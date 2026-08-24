@echo off
chcp 65001 >nul
title byyxt-autoplay
cd /d "%~dp0"

echo ============================================
echo   byyxt-autoplay
echo ============================================
echo.

set "LOCAL_NODE=%~dp0runtime\node"
if exist "%LOCAL_NODE%\node.exe" set "PATH=%LOCAL_NODE%;%PATH%"

set "NODE_OK=0"
where node >nul 2>nul
if not errorlevel 1 (
  node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" >nul 2>nul
  if not errorlevel 1 set "NODE_OK=1"
)
if "%NODE_OK%"=="1" goto :node_done

echo Node.js is missing or too old (v18 or newer required).
echo Downloading a portable Node.js into this folder...
echo About 30MB, no administrator rights needed. Please wait.
echo.
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tools\install-node.ps1" -Root "%~dp0."
) else (
  powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tools\install-node.ps1" -Root "%~dp0."
)
set "PATH=%~dp0runtime\node;%PATH%"
node -e "process.exit(Number(process.versions.node.split('.')[0])>=18?0:1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Automatic download failed. Please install manually:
  echo   https://nodejs.org/  choose an LTS version, v18 or newer
  echo Then double-click this file again.
  echo.
  pause
  exit /b 1
)
echo Node.js ready.
echo.

:node_done
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
