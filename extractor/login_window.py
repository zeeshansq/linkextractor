import os
import sys
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from playwright.async_api import async_playwright

load_dotenv()

AUTH_DIR = Path("./.auth")
STATE_FILE = AUTH_DIR / "state.json"

async def run_interactive_login():
    AUTH_DIR.mkdir(exist_ok=True)
    
    user_email = os.getenv("DIGISKILLS_EMAIL", "").strip()
    user_pass = os.getenv("DIGISKILLS_PASSWORD", "").strip()
    login_url = os.getenv("DIGISKILLS_LOGIN_URL", "https://lms.digiskills.pk/Login.aspx")

    print(f"\n==================================================")
    print(f"  DigiSkills Interactive Login Window Launching   ")
    print(f"==================================================")
    print(f"[Login Window] Target URL: {login_url}")
    if user_email:
        print(f"[Login Window] Credentials Found: {user_email}")

    async with async_playwright() as p:
        # Launch visible headful browser
        browser = await p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled", "--start-maximized"]
        )
        
        context = await browser.new_context(viewport={"width": 1280, "height": 720})
        page = await context.new_page()
        
        print("[Login Window] Opening browser page...")
        await page.goto(login_url, wait_until="domcontentloaded")
        await asyncio.sleep(1.5)

        # Auto-fill credentials if available in .env (DO NOT Auto-submit)
        if user_email and user_pass and "example.com" not in user_email:
            try:
                print(f"[Login Window] Auto-filling credentials for {user_email} (Not auto-submitting)...")
                email_input = await page.query_selector("#txtStudentId, #txtEmail, input[type='email'], input[type='text']")
                pass_input = await page.query_selector("#txtNewPassword, #txtPassword, input[type='password']")

                if email_input and pass_input:
                    await email_input.fill(user_email)
                    await pass_input.fill(user_pass)
                    print("[Login Window] Credentials auto-filled into login fields! Please click Sign In yourself.")
            except Exception as ex:
                print(f"[Login Window] Auto-fill note: {ex}")

        print("\n[Login Window] Please click 'Sign In' in the opened browser window.")
        print("[Login Window] Waiting for dashboard navigation...")


        # Monitor page until user lands on Default.aspx / Dashboard.aspx
        logged_in = False
        for sec in range(180): # Wait up to 3 minutes
            await asyncio.sleep(1)
            try:
                if page.is_closed():
                    break

                current_url = page.url.lower()
                
                # Check for successful dashboard navigation
                if ("default" in current_url or "dashboard" in current_url or "course" in current_url) and "login" not in current_url:
                    print("\n[SUCCESS] DigiSkills Dashboard Detected!")
                    logged_in = True
                    # Give session 2 seconds to establish cookies
                    await asyncio.sleep(2)
                    await context.storage_state(path=str(STATE_FILE))
                    print(f"[SUCCESS] Session saved to {STATE_FILE.resolve()}")
                    break
            except Exception as e:
                print(f"[Login Window Monitor] {e}")
                break

        if not logged_in and not page.is_closed():
            try:
                await context.storage_state(path=str(STATE_FILE))
            except Exception:
                pass

        try:
            if not page.is_closed():
                await browser.close()
        except Exception:
            pass

    print("[Login Window] Process finished.\n")

if __name__ == "__main__":
    asyncio.run(run_interactive_login())
