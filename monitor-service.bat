@echo off
title ZKTeco Service Monitor v2.0
color 0E
mode con: cols=100 lines=35

set "PROJECT_PATH=%USERPROFILE%\Desktop\zkteco-attendance"
set "SERVICE_NAME=zkteco-service"

:menu
cls
echo ========================================
echo       ZKTeco Service Monitor
echo ========================================
echo Project: %PROJECT_PATH%
echo Service: %SERVICE_NAME%
echo ========================================
echo [1] View Status
echo [2] View Live Logs (PM2)
echo [3] View Local Logs
echo [4] Restart Service
echo [5] Stop Service
echo [6] Start Service
echo [7] Open Dashboard
echo [8] Manual Sync
echo [9] View Data Files
echo [A] Advanced
echo [0] Exit
echo.
set /p choice="Select: "

if "%choice%"=="1" goto status
if "%choice%"=="2" goto pm2logs
if "%choice%"=="3" goto localogs
if "%choice%"=="4" goto restart
if "%choice%"=="5" goto stop
if "%choice%"=="6" goto startsvc
if "%choice%"=="7" goto dashboard
if "%choice%"=="8" goto manualsync
if "%choice%"=="9" goto viewdata
if /i "%choice%"=="A" goto advanced
if "%choice%"=="0" exit
goto menu

:status
cls
echo ========== SERVICE STATUS ==========
pm2 status %SERVICE_NAME%
echo.
echo Port 3000 Check:
netstat -an | find ":3000" >nul && echo ✅ Listening || echo ❌ Not Running
pause
goto menu

:pm2logs
cls
echo LIVE LOGS (Ctrl+C to exit)
pm2 logs %SERVICE_NAME%
goto menu

:localogs
cls
echo Local Logs:
echo.
if not exist "%PROJECT_PATH%\logs" mkdir "%PROJECT_PATH%\logs"
dir "%PROJECT_PATH%\logs" /b
echo.
set /p c="Open latest? (Y/N): "
if /i "%c%"=="Y" (
    for /f %%i in ('dir "%PROJECT_PATH%\logs\*.log" /b /o:-d') do (
        notepad "%PROJECT_PATH%\logs\%%i"
        goto menu
    )
)
goto menu

:restart
pm2 restart %SERVICE_NAME%
echo Service Restarted!
timeout /t 2 >nul
goto menu

:stop
pm2 stop %SERVICE_NAME%
echo Service Stopped!
timeout /t 2 >nul
goto menu

:startsvc
cd /d "%PROJECT_PATH%"
pm2 start app.js --name %SERVICE_NAME% --time
echo Service Started!
timeout /t 2 >nul
goto menu

:dashboard
start "" "http://localhost:3000"
goto menu

:manualsync
curl -s http://localhost:3000/api/trigger >nul
echo Sync Triggered!
timeout /t 2 >nul
goto menu

:viewdata
cls
echo DATA FILES:
echo.
if not exist "%PROJECT_PATH%\data" mkdir "%PROJECT_PATH%\data"
dir "%PROJECT_PATH%\data\*.json" /b
echo.
pause
goto menu

:advanced
cls
echo [1] Reinstall Dependencies
echo [2] Update PM2
echo [3] System Info
echo [4] Reset Service
echo [5] Back
set /p adv="Select: "

if "%adv%"=="1" (
    cd /d "%PROJECT_PATH%" && npm install --force
)
if "%adv%"=="2" npm update -g pm2
if "%adv%"=="3" systeminfo | findstr /B /C:"OS"
if "%adv%"=="4" (
    pm2 delete %SERVICE_NAME%
    cd /d "%PROJECT_PATH%"
    pm2 start app.js --name %SERVICE_NAME%
    pm2 save
)
goto menu
