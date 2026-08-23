@echo off
setlocal

REM ============================================================
REM DAO BÁNH QUY - DAILY AUTOMATION
REM Project root:
REM C:\Users\ADMIN\OneDrive\Desktop\auto post playwright - page
REM
REM DAILY FLOW:
REM   1) prepare-daily-batch.ts
REM   2) post-daily.ts
REM
REM generate-captions.ts is NOT run daily.
REM Run it manually once whenever currentCampaign changes.
REM ============================================================

REM This BAT lives in fbpost\
REM Move to project root so the root .env is available.
cd /d "%~dp0.."

if not exist "fbpost\logs" mkdir "fbpost\logs"

set LOG_FILE=fbpost\logs\daily-%date:~10,4%-%date:~4,2%-%date:~7,2%.log

echo.
echo ============================================================
echo START DAILY AUTOMATION
echo %date% %time%
echo ============================================================
echo.

echo [1/2] Preparing today's 25-group batch...
call npx.cmd tsx fbpost\prepare-daily-batch.ts >> "%LOG_FILE%" 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] prepare-daily-batch.ts failed.
    echo See: %LOG_FILE%
    echo.
    exit /b 1
)

echo.
echo [OK] Daily batch prepared.
echo.

echo [2/2] Starting Facebook posting...
call npx.cmd tsx fbpost\post-daily.ts >> "%LOG_FILE%" 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] post-daily.ts failed.
    echo See: %LOG_FILE%
    echo.
    exit /b 1
)

echo.
echo ============================================================
echo DAILY AUTOMATION FINISHED
echo %date% %time%
echo ============================================================
echo.
echo Log: %LOG_FILE%

endlocal
