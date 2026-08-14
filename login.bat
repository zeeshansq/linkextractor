@echo off
title DigiSkills Login Window Launcher
echo.
echo ==================================================
echo   DigiSkills Interactive Login Window Launcher
echo ==================================================
echo.
echo Starting Chromium browser for DigiSkills login...
echo After logging in, your session will be saved automatically.
echo.
cd /d "%~dp0"
if exist "C:\venv\envTemp\Scripts\python.exe" (
    "C:\venv\envTemp\Scripts\python.exe" -m extractor.login_window
) else if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" -m extractor.login_window
) else (
    python -m extractor.login_window
)
echo.
echo Login window closed. Session saved to .auth\state.json
pause
