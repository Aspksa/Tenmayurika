@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Tenmayurika - Launcher
cd /d "%~dp0" || (echo [ERROR] Cannot open project directory.& pause & exit /b 1)
echo ==========================================
echo        TENMAYURIKA - START
echo ==========================================
echo Directory: "%CD%"
where node.exe >nul 2>&1
if errorlevel 1 (
 echo [ERROR] Node.js not found. Install Node.js LTS from https://nodejs.org/
 pause
 exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
 echo [ERROR] npm.cmd not found. Reinstall Node.js LTS.
 pause
 exit /b 1
)
if not exist "package.json" (
 echo [INFO] This repository has no application yet.
 echo [INFO] Add package.json with a start or dev script, then run this BAT again.
 pause
 exit /b 2
)
if not exist "node_modules\" (
 echo [INFO] Installing dependencies...
 if exist "package-lock.json" (
  call npm.cmd ci
 ) else (
  call npm.cmd install
 )
 if errorlevel 1 goto :failed
)
node.exe -e "const s=require('./package.json').scripts||{};process.exit(s.start?0:s.dev?1:2)"
if errorlevel 1 goto :check_dev
echo [INFO] Open http://127.0.0.1:5173 in your browser.
start "" "http://127.0.0.1:5173"
echo [INFO] Starting application with npm start...
call npm.cmd start
goto :finished
:check_dev
node.exe -e "const s=require('./package.json').scripts||{};process.exit(s.dev?0:1)"
if errorlevel 1 (
 echo [ERROR] package.json needs scripts.start or scripts.dev
 pause
 exit /b 3
)
echo [INFO] Open http://127.0.0.1:5173 in your browser.
start "" "http://127.0.0.1:5173"
echo [INFO] Starting application with npm run dev...
call npm.cmd run dev
goto :finished
:failed
echo [ERROR] Dependency installation failed.
pause
exit /b 4
:finished
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo [ERROR] Application exited with code %RESULT%.
pause
exit /b %RESULT%
