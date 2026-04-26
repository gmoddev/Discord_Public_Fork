@echo off
:loop
echo [INFO] Starting run.js...
node run.js
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE%==100 (
    echo [INFO] Shutdown code received. Exiting loop.
    goto end
)

echo [WARN] run.js crashed or exited with code %EXIT_CODE%. Restarting...
timeout /t 2 >nul
goto loop

:end
echo [INFO] Script has exited gracefully.
