import os
import sys
import re
import json
import asyncio
import argparse
from typing import List, Dict, Any, Optional
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, Response, BackgroundTasks, Query
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from extractor.browser import BrowserManager
from extractor.digiskills import DigiSkillsExtractor
from extractor.exporter import DataExporter

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    global browser_manager
    browser_manager = BrowserManager(headless=True)
    yield
    if browser_manager:
        await browser_manager.close()

app = FastAPI(title="DigiSkills Video Links Extractor", version="1.0.0", lifespan=lifespan)

web_dir = Path(__file__).parent / "web"
app.mount("/web", StaticFiles(directory=str(web_dir)), name="web")

@app.get("/", response_class=HTMLResponse)
async def index_page():
    html_path = web_dir / "index.html"
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

STATE_FILE = Path("./.auth/state.json")
USER_DATA_DIR = Path("./.auth/user_data")

# Cache the last known live session result to avoid checking on every poll
_session_cache = {"logged_in": False, "checked_at": 0.0}

async def _do_live_session_check() -> bool:
    """Verify session by checking state.json and using browser_manager context cleanly."""
    global browser_manager
    if not STATE_FILE.exists():
        return False
    try:
        if not browser_manager:
            browser_manager = BrowserManager()
        context = await browser_manager.initialize(force_headful=False)
        if STATE_FILE.exists():
            try:
                state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                if state.get("cookies"):
                    await context.add_cookies(state["cookies"])
            except Exception:
                pass
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://lms.digiskills.pk/Default.aspx", wait_until="domcontentloaded", timeout=10000)
        return "login" not in page.url.lower()
    except Exception as e:
        print(f"[Session Check Error] {e}")
        # Fallback check if state file has valid session cookies
        try:
            if STATE_FILE.exists():
                state_data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                cookies = state_data.get("cookies", [])
                return len(cookies) > 0
        except Exception:
            pass
        return False


@app.get("/api/status")
async def check_status():
    """Fast session status check: verifies state.json session cookies instantly."""
    if not STATE_FILE.exists():
        return {
            "logged_in": False,
            "message": "No active session file. Please click Login Browser."
        }
    
    try:
        state_data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        cookies = state_data.get("cookies", [])
        if cookies:
            return {
                "logged_in": True,
                "message": "DigiSkills Session Active"
            }
    except Exception as e:
        print(f"[Status Check Error] {e}")

    return {
        "logged_in": False,
        "message": "Session expired. Click Login Browser to log in."
    }


