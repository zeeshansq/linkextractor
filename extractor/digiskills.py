import asyncio
import re
from pathlib import Path
from typing import List, Dict, Any, Callable, Optional
from playwright.async_api import Page
from extractor.browser import BrowserManager

from extractor.cache_manager import CacheManager

BASE_URL = "https://lms.digiskills.pk"


class DigiSkillsExtractor:
    def __init__(self, browser_manager: BrowserManager, progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.bm = browser_manager
        self.progress_callback = progress_callback
        self.stop_requested = False
        self.cache_mgr = CacheManager()

    def emit_progress(self, event_type: str, data: Dict[str, Any]):
        if self.progress_callback:
            try:
                self.progress_callback({"type": event_type, "data": data})
            except Exception as e:
                print(f"[Progress Callback Error] {e}")

    async def _is_logged_in(self, page: Page) -> bool:
        """Quick check: are we on a real page (not redirected to Login)?"""
        return "login" not in page.url.lower()

    async def _dismiss_modals(self, page: Page):
        """Dismisses any popup dialogs/overlays (e.g. Trainee Survey #mViewSurvey) that intercept pointer events."""
        try:
            await page.evaluate("""() => {
                document.querySelectorAll('[data-dismiss="modal"], .close, #btnSurveyAskLater').forEach(b => {
                    try { b.click(); } catch(e) {}
                });
                document.querySelectorAll('.modal').forEach(m => {
                    m.classList.remove('in');
                    m.style.display = 'none';
                    m.setAttribute('aria-hidden', 'true');
                });
                document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                document.body.classList.remove('modal-open');
            }""")
        except Exception as e:
            print(f"[DigiSkillsExtractor] Note dismissing modals: {e}")

    async def _open_course_page(self, page: Page, course_title: str, button_id: Optional[str] = None) -> bool:
        """Navigates to the course page (CourseWebsite.aspx or PreviousCoursesVideos.aspx)
        handling ASP.NET postbacks, modal dismissals, disabled active course buttons, and accordion expansion.
        """
        try:
            # 1. Dismiss any blocking modals (e.g. Trainee Survey #mViewSurvey)
            await self._dismiss_modals(page)

            # 2. Expand all previous course accordions so elements are in DOM
            await page.evaluate("""() => {
                document.querySelectorAll('#ctl00_ContentPlaceHolder1_divPreviousCourses .panel-collapse').forEach(el => {
                    el.classList.add('in');
                    el.style.display = 'block';
                });
            }""")
            await asyncio.sleep(0.3)

            # 3. Check if we have an exact button_id
            target_btn = None
            if button_id and not button_id.startswith("http"):
                target_btn = await page.query_selector(f"#{button_id}")

            is_disabled = False
            if target_btn:
                dis_attr = await target_btn.get_attribute("disabled")
                is_disabled = dis_attr is not None

            # If button not found or disabled (e.g. active course batch ended), search for active matching button in Previous Courses
            if not target_btn or is_disabled:
                clean_target = re.sub(r'\s*\((?:Week|DSTP).*?\)', '', course_title, flags=re.IGNORECASE).strip().lower()
                all_site_btns = await page.query_selector_all("a[id*='linkPreviousCourse'], a[id*='btnCourseWebsite']")
                for sbtn in all_site_btns:
                    s_dis = (await sbtn.get_attribute("disabled")) is not None
                    if s_dis:
                        continue
                    heading = await sbtn.query_selector("#CourseHeading, .courses-heading, #lblmdbtitle")
                    htxt = " ".join((await heading.inner_text()).strip().split()) if heading else ""
                    if not htxt and await sbtn.inner_text():
                        htxt = " ".join((await sbtn.inner_text()).strip().split())

                    clean_h = re.sub(r'\s*\((?:Week|DSTP).*?\)', '', htxt, flags=re.IGNORECASE).strip().lower()
                    if clean_target and (clean_target in clean_h or clean_h in clean_target):
                        target_btn = sbtn
                        print(f"[DigiSkillsExtractor] Found active alternative button: {await sbtn.get_attribute('id')} ({htxt})")
                        break

            if not target_btn:
                print(f"[DigiSkillsExtractor] Warning: Could not locate a valid clickable button for '{course_title}'")
                return False

            # Dismiss modals again right before click to ensure no new dialog appeared
            await self._dismiss_modals(page)

            # Trigger navigation: check for ASP.NET __doPostBack in href or evaluate
            href = (await target_btn.get_attribute("href")) or ""
            target_id = (await target_btn.get_attribute("id")) or ""

            if "__doPostBack" in href:
                pb_match = re.search(r"__doPostBack\('([^']*)'", href)
                if pb_match:
                    pb_target = pb_match.group(1)
                    await page.evaluate(f"__doPostBack('{pb_target}', '')")
                else:
                    await target_btn.click(force=True, timeout=5000)
            elif "linkPreviousCourse" in target_id or "btnCourseWebsite" in target_id:
                pb_target = target_id.replace('_', '$')
                try:
                    await page.evaluate(f"__doPostBack('{pb_target}', '')")
                except Exception:
                    await target_btn.click(force=True, timeout=5000)
            else:
                await target_btn.click(force=True, timeout=5000)

            # Wait for navigation to complete
            for _ in range(20):  # poll up to 6 seconds
                await asyncio.sleep(0.3)
                curr_url = page.url
                if "CourseWebsite" in curr_url or "PreviousCoursesVideos" in curr_url:
                    break

            try:
                await page.wait_for_load_state("domcontentloaded", timeout=4000)
            except Exception:
                pass

            success = "CourseWebsite" in page.url or "PreviousCoursesVideos" in page.url
            print(f"[DigiSkillsExtractor] Opened course page ({page.url}) -> Success: {success}")
            return success

        except Exception as e:
            print(f"[DigiSkillsExtractor] Error opening course page: {e}")
            return False

    async def get_enrolled_courses(self, page: Page) -> List[Dict[str, Any]]:
        """Scrapes active AND previous enrolled courses live from the student dashboard (Default.aspx)."""
        courses = []
        try:
            await page.goto(f"{BASE_URL}/Default.aspx", wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(1.5)
            await self._dismiss_modals(page)

            if not await self._is_logged_in(page):
                print("[DigiSkillsExtractor] Not logged in - redirected to Login.aspx")
                return courses

            seen = set()

            # 1. Active Enrolled Courses
            cards = await page.query_selector_all("a[id*='btnCourseWebsite']")
            for btn in cards:
                btn_id = await btn.get_attribute("id") or ""
                dis = await btn.get_attribute("disabled")
                is_disabled = dis is not None
                parent = await btn.query_selector("xpath=ancestor::div[contains(@class,'courses-items') or contains(@class,'bg-courses')]")
                title = ""
                if parent:
                    heading_elem = await parent.query_selector("#CourseHeading, .courses-heading")
                    if heading_elem:
                        title = " ".join((await heading_elem.inner_text()).strip().split())

                if not title:
                    title = btn_id

                if title and title not in seen:
                    seen.add(title)
                    courses.append({
                        "id": f"course_{len(courses)+1}",
                        "title": title,
                        "url": f"{BASE_URL}/CourseWebsite.aspx",
                        "button_id": btn_id,
                        "is_previous": False,
                        "is_disabled": is_disabled
                    })

            # 2. My Previous Courses (Grouped by Batch)
            prev_section = await page.query_selector("#ctl00_ContentPlaceHolder1_divPreviousCourses")
            if prev_section:
                # Expand all collapsed batch accordion panels in previous courses section
                await page.evaluate("""() => {
                    document.querySelectorAll('#ctl00_ContentPlaceHolder1_divPreviousCourses .panel-collapse').forEach(el => {
                        el.classList.add('in');
                        el.style.display = 'block';
                    });
                }""")
                await asyncio.sleep(0.5)

                prev_links = await page.query_selector_all("a[id*='linkPreviousCourse']")
                for pbtn in prev_links:
                    pbtn_id = await pbtn.get_attribute("id") or ""
                    batch_name = ""
                    panel = await pbtn.query_selector("xpath=ancestor::div[contains(@class,'panel-default')]")
                    if panel:
                        header_elem = await panel.query_selector(".panel-title a")
                        if header_elem:
                            batch_name = " ".join((await header_elem.inner_text()).strip().split())

                    title_elem = await pbtn.query_selector("#lblmdbtitle, .courses-heading")
                    ctitle = ""
                    if title_elem:
                        ctitle = " ".join((await title_elem.inner_text()).strip().split())
                    elif await pbtn.inner_text():
                        ctitle = " ".join((await pbtn.inner_text()).strip().split())

                    full_title = f"{ctitle} ({batch_name})" if batch_name else ctitle
                    if full_title and full_title not in seen:
                        seen.add(full_title)
                        courses.append({
                            "id": f"course_{len(courses)+1}",
                            "title": full_title,
                            "url": f"{BASE_URL}/PreviousCoursesVideos.aspx",
                            "button_id": pbtn_id,
                            "is_previous": True
                        })

            print(f"[DigiSkillsExtractor] Fetched {len(courses)} live enrolled & previous courses from dashboard.")
        except Exception as e:
            err_str = str(e)
            print(f"[DigiSkillsExtractor] Error fetching enrolled courses: {err_str}")
            if "ERR_TOO_MANY_REDIRECTS" in err_str or "redirect" in err_str.lower():
                print("[DigiSkillsExtractor] Session expired: LMS server returned redirect loop. Clearing stale cookies.")
                try:
                    await page.context.clear_cookies()
                except Exception:
                    pass
                # Re-raise with a clear message so the caller knows the session expired
                raise RuntimeError("DigiSkills session has expired. Please click 'Login Browser' or 'Auto Login' to sign in again.") from e
            raise

        return courses

    async def extract_course_lectures(
        self,
        page: Page,
        course_title: str,
        course_target: str,
        target_week: str = "ALL",
        force_live: bool = False
    ) -> List[Dict[str, Any]]:
        """Extracts topics from live page with hybrid local cache fallback & force_live option."""
        self.stop_requested = False
        lectures_data = []

        # ── Step 0: Check Local Cache (Instant 0s Load) ──
        if not force_live:
            cached_topics = self.cache_mgr.get_cached_topics(course_title, target_week)
            if cached_topics and len(cached_topics) >= 5:
                has_unextracted = any(
                    not (t.get("youtube_url") and t["youtube_url"].startswith("https://www.youtube.com"))
                    and t.get("status") != "locked_week"
                    for t in cached_topics
                )
                if not has_unextracted:
                    print(f"[DigiSkillsExtractor] Instantly loading {len(cached_topics)} topics from local cache for '{course_title}' [{target_week}]")
                    self.emit_progress("info", {
                        "message": f"Instantly loaded {len(cached_topics)} topics from local cache [FAST ⚡]",
                        "total": len(cached_topics),
                        "course": course_title
                    })
                    for idx, t in enumerate(cached_topics, 1):
                        self.emit_progress("lecture_start", {
                            "current": idx,
                            "total": len(cached_topics),
                            "title": f"[{t.get('week', 'Week 01')}] {t.get('topic_title', '')}",
                            "course": course_title
                        })
                        self.emit_progress("lecture_complete", {
                            "current": idx,
                            "total": len(cached_topics),
                            "lecture": t
                        })
                    self.emit_progress("course_complete", {
                        "course": course_title,
                        "total_extracted": len(cached_topics),
                        "lectures": cached_topics
                    })
                    return cached_topics

        self.emit_progress("status", {"message": f"Opening course: {course_title}", "status": "navigating"})


        # ── Step 1: Navigate to Default.aspx and click course card ──
        try:
            await page.goto(f"{BASE_URL}/Default.aspx", wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(1.0)
        except Exception as nav_ex:
            print(f"[DigiSkillsExtractor] Navigation note: {nav_ex}")

        if await self._is_logged_in(page):
            is_live = True
            clicked = await self._open_course_page(page, course_title, course_target)
            if not clicked:
                print(f"[DigiSkillsExtractor] WARNING: Could not navigate to course page for '{course_title}'")
        else:
            print(f"[DigiSkillsExtractor] Session expired — login required.")

        # ── Step 2: Collect all topic rows live ──
        all_lecture_items = []

        is_previous_page = "PreviousCoursesVideos" in page.url
        is_course_page = "CourseWebsite" in page.url or is_previous_page

        if is_live and is_course_page:
            all_lecture_items = await self._collect_topics_from_live_page(page)
            print(f"[DigiSkillsExtractor] Collected {len(all_lecture_items)} live topics from {page.url}")

            if target_week and target_week.upper() != "ALL":
                clean_target = target_week.lower().replace(" ", "").strip()
                all_lecture_items = [
                    item for item in all_lecture_items
                    if clean_target in item["week"].lower().replace(" ", "")
                    or item["week"].lower().startswith(target_week.lower())
                ]
                print(f"[DigiSkillsExtractor] Filtered {len(all_lecture_items)} topics matching week: '{target_week}'")


        if not all_lecture_items:
            msg = f"⚠ Not logged in or no topics found for '{course_title}'. Please click Login Browser."
            self.emit_progress("status", {"message": msg, "status": "login_required"})
            self.emit_progress("info", {"message": msg, "total": 0, "course": course_title})
            return lectures_data

        total_topics = len(all_lecture_items)
        self.emit_progress("info", {
            "message": f"Discovered {total_topics} topics in {course_title}" + (" [LIVE]" if is_live else " [OFFLINE — login required]"),
            "total": total_topics,
            "course": course_title
        })

        # Build cache lookup map for smart row-level caching
        cached_list = self.cache_mgr.get_cached_topics(course_title, target_week) or []
        cached_map = { (t.get("week", ""), t.get("topic_title", "")): t for t in cached_list if t.get("youtube_url") and t["youtube_url"].startswith("https://www.youtube.com") }

        # ── Step 4: Extract YouTube link for each topic row ──
        for idx, item in enumerate(all_lecture_items, 1):
            if self.stop_requested:
                print("[DigiSkillsExtractor] Stop requested before topic start.")
                self.emit_progress("stopped", {"message": "Extraction stopped by user."})
                break

            topic_title = item["topic_name"]
            week_label = item["week"]
            is_enabled = item["is_enabled"]
            lesson_link_id = item.get("lesson_link_id")

            self.emit_progress("lecture_start", {
                "current": idx,
                "total": total_topics,
                "title": f"[{week_label}] {topic_title}",
                "course": course_title
            })

            cache_key = (week_label, topic_title)
            if not force_live and cache_key in cached_map:
                # Instant row-level cache hit!
                lecture_record = dict(cached_map[cache_key])
                lecture_record["lecture_number"] = idx
                lecture_record["source"] = "cache"
                lectures_data.append(lecture_record)

                self.emit_progress("lecture_complete", {
                    "current": idx,
                    "total": total_topics,
                    "lecture": lecture_record
                })
                continue

            yt_data = {"youtube_url": None, "video_id": None, "embed_url": None, "thumbnail_url": None, "description": None}
            status = "extracted"

            if not is_enabled:
                status = "locked_week"
                yt_data["youtube_url"] = "Locked (Future Week)"
            elif is_live and lesson_link_id:
                try:
                    if self.stop_requested:
                        self.emit_progress("stopped", {"message": "Extraction stopped by user."})
                        break

                    if is_previous_page:
                        pb_target = lesson_link_id.replace('_', '$')
                        await page.evaluate(f"__doPostBack('{pb_target}', '')")
                        await asyncio.sleep(1.2)
                        clicked_ok = True
                    else:
                        pb_target = lesson_link_id.replace('_', '$')
                        await page.evaluate(f"__doPostBack('{pb_target}', '')")
                        try:
                            await page.wait_for_load_state("domcontentloaded", timeout=5000)
                        except Exception:
                            pass
                        await asyncio.sleep(1.0)
                        clicked_ok = True

                    if clicked_ok:
                        if self.stop_requested:
                            self.emit_progress("stopped", {"message": "Extraction stopped by user."})
                            break
                        
                        yt_data = await BrowserManager.extract_youtube_url(page)
                        status = "extracted" if yt_data["youtube_url"] else "video_not_found"

                        # On Active Course (CourseWebsite.aspx), after extracting CourseTopicDetail.aspx, go back to CourseWebsite.aspx
                        if not is_previous_page and ("CourseTopicDetail" in page.url or "CourseWebsite" not in page.url):
                            await page.go_back()
                            try:
                                await page.wait_for_load_state("domcontentloaded", timeout=5000)
                            except Exception:
                                pass
                            await asyncio.sleep(0.5)
                        else:
                            await asyncio.sleep(0.3)

                    else:
                        print(f"[Live] JS click failed for #{lesson_link_id}")
                        status = "link_not_found"
                        yt_data["youtube_url"] = "Link not found on page"
                except Exception as ex:
                    print(f"[Topic Extract Error] {topic_title}: {ex}")
                    status = "error"
                    yt_data["youtube_url"] = "Error fetching link"
            elif not is_live:
                yt_data["youtube_url"] = "Login required — use Login Browser then re-run"
                status = "login_required"
            
            if self.stop_requested:
                self.emit_progress("stopped", {"message": "Extraction stopped by user."})
                break

            lecture_record = {
                "course_name": course_title,
                "week": week_label,
                "lecture_number": idx,
                "topic_title": topic_title,
                "youtube_url": yt_data.get("youtube_url") or "N/A",
                "video_id": yt_data.get("video_id") or "N/A",
                "embed_url": yt_data.get("embed_url") or "N/A",
                "thumbnail_url": yt_data.get("thumbnail_url") or "",
                "duration": item["duration"],
                "description": yt_data.get("description") or "N/A",
                "status": status
            }

            lectures_data.append(lecture_record)

            self.emit_progress("lecture_complete", {
                "current": idx,
                "total": total_topics,
                "lecture": lecture_record
            })

        self.emit_progress("course_complete", {
            "course": course_title,
            "total_extracted": len(lectures_data),
            "lectures": lectures_data
        })

        merged_results = self.cache_mgr.merge_hybrid_topics(course_title, target_week, lectures_data)
        return merged_results

    async def _collect_topics_from_live_page(self, page: Page) -> List[Dict]:
        """Collect all topic rows from live CourseWebsite.aspx or PreviousCoursesVideos.aspx."""
        items = []
        try:
            week_headers = await page.query_selector_all("a[id^='Week_'], .accordion-toggle")
            print(f"[DigiSkillsExtractor] Discovered {len(week_headers)} week accordion tabs.")
            for w_idx, week_header in enumerate(week_headers, 1):
                week_id = await week_header.get_attribute("id") or f"Week_{w_idx:02d}"
                week_title = " ".join((await week_header.inner_text()).strip().split())
                week_title = re.sub(r'\s*\([^)]*\)', '', week_title).strip()

                try:
                    aria_expanded = await week_header.get_attribute("aria-expanded")
                    if aria_expanded != "true":
                        await week_header.click()
                        await asyncio.sleep(0.3)
                except Exception:
                    pass

                detail_container = await page.query_selector(f"#{week_id}Detail")
                if not detail_container:
                    parent = await week_header.query_selector("xpath=ancestor::div[contains(@class, 'panel')]")
                    if parent:
                        detail_container = await parent.query_selector(".panel-collapse, table")

                if detail_container:
                    topic_rows = await detail_container.query_selector_all("tr")
                    for row in topic_rows:
                        # Skip table header rows (e.g. <th> Title </th>)
                        if await row.query_selector("th"):
                            continue

                        lesson_link = await row.query_selector("a[id*='lbtnLesson']")
                        lesson_span = await row.query_selector("span[id*='lblLesson']")
                        duration_elem = await row.query_selector("span[id*='lblDuration']")

                        elem = lesson_link or lesson_span
                        if elem:
                            topic_name = " ".join((await elem.inner_text()).strip().split())
                            if not topic_name or topic_name.lower() in ["title", "lesn no", "topic", "completion status"]:
                                continue

                            link_id = await elem.get_attribute("id") if lesson_link else None
                            duration = " ".join((await duration_elem.inner_text()).strip().split()) if duration_elem else "N/A"

                            items.append({
                                "week": week_title,
                                "topic_name": topic_name,
                                "duration": duration,
                                "is_enabled": lesson_link is not None,
                                "lesson_link_id": link_id
                            })
        except Exception as e:
            print(f"[DigiSkillsExtractor] Error collecting topics: {e}")
        return items

    async def get_course_weeks_live(self, page: Page, course_title: str, button_id: Optional[str] = None) -> List[Dict[str, str]]:
        """Scrapes live week tabs for the selected active or previous course directly from the LMS."""
        weeks = []
        cached_weeks = self.cache_mgr.get_cached_weeks(course_title)
        try:
            if "Default.aspx" not in page.url or "login" in page.url.lower():
                try:
                    await page.goto(f"{BASE_URL}/Default.aspx", wait_until="domcontentloaded", timeout=25000)
                except Exception as goto_ex:
                    print(f"[DigiSkillsExtractor] Navigation notice: {goto_ex}")
                await asyncio.sleep(1)

            if not await self._is_logged_in(page):
                if cached_weeks:
                    print(f"[DigiSkillsExtractor] Not logged in, returning {len(cached_weeks)} cached weeks for '{course_title}'")
                    return cached_weeks
                return weeks

            opened = await self._open_course_page(page, course_title, button_id)
            if opened:
                week_headers = await page.query_selector_all("a[id^='Week_'], .accordion-toggle")
                for w_idx, week_header in enumerate(week_headers, 1):
                    week_id = await week_header.get_attribute("id") or f"Week_{w_idx:02d}"
                    raw_title = " ".join((await week_header.inner_text()).strip().split())
                    clean_title = re.sub(r'\s*\([^)]*\)', '', raw_title).strip() or f"Week {w_idx:02d}"
                    weeks.append({
                        "id": week_id,
                        "title": clean_title,
                        "raw_title": raw_title
                    })
                print(f"[DigiSkillsExtractor] Fetched {len(weeks)} live week tabs for '{course_title}'")

            if not weeks and cached_weeks:
                print(f"[DigiSkillsExtractor] Live weeks not found, returning {len(cached_weeks)} cached weeks for '{course_title}'")
                return cached_weeks
        except Exception as ex:
            print(f"[DigiSkillsExtractor] Error fetching live course weeks: {ex}")
            if cached_weeks:
                return cached_weeks
        return weeks