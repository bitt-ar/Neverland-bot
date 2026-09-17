@echo off
title Neverland Dashboard
cd /d "%~dp0dashboard"
echo ============================================
echo   Neverland Dashboard (dev) - starting...
echo   URL: http://localhost:3000
echo ============================================
pnpm dev
echo.
echo Dashboard exited (code %errorlevel%). Press any key to close this window.
pause >nul
