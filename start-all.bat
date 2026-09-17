@echo off
title Neverland - Start All
echo Launching Neverland Bot and Dashboard in separate windows...
start "Neverland Bot" cmd /k "%~dp0start-bot.bat"
timeout /t 3 /nobreak >nul
start "Neverland Dashboard" cmd /k "%~dp0start-dashboard.bat"
echo.
echo Both windows launched:
echo   - Bot:        http://127.0.0.1:8800/health
echo   - Dashboard:  http://localhost:3000
echo Close each window to stop that service.
timeout /t 5 >nul
