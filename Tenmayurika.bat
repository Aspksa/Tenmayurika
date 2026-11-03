@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "OLDCP="
for /f "tokens=2 delims=:." %%A in ('chcp') do set /a "OLDCP=%%A" >nul 2>nul
chcp 65001 >nul
title 🎮 Tenmayurika ^| Запуск
pushd "%~dp0" || goto :pushd_error
echo.
echo  ====================================================
echo   🎮 TENMAYURIKA
echo   ✦  Подготовка окружения и запуск
echo  ====================================================
echo.
set "NODE=node.exe"
if exist "runtime\node\node.exe" (
 set "NODE=%~dp0runtime\node\node.exe"
 set "PATH=%~dp0runtime\node;%PATH%"
)
"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" >nul 2>nul
if errorlevel 1 goto :bootstrap_node
goto :python_check
:bootstrap_node
echo [*] 🧩 Подготовка Node.js 24...
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\bootstrap-node.ps1"
if errorlevel 1 goto :node_error
if not exist "%~dp0runtime\node\node.exe" (
 node.exe -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)" >nul 2>nul
 if errorlevel 1 goto :node_error
 goto :python_check
)
set "NODE=%~dp0runtime\node\node.exe"
set "PATH=%~dp0runtime\node;%PATH%"
:python_check
if /i "%~1"=="doctor" goto :check_files
if exist "%~dp0tools\progress.js" "%NODE%" "%~dp0tools\progress.js" 2
if not exist "%~dp0runtime\python\python.exe" (
 echo [*] 🐍 Проверка Python...
 powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\bootstrap-python.ps1"
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
set "NPM_MODE=install"
if exist "%~dp0package-lock.json" set "NPM_MODE=ci"
"%NODE%" "%~dp0tools\run-npm.js" %NPM_MODE% --no-audit --no-fund
set "NPM_RESULT=%ERRORLEVEL%"
if "%NPM_RESULT%"=="86" goto :portable_npm
if not "%NPM_RESULT%"=="0" goto :dependencies
goto :verify_deps
:portable_npm
echo [!] ⚠ У найденного Node.js нет npm. Загружаю переносной Node.js 24 с npm...
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\bootstrap-node.ps1" -RequireNpm
if errorlevel 1 goto :node_error
if not exist "%~dp0runtime\node\node.exe" goto :node_error
set "NODE=%~dp0runtime\node\node.exe"
set "PATH=%~dp0runtime\node;%PATH%"
"%NODE%" "%~dp0tools\run-npm.js" %NPM_MODE% --no-audit --no-fund
if errorlevel 1 goto :dependencies
:verify_deps
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
goto :finish
:node_error
echo [X] ❌ Не удалось подготовить Node.js 24 или новее.
pause
set "RESULT=1"
goto :finish
:missing
echo [ОШИБКА] Не найден tools\launcher.js.
pause
set "RESULT=2"
goto :finish
:dependencies
echo [ОШИБКА] Не удалось установить зависимости.
pause
set "RESULT=4"
goto :finish
:pushd_error
echo [ОШИБКА] Не удалось перейти в папку запуска.
if defined OLDCP chcp %OLDCP% >nul
exit /b 1
:finish
popd
if defined OLDCP chcp %OLDCP% >nul
exit /b %RESULT%
