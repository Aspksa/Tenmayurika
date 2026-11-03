@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title 🎮 Tenmayurika | Запуск
pushd "%~dp0" || exit /b 1
echo.
echo  ====================================================
echo   🎮 TENMAYURIKA
echo   ✦  Подготовка окружения и запуск
echo  ====================================================
echo.
set "NODE=node.exe"
set "NPM=npm.cmd"
if exist "runtime\node\node.exe" (
 set "NODE=%~dp0runtime\node\node.exe"
 set "NPM=%~dp0runtime\node\npm.cmd"
 set "PATH=%~dp0runtime\node;%PATH%"
)
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
if errorlevel 1 goto :bootstrap_node
goto :python_check
if exist "%~dp0tools\progress.js" "%NODE%" "%~dp0tools\progress.js" 1
:bootstrap_node
echo [*] 🧩 Подготовка Node.js 24...
powershell.exe -NoProfile -NonInteractive -File "%~dp0tools\bootstrap-node.ps1"
if errorlevel 1 goto :node_error
if not exist "%~dp0runtime\node\node.exe" goto :node_error
set "NODE=%~dp0runtime\node\node.exe"
set "NPM=%~dp0runtime\node\npm.cmd"
set "PATH=%~dp0runtime\node;%PATH%"
:python_check
if /i "%~1"=="doctor" goto :check_files
if exist "%~dp0tools\progress.js" "%NODE%" "%~dp0tools\progress.js" 2
if not exist "%~dp0runtime\python\python.exe" (
 echo [*] 🐍 Проверка Python...
 powershell.exe -NoProfile -NonInteractive -File "%~dp0tools\bootstrap-python.ps1"
 if errorlevel 1 (
  echo [!] ⚠ Python недоступен. Основной запуск продолжится.
 )
)
:check_files
if not exist "%~dp0tools\launcher.js" goto :missing
"%NODE%" -e "require('dotenv');import('@lancedb/lancedb').then(()=>process.exit(0),()=>process.exit(1))" >nul 2>nul
if not errorlevel 1 goto :deps_ready
if exist "%~dp0tools\progress.js" "%NODE%" "%~dp0tools\progress.js" 3
echo [*] 🔧 Восстановление зависимостей...
call "%NPM%" install --no-audit --no-fund
if errorlevel 1 goto :dependencies
"%NODE%" -e "require('dotenv');import('@lancedb/lancedb').then(()=>process.exit(0),()=>process.exit(1))" >nul 2>nul
if errorlevel 1 goto :dependencies
:deps_ready
 echo [OK] ✨ Зависимости готовы.
 echo [*] 🚀 Запуск Tenmayurika...
"%NODE%" "%~dp0tools\launcher.js" "%~1"
set "RESULT=%ERRORLEVEL%"
if "%RESULT%"=="0" echo [OK] 🌸 Работа завершена.
if not "%RESULT%"=="0" echo [!] ⚠ Завершено с ошибкой %RESULT%.
if not "%RESULT%"=="0" pause
popd
exit /b %RESULT%
:node_error
echo [X] ❌ Не удалось подготовить Node.js 24 или новее.
pause
exit /b 1
:missing
echo [ОШИБКА] Не найден tools\launcher.js.
pause
exit /b 2
:dependencies
echo [ОШИБКА] Не удалось установить зависимости.
pause
exit /b 4
