import os
import re
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, Callable
import yt_dlp
import imageio_ffmpeg

DOWNLOADS_DIR = Path("downloads").resolve()


def clean_course_name(course_name: str) -> str:
    """Strips dynamic batch/week suffixes like '(Week 2/12)' or '(DSTP2.0-Batch-01)' from course title."""
    if not course_name:
        return "Course"
    # Remove patterns like (Week X/Y), (Week X_Y), (Week X), (DSTP...)
    cleaned = re.sub(r'\s*\((?:Week|DSTP).*?\)', '', course_name, flags=re.IGNORECASE).strip()
    return cleaned or course_name


def sanitize_filename(name: str) -> str:
    """Sanitizes a string to be a safe filename for Windows/NTFS filesystems."""
    if not name:
        return "file"
    # Remove invalid NTFS chars: < > : " / \ | ? *
    clean = re.sub(r'[<>:"/\\|?*]', '_', name)
    # Remove control chars and non-printable chars
    clean = re.sub(r'[\x00-\x1f\x7f]', '', clean)
    # Strip leading/trailing spaces and dots
    clean = clean.strip(" .")
    return clean or "file"


class VideoDownloader:
    def __init__(self, downloads_dir: Optional[Path] = None):
        self.downloads_dir = (downloads_dir or DOWNLOADS_DIR).resolve()
        self.downloads_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            self.ffmpeg_path = None

    def get_target_path(self, course_name: str, week: str, topic_title: str, lecture_number: Optional[int] = None) -> Path:
        """Constructs the canonical file path: downloads/<CleanCourse>/<CleanWeek>/<CleanFilename>.mp4"""
        pure_course = clean_course_name(course_name)
        clean_course = sanitize_filename(pure_course)
        clean_week = sanitize_filename(week)
        clean_title = sanitize_filename(topic_title)

        if lecture_number is not None:
            filename = f"Topic {lecture_number:03d} - {clean_title}.mp4"
        else:
            filename = f"{clean_title}.mp4"

        target_folder = self.downloads_dir / clean_course / clean_week
        target_folder.mkdir(parents=True, exist_ok=True)
        return target_folder / filename

    def check_exists(self, course_name: str, week: str, topic_title: str, lecture_number: Optional[int] = None) -> Dict[str, Any]:
        """Checks if the target MP4 file already exists on disk."""
        target_path = self.get_target_path(course_name, week, topic_title, lecture_number)
        if target_path.exists() and target_path.stat().st_size > 10000:
            return {
                "exists": True,
                "file_path": str(target_path),
                "file_name": target_path.name,
                "file_size": target_path.stat().st_size
            }
        return {"exists": False, "file_path": str(target_path), "file_name": target_path.name, "file_size": 0}

    async def download_video(
        self,
        youtube_url: str,
        course_name: str,
        week: str,
        topic_title: str,
        lecture_number: Optional[int] = None,
        overwrite: bool = False,
        quality: str = "1080p",
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None
    ) -> Dict[str, Any]:
        """Downloads a single YouTube video to the structured course/week directory."""
        target_path = self.get_target_path(course_name, week, topic_title, lecture_number)

        # File existence & safe overwrite check
        if target_path.exists():
            if not overwrite:
                return {
                    "status": "already_exists",
                    "message": f"File '{target_path.name}' already exists.",
                    "file_path": str(target_path),
                    "file_name": target_path.name,
                    "file_size": target_path.stat().st_size
                }
            else:
                try:
                    target_path.unlink()
                except Exception:
                    pass

        # Clean up any residual temp/part files before launching yt-dlp
        for temp_ext in [".temp.mp4", ".part", ".ytdl", ".old"]:
            try:
                tf = target_path.with_suffix(temp_ext)
                if tf.exists():
                    tf.unlink()
            except Exception:
                pass

        # Choose format specification with automatic quality fallback (1080p -> 720p -> 480p -> 360p -> best)
        if quality == "best" or quality == "1080p":
            format_spec = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo+bestaudio/best"
        elif quality == "720p":
            format_spec = "bestvideo[height<=720]+bestaudio/best[height<=720]/bestvideo+bestaudio/best"
        elif quality == "480p":
            format_spec = "bestvideo[height<=480]+bestaudio/best[height<=480]/bestvideo+bestaudio/best"
        elif quality == "360p":
            format_spec = "bestvideo[height<=360]+bestaudio/best[height<=360]/best"
        elif quality == "audio":
            format_spec = "bestaudio[ext=m4a]/bestaudio/best"
        else: # Default 1080p with fallback
            format_spec = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo+bestaudio/best"

        def progress_hook(d):
            if progress_callback and d.get("status") == "downloading":
                total_bytes = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                pct = (downloaded / total_bytes * 100) if total_bytes > 0 else 0
                speed = d.get("speed") or 0
                eta = d.get("eta") or 0

                speed_str = f"{speed / 1024 / 1024:.2f} MB/s" if speed else "N/A"
                downloaded_mb = f"{downloaded / 1024 / 1024:.1f} MB"
                total_mb = f"{total_bytes / 1024 / 1024:.1f} MB" if total_bytes > 0 else "N/A"

                progress_callback({
                    "type": "progress",
                    "status": "downloading",
                    "percent": round(pct, 1),
                    "downloaded_bytes": downloaded,
                    "total_bytes": total_bytes,
                    "downloaded_mb": downloaded_mb,
                    "total_mb": total_mb,
                    "speed_str": speed_str,
                    "eta": eta,
                    "file_name": target_path.name
                })

        # Try multiple player_client configurations if 403 Forbidden occurs
        client_configs = [
            ["android_vr", "web_creator", "ios"],
            ["android", "web"],
            ["mweb", "android_vr"],
            []  # Default yt-dlp client handling
        ]

        last_ex = None
        for client_list in client_configs:
            ydl_opts = {
                "format": format_spec,
                "outtmpl": str(target_path),
                "progress_hooks": [progress_hook],
                "quiet": True,
                "no_warnings": True,
                "nocheckcertificate": True,
                "overwrites": overwrite,
                "merge_output_format": "mp4",
                "retries": 10,
                "fragment_retries": 10,
                "concurrent_fragment_downloads": 1
            }

            if client_list:
                ydl_opts["extractor_args"] = {
                    "youtube": {
                        "player_client": client_list
                    }
                }

            if self.ffmpeg_path:
                ydl_opts["ffmpeg_location"] = self.ffmpeg_path

            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: yt_dlp.YoutubeDL(ydl_opts).download([youtube_url]))

                if target_path.exists() and target_path.stat().st_size > 0:
                    if progress_callback:
                        progress_callback({
                            "type": "complete",
                            "status": "success",
                            "percent": 100.0,
                            "file_path": str(target_path),
                            "file_name": target_path.name
                        })
                    return {
                        "status": "success",
                        "message": f"Successfully downloaded '{target_path.name}'",
                        "file_path": str(target_path),
                        "file_name": target_path.name,
                        "file_size": target_path.stat().st_size
                    }
            except Exception as ex:
                last_ex = ex
                print(f"[Downloader Retry] Client {client_list} hit: {ex}. Trying next client...")
                await asyncio.sleep(1)

        print(f"[Downloader Error] {youtube_url}: {last_ex}")
        return {
            "status": "error",
            "message": f"Failed to download video: {str(last_ex)}",
            "file_path": str(target_path)
        }
