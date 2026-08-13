# 🎬 Getting Started & Installation Guide

This guide covers complete step-by-step setup instructions for installing, configuring, and launching the **DigiSkills Video Links Extractor** on Windows.

---

## 🛠️ Prerequisites

Before starting, ensure you have:
- **Python 3.10 or higher** installed on your system (Verify with `python --version`).
- Active internet connection to download dependencies & Playwright Chromium browser binaries.
- A valid DigiSkills LMS student account (`lms.digiskills.pk`).

---

## 🐍 Step 1: Virtual Environment Setup (`venv`)

> [!IMPORTANT]
> **Why use a virtual environment?** Isolating project dependencies prevents version conflicts with other Python packages on your computer.

### Creating the Virtual Environment
Open your terminal in the root project folder `c:\py-projects\Link Extractor` and run:

```bash
python -m venv venv
```

### Activating the Virtual Environment

Choose the activation command corresponding to your terminal shell:

#### ⚡ Option A: Windows PowerShell
```powershell
.\venv\Scripts\Activate.ps1
```
> [!NOTE]
> If PowerShell blocks execution with a security policy error, run this once to grant script permissions for your session:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
> ```

#### 💻 Option B: Command Prompt (`cmd.exe`)
```cmd
venv\Scripts\activate.bat
```

#### 🐧 Option C: Git Bash / Linux Shell
```bash
source venv/Scripts/activate
```

> [!TIP]
> When successfully activated, your terminal prompt will display `(venv)` at the left margin!

---

## 📦 Step 2: Install Dependencies & Browser Engine

Once `(venv)` is active, install the Python requirements and Playwright browser:

```bash
# 1. Install required Python packages
pip install -r requirements.txt

# 2. Download Playwright's Chromium browser engine
playwright install chromium
```

---

## 🔑 Step 3: Configure Environment Credentials (`.env`)

You can store your DigiSkills login credentials and platform URLs in `.env` so you don't need to type them manually every time.

Open `.env` (or copy `.env.example` to `.env`) and add your login details:

```env
# DigiSkills LMS Credentials
DIGISKILLS_EMAIL=your_email@example.com
DIGISKILLS_PASSWORD=your_password_here

# Platform URLs
DIGISKILLS_LOGIN_URL=https://lms.digiskills.pk/Login.aspx
DIGISKILLS_DASHBOARD_URL=https://lms.digiskills.pk/Dashboard.aspx

# Application Settings
PORT=8000
HEADLESS=true
```

> [!NOTE]
> Storing credentials in `.env` enables **One-Click Auto Login** directly from the dashboard!


---

## 🚀 Step 3: Launching the Application

### Method 1: Web Dashboard Interface (Recommended)

Start the FastAPI server:
```bash
python main.py --port 8000
```

Access the interactive dashboard in your browser at:
👉 **`http://localhost:8000`**

---

### Method 2: Command Line Interface (CLI Mode)

If you prefer terminal-based execution:
```bash
python main.py --cli
```

---

## ⚙️ Command Line Options Reference

| Command | Description | Default Value |
| :--- | :--- | :--- |
| `python main.py` | Launches Web UI on default port 8000 | `http://localhost:8000` |
| `python main.py --port 9000` | Launches Web UI on custom port (e.g. 9000) | `8000` |
| `python main.py --cli` | Runs interactive Command-Line Interface mode | Off |
| `deactivate` | Exits the active virtual environment | N/A |
