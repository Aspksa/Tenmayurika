@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Tenmayurika - Portable Launcher
cd /d "%~dp0" || exit /b 1
set "NODE=node.exe"
set "NPM=npm.cmd"
if exist "runtime\node\node.exe" (
 set "NODE=%CD%\runtime\node\node.exe"
 set "NPM=%CD%\runtime\node\npm.cmd"
 set "PATH=%CD%\runtime\node;%PATH%"
)
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
if errorlevel 1 goto :node_error
if not exist "tools\launcher.js" goto :missing
if not exist "node_modules\dotenv" (
 if /i not "%~1"=="start" if not "%~1"=="" goto :dependencies
 echo Installing dependencies once...
 call "%NPM%" install --no-audit --no-fund
 if errorlevel 1 goto :dependencies
)
"%NODE%" "tools\launcher.js" "%~1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
:node_error
echo Node.js 24 or newer required. Put portable Node.js in runtime\node.
pause
exit /b 1
:missing
echo tools\launcher.js is missing.
pause
exit /b 2
:dependencies
echo Dependencies missing or npm install failed.
pause
exit /b 4
