@echo off
title Neverland Bot
cd /d "%~dp0"
echo ============================================
echo   Neverland Bot - starting...
echo   Control plane: http://127.0.0.1:8800
echo ============================================
python main.py
echo.
echo Bot exited (code %errorlevel%). Press any key to close this window.
pause >nul