@app.post("/api/logout")
async def logout():
    """Destroy session by deleting state.json and clearing cache."""
    global _session_cache
    try:
        if STATE_FILE.exists():
            STATE_FILE.unlink()
        # Also clear user_data cookies folder
        import shutil
        cookies_file = USER_DATA_DIR / "Default" / "Cookies"
        if cookies_file.exists():
            cookies_file.unlink()
        _session_cache = {"logged_in": False, "checked_at": 0.0}
        return {"status": "success", "message": "Logged out. Session destroyed."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


import subprocess

@app.post("/api/login")
async def interactive_login():
    try:
        if sys.platform == "win32":
            subprocess.Popen(f'cmd.exe /c start "" "{sys.executable}" -m extractor.login_window', shell=True, cwd=str(Path(__file__).parent.resolve()))
        else:
            subprocess.Popen([sys.executable, "-m", "extractor.login_window"], cwd=str(Path(__file__).parent.resolve()))
            
        return {
            "status": "success",
            "message": "Interactive browser window launched! Log into DigiSkills in the opened window, then click 'Fetch Courses'."
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to launch login window: {str(e)}"}

@app.post("/api/auto-login")
async def auto_login():
    global browser_manager
    if not browser_manager:
        browser_manager = BrowserManager()
    
    res = await browser_manager.perform_auto_login()
    return res

@app.get("/api/courses")
async def get_courses():
    global browser_manager, _session_cache
    if not browser_manager:
        return {"courses": []}
    
    try:
        context = await browser_manager.initialize(force_headful=False)
        # Reload fresh cookies into existing context
        if STATE_FILE.exists():
            try:
                state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                if state.get("cookies"):
                    await context.add_cookies(state["cookies"])
            except Exception as ck_err:
                print(f"[Courses] Cookie reload error: {ck_err}")
        page = context.pages[0] if context.pages else await context.new_page()
        extractor = DigiSkillsExtractor(browser_manager)
        courses = await extractor.get_enrolled_courses(page)
        # Update session cache based on what get_enrolled_courses discovered
        if courses:
            import time
            _session_cache = {"logged_in": True, "checked_at": time.time()}
        return {"courses": courses}
    except Exception as e:
        return {"courses": [], "error": str(e)}

@app.get("/api/course-weeks")
async def get_course_weeks(button_id: Optional[str] = None, course_title: str = "Course"):
    global browser_manager
    if not browser_manager:
        return {"weeks": []}
    try:
        context = await browser_manager.initialize(force_headful=False)
        if STATE_FILE.exists():
            try:
                state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                if state.get("cookies"):
                    await context.add_cookies(state["cookies"])
            except Exception:
                pass
        page = context.pages[0] if context.pages else await context.new_page()
        extractor = DigiSkillsExtractor(browser_manager)
        weeks = await extractor.get_course_weeks_live(page, course_title, button_id)
        return {"weeks": weeks}
    except Exception as e:
        return {"weeks": [], "error": str(e)}


@app.get("/api/stream-extraction")
async def stream_extraction(
    course_url: str,
    course_title: str = "Course",
    button_id: Optional[str] = None,
    target_week: Optional[str] = "ALL",
    force_live: bool = Query(False)
):
    global browser_manager, latest_extracted_data, active_extractor
    
    async def event_generator():
        global latest_extracted_data, active_extractor
        latest_extracted_data = []
        queue = asyncio.Queue()

        def on_progress(event: Dict[str, Any]):
            asyncio.run_coroutine_threadsafe(queue.put(event), loop)

        loop = asyncio.get_event_loop()
        
        if not browser_manager:
            await queue.put({"type": "error", "data": {"message": "Browser uninitialized"}})
            return

        context = await browser_manager.initialize(force_headful=False)
        # Reload fresh cookies before extraction
        if STATE_FILE.exists():
            try:
                state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                if state.get("cookies"):
                    await context.add_cookies(state["cookies"])
            except Exception:
                pass
        page = context.pages[0] if context.pages else await context.new_page()

        active_extractor = DigiSkillsExtractor(browser_manager, progress_callback=on_progress)
        target_param = button_id or course_url
        
        async def run_extraction():
            try:
                lectures = await active_extractor.extract_course_lectures(page, course_title, target_param, target_week, force_live=force_live)
                latest_extracted_data.clear()
                latest_extracted_data.extend(lectures)
            except Exception as ex:
                await queue.put({"type": "error", "data": {"message": str(ex)}})


        asyncio.create_task(run_extraction())

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=60.0)
                yield f"data: {json.dumps(event)}\n\n"
                
                if event.get("type") == "course_complete":
                    try:
                        clean_title = re.sub(r'[^\w\s-]', '', course_title).strip().replace(" ", "_")
                        DataExporter.export_to_txt(latest_extracted_data, f"{clean_title}.txt")
                        DataExporter.export_to_csv(latest_extracted_data, f"{clean_title}.csv")
                        DataExporter.export_to_excel(latest_extracted_data, f"{clean_title}.xlsx")
                        DataExporter.export_to_json(latest_extracted_data, f"{clean_title}.json")
                        DataExporter.export_to_txt(latest_extracted_data, "digiskills_lectures.txt")
                    except Exception as exp_err:
                        print(f"[Auto Export Error] {exp_err}")
                    break
                elif event.get("type") in ["stopped", "error"]:
                    break
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'ping', 'data': {}})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/stop")
async def stop_extraction():
    global active_extractor
    if active_extractor:
        active_extractor.stop_requested = True
        return {"status": "stopped"}
    return {"status": "idle"}

@app.get("/api/export/txt")
async def export_txt():
    global latest_extracted_data
    if not latest_extracted_data:
        return JSONResponse(status_code=400, content={"message": "No extracted data available"})
    file_path = DataExporter.export_to_txt(latest_extracted_data)
    return FileResponse(file_path, media_type="text/plain", filename="digiskills_lectures.txt")

@app.get("/api/export/csv")
async def export_csv():
    global latest_extracted_data
    if not latest_extracted_data:
        return JSONResponse(status_code=400, content={"message": "No extracted data available"})
    file_path = DataExporter.export_to_csv(latest_extracted_data)
    return FileResponse(file_path, media_type="text/csv", filename="digiskills_lectures.csv")

@app.get("/api/export/excel")
async def export_excel():
    global latest_extracted_data
    if not latest_extracted_data:
        return JSONResponse(status_code=400, content={"message": "No extracted data available"})
    file_path = DataExporter.export_to_excel(latest_extracted_data)
    return FileResponse(file_path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename="digiskills_lectures.xlsx")

@app.get("/api/export/json")
async def export_json():
    global latest_extracted_data
    if not latest_extracted_data:
        return JSONResponse(status_code=400, content={"message": "No extracted data available"})
    file_path = DataExporter.export_to_json(latest_extracted_data)
    return FileResponse(file_path, media_type="application/json", filename="digiskills_lectures.json")

from extractor.downloader import VideoDownloader, DOWNLOADS_DIR

video_downloader = VideoDownloader()

@app.post("/api/check-download-status")
async def check_download_status(request: Request):
    """Checks if requested videos already exist on disk."""
    try:
        body = await request.json()
        items = body.get("items", [])
        results = {}
        for idx, item in enumerate(items):
            c_name = item.get("course_name", "Course")
            week = item.get("week", "Week 01")
            t_title = item.get("topic_title", "Topic")
            lec_num = item.get("lecture_number")
            status = video_downloader.check_exists(c_name, week, t_title, lec_num)
            results[str(idx)] = status
        return JSONResponse(results)
    except Exception as ex:
        return JSONResponse(status_code=500, content={"error": str(ex)})

