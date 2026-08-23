@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==========================================
echo    FACEBOOK PERSONAL PROFILE - 1 POST
echo ==========================================
echo.

echo [1/2] Checking current campaign...

for /f "delims=" %%A in ('node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('config/campaign-config.json','utf8')); const c=cfg.currentCampaign||cfg.campaign||cfg.current; let s='GENERATE'; try { const x=JSON.parse(fs.readFileSync('data/captions.json','utf8')); if(x.campaign===c && Array.isArray(x.captions) && x.captions.length>=25) s='SKIP'; } catch(e) {} console.log(s);"') do set CAPTION_STATUS=%%A

if /i "%CAPTION_STATUS%"=="GENERATE" (
    echo [CAMPAIGN CHANGED] Generating captions...
    call npx.cmd tsx generate-captions.ts
    if errorlevel 1 (
        echo [ERROR] Caption generation failed.
        exit /b 1
    )
    echo [OK] Captions generated.
) else (
    echo [OK] Captions already match current campaign.
)

echo.
echo [2/2] Posting ONE personal-profile post...
echo.

call npx.cmd tsx post-personal-profile.ts

if errorlevel 1 (
    echo.
    echo [ERROR] post-personal-profile.ts failed.
    exit /b 1
)

echo.
echo ==========================================
echo   FACEBOOK PERSONAL PROFILE - DONE
echo ==========================================
echo   ONE run = ONE post = FOUR images
echo ==========================================
echo.

endlocal
