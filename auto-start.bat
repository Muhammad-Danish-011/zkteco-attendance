@echo off
title ZKTeco Attendance - One Time Setup

echo ========================================
echo   ZKTeco Attendance - One Time Setup
echo ========================================
echo.

cd /d "%USERPROFILE%\Desktop\zkteco-attendance"

echo Checking Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js not installed!
    echo Please install Node.js LTS from https://nodejs.org
    pause
    exit /b
)

echo.
echo Installing dependencies...
npm install

echo.
echo Installing PM2 (if not installed)...
npm install -g pm2

echo.
echo Starting app with PM2...
pm2 start app.js --name zkteco-service

echo.
echo Saving PM2 process list...
pm2 save

echo.
echo ========================================
echo ✅ SETUP COMPLETED SUCCESSFULLY
echo ========================================
echo.
echo • Service name: zkteco-service
echo • Auto start: ENABLED via Task Scheduler
echo • Local URL: http://localhost:3000
echo.
echo ⚠️ IMPORTANT:
echo Task Scheduler MUST be configured separately
echo to run: pm2 resurrect at system startup
echo.
pause
