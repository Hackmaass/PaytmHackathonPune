@echo off
setlocal
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
cd /d "%DIR%\cortex"

echo ========================================================
echo   Cortex - Autonomous AI Back-Office for Bharat MSMEs
echo ========================================================
echo.

echo [1/2] Starting Cortex Backend Control Plane (Port 3200)...
start "Cortex Server (Port 3200)" cmd /k "pnpm.cmd dev:server"

ping -n 3 127.0.0.1 >nul 2>&1

echo [2/2] Starting Cortex Command Center Web UI (Port 5173)...
start "Cortex Web (Port 5173)" cmd /k "pnpm.cmd dev:web"

echo.
echo All systems launching:
echo   - Backend API:    http://localhost:3200
echo   - Web Dashboard:  http://localhost:5173
echo.
ping -n 3 127.0.0.1 >nul 2>&1
endlocal
