@echo off
title StockWatch 24/7 Cloud Deployment
cd /d "%~dp0"
echo ========================================================
echo   StockWatch: 24/7 Permanent Cloud Deployment
echo   Account: x-mancode
echo ========================================================
echo.
echo Opening GitHub in your browser to create the repository...
start https://github.com/new?name=stockwatch-live
echo.
echo [STEP 1] In your browser, click the green "Create repository" button.
echo.
pause
echo.
echo [STEP 2] Pushing files to https://github.com/x-mancode/stockwatch-live...
git push -u origin main
echo.
if %errorlevel% neq 0 (
  echo If push failed, make sure you created the repo on GitHub and try again!
  pause
  exit /b
)
echo.
echo ========================================================
echo   CODE PUSHED SUCCESSFULLY!
echo ========================================================
echo.
echo [STEP 3] Opening Render.com to launch your 24/7 permanent URL...
start https://dashboard.render.com/select-repo?type=web
echo.
echo On Render:
echo 1. Sign in with GitHub
echo 2. Connect the "stockwatch-live" repository
echo 3. Click "Deploy Web Service"
echo.
echo Your permanent link (e.g. https://stockwatch-live.onrender.com)
echo will be live 24/7 forever!
echo ========================================================
pause
