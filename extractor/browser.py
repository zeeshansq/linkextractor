import os
import json
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any, List
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, ElementHandle

from dotenv import load_dotenv

load_dotenv()

AUTH_DIR = Path("./.auth")
STATE_FILE = AUTH_DIR / "state.json"
USER_DATA_DIR = AUTH_DIR / "user_data"

class BrowserManager:
    def __init__(self, headless: Optional[bool] = None):
        if headless is None:
            env_headless = os.getenv("HEADLESS", "true").lower()
            self.headless = env_headless not in ("false", "0", "no")
        else:
            self.headless = headless
        self.playwright = None
        self.context: Optional[BrowserContext] = None
        self.browser: Optional[Browser] = None

    async def initialize(self, force_headful: bool = False):
        AUTH_DIR.mkdir(exist_ok=True)
        if not self.playwright:
            self.playwright = await async_playwright().start()
        
        is_headless = self.headless if not force_headful else False
        
        if not self.browser:
            self.browser = await self.playwright.chromium.launch(
                headless=is_headless,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-setuid-sandbox"
                ]
            )

        if not self.context:
            context_kwargs = {
                "viewport": {"width": 1366, "height": 768},
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            if STATE_FILE.exists():
                try:
                    context_kwargs["storage_state"] = str(STATE_FILE)
                    print(f"[BrowserManager] Initialized context with storage state from {STATE_FILE}")
                except Exception as e:
                    print(f"[BrowserManager] Warning loading storage state: {e}")

            self.context = await self.browser.new_context(**context_kwargs)
        else:
            if STATE_FILE.exists():
                try:
                    state_data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                    if "cookies" in state_data and state_data["cookies"]:
                        await self.context.clear_cookies()
                        await self.context.add_cookies(state_data["cookies"])
                except Exception as e:
                    print(f"[BrowserManager] Warning refreshing state cookies: {e}")

        return self.context


    async def launch_interactive_login(self, target_url: str = None) -> Dict[str, Any]:
        """Launches a headful browser session allowing user to log in interactively."""
        login_url = target_url or os.getenv("DIGISKILLS_LOGIN_URL", "https://lms.digiskills.pk/Login.aspx")
        
        # Close existing context if running headlessly
        if self.context:
            try:
                await self.context.close()
            except Exception:
                pass
            self.context = None

        await self.initialize(force_headful=True)
            
        page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        await page.goto(login_url, wait_until="domcontentloaded")
        
        # Save state upon login detection
        await page.context.storage_state(path=str(STATE_FILE))
        return {"status": "success", "message": "Interactive browser opened. Please log into DigiSkills."}

    async def perform_auto_login(self, email: Optional[str] = None, password: Optional[str] = None) -> Dict[str, Any]:
        """Attempts automated headless/headful login using credentials from .env or parameters."""
        user_email = email or os.getenv("DIGISKILLS_EMAIL", "").strip()
        user_pass = password or os.getenv("DIGISKILLS_PASSWORD", "").strip()
        login_url = os.getenv("DIGISKILLS_LOGIN_URL", "https://lms.digiskills.pk/Login.aspx")

        if not user_email or not user_pass or "example.com" in user_email or "your_password" in user_pass:
            return {
                "status": "error",
                "message": "Please open the .env file and enter your actual DIGISKILLS_EMAIL and DIGISKILLS_PASSWORD!"
            }

        context = await self.initialize()
        page = context.pages[0] if context.pages else await context.new_page()

        try:
            await page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(1)

            # Target exact DigiSkills ASP.NET input IDs: #txtStudentId, #txtNewPassword
            email_field = await page.query_selector("#txtStudentId, #txtEmail, #txtUserName, input[name*='StudentId'], input[name*='Email'], input[type='email']")
            if not email_field:
                email_field = await page.query_selector("input[type='text']")

            pass_field = await page.query_selector("#txtNewPassword, #txtPassword, input[name*='Password'], input[type='password']")

            login_btn = await page.query_selector("#btnLogin, input[name*='btnLogin'], button[type='submit'], input[type='submit']")

            if email_field and pass_field:
                await email_field.fill(user_email)
                await pass_field.fill(user_pass)
                
                if login_btn:
                    await login_btn.click()
                else:
                    await pass_field.press("Enter")

                await asyncio.sleep(4)
                
                # Check if login succeeded
                if await self.check_logged_in(page):
                    await page.context.storage_state(path=str(STATE_FILE))
                    return {"status": "success", "message": f"Successfully logged into DigiSkills as {user_email}"}
                else:
                    # Check for on-screen error alerts
                    err_elem = await page.query_selector("#lblError, .alert-danger, .error-message, .alert")
                    err_msg = (await err_elem.inner_text()).strip() if err_elem else ""
                    if err_msg:
                        return {"status": "error", "message": f"DigiSkills LMS Error: {err_msg}"}
                    
                    return {
                        "status": "warning",
                        "message": f"Login submitted for {user_email}. If your credentials are valid, click 'Fetch Courses' or try 'Login Browser'."
                    }
            else:
                return {"status": "error", "message": "Could not find DigiSkills login form fields on page."}

        except Exception as e:
            return {"status": "error", "message": f"Auto-login failed: {str(e)}"}

    async def check_logged_in(self, page: Page) -> bool:
        """Verifies if the user is currently logged into DigiSkills LMS dashboard."""
        try:
            # Navigate to Default.aspx to verify session
            current_url = page.url.lower()
            if "default" not in current_url and "dashboard" not in current_url:
                await page.goto("https://lms.digiskills.pk/Default.aspx", wait_until="domcontentloaded")
                await asyncio.sleep(1)

            final_url = page.url.lower()
            if "login" in final_url or "signin" in final_url:
                return False
            
            # Check dashboard elements
            dashboard_elem = await page.query_selector("#CourseHeading, .courses-items, .bg-courses, .course-list, #divCourses, a[href*='Logout'], a[href*='logout']")
            return dashboard_elem is not None or "default" in final_url or "dashboard" in final_url
        except Exception:
            return False

    async def close(self):
        if self.context:
            try:
                if STATE_FILE.parent.exists():
                    await self.context.storage_state(path=str(STATE_FILE))
                await self.context.close()
            except Exception:
                pass
            self.context = None
        if self.browser:
            try:
                await self.browser.close()
            except Exception:
                pass
            self.browser = None
        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception:
                pass
            self.playwright = None

    @staticmethod
    async def extract_youtube_url(page: Page, timeout: float = 3.5) -> Dict[str, Optional[str]]:
        """Dynamically polls until YouTube iframe or overview description is present in DOM.
        Extracts YouTube embedded video URL, ID, thumbnail, and overview text as soon as loaded.
        """
        import time
        video_info = {
            "youtube_url": None,
            "video_id": None,
            "embed_url": None,
            "thumbnail_url": None,
            "description": None
        }

        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                # 1. Check for topic overview text inside divContent divs
                if not video_info["description"]:
                    desc_elems = await page.query_selector_all("div[id^='divContent-']")
                    for desc_elem in desc_elems:
                        txt = (await desc_elem.inner_text()).strip()
                        if txt and not txt.startswith("Rate this video") and len(txt) > 15:
                            video_info["description"] = " ".join(txt.split())
                            break

                # 2. Search for YouTube frame URLs in page frames
                for frame in page.frames:
                    frame_url = frame.url
                    if "youtube.com/embed/" in frame_url or "youtu.be/" in frame_url or "youtube-nocookie.com/" in frame_url:
                        video_id = BrowserManager._parse_youtube_id(frame_url)
                        if video_id:
                            video_info["video_id"] = video_id
                            video_info["youtube_url"] = f"https://www.youtube.com/watch?v={video_id}"
                            video_info["embed_url"] = f"https://www.youtube.com/embed/{video_id}"
                            video_info["thumbnail_url"] = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
                            return video_info

                # 3. Search DOM iframe attributes (src, id)
                iframes = await page.query_selector_all("iframe")
                for iframe in iframes:
                    src = await iframe.get_attribute("src") or ""
                    iframe_id = await iframe.get_attribute("id") or ""
                    video_id = BrowserManager._parse_youtube_id(src) or BrowserManager._parse_youtube_id(iframe_id)
                    if video_id:
                        video_info["embed_url"] = f"https://www.youtube.com/embed/{video_id}"
                        video_info["video_id"] = video_id
                        video_info["youtube_url"] = f"https://www.youtube.com/watch?v={video_id}"
                        video_info["thumbnail_url"] = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
                        return video_info

                # 4. Fallback: check page HTML content
                content = await page.content()
                video_id = BrowserManager._parse_youtube_id(content)
                if video_id:
                    video_info["video_id"] = video_id
                    video_info["youtube_url"] = f"https://www.youtube.com/watch?v={video_id}"
                    video_info["embed_url"] = f"https://www.youtube.com/embed/{video_id}"
                    video_info["thumbnail_url"] = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
                    return video_info

            except Exception:
                pass

            # Short poll delay
            await asyncio.sleep(0.15)

        return video_info


    @staticmethod
    def _parse_youtube_id(url_or_text: str) -> Optional[str]:
        import re
        if not url_or_text:
            return None

        patterns = [
            r'(?:v=|\/embed\/|\/v\/|youtu\.be\/|\/watch\?v=|\/shorts\/)([a-zA-Z0-9_-]{11})',
            r'youtube\.com\/embed\/([a-zA-Z0-9_-]{11})',
            r'CourseTopicDetail_files\/([a-zA-Z0-9_-]{11})',
            r'PreviousCoursesVideos_files\/([a-zA-Z0-9_-]{11})',
            r'(?:VideoID|video_id|v)\s*[:=]\s*["\']([a-zA-Z0-9_-]{11})["\']'
        ]
        for pattern in patterns:
            match = re.search(pattern, url_or_text)
            if match:
                return match.group(1)
        
        # Check if the string itself is an 11-char ID (e.g. iframe id="8yQIL5xQCGQ")
        clean_str = url_or_text.strip()
        if len(clean_str) == 11 and re.match(r'^[a-zA-Z0-9_-]{11}$', clean_str):
            return clean_str

        return None
