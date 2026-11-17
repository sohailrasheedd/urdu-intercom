@echo off
title Deploy to Vercel
cd /d "%~dp0"
echo ====================================================
echo        Vercel Deployment (اردو انٹر کام)
echo ====================================================
echo.
echo Vercel CLI chalayi ja rahi hai...
echo Agar pehli dafa hai to browser mein Vercel login khulega.
echo.
npx vercel
pause
