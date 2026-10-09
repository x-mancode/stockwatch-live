@echo off
title StockWatch Public Internet Tunnel
cd /d "%~dp0"
echo ========================================================
echo   StockWatch: Exposing Dashboard to the Internet
echo ========================================================
echo.
echo Launching Cloudflare Tunnel for http://localhost:8888...
echo Once started, look for the 'https://....trycloudflare.com' link below!
echo.
cloudflared.exe tunnel --url http://localhost:8888
pause
