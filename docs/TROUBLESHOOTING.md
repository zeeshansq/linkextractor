# 🛠️ Troubleshooting Guide & FAQ

This guide provides solutions to common issues, error messages, and edge cases encountered when running the **DigiSkills Video Links Extractor**.

---

## ❓ Frequently Asked Questions & Problem Solving

### 1. 🔒 "Not Logged In" or Session Expired

> [!WARNING]
> **Symptom**: The status dot in the upper right displays `Not Logged In` or fetching courses returns an empty list.

**Solution**:
1. Click the **"Login Browser"** button in the dashboard header.
2. A headful browser window will launch navigating to `https://lms.digiskills.pk/`.
3. Log into your DigiSkills account with your email, password, and optional CAPTCHA.
4. Once you see your student dashboard inside the browser window, close it or leave it open. The session state is saved to `.auth/state.json`.
5. Return to the Web Dashboard and click **"Fetch Courses"**.

---

### 2. 🌐 "Address already in use" (Port 8000 Conflict)

> [!CAUTION]
> **Symptom**: `OSError: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000)`

**Solution**:
Run the application on a different port (e.g. 9000 or 8080):
```bash
python main.py --port 9000
```
Then open `http://localhost:9000` in your browser.

---

### 3. 🚨 Playwright Browser Driver / Chromium Missing

> [!IMPORTANT]
> **Symptom**: `playwright._impl._errors.Error: Executable doesn't exist at ...`

**Solution**:
Install the Chromium browser binaries into Playwright:
```bash
# Ensure virtual environment is active
.\venv\Scripts\Activate.ps1

# Run driver installation
playwright install chromium
```

---

### 4. ⚡ PowerShell "Script Execution Disabled" Error

> [!NOTE]
> **Symptom**: `File ...\Activate.ps1 cannot be loaded because running scripts is disabled on this system.`

**Solution**:
Temporarily allow local script execution in your PowerShell session:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\venv\Scripts\Activate.ps1
```

---

### 5. 🎥 "video_not_found" or Missing YouTube Link for a Lecture

> [!WARNING]
> **Symptom**: The extractor records a lecture topic title but marks the YouTube link as `N/A`.

**Possible Causes & Fixes**:
1. **Interactive Click Required**: Some DigiSkills lectures require clicking a tab (e.g., "Video", "Topic Detail", or "Play") before the YouTube iFrame loads into the DOM. The extractor automatically handles clicking fallback elements, but slow connections may need a higher wait threshold.
2. **Non-YouTube Player**: If the video is hosted on an internal stream or Vimeo rather than YouTube, the URL won't match standard YouTube patterns. Check the raw `embed_url` field in the JSON export for alternative video sources.

---

### 6. 🧹 How to Reset Authentication / Clear Stale Cookies

If your LMS account credentials changed or session cookies became invalid:
1. Delete the `.auth` folder inside the project directory:
   ```cmd
   rmdir /s /q .auth
   ```
2. Click **"Login Browser"** in the web interface to establish a fresh session.

---

## 📌 Summary Matrix of Diagnostic Commands

| Problem | Fix Command |
| :--- | :--- |
| **Port 8000 busy** | `python main.py --port 8500` |
| **Missing browser driver** | `playwright install chromium` |
| **Clear saved login session** | `rmdir /s /q .auth` |
| **PowerShell script blocked** | `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process` |
| **Run in terminal CLI mode** | `python main.py --cli` |
