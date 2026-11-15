@echo off
setlocal
set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges to fix ownership and permissions...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ========================================================
echo   Fixing Ownership and File Permissions for %USERNAME%
echo   Target Directory: %DIR%
echo ========================================================
echo.

echo [1/3] Taking ownership of repository files...
takeown /f "%DIR%" /r /d y

echo.
echo [2/3] Granting full permissions to omkar, %USERNAME%, and Users...
icacls "%DIR%" /grant "omkar:(OI)(CI)F" "%USERNAME%:(OI)(CI)F" "Users:(OI)(CI)F" "Everyone:(OI)(CI)F" /t /c /q

echo.
echo [3/3] Adding Git safe.directory exception...
git config --global --add safe.directory "%DIR%"

echo.
echo ========================================================
echo   Permissions successfully restored!
echo   Launching Cortex Control Plane & Web UI...
echo ========================================================
start "" "%DIR%\run-cortex.bat"
timeout /t 5
exit /b
