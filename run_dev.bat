@echo off
taskkill /F /IM AgentriX.exe >nul 2>&1
taskkill /F /IM ai-cli-manager.exe >nul 2>&1
cd /d "%~dp0"
echo [AgentriX] Starting Tauri Dev Mode...
npm run tauri dev
pause
