@echo off
title QR Site Checklist Server
setlocal

:: Ensure local node is in PATH if present
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)

echo ====================================================
echo Starting QR Site Checklist Server...
echo ====================================================

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

echo Launching on http://localhost:3000
npm start
pause
