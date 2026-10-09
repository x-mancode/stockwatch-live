@echo off
title Push StockWatch to GitHub for 24/7 Deployment
cd /d "%~dp0"
echo ========================================================
echo   StockWatch: Push to GitHub for Permanent 24/7 Hosting
echo ========================================================
echo.
echo Step 1: Create a new repository at https://github.com/new
echo         Name it: stockwatch-live
echo.
set /p REPO_URL="Paste your GitHub Repo URL here (e.g. https://github.com/yourname/stockwatch-live.git): "
if "%REPO_URL%"=="" goto end
git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main
echo.
echo Pushing files to GitHub...
git push -u origin main
echo.
echo ========================================================
echo SUCCESS! Now deploy on Render (100%% Free):
echo 1. Open https://render.com and sign in with GitHub
echo 2. Click 'New +' -> 'Web Service'
echo 3. Select your 'stockwatch-live' repository
echo 4. Click 'Deploy Web Service'
echo.
echo Your permanent fixed URL (e.g. stockwatch-live.onrender.com)
echo will be live 24/7 even when your laptop is turned off!
echo ========================================================
:end
pause
