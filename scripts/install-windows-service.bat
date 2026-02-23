@echo off
setlocal

:: Get the directory of the current batch script
set "DIR=%~dp0"
set "PROJECT_ROOT=%DIR%.."
set "DAEMON_SCRIPT=%PROJECT_ROOT%\dist\daemon\iliagpt-daemon.js"

:: Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Please run this script as Administrator.
    pause
    exit /b 1
)

echo Registering ILIAGPT Hypervisor Daemon as a Windows Scheduled Task (Run at Startup)...

:: Create the scheduled task using PowerShell
powershell -Command "$action = New-ScheduledTaskAction -Execute 'node' -Argument '\"%DAEMON_SCRIPT%\"'; $trigger = New-ScheduledTaskTrigger -AtStartup; $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 10000); Register-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -TaskName 'ILIAGPT-Hypervisor-Daemon' -Description 'Runs the ILIAGPT Native Daemon IPC server' -Force"

if %errorLevel% equ 0 (
    echo [SUCCESS] ILIAGPT Hypervisor Daemon registered successfully.
    echo To manually start the service now, you can run:
    echo schtasks /run /tn "ILIAGPT-Hypervisor-Daemon"
) else (
    echo [FAILED] Failed to register the service.
)

pause
