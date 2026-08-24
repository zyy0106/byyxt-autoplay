@echo off
chcp 65001 >nul
title byyxt-autoplay
cd /d "%~dp0"

echo ============================================
echo   byyxt-autoplay
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install Node.js LTS from: https://nodejs.org/
  echo Then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Starting...
echo First run downloads dependencies (about 150MB, internet required, one time only).
echo Keep this window open until it finishes.
echo.
node start.js %*

echo.
echo ============================================
echo   Finished. If no red errors above, all done.
echo   Summary saved to result.json
echo ============================================
pause