@app.post("/api/download-single-mp4")
async def download_single_mp4(request: Request):
    """Downloads a single video MP4 with progress reporting."""
    try:
        body = await request.json()
        yt_url = body.get("youtube_url")
        if not yt_url or "youtube" not in yt_url.lower() and "youtu.be" not in yt_url.lower():
            return JSONResponse(status_code=400, content={"status": "error", "message": "Invalid or missing YouTube URL"})

        c_name = body.get("course_name", "Course")
        week = body.get("week", "Week 01")
        t_title = body.get("topic_title", "Topic")
        lec_num = body.get("lecture_number")
        overwrite = body.get("overwrite", False)
        quality = body.get("quality", "720p")

        result = await video_downloader.download_video(
            youtube_url=yt_url,
            course_name=c_name,
            week=week,
            topic_title=t_title,
            lecture_number=lec_num,
            overwrite=overwrite,
            quality=quality
        )
        return JSONResponse(result)
    except Exception as ex:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(ex)})

@app.get("/api/open-downloads-folder")
async def open_downloads_folder():
    """Opens the local downloads directory in Windows File Explorer."""
    try:
        folder = DOWNLOADS_DIR.resolve()
        folder.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(str(folder))
        elif sys.platform == "darwin":
            import subprocess
            subprocess.Popen(["open", str(folder)])
        else:
            import subprocess
            subprocess.Popen(["xdg-open", str(folder)])
        return JSONResponse({"status": "success", "message": f"Opened downloads folder: {folder}"})
    except Exception as ex:
        print(f"[Open Folder Error] {ex}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(ex)})


@app.get("/api/scan-downloads-folder")
async def scan_downloads_folder():
    """Scans the downloads folder and returns all existing MP4 video files."""
    try:
        downloads_dir = DOWNLOADS_DIR.resolve()
        files = []
        if downloads_dir.exists():
            for p in downloads_dir.glob("**/*.mp4"):
                if p.is_file():
                    stat = p.stat()
                    rel_parts = p.relative_to(downloads_dir).parts
                    c_name = rel_parts[0] if len(rel_parts) > 1 else "Downloads"
                    w_name = rel_parts[1] if len(rel_parts) > 2 else "Week"
                    files.append({
                        "file_name": p.name,
                        "file_path": str(p),
                        "file_size_mb": round(stat.st_size / (1024 * 1024), 1),
                        "course_name": c_name,
                        "week": w_name
                    })
        return JSONResponse({"status": "success", "files": files})
    except Exception as ex:
        return JSONResponse(status_code=500, content={"status": "error", "message": str(ex)})



def run_cli_mode():
    """CLI mode for direct command line execution."""
    print("==================================================")
    print("   DigiSkills Video Links Extractor (CLI Mode)    ")
    print("==================================================")
    
    async def main_cli():
        bm = BrowserManager(headless=False)
        print("[1] Opening browser for DigiSkills login...")
        await bm.launch_interactive_login()
        input("Press ENTER after completing login in the opened browser window...")
        
        context = await bm.initialize(force_headful=False)
        page = context.pages[0] if context.pages else await context.new_page()
        
        extractor = DigiSkillsExtractor(bm, progress_callback=lambda p: print(f"[{p['type'].upper()}] {p['data']}"))
        courses = await extractor.get_enrolled_courses(page)
        
        print("\nEnrolled Courses Found:")
        for idx, c in enumerate(courses, 1):
            print(f"  {idx}. {c['title']} ({c['url']})")
            
        target_url = input("\nEnter Course URL or select course number: ").strip()
        if target_url.isdigit() and 1 <= int(target_url) <= len(courses):
            selected = courses[int(target_url) - 1]
            course_url = selected['url']
            course_title = selected['title']
        else:
            course_url = target_url
            course_title = "Selected Course"

        lectures = await extractor.extract_course_lectures(page, course_title, course_url)
        
        csv_file = DataExporter.export_to_csv(lectures)
        excel_file = DataExporter.export_to_excel(lectures)
        json_file = DataExporter.export_to_json(lectures)
        
        print("\nExtraction Complete!")
        print(f"Saved CSV:   {csv_file}")
        print(f"Saved Excel: {excel_file}")
        print(f"Saved JSON:  {json_file}")
        
        await bm.close()

    asyncio.run(main_cli())

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DigiSkills Video Links Extractor")
    parser.add_argument("--cli", action="store_true", help="Run in Command-Line Interface mode")
    parser.add_argument("--port", type=int, default=8000, help="Port for web dashboard server (default: 8000)")
    args = parser.parse_args()

    if args.cli:
        run_cli_mode()
    else:
        print(f"Starting DigiSkills Video Extractor Web UI on http://localhost:{args.port}")
        uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")
