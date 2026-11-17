@echo off
title Urdu Intercom Server
cd /d "%~dp0"

echo ====================================================
echo    اردو ڈیجیٹل انٹر کام - لوکل لائیو سرور
echo ====================================================
echo.

:: Purane chalte hue server process ko band karein agar port 3000 pe hai
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo سرور شروع ہو رہا ہے: http://localhost:3000
echo.
start http://localhost:3000
node server.js
pause
