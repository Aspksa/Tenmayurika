@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Tenmayurika - Launcher
cd /d "%~dp0" || (echo [ERROR] Cannot open project directory.& pause & exit /b 1)
echo ==========================================
echo        TENMAYURIKA - START
echo ==========================================
echo Directory: "%CD%"
set "NODE=node.exe"
set "NPM=npm.cmd"
if exist "%~dp0runtime
ode
ode.exe" (
 set "NODE=%~dp0runtime
ode
ode.exe"
 set "NPM=%~dp0runtime
ode
pm.cmd"
 set "PATH=%~dp0runtime
ode;%PATH%"
)
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
 echo [ERROR] Node.js not found. Put portable Node.js 24+ in runtime
ode.
 pause
 exit /b 1
)
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
if errorlevel 1 (
 echo [ERROR] Node.js 24 or newer is required for built-in SQLite.
 pause
 exit /b 1
)
if not exist "%~dp0runtime
ode
ode.exe" (
 where npm.cmd >nul 2>&1
 if errorlevel 1 goto :no_npm
) else (
 if not exist "%NPM%" goto :no_npm
)
goto :npm_ready
:no_npm
echo [ERROR] npm.cmd not found. Put full portable Node.js distribution in runtime
ode.
pause
exit /b 1
:npm_ready
if not exist "package.json" (
 echo [INFO] This repository has no application yet.
 echo [INFO] Add package.json with a start or dev script, then run this BAT again.
 pause
 exit /b 2
)
echo [INFO] Installing or updating Node.js dependencies...
call "%NPM%" install --no-audit --no-fund
if errorlevel 1 goto :failed
"%NODE%" -e "const s=require('./package.json').scripts||{};process.exit(s.start?0:s.dev?1:2)"
if errorlevel 1 goto :check_dev
echo [INFO] Open http://127.0.0.1:5173 in your browser.
start "" "http://127.0.0.1:5173"
echo [INFO] Starting application with npm start...
call "%NPM%" start
goto :finished
:check_dev
"%NODE%" -e "const s=require('./package.json').scripts||{};process.exit(s.dev?0:1)"
if errorlevel 1 (
 echo [ERROR] package.json needs scripts.start or scripts.dev
 pause
 exit /b 3
)
echo [INFO] Open http://127.0.0.1:5173 in your browser.
start "" "http://127.0.0.1:5173"
echo [INFO] Starting application with npm run dev...
call "%NPM%" run dev
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
