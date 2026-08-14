// Global session check function (also callable from modal buttons)
async function checkSessionStatus() {
    const sessionDot = document.getElementById("statusDot");
    const sessionText = document.getElementById("sessionText");
    const btnLogout = document.getElementById("btnLogout");
    if (!sessionDot || !sessionText) return;
    try {
        const res = await fetch("/api/status");
        const data = await res.json();
        if (data.logged_in) {
            sessionDot.className = "status-dot pulsing online";
            sessionText.textContent = data.message || "DigiSkills Session Active";
            if (btnLogout) btnLogout.style.display = "inline-flex";
        } else {
            sessionDot.className = "status-dot offline";
            sessionText.textContent = data.message || "Not Logged In";
            if (btnLogout) btnLogout.style.display = "none";
        }
    } catch (err) {
        sessionDot.className = "status-dot offline";
        sessionText.textContent = "Server Disconnected";
        if (btnLogout) btnLogout.style.display = "none";
    }
}


document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const sessionDot = document.getElementById("statusDot");
    const sessionText = document.getElementById("sessionText");
    const btnAutoLogin = document.getElementById("btnAutoLogin");
    const btnInteractiveLogin = document.getElementById("btnInteractiveLogin");
    const btnLogout = document.getElementById("btnLogout");
    
    const courseSelect = document.getElementById("courseSelect");
    const btnFetchCourses = document.getElementById("btnFetchCourses");
    const customCourseUrl = document.getElementById("customCourseUrl");
    
    const btnStartExtract = document.getElementById("btnStartExtract");
    const btnStopExtract = document.getElementById("btnStopExtract");
    
    const progressSection = document.getElementById("progressSection");
    const progressMessage = document.getElementById("progressMessage");
    const progressPercent = document.getElementById("progressPercent");
    const progressBarFill = document.getElementById("progressBarFill");
    
    const statTotalLectures = document.getElementById("statTotalLectures");
    const statYoutubeFound = document.getElementById("statYoutubeFound");
    const statCourseName = document.getElementById("statCourseName");
    const statExtractStatus = document.getElementById("statExtractStatus");
    
    const lecturesTableBody = document.getElementById("lecturesTableBody");
    const tableCount = document.getElementById("tableCount");
    const tableSearch = document.getElementById("tableSearch");
    const btnCopyAll = document.getElementById("btnCopyAll");
    
    const exportCsv = document.getElementById("exportCsv");
    const exportExcel = document.getElementById("exportExcel");
    const exportJson = document.getElementById("exportJson");

    let extractedLectures = [];
    let selectedIndices = new Set();
    let currentFilter = "all";
    let eventSource = null;
    let extractionStartTime = null;
    let downloadedDiskFiles = [];

    function cleanCourseTitle(title) {
        if (!title) return "";
        return title.replace(/\s*\((?:Week|DSTP).*?\)/gi, '').trim();
    }

    function sanitizeTitleForCompare(str) {
        if (!str) return "";
        return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function isLectureDownloaded(l, index) {
        if (!l) return false;
        if (l.is_downloaded === true) return true;

        const currentCourse = (l.course_name || (courseSelect && courseSelect.selectedIndex >= 0 ? courseSelect.options[courseSelect.selectedIndex].text : "") || "").trim();
        const cleanCourse = cleanCourseTitle(currentCourse).toLowerCase();
        const week = (l.week || "Week 01").toLowerCase();
        const topicTitle = (l.topic_title || "").toLowerCase();
        const lecNum = l.lecture_number || (index !== undefined ? index + 1 : null);

        return downloadedDiskFiles.some(f => {
            const fName = (f.file_name || "").toLowerCase();
            const fCourse = (f.course_name || "").toLowerCase();
            const fWeek = (f.week || "").toLowerCase();

            // 1. Check Topic number prefix e.g. "Topic 001" or "Topic 1"
            if (lecNum !== null) {
                const numPadded = `topic ${lecNum.toString().padStart(3, '0')}`.toLowerCase();
                const numSimple = `topic ${lecNum}`.toLowerCase();
                if (fName.startsWith(numPadded) || fName.startsWith(numSimple)) {
                    if (fWeek === week || fCourse.includes(cleanCourse) || cleanCourse.includes(fCourse) || !cleanCourse) {
                        return true;
                    }
                }
            }

            // 2. Check title slug substring
            const cleanTitleSlug = sanitizeTitleForCompare(topicTitle);
            const fNameSlug = sanitizeTitleForCompare(fName);
            if (cleanTitleSlug && cleanTitleSlug.length > 5 && fNameSlug.includes(cleanTitleSlug)) {
                if (fWeek === week || !cleanCourse || fCourse.includes(cleanCourse) || cleanCourse.includes(fCourse)) {
                    return true;
                }
            }

            return false;
        });
    }

    async function syncDownloadedFiles() {
        try {
            const res = await fetch("/api/scan-downloads-folder");
            const data = await res.json();
            if (data.status === "success" && Array.isArray(data.files)) {
                downloadedDiskFiles = data.files;
                if (extractedLectures && extractedLectures.length > 0) {
                    renderTable();
                }
                if (window.globalDownloadQueue) {
                    window.globalDownloadQueue.syncDiskDownloads();
                }
            }
        } catch (e) {
            console.warn("Failed to sync downloads folder:", e);
        }
    }

    // Check session status and sync existing downloaded files on page load
    checkSessionStatus();
    syncDownloadedFiles();

    // Logout Action
    if (btnLogout) {
        btnLogout.addEventListener("click", async () => {
            if (!confirm("Are you sure you want to log out and destroy the active session?")) return;
            btnLogout.disabled = true;
            try {
                const res = await fetch("/api/logout", { method: "POST" });
                const data = await res.json();
                alert(data.message || "Logged out.");
                // Reset course select
                courseSelect.innerHTML = `<option value="">-- Click "Fetch Courses" after login --</option>`;
            } catch (err) {
                alert("Logout error: " + err);
            } finally {
                btnLogout.disabled = false;
                checkSessionStatus();
            }
        });
    }


    // Auto Login using .env credentials
    if (btnAutoLogin) {
        btnAutoLogin.addEventListener("click", async () => {
            btnAutoLogin.disabled = true;
            btnAutoLogin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Logging in...`;
            try {
                const res = await fetch("/api/auto-login", { method: "POST" });
                const data = await res.json();
                alert(data.message || "Auto login processed.");
            } catch (err) {
                alert("Auto-login error: " + err);
            } finally {
                btnAutoLogin.disabled = false;
                btnAutoLogin.innerHTML = `<i class="fa-solid fa-key"></i> Auto Login (.env)`;
                checkSessionStatus();
            }
        });
    }

    let loginPollInterval = null;

    // Launch Interactive Browser Login
    btnInteractiveLogin.addEventListener("click", () => {
        showLoginModal(true);
    });

    async function launchBrowserLogin() {
        const statusEl = document.getElementById("loginModalStatusText");
        const spinnerEl = document.getElementById("loginModalSpinner");
        if (statusEl) statusEl.textContent = "Launching Chromium browser window...";
        if (spinnerEl) spinnerEl.className = "fa-solid fa-spinner fa-spin";
        try {
            const res = await fetch("/api/login", { method: "POST" });
            const data = await res.json();
            if (statusEl) {
                if (data.status === "success") {
                    statusEl.textContent = "Browser window opened! Sign in to DigiSkills, then your session will be detected automatically.";
                } else {
                    statusEl.textContent = data.message || "Failed to launch login window.";
                }
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = "Error launching browser: " + err;
        }
    }

    function showLoginModal(autoLaunch = true) {
        // Remove existing modal if any
        const existing = document.getElementById("loginModal");
        if (existing) {
            if (loginPollInterval) clearInterval(loginPollInterval);
            existing.remove();
        }

        if (autoLaunch) {
            launchBrowserLogin();
        }

        const modal = document.createElement("div");
        modal.id = "loginModal";
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.75); z-index: 9999;
            display: flex; align-items: center; justify-content: center;
            backdrop-filter: blur(6px);
        `;
        modal.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #131b2e 0%, #1e1b4b 100%);
                border: 1px solid rgba(168,139,250,0.4);
                border-radius: 18px; padding: 28px; max-width: 540px; width: 92%;
                box-shadow: 0 25px 60px rgba(0,0,0,0.7);
                color: #e2e8f0; position: relative; font-family: 'Inter', sans-serif;
            ">
                <button id="btnCloseLoginModal" style="
                    position: absolute; top: 14px; right: 16px; background: none; border: none;
                    color: #94a3b8; font-size: 22px; cursor: pointer; line-height: 1;
                ">&times;</button>

                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(168,85,247,0.2); border: 1px solid rgba(168,85,247,0.4); display: flex; align-items: center; justify-content: center; color: #c084fc; font-size: 18px;">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i>
                    </div>
                    <div>
                        <h2 style="margin: 0; color: #f1f5f9; font-size: 18px; font-weight: 700;">Login to DigiSkills LMS</h2>
                        <p style="margin: 2px 0 0; color: #94a3b8; font-size: 12px;">Complete sign-in in the opened Chromium window</p>
                    </div>
                </div>

                <!-- Live Status Banner -->
                <div id="loginModalStatusBox" style="
                    display: flex; align-items: center; gap: 12px;
                    background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.3);
                    border-radius: 10px; padding: 14px 16px; margin: 16px 0;
                ">
                    <i id="loginModalSpinner" class="fa-solid fa-spinner fa-spin" style="font-size: 18px; color: #60a5fa; flex-shrink: 0;"></i>
                    <span id="loginModalStatusText" style="color: #bfdbfe; font-size: 13px; line-height: 1.4;">
                        Launching Chromium browser window...
                    </span>
                </div>

                <!-- Steps Guide -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; font-size: 13px; color: #cbd5e1; line-height: 1.6;">
                    <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                        <span style="color: #a855f7; font-weight: 700;">1.</span>
                        <span>A browser window opens on your desktop displaying the DigiSkills login page.</span>
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 6px;">
                        <span style="color: #a855f7; font-weight: 700;">2.</span>
                        <span>Enter your LMS Student ID & Password, then click <strong>Sign In</strong>.</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <span style="color: #a855f7; font-weight: 700;">3.</span>
                        <span>Once your dashboard appears, this window will automatically detect your session!</span>
                    </div>
                </div>

                <!-- Collapsible Manual Execution -->
                <details style="margin-bottom: 20px; font-size: 12px; color: #94a3b8;">
                    <summary style="cursor: pointer; color: #a78bfa; font-weight: 500; outline: none; margin-bottom: 8px;">
                        ⚙️ Need to run manually via terminal or batch file?
                    </summary>
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px; margin-top: 6px;">
                        <p style="margin: 0 0 6px; color: #cbd5e1;">Double-click <code>login.bat</code> in the project folder, or run:</p>
                        <code style="background: rgba(0,0,0,0.5); border-radius: 4px; padding: 6px 10px; display: block; font-size: 11px; color: #86efac; word-break: break-all;">
                            & "C:\\venv\\envTemp\\Scripts\\python.exe" -m extractor.login_window
                        </code>
                    </div>
                </details>

                <!-- Actions -->
                <div style="display: flex; gap: 10px; justify-content: flex-end; align-items: center;">
                    <button id="btnRelaunchLogin" style="
                        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
                        border-radius: 8px; padding: 9px 16px; color: #cbd5e1; cursor: pointer; font-size: 13px; font-weight: 500;
                    "><i class="fa-solid fa-arrows-rotate"></i> Relaunch Browser</button>

                    <button id="btnCheckSessionNow" style="
                        background: linear-gradient(135deg, #7c3aed, #9333ea);
                        border: none; border-radius: 8px; padding: 9px 18px;
                        color: white; cursor: pointer; font-weight: 600; font-size: 13px;
                        box-shadow: 0 4px 12px rgba(124,58,237,0.3);
                    "><i class="fa-solid fa-circle-check"></i> Check Session</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => {
            if (loginPollInterval) {
                clearInterval(loginPollInterval);
                loginPollInterval = null;
            }
            modal.remove();
        };

        document.getElementById("btnCloseLoginModal").addEventListener("click", closeModal);
        modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

        document.getElementById("btnRelaunchLogin").addEventListener("click", () => {
            launchBrowserLogin();
        });

        document.getElementById("btnCheckSessionNow").addEventListener("click", async () => {
            const statusText = document.getElementById("loginModalStatusText");
            if (statusText) statusText.textContent = "Checking active session...";
            const loggedIn = await checkSessionStatus();
            if (loggedIn) {
                onLoginSuccess();
            } else {
                if (statusText) statusText.textContent = "Session not detected yet. Please make sure you signed in on the opened browser.";
            }
        });

        function onLoginSuccess() {
            const statusBox = document.getElementById("loginModalStatusBox");
            const spinner = document.getElementById("loginModalSpinner");
            const statusText = document.getElementById("loginModalStatusText");
            if (statusBox) {
                statusBox.style.background = "rgba(34,197,94,0.15)";
                statusBox.style.borderColor = "rgba(34,197,94,0.4)";
            }
            if (spinner) {
                spinner.className = "fa-solid fa-circle-check";
                spinner.style.color = "#4ade80";
            }
            if (statusText) {
                statusText.style.color = "#86efac";
                statusText.innerHTML = "<strong>✅ Login Successful!</strong> Session active. Loading courses...";
            }
            if (loginPollInterval) {
                clearInterval(loginPollInterval);
                loginPollInterval = null;
            }
            setTimeout(() => {
                closeModal();
                btnFetchCourses.click();
            }, 1200);
        }

        // Start background polling to automatically detect login
        if (loginPollInterval) clearInterval(loginPollInterval);
        loginPollInterval = setInterval(async () => {
            try {
                const res = await fetch("/api/status");
                const data = await res.json();
                if (data.logged_in) {
                    onLoginSuccess();
                    checkSessionStatus();
                }
            } catch (_) {}
        }, 2000);
    }

    // Fetch Enrolled Courses
    btnFetchCourses.addEventListener("click", async () => {
        btnFetchCourses.disabled = true;
        btnFetchCourses.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading...`;
        try {
            const res = await fetch("/api/courses");
            const data = await res.json();
            
            if (data.error) {
                if (data.error.includes("expired") || data.error.includes("Login") || data.error.includes("sign in")) {
                    updateSessionBadge(false, "Session Expired");
                    showLoginModal(true);
                    return;
                } else {
                    alert("Course fetch notice: " + data.error);
                }
            }

            // Deduplicate by title
            const uniqueCourses = [];
            const seenTitles = new Set();
            (data.courses || []).forEach(c => {
                const normTitle = (c.title || "").trim();
                if (normTitle && !seenTitles.has(normTitle)) {
                    seenTitles.add(normTitle);
                    uniqueCourses.push(c);
                }
            });

            courseSelect.innerHTML = `<option value="">-- Select a Course (${uniqueCourses.length} found) --</option>`;
            uniqueCourses.forEach(c => {
                const opt = document.createElement("option");
                opt.value = c.button_id || c.url;
                opt.dataset.buttonId = c.button_id || "";
                opt.dataset.title = c.title;
                opt.textContent = c.title;
                courseSelect.appendChild(opt);
            });

            if (uniqueCourses.length === 0) {
                alert("No active courses found automatically. Make sure you are logged into LMS, or paste the Course URL directly into the text field.");
            } else {
                checkSessionStatus();
            }
        } catch (err) {
            alert("Error fetching courses: " + err);
        } finally {
            btnFetchCourses.disabled = false;
            btnFetchCourses.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Fetch Courses`;
        }
    });

    // Fetch Course Weeks Live

    const weekSelect = document.getElementById("weekSelect");
    const btnFetchWeeks = document.getElementById("btnFetchWeeks");

    async function fetchCourseWeeks() {
        const selectedOpt = courseSelect.options[courseSelect.selectedIndex];
        if (!selectedOpt || !selectedOpt.value || selectedOpt.value.startsWith("--")) {
            alert("Please select a course first to fetch its weeks.");
            return;
        }
        const selectedTitle = selectedOpt.dataset.title || selectedOpt.text;
        const buttonId = selectedOpt.dataset.buttonId || selectedOpt.value;

        if (btnFetchWeeks) {
            btnFetchWeeks.disabled = true;
            btnFetchWeeks.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Fetching...`;
        }

        try {
            const res = await fetch(`/api/course-weeks?button_id=${encodeURIComponent(buttonId)}&course_title=${encodeURIComponent(selectedTitle)}`);
            const data = await res.json();
            const weeks = data.weeks || [];

            weekSelect.innerHTML = `<option value="ALL">All Weeks (${weeks.length} Weeks Found)</option>`;
            weeks.forEach(w => {
                const opt = document.createElement("option");
                opt.value = w.title;
                opt.textContent = w.raw_title ? `${w.raw_title}` : `${w.title}`;
                weekSelect.appendChild(opt);
            });

            if (weeks.length === 0) {
                weekSelect.innerHTML = `<option value="ALL">All Weeks</option>`;
            }
        } catch (err) {
            console.error("Error fetching course weeks:", err);
        } finally {
            if (btnFetchWeeks) {
                btnFetchWeeks.disabled = false;
                btnFetchWeeks.innerHTML = `<i class="fa-solid fa-layer-group"></i> Fetch Weeks`;
            }
        }
    }

    if (btnFetchWeeks) {
        btnFetchWeeks.addEventListener("click", fetchCourseWeeks);
    }
    courseSelect.addEventListener("change", () => {
        if (courseSelect.value && !courseSelect.value.startsWith("--")) {
            fetchCourseWeeks();
            syncDownloadedFiles();
        }
    });




    // Extraction Mode Switcher UI Handlers
    const modeCacheBtn = document.getElementById("modeCacheBtn");
    const modeLiveBtn = document.getElementById("modeLiveBtn");
    const modeCacheRadio = document.getElementById("modeCacheRadio");
    const modeLiveRadio = document.getElementById("modeLiveRadio");

    if (modeCacheBtn && modeLiveBtn) {
        modeCacheBtn.addEventListener("click", () => {
            modeCacheBtn.classList.add("active");
            modeLiveBtn.classList.remove("active");
            if (modeCacheRadio) modeCacheRadio.checked = true;
        });

        modeLiveBtn.addEventListener("click", () => {
            modeLiveBtn.classList.add("active");
            modeCacheBtn.classList.remove("active");
            if (modeLiveRadio) modeLiveRadio.checked = true;
        });
    }

    // Start Extraction
    btnStartExtract.addEventListener("click", async () => {
        const selectedOpt = courseSelect.options[courseSelect.selectedIndex];
        const selectedTitle = selectedOpt ? (selectedOpt.dataset.title || selectedOpt.text) : (customCourseUrl.value.trim() ? "Custom Course" : "");
        const selectedUrl = courseSelect.value || customCourseUrl.value.trim();
        const buttonId = selectedOpt ? (selectedOpt.dataset.buttonId || "") : "";

        const selectedWeek = weekSelect ? weekSelect.value : "ALL";

        if (!selectedUrl || selectedUrl.startsWith("--")) {
            alert("Please select a valid course from the dropdown or paste a Course URL.");
            return;
        }

        // Reset UI state
        extractedLectures = [];
        selectedIndices.clear();
        renderTable();
        
        btnStartExtract.disabled = true;
        btnStopExtract.disabled = false;
        progressSection.style.display = "block";
        progressBarFill.style.width = "0%";
        progressPercent.textContent = "0%";
        progressMessage.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Starting extraction engine...`;

        statCourseName.textContent = selectedTitle;
        statExtractStatus.textContent = "Extracting...";
        extractionStartTime = Date.now();

        const modeLiveRadio = document.getElementById("modeLiveRadio");
        const forceLive = modeLiveRadio ? modeLiveRadio.checked : false;
        const streamApiUrl = `/api/stream-extraction?course_url=${encodeURIComponent(selectedUrl)}&course_title=${encodeURIComponent(selectedTitle)}&button_id=${encodeURIComponent(buttonId)}&target_week=${encodeURIComponent(selectedWeek)}&force_live=${forceLive}`;
        eventSource = new EventSource(streamApiUrl);

        eventSource.onmessage = (event) => {
            const payload = JSON.parse(event.data);
            handleSSEMessage(payload);
        };

        eventSource.onerror = (err) => {
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            finishExtraction("Extraction completed or connection closed.");
        };
    });

    // Stop Extraction with Confirmation Warning
    btnStopExtract.addEventListener("click", async () => {
        if (!confirm("⚠️ Are you sure you want to stop the ongoing extraction process?")) {
            return;
        }
        btnStopExtract.disabled = true;
        btnStopExtract.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Stopping...`;
        try {
            await fetch("/api/stop", { method: "POST" });
            finishExtraction("Extraction stopped by user.");
        } catch (err) {
            console.error("Error stopping extraction:", err);
            finishExtraction("Extraction stopped.");
        } finally {
            btnStopExtract.innerHTML = `<i class="fa-solid fa-stop"></i> Stop`;
        }
    });

    function handleSSEMessage(payload) {
        const { type, data } = payload;

        if (type === "status") {
            progressMessage.innerHTML = `<i class="fa-solid fa-cog fa-spin"></i> ${data.message}`;
        } else if (type === "info") {
            progressMessage.textContent = data.message;
            statTotalLectures.textContent = data.total;
        } else if (type === "lecture_start") {
            const pct = Math.round((data.current / data.total) * 100);
            progressBarFill.style.width = `${pct}%`;
            progressPercent.textContent = `${pct}%`;
            progressMessage.innerHTML = `<i class="fa-solid fa-film"></i> [${data.current}/${data.total}] Extracting: <strong>${escapeHtml(data.title)}</strong>`;

            // Calculate speed and ETA
            if (extractionStartTime && data.current > 1) {
                const elapsedSec = (Date.now() - extractionStartTime) / 1000;
                const secPerTopic = (elapsedSec / data.current).toFixed(1);
                const remainingSec = Math.round((data.total - data.current) * (elapsedSec / data.current));
                
                if (speedVal) speedVal.textContent = `${secPerTopic}s/topic`;
                statExtractStatus.textContent = `ETA: ~${remainingSec}s`;
            }
        } else if (type === "lecture_complete") {
            const lecture = data.lecture;
            extractedLectures.push(lecture);
            renderTable();
            
            const foundCount = extractedLectures.filter(l => l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com")).length;
            statYoutubeFound.textContent = foundCount;
        } else if (type === "course_complete") {
            if (data.lectures && data.lectures.length > 0 && extractedLectures.length === 0) {
                extractedLectures = data.lectures;
                renderTable();
            }
            const foundCount = extractedLectures.filter(l => l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com")).length;
            statYoutubeFound.textContent = foundCount;
            progressBarFill.style.width = "100%";
            progressPercent.textContent = "100%";
            finishExtraction(`Extraction complete! ${data.total_extracted || extractedLectures.length} topics processed.`);
        }
    }

    function finishExtraction(msg) {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        btnStartExtract.disabled = false;
        btnStopExtract.disabled = true;
        progressMessage.textContent = msg;
        statExtractStatus.textContent = "Completed";
        syncDownloadedFiles();
    }

    // Filter Pills Click Handlers
    document.querySelectorAll(".filter-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
            pill.classList.add("active");
            currentFilter = pill.dataset.filter || "all";
            renderTable();
        });
    });

    // Checkbox Select All Handler
    if (selectAllCheck) {
        selectAllCheck.addEventListener("change", () => {
            const visibleLectures = getFilteredLectures();
            if (selectAllCheck.checked) {
                visibleLectures.forEach((_, idx) => selectedIndices.add(idx));
            } else {
                selectedIndices.clear();
            }
            updateBatchActionsBar();
            renderTableCheckboxes();
        });
    }

    function getFilteredLectures() {
        const filterText = tableSearch.value.toLowerCase().trim();
        return extractedLectures.filter(l => {
            const hasYt = l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com");
            const isLocked = l.status === "locked_week" || (l.youtube_url && l.youtube_url.includes("Locked"));
            const isQuiz = !hasYt && !isLocked;

            if (currentFilter === "video" && !hasYt) return false;
            if (currentFilter === "quiz" && !isQuiz) return false;
            if (currentFilter === "locked" && !isLocked) return false;

            if (filterText) {
                const matchTitle = (l.topic_title || "").toLowerCase().includes(filterText);
                const matchUrl = (l.youtube_url || "").toLowerCase().includes(filterText);
                const matchDesc = (l.description || "").toLowerCase().includes(filterText);
                const matchWeek = (l.week || "").toLowerCase().includes(filterText);
                return matchTitle || matchUrl || matchDesc || matchWeek;
            }
            return true;
        });
    }

    function updatePillCounts() {
        const total = extractedLectures.length;
        const videos = extractedLectures.filter(l => l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com")).length;
        const locked = extractedLectures.filter(l => l.status === "locked_week" || (l.youtube_url && l.youtube_url.includes("Locked"))).length;
        const quizzes = total - videos - locked;

        if (pillAllCount) pillAllCount.textContent = total;
        if (pillVideoCount) pillVideoCount.textContent = videos;
        if (pillQuizCount) pillQuizCount.textContent = quizzes;
        if (pillLockedCount) pillLockedCount.textContent = locked;
    }

    function updateBatchActionsBar() {
        if (selectedIndices.size > 0) {
            batchActionsBar.style.display = "flex";
            selectedCount.textContent = selectedIndices.size;
        } else {
            batchActionsBar.style.display = "none";
        }
    }

    function renderTableCheckboxes() {
        document.querySelectorAll(".row-checkbox").forEach(cb => {
            const idx = parseInt(cb.dataset.index);
            cb.checked = selectedIndices.has(idx);
        });
    }

    // Render Table
    function renderTable() {
        const filtered = getFilteredLectures();
        updatePillCounts();
        tableCount.textContent = filtered.length;

        if (filtered.length === 0) {
            lecturesTableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="7">
                        <div class="empty-state">
                            <i class="fa-solid fa-video-slash"></i>
                            <p>No lectures to display.</p>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        lecturesTableBody.innerHTML = filtered.map((l, index) => {
            const hasYt = l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com");
            const isLocked = l.status === "locked_week" || (l.youtube_url && l.youtube_url.includes("Locked"));
            const isLoginRequired = l.status === "login_required" || (l.youtube_url && l.youtube_url.includes("Login required"));
            const isChecked = selectedIndices.has(index);
            const isDownloaded = isLectureDownloaded(l, index);

            return `
                <tr class="${isChecked ? 'row-selected' : ''}">
                    <td style="text-align: center;">
                        <input type="checkbox" class="row-checkbox" data-index="${index}" ${isChecked ? 'checked' : ''} />
                    </td>
                    <td style="text-align: center;"><strong>${l.lecture_number || index + 1}</strong></td>
                    <td><span class="yt-badge" style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4);">${escapeHtml(l.week || 'Week 01')}</span></td>
                    <td class="topic-cell">
                        <div style="font-weight: 600; color: #f3f4f6; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                            <span>${escapeHtml(l.topic_title)}</span>
                            ${l.source === 'cache' ? `
                                <span class="source-badge cache" title="Instantly loaded from local JSON cache"><i class="fa-solid fa-bolt"></i> Cached</span>
                            ` : `
                                <span class="source-badge live" title="Scraped live from DigiSkills LMS"><i class="fa-solid fa-globe"></i> Live LMS</span>
                            `}
                        </div>
                        ${l.description && l.description !== 'N/A' ? `
                            <div style="font-size: 12px; color: #94a3b8; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                                <i class="fa-solid fa-align-left" style="color: #818cf8;"></i> ${escapeHtml(l.description)}
                            </div>
                        ` : ''}
                    </td>
                    <td>
                        <div class="yt-link-cell">
                            ${hasYt ? `
                                <a href="${l.youtube_url}" target="_blank" class="yt-link">
                                    <i class="fa-brands fa-youtube" style="color: #ff0000;"></i> ${l.youtube_url}
                                </a>
                                ${isDownloaded ? `
                                    <span class="yt-badge found" style="background: rgba(34, 197, 94, 0.18); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);">
                                        <i class="fa-solid fa-circle-check"></i> Downloaded
                                    </span>
                                ` : `
                                    <span class="yt-badge found">Active Link</span>
                                `}
                            ` : isLoginRequired ? `
                                <span class="yt-badge" style="background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.4);">
                                    <i class="fa-solid fa-right-to-bracket"></i> Login Required
                                </span>
                            ` : isLocked ? `
                                <span class="yt-badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">
                                    <i class="fa-solid fa-lock"></i> Locked (Future Week)
                                </span>
                            ` : `
                                <span class="yt-badge missing">No Video Link (Quiz/Text)</span>
                            `}
                        </div>
                    </td>
                    <td style="text-align: center; font-size: 13px; color: #cbd5e1;">${l.duration || 'N/A'}</td>
                    <td style="text-align: center;">
                        <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
                            ${hasYt ? `
                                <button class="btn btn-sm btn-primary" onclick="openVideoPreviewModal(${index})" title="Preview Video Modal">
                                    <i class="fa-solid fa-play"></i> Preview
                                </button>
                                ${isDownloaded ? `
                                    <button class="btn btn-sm btn-outline-success btn-dl-mp4 downloaded" id="btnDlMp4_${index}" onclick="downloadSingleMp4(${index})" title="Already downloaded to disk! Click to re-download or overwrite.">
                                        <i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> Downloaded
                                    </button>
                                ` : `
                                    <button class="btn btn-sm btn-success btn-dl-mp4" id="btnDlMp4_${index}" onclick="downloadSingleMp4(${index})" title="Download MP4 Video">
                                        <i class="fa-solid fa-file-arrow-down"></i> MP4
                                    </button>
                                `}
                                <button class="btn btn-sm btn-outline" onclick="copyToClipboard('${l.youtube_url}')" title="Copy Link">
                                    <i class="fa-solid fa-copy"></i>
                                </button>
                            ` : '-'}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach Row Checkbox Events
        document.querySelectorAll(".row-checkbox").forEach(cb => {
            cb.addEventListener("change", (e) => {
                const idx = parseInt(e.target.dataset.index);
                if (e.target.checked) {
                    selectedIndices.add(idx);
                } else {
                    selectedIndices.delete(idx);
                }
                updateBatchActionsBar();
            });
        });
    }

    tableSearch.addEventListener("input", renderTable);

    // Batch Actions: Copy Selected Links
    if (btnCopySelected) {
        btnCopySelected.addEventListener("click", () => {
            const filtered = getFilteredLectures();
            const selectedLectures = Array.from(selectedIndices).map(i => filtered[i]).filter(Boolean);
            const links = selectedLectures
                .filter(l => l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com"))
                .map(l => `${l.lecture_number}. ${l.topic_title}: ${l.youtube_url}`)
                .join('\n');

            if (!links) {
                alert("No valid YouTube video links in selected rows.");
                return;
            }

            navigator.clipboard.writeText(links).then(() => {
                alert(`✅ Copied ${selectedLectures.length} selected YouTube video links!`);
            });
        });
    }

    // Batch Actions: Copy Formatted Markdown
    if (btnCopyFormatted) {
        btnCopyFormatted.addEventListener("click", () => {
            const filtered = getFilteredLectures();
            const selectedLectures = Array.from(selectedIndices).map(i => filtered[i]).filter(Boolean);
            const markdown = selectedLectures
                .filter(l => l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com"))
                .map(l => `* [${l.topic_title}](${l.youtube_url})`)
                .join('\n');

            if (!markdown) {
                alert("No valid YouTube video links in selected rows.");
                return;
            }

            navigator.clipboard.writeText(markdown).then(() => {
                alert(`✅ Copied ${selectedLectures.length} links in Markdown format!`);
            });
        });
    }

    // Copy All Links
    btnCopyAll.addEventListener("click", () => {
        const links = extractedLectures
            .filter(l => l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com"))
            .map(l => `${l.lecture_number}. ${l.topic_title}: ${l.youtube_url}`)
            .join('\n');

        if (!links) {
            alert("No YouTube links available to copy.");
            return;
        }

        navigator.clipboard.writeText(links).then(() => {
            alert("All extracted YouTube video links copied to clipboard!");
        });
    });

    window.copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            alert("Link copied: " + text);
        });
    };

    // Video Preview Modal Handlers
    window.openVideoPreviewModal = (index) => {
        const filtered = getFilteredLectures();
        const lecture = filtered[index];
        if (!lecture || !lecture.video_id) return;

        modalTopicTitle.textContent = lecture.topic_title;
        modalWeekBadge.textContent = lecture.week || "Week 01";
        modalYtLink.href = lecture.youtube_url;
        modalYtLink.textContent = lecture.youtube_url;
        modalDescription.innerHTML = `<strong style="color: #a5b4fc;"><i class="fa-solid fa-align-left"></i> Overview:</strong> ${escapeHtml(lecture.description || 'No description available for this lecture.')}`;

        modalIframeContainer.innerHTML = `
            <iframe src="https://www.youtube.com/embed/${lecture.video_id}?autoplay=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        `;

        modalCopyBtn.onclick = () => {
            navigator.clipboard.writeText(lecture.youtube_url).then(() => {
                alert("Copied YouTube Link: " + lecture.youtube_url);
            });
        };

        videoPreviewModal.style.display = "flex";
    };

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener("click", () => {
            videoPreviewModal.style.display = "none";
            modalIframeContainer.innerHTML = "";
        });
    }

    if (videoPreviewModal) {
        videoPreviewModal.addEventListener("click", (e) => {
            if (e.target === videoPreviewModal) {
                videoPreviewModal.style.display = "none";
                modalIframeContainer.innerHTML = "";
            }
        });
    }

    // Export Dropdown Click Listener
    const dropdownTrigger = document.getElementById("exportDropdownBtn");
    const dropdownMenu = document.getElementById("exportDropdownMenu");

    if (dropdownTrigger && dropdownMenu) {
        dropdownTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle("show");
        });

        document.addEventListener("click", (e) => {
            if (!dropdownTrigger.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove("show");
            }
        });
    }

    // Exports
    const exportTxt = document.getElementById("exportTxt");
    if (exportTxt) {
        exportTxt.addEventListener("click", (e) => {
            e.preventDefault();
            if (dropdownMenu) dropdownMenu.classList.remove("show");
            triggerDownload("/api/export/txt");
        });
    }

    exportCsv.addEventListener("click", (e) => {
        e.preventDefault();
        if (dropdownMenu) dropdownMenu.classList.remove("show");
        triggerDownload("/api/export/csv");
    });
    exportExcel.addEventListener("click", (e) => {
        e.preventDefault();
        if (dropdownMenu) dropdownMenu.classList.remove("show");
        triggerDownload("/api/export/excel");
    });
    exportJson.addEventListener("click", (e) => {
        e.preventDefault();
        if (dropdownMenu) dropdownMenu.classList.remove("show");
        triggerDownload("/api/export/json");
    });

    // Open Downloads Folder
    const btnOpenDownloadsFolder = document.getElementById("btnOpenDownloadsFolder");
    if (btnOpenDownloadsFolder) {
        btnOpenDownloadsFolder.addEventListener("click", async () => {
            try {
                const res = await fetch("/api/open-downloads-folder");
                const data = await res.json();
                if (data.status === "success") {
                    console.log(data.message);
                } else {
                    alert("Could not open downloads folder: " + (data.message || "Unknown error"));
                }
            } catch (err) {
                alert("Error opening downloads folder: " + (err.message || err));
            }
        });
    }

    // Overwrite Confirmation Modal Helper
    window.showOverwriteModal = function(fileName, callback) {
        const modal = document.getElementById("overwriteModal");
        const msg = document.getElementById("overwriteMessage");
        const closeBtn = document.getElementById("overwriteCloseBtn");
        const skipBtn = document.getElementById("btnOverwriteSkip");
        const confirmBtn = document.getElementById("btnOverwriteConfirm");

        if (!modal) return callback(false);

        msg.innerHTML = `The video file <strong>${escapeHtml(fileName)}</strong> already exists on disk in your <code>downloads/</code> folder.<br><br>Do you want to overwrite it with a new download or skip?`;
        modal.style.display = "flex";

        const cleanup = () => {
            modal.style.display = "none";
            closeBtn.removeEventListener("click", onSkip);
            skipBtn.removeEventListener("click", onSkip);
            confirmBtn.removeEventListener("click", onConfirm);
        };

        const onSkip = () => { cleanup(); callback(false); };
        const onConfirm = () => { cleanup(); callback(true); };

        closeBtn.addEventListener("click", onSkip);
        skipBtn.addEventListener("click", onSkip);
        confirmBtn.addEventListener("click", onConfirm);
    };

    // Premium Download Progress Modal Helper Functions
    window.openDownloadProgressModal = function(title, fileName, courseFolder, weekFolder, isBatch = false, totalBatchItems = 1) {
        const modal = document.getElementById("downloadProgressModal");
        const modalTitle = document.getElementById("dlModalTitle");
        const modalFileName = document.getElementById("dlModalFileName");
        const modalCourse = document.getElementById("dlModalCourseFolder");
        const modalWeek = document.getElementById("dlModalWeekFolder");
        const batchWrap = document.getElementById("dlBatchProgressWrap");
        const batchCounter = document.getElementById("dlBatchCounter");
        const batchFill = document.getElementById("dlBatchProgressBarFill");

        if (modalTitle) modalTitle.textContent = title;
        if (modalFileName) modalFileName.textContent = fileName;
        if (modalCourse) modalCourse.textContent = courseFolder || "Course";
        if (modalWeek) modalWeek.textContent = weekFolder || "Week 01";

        if (batchWrap) {
            if (isBatch) {
                batchWrap.style.display = "block";
                if (batchCounter) batchCounter.textContent = `1 / ${totalBatchItems} Videos`;
                if (batchFill) batchFill.style.width = "0%";
            } else {
                batchWrap.style.display = "none";
            }
        }

        window.resetDownloadProgressModal();
        if (modal) modal.style.display = "flex";
    };

    window.updateDownloadProgressModal = function(data) {
        const statusText = document.getElementById("dlModalStatusText");
        const percentText = document.getElementById("dlModalPercentText");
        const fill = document.getElementById("dlModalProgressBarFill");
        const speed = document.getElementById("dlModalSpeed");
        const size = document.getElementById("dlModalSize");
        const eta = document.getElementById("dlModalEta");

        if (data.status === "downloading") {
            if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading MP4 video...`;
            if (percentText) percentText.textContent = `${data.percent}%`;
            if (fill) fill.style.width = `${data.percent}%`;
            if (speed) speed.textContent = data.speed_str || "0.0 MB/s";
            if (size) size.textContent = `${data.downloaded_mb || '0 MB'} / ${data.total_mb || '0 MB'}`;
            if (eta) eta.textContent = data.eta ? `${data.eta}s` : "Calculating...";
        } else if (data.status === "success" || data.percent === 100) {
            if (statusText) statusText.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> Download Complete!`;
            if (percentText) percentText.textContent = `100%`;
            if (fill) fill.style.width = `100%`;
            if (speed) speed.textContent = "Finished";
            if (eta) eta.textContent = "0s";
        }
    };

    window.updateBatchProgressModal = function(current, total) {
        const batchCounter = document.getElementById("dlBatchCounter");
        const batchFill = document.getElementById("dlBatchProgressBarFill");
        const pct = Math.round((current / total) * 100);
        if (batchCounter) batchCounter.textContent = `${current} / ${total} Videos`;
        if (batchFill) batchFill.style.width = `${pct}%`;
    };

    window.resetDownloadProgressModal = function() {
        const statusText = document.getElementById("dlModalStatusText");
        const percentText = document.getElementById("dlModalPercentText");
        const fill = document.getElementById("dlModalProgressBarFill");
        const speed = document.getElementById("dlModalSpeed");
        const size = document.getElementById("dlModalSize");
        const eta = document.getElementById("dlModalEta");

        if (statusText) statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Connecting to YouTube stream...`;
        if (percentText) percentText.textContent = `0%`;
        if (fill) fill.style.width = `0%`;
        if (speed) speed.textContent = `0.0 MB/s`;
        if (size) size.textContent = `0 MB / 0 MB`;
        if (eta) eta.textContent = `Calculating...`;
    };

    window.closeDownloadProgressModal = function() {
        const modal = document.getElementById("downloadProgressModal");
        if (modal) modal.style.display = "none";
    };

    const dlModalCloseBtn = document.getElementById("dlModalCloseBtn");
    if (dlModalCloseBtn) {
        dlModalCloseBtn.addEventListener("click", window.closeDownloadProgressModal);
    }

    // Real-Time SSE Stream Download Helper Function
    function downloadWithProgressStream(params) {
        return new Promise((resolve) => {
            const query = new URLSearchParams({
                youtube_url: params.youtube_url,
                course_name: params.course_name || "Course",
                week: params.week || "Week 01",
                topic_title: params.topic_title || "Topic",
                lecture_number: params.lecture_number || 1,
                overwrite: params.overwrite ? "true" : "false",
                quality: params.quality || "1080p"
            });

            const sse = new EventSource(`/api/stream-download?${query.toString()}`);
            let resolved = false;

            const finish = (result) => {
                if (!resolved) {
                    resolved = true;
                    try { sse.close(); } catch (_) {}
                    resolve(result);
                }
            };

            sse.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.type === "progress") {
                        if (params.onProgress) params.onProgress(data);
                    } else if (data.type === "complete" || data.status === "success") {
                        if (params.onProgress) {
                            params.onProgress({
                                percent: 100,
                                speed_str: "Finished",
                                downloaded_mb: data.total_mb || data.downloaded_mb || "Complete",
                                total_mb: data.total_mb || "Complete",
                                eta: "0"
                            });
                        }
                        finish({ status: "success", ...data });
                    } else if (data.type === "already_exists" || data.status === "already_exists") {
                        finish({ status: "already_exists", ...data });
                    } else if (data.type === "error" || data.status === "error") {
                        finish({ status: "error", message: data.message || "Download failed" });
                    }
                } catch (parseErr) {
                    console.warn("[Download SSE Parse Error]", parseErr);
                }
            };

            sse.onerror = (err) => {
                console.warn("[Download SSE Connection Error]", err);
                finish({ status: "error", message: "Connection lost during video download" });
            };
        });
    }

    // Single MP4 Video Downloader
    window.downloadSingleMp4 = async function(index, overwrite = false) {
        const filtered = getFilteredLectures();
        const lecture = filtered[index] || extractedLectures[index];
        if (!lecture || !lecture.youtube_url || !lecture.youtube_url.startsWith("https://www.youtube.com")) {
            alert("No valid YouTube video link found for this topic.");
            return;
        }

        const btn = document.getElementById(`btnDlMp4_${index}`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading...`;
        }

        const courseSelect = document.getElementById("courseSelect");
        const qualitySelect = document.getElementById("qualitySelect");
        let selectedCourseTitle = "";
        if (courseSelect && courseSelect.selectedIndex >= 0) {
            selectedCourseTitle = courseSelect.options[courseSelect.selectedIndex].text || "";
        }
        const selectedQuality = qualitySelect ? qualitySelect.value : "1080p";

        const fileName = `Topic ${(lecture.lecture_number || index + 1).toString().padStart(3, '0')} - ${lecture.topic_title}.mp4`;
        window.openDownloadProgressModal("Downloading Single Video", fileName, lecture.course_name || selectedCourseTitle || "Course", lecture.week || "Week 01", false);

        try {
            const data = await downloadWithProgressStream({
                youtube_url: lecture.youtube_url,
                course_name: lecture.course_name || selectedCourseTitle || "Course",
                week: lecture.week || "Week 01",
                topic_title: lecture.topic_title || "Topic",
                lecture_number: lecture.lecture_number || (index + 1),
                overwrite: overwrite,
                quality: selectedQuality,
                onProgress: (progData) => {
                    window.updateDownloadProgressModal({
                        status: "downloading",
                        percent: progData.percent,
                        speed_str: progData.speed_str,
                        downloaded_mb: progData.downloaded_mb,
                        total_mb: progData.total_mb,
                        eta: progData.eta
                    });
                }
            });

            if (data.status === "already_exists") {
                window.closeDownloadProgressModal();
                lecture.is_downloaded = true;
                syncDownloadedFiles();
                window.showOverwriteModal(data.file_name, async (shouldOverwrite) => {
                    if (shouldOverwrite) {
                        await window.downloadSingleMp4(index, true);
                    } else {
                        if (btn) {
                            btn.disabled = false;
                            btn.className = "btn btn-sm btn-outline-success btn-dl-mp4 downloaded";
                            btn.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> Downloaded`;
                        }
                    }
                });
                return;
            }

            if (data.status === "success") {
                window.updateDownloadProgressModal({ status: "success", percent: 100 });
                setTimeout(() => window.closeDownloadProgressModal(), 1200);
                lecture.is_downloaded = true;

                if (btn) {
                    btn.disabled = false;
                    btn.className = "btn btn-sm btn-outline-success btn-dl-mp4 downloaded";
                    btn.innerHTML = `<i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> Downloaded`;
                }

                syncDownloadedFiles();
            } else {
                window.closeDownloadProgressModal();
                alert(`Download error for ${lecture.topic_title}: ${data.message || 'Unknown error'}`);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> MP4`;
                }
            }
        } catch (err) {
            window.closeDownloadProgressModal();
            alert(`Failed to download MP4: ${err.message}`);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> MP4`;
            }
        }
    };

    // Batch Selected MP4 Video Downloader
    const btnDownloadSelectedMp4 = document.getElementById("btnDownloadSelectedMp4");
    if (btnDownloadSelectedMp4) {
        btnDownloadSelectedMp4.addEventListener("click", async () => {
            const filtered = getFilteredLectures();
            const selectedLectures = Array.from(selectedIndices).map(i => filtered[i]).filter(l => l && l.youtube_url && l.youtube_url.startsWith("https://www.youtube.com"));

            if (selectedLectures.length === 0) {
                alert("No valid YouTube video links selected for download.");
                return;
            }

            let overwriteAll = false;
            let skipAll = false;

            btnDownloadSelectedMp4.disabled = true;
            btnDownloadSelectedMp4.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading (0/${selectedLectures.length})...`;

            const courseSelect = document.getElementById("courseSelect");
            const qualitySelect = document.getElementById("qualitySelect");
            let selectedCourseTitle = "";
            if (courseSelect && courseSelect.selectedIndex >= 0) {
                selectedCourseTitle = courseSelect.options[courseSelect.selectedIndex].text || "";
            }
            const selectedQuality = qualitySelect ? qualitySelect.value : "1080p";

            const firstLec = selectedLectures[0];
            const firstFileName = `Topic ${(firstLec.lecture_number || 1).toString().padStart(3, '0')} - ${firstLec.topic_title}.mp4`;
            window.openDownloadProgressModal("Batch Video Download", firstFileName, firstLec.course_name || selectedCourseTitle || "Course", firstLec.week || "Week 01", true, selectedLectures.length);

            for (let i = 0; i < selectedLectures.length; i++) {
                const l = selectedLectures[i];
                const origIndex = extractedLectures.indexOf(l);

                window.updateBatchProgressModal(i + 1, selectedLectures.length);
                const currentFileName = `Topic ${(l.lecture_number || origIndex + 1).toString().padStart(3, '0')} - ${l.topic_title}.mp4`;

                const modalFileName = document.getElementById("dlModalFileName");
                if (modalFileName) modalFileName.textContent = currentFileName;

                btnDownloadSelectedMp4.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading (${i + 1}/${selectedLectures.length})...`;

                const data = await downloadWithProgressStream({
                    youtube_url: l.youtube_url,
                    course_name: l.course_name || selectedCourseTitle || "Course",
                    week: l.week || "Week 01",
                    topic_title: l.topic_title || "Topic",
                    lecture_number: l.lecture_number || (origIndex + 1),
                    overwrite: overwriteAll,
                    quality: selectedQuality,
                    onProgress: (progData) => {
                        window.updateDownloadProgressModal({
                            status: "downloading",
                            percent: progData.percent,
                            speed_str: progData.speed_str,
                            downloaded_mb: progData.downloaded_mb,
                            total_mb: progData.total_mb,
                            eta: progData.eta
                        });
                    }
                });

                if (data.status === "already_exists" && !overwriteAll && !skipAll) {
                    const choice = await new Promise(resolve => {
                        window.showOverwriteModal(data.file_name, resolve);
                    });

                    if (choice) {
                        overwriteAll = true;
                        const retryData = await downloadWithProgressStream({
                            youtube_url: l.youtube_url,
                            course_name: l.course_name || selectedCourseTitle || "Course",
                            week: l.week || "Week 01",
                            topic_title: l.topic_title || "Topic",
                            lecture_number: l.lecture_number || (origIndex + 1),
                            overwrite: true,
                            quality: selectedQuality,
                            onProgress: (progData) => {
                                window.updateDownloadProgressModal({
                                    status: "downloading",
                                    percent: progData.percent,
                                    speed_str: progData.speed_str,
                                    downloaded_mb: progData.downloaded_mb,
                                    total_mb: progData.total_mb,
                                    eta: progData.eta
                                });
                            }
                        });
                        if (retryData.status === "success" || retryData.status === "already_exists") {
                            l.is_downloaded = true;
                        }
                    } else {
                        skipAll = true;
                        l.is_downloaded = true;
                    }
                } else if (data.status === "success" || data.status === "already_exists") {
                    l.is_downloaded = true;
                } else {
                    console.error(`Download failed for ${l.topic_title}:`, data.message);
                }

                syncDownloadedFiles();
            }

            window.updateDownloadProgressModal({ status: "success", percent: 100 });
            setTimeout(() => window.closeDownloadProgressModal(), 1500);

            btnDownloadSelectedMp4.disabled = false;
            btnDownloadSelectedMp4.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Download Selected MP4s`;
        });
    }

    // Multi-Link Batch Input Modal Handlers
    const btnOpenMultiLinkModal = document.getElementById("btnOpenMultiLinkModal");
    const multiLinkModal = document.getElementById("multiLinkModal");
    const multiLinkCloseBtn = document.getElementById("multiLinkCloseBtn");
    const btnMultiLinkCancel = document.getElementById("btnMultiLinkCancel");
    const btnMultiLinkStart = document.getElementById("btnMultiLinkStart");

    if (btnOpenMultiLinkModal && multiLinkModal) {
        btnOpenMultiLinkModal.addEventListener("click", () => {
            multiLinkModal.style.display = "flex";
        });
    }

    const closeMultiLinkModal = () => {
        if (multiLinkModal) multiLinkModal.style.display = "none";
    };

    if (multiLinkCloseBtn) multiLinkCloseBtn.addEventListener("click", closeMultiLinkModal);
    if (btnMultiLinkCancel) btnMultiLinkCancel.addEventListener("click", closeMultiLinkModal);

    // Modern Download Manager Drawer Controls
    const floatingDlManagerBtn = document.getElementById("floatingDlManagerBtn");
    const downloadManagerDrawer = document.getElementById("downloadManagerDrawer");
    const btnDrawerClose = document.getElementById("btnDrawerClose");
    const btnDrawerOpenFolder = document.getElementById("btnDrawerOpenFolder");
    const btnDrawerClearCompleted = document.getElementById("btnDrawerClearCompleted");
    const btnDrawerRefresh = document.getElementById("btnDrawerRefresh");

    window.openDownloadManagerDrawer = function() {
        if (downloadManagerDrawer) downloadManagerDrawer.style.display = "flex";
        if (window.globalDownloadQueue) window.globalDownloadQueue.syncDiskDownloads();
    };

    window.closeDownloadManagerDrawer = function() {
        if (downloadManagerDrawer) downloadManagerDrawer.style.display = "none";
    };

    if (floatingDlManagerBtn) floatingDlManagerBtn.addEventListener("click", window.openDownloadManagerDrawer);
    if (btnDrawerClose) btnDrawerClose.addEventListener("click", window.closeDownloadManagerDrawer);

    if (btnDrawerOpenFolder) {
        btnDrawerOpenFolder.addEventListener("click", () => {
            if (btnOpenDownloadsFolder) btnOpenDownloadsFolder.click();
        });
    }

    if (btnDrawerRefresh) {
        btnDrawerRefresh.addEventListener("click", () => {
            if (window.globalDownloadQueue) window.globalDownloadQueue.syncDiskDownloads();
        });
    }

    // Download Queue Manager System
    class DownloadQueueManager {
        constructor() {
            self = this;
            this.activeQueue = [];
            this.completedQueue = [];
            this.maxConcurrent = 2;
            this.runningCount = 0;
            this.totalDownloadedBytes = 0;
        }

        async syncDiskDownloads() {
            try {
                const res = await fetch("/api/scan-downloads-folder");
                const data = await res.json();
                if (data.status === "success" && data.files) {
                    const seenNames = new Set(this.completedQueue.map(t => t.file_name));
                    data.files.forEach(f => {
                        if (!seenNames.has(f.file_name)) {
                            seenNames.add(f.file_name);
                            this.completedQueue.push({
                                id: 'disk_' + Math.random().toString(36).substr(2, 7),
                                file_name: f.file_name,
                                course_name: f.course_name,
                                week: f.week,
                                status: 'success',
                                percent: 100,
                                speed_str: 'Saved on Disk',
                                total_mb: `${f.file_size_mb} MB`
                            });
                        }
                    });
                    this.renderDrawer();
                }
            } catch (e) {
                console.error("Failed to sync disk downloads:", e);
            }
        }

        addToQueue(items) {
            items.forEach(item => {
                const task = {
                    id: 'dl_' + Math.random().toString(36).substr(2, 9),
                    youtube_url: item.youtube_url,
                    course_name: item.course_name || "Course",
                    week: item.week || "Week 01",
                    topic_title: item.topic_title || "Topic",
                    lecture_number: item.lecture_number || 1,
                    quality: item.quality || "1080p",
                    status: "queued", // queued, downloading, success, error
                    percent: 0,
                    speed_str: "0.0 MB/s",
                    downloaded_mb: "0 MB",
                    total_mb: "0 MB",
                    eta: "Pending",
                    file_name: `Topic ${(item.lecture_number || 1).toString().padStart(3, '0')} - ${item.topic_title}.mp4`
                };
                this.activeQueue.push(task);
            });

            this.renderDrawer();
            this.processNext();
        }

        processNext() {
            while (this.runningCount < this.maxConcurrent) {
                const task = this.activeQueue.find(t => t.status === "queued");
                if (!task) break;
                this.runTask(task);
            }
        }

        async runTask(task) {
            task.status = "downloading";
            this.runningCount++;
            this.renderDrawer();

            try {
                const data = await downloadWithProgressStream({
                    youtube_url: task.youtube_url,
                    course_name: task.course_name,
                    week: task.week,
                    topic_title: task.topic_title,
                    lecture_number: task.lecture_number,
                    overwrite: true,
                    quality: task.quality,
                    onProgress: (progData) => {
                        task.percent = progData.percent;
                        task.speed_str = progData.speed_str;
                        task.downloaded_mb = progData.downloaded_mb;
                        task.total_mb = progData.total_mb;
                        task.eta = progData.eta ? `${progData.eta}s` : "Calculating...";
                        this.renderDrawer();
                    }
                });

                if (data.status === "success" || data.status === "already_exists") {
                    task.status = "success";
                    task.percent = 100;
                    task.speed_str = "Complete";
                    task.file_name = data.file_name || task.file_name;
                    task.total_mb = data.total_mb || task.total_mb;
                    this.totalDownloadedBytes += data.file_size || (data.downloaded_bytes || 25000000);

                    // Mark corresponding lecture as downloaded
                    const matchingLec = extractedLectures.find(l => 
                        (l.lecture_number === task.lecture_number && (l.week === task.week || !l.week)) ||
                        (l.topic_title && task.topic_title && l.topic_title.toLowerCase() === task.topic_title.toLowerCase())
                    );
                    if (matchingLec) {
                        matchingLec.is_downloaded = true;
                    }

                    // Move to completed queue
                    this.activeQueue = this.activeQueue.filter(t => t.id !== task.id);
                    this.completedQueue.unshift(task);

                    // Sync files and refresh table
                    syncDownloadedFiles();
                } else {
                    task.status = "error";
                    task.error_msg = data.message || "Failed";
                }
            } catch (ex) {
                task.status = "error";
                task.error_msg = ex.message;
            }

            this.runningCount--;
            this.renderDrawer();
            this.processNext();
        }

        renderDrawer() {
            const activeBadge = document.getElementById("dlManagerActiveBadge");
            const drawerActiveCount = document.getElementById("drawerActiveCount");
            const drawerTotalCount = document.getElementById("drawerTotalCount");
            const drawerSpeedVal = document.getElementById("drawerSpeedVal");
            const drawerQueueVal = document.getElementById("drawerQueueVal");
            const drawerTotalDownloaded = document.getElementById("drawerTotalDownloaded");
            const activeQueueContainer = document.getElementById("drawerActiveQueue");
            const completedQueueContainer = document.getElementById("drawerCompletedQueue");

            const activeDownloading = this.activeQueue.filter(t => t.status === "downloading");
            const queued = this.activeQueue.filter(t => t.status === "queued");

            if (activeBadge) activeBadge.textContent = this.activeQueue.length;
            if (drawerActiveCount) drawerActiveCount.textContent = activeDownloading.length;
            if (drawerTotalCount) drawerTotalCount.textContent = this.activeQueue.length;
            if (drawerQueueVal) drawerQueueVal.textContent = `${this.completedQueue.length} / ${this.completedQueue.length + this.activeQueue.length}`;
            if (drawerTotalDownloaded) drawerTotalDownloaded.textContent = `${(this.totalDownloadedBytes / 1024 / 1024).toFixed(1)} MB`;

            const currentSpeed = activeDownloading.length > 0 ? activeDownloading[0].speed_str : "0.0 MB/s";
            if (drawerSpeedVal) drawerSpeedVal.textContent = currentSpeed;

            // Render Active Queue Cards
            if (this.activeQueue.length === 0) {
                if (activeQueueContainer) {
                    activeQueueContainer.innerHTML = `
                        <div class="queue-empty-state">
                            <i class="fa-solid fa-download"></i>
                            <p>No active downloads in queue.</p>
                            <small>Click "⬇ MP4" or "Multi-Link Downloader" to queue videos.</small>
                        </div>`;
                }
            } else {
                if (activeQueueContainer) {
                    activeQueueContainer.innerHTML = this.activeQueue.map(task => `
                        <div class="queue-item-card ${task.status}">
                            <div class="queue-item-header">
                                <div class="queue-item-title">${escapeHtml(task.file_name)}</div>
                                <span class="yt-badge" style="background: rgba(99,102,241,0.2); color: #818cf8;">${task.quality}</span>
                            </div>
                            <div class="queue-item-meta">
                                <span><i class="fa-solid fa-folder"></i> ${escapeHtml(task.course_name)}</span>
                                <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(task.week)}</span>
                            </div>
                            <div class="queue-item-progress">
                                <div style="display:flex; justify-content:space-between; font-size: 0.8rem; color: #cbd5e1; margin-bottom:4px;">
                                    <span><i class="fa-solid fa-spinner ${task.status === 'downloading' ? 'fa-spin' : ''}"></i> ${task.status === 'downloading' ? 'Downloading...' : 'Queued'}</span>
                                    <strong>${task.percent}%</strong>
                                </div>
                                <div class="dl-progress-track" style="height:8px;">
                                    <div class="dl-progress-fill" style="width: ${task.percent}%;"></div>
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; color: #94a3b8;">
                                <span><i class="fa-solid fa-gauge-high"></i> ${task.speed_str}</span>
                                <span><i class="fa-solid fa-hard-drive"></i> ${task.downloaded_mb} / ${task.total_mb}</span>
                                <span><i class="fa-solid fa-stopwatch"></i> ETA: ${task.eta}</span>
                            </div>
                        </div>
                    `).join('');
                }
            }

            // Render Completed Queue Cards
            if (this.completedQueue.length === 0) {
                if (completedQueueContainer) {
                    completedQueueContainer.innerHTML = `
                        <div class="queue-empty-state" style="padding: 20px;">
                            <small>Completed downloads will appear here.</small>
                        </div>`;
                }
            } else {
                if (completedQueueContainer) {
                    completedQueueContainer.innerHTML = this.completedQueue.map(task => `
                        <div class="queue-item-card" style="border-color: rgba(34, 197, 94, 0.3);">
                            <div class="queue-item-header">
                                <div class="queue-item-title"><i class="fa-solid fa-circle-check" style="color: #22c55e;"></i> ${escapeHtml(task.file_name)}</div>
                                <span class="yt-badge" style="background: rgba(34, 197, 94, 0.15); color: #22c55e;">Saved</span>
                            </div>
                            <div class="queue-item-meta">
                                <span><i class="fa-solid fa-folder"></i> ${escapeHtml(task.course_name)}</span>
                                <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(task.week)}</span>
                            </div>
                        </div>
                    `).join('');
                }
            }
        }
    }

    window.globalDownloadQueue = new DownloadQueueManager();

    if (btnDrawerClearCompleted) {
        btnDrawerClearCompleted.addEventListener("click", () => {
            window.globalDownloadQueue.completedQueue = [];
            window.globalDownloadQueue.renderDrawer();
        });
    }

    // Handle Custom Multi-Link Start Button
    if (btnMultiLinkStart) {
        btnMultiLinkStart.addEventListener("click", () => {
            const textArea = document.getElementById("multiLinkTextArea");
            const courseInput = document.getElementById("multiLinkCourseFolder");
            const weekInput = document.getElementById("multiLinkWeekFolder");
            const qualitySelect = document.getElementById("qualitySelect");

            const rawText = textArea ? textArea.value.trim() : "";
            if (!rawText) {
                alert("Please enter at least one YouTube video URL.");
                return;
            }

            const urls = rawText.split('\n')
                .map(u => u.trim())
                .filter(u => u.length > 5 && (u.includes("youtube.com") || u.includes("youtu.be")));

            if (urls.length === 0) {
                alert("No valid YouTube URLs found. Please check your links.");
                return;
            }

            const cName = courseInput ? courseInput.value.trim() || "Custom Course" : "Custom Course";
            const weekName = weekInput ? weekInput.value.trim() || "Week 01" : "Week 01";
            const quality = qualitySelect ? qualitySelect.value : "1080p";

            const items = urls.map((url, idx) => ({
                youtube_url: url,
                course_name: cName,
                week: weekName,
                topic_title: `Custom Video ${idx + 1}`,
                lecture_number: idx + 1,
                quality: quality
            }));

            window.globalDownloadQueue.addToQueue(items);
            closeMultiLinkModal();
            window.openDownloadManagerDrawer();
        });
    }

    function triggerDownload(endpoint) {
        if (extractedLectures.length === 0) {
            alert("No extracted lecture data available for download yet.");
            return;
        }
        window.open(endpoint, "_blank");
    }

    function escapeHtml(str) {
        return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
});

