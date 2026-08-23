@echo off
setlocal

REM ============================================================
REM FACEBOOK PERSONAL - DAILY AUTOMATION
REM Project root:
REM C:\Users\ADMIN\OneDrive\Desktop\auto post playwright - fb cá nhân
REM
REM DAILY FLOW:
REM   1) Check currentCampaign vs captions.json
REM   2) If campaign changed/missing -> generate 25 captions
REM   3) prepare-daily-batch.ts
REM   4) post-daily.ts
REM ============================================================

REM This BAT lives in fbpost\
REM Move to project root so the root .env is available.
cd /d "%~dp0.."

if not exist "fbpost\logs" mkdir "fbpost\logs"

set LOG_FILE=fbpost\logs\daily-%date:~10,4%-%date:~4,2%-%date:~7,2%.log

echo.
echo ============================================================
echo START FACEBOOK PERSONAL DAILY AUTOMATION
echo %date% %time%
echo ============================================================
echo.

REM ============================================================
REM [1/3] CHECK CAMPAIGN
REM ============================================================

echo [1/3] Checking current campaign...

for /f "delims=" %%A in ('node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('fbpost/config/campaign-config.json','utf8')); let wanted=cfg.currentCampaign||cfg.campaign||cfg.current; let status='GENERATE'; try { const saved=JSON.parse(fs.readFileSync('fbpost/data/captions.json','utf8')); if(saved.campaign===wanted && Array.isArray(saved.captions) && saved.captions.length>=25) status='SKIP'; } catch(e) {} console.log(status);"') do set CAMPAIGN_STATUS=%%A

if /i "%CAMPAIGN_STATUS%"=="GENERATE" (
    echo.
    echo [CAMPAIGN CHANGE / MISSING CAPTIONS]
    echo Generating 25 captions for the current campaign...
    echo.

    call npx.cmd tsx fbpost\generate-captions.ts >> "%LOG_FILE%" 2>&1

    if errorlevel 1 (
        echo.
        echo [ERROR] generate-captions.ts failed.
        echo See: %LOG_FILE%
        echo.
        exit /b 1
    )

    echo.
    echo [OK] Captions generated.
    echo.
) else (
    echo [OK] Current campaign matches captions.json.
    echo [SKIP] No caption generation needed.
    echo.
)

REM ============================================================
REM [2/3] PREPARE DAILY BATCH
REM ============================================================

echo [2/3] Preparing today's 25-group batch...

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

REM ============================================================
REM [3/3] POST
REM ============================================================

echo [3/3] Starting Facebook personal posting...

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
echo FACEBOOK PERSONAL DAILY AUTOMATION FINISHED
echo %date% %time%
echo ============================================================
echo.
echo Log: %LOG_FILE%

endlocal
