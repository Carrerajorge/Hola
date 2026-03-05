@echo off
title Cowork Clone - AI File Management Agent
echo.
echo Starting Cowork Clone...
echo.

REM Check if .env exists
if not exist .env (
    echo First time setup detected!
    python setup.py
    if %errorlevel% neq 0 (
        echo Setup failed. Please check your Python installation.
        pause
        exit /b 1
    )
)

REM Start the server
echo Starting server at http://127.0.0.1:8000
echo Press Ctrl+C to stop
echo.
python app.py
pause
