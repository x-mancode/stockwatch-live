@echo off
title StockWatch Live Terminal (Port 8888)
cd /d "%~dp0"
echo ========================================================
echo   StockWatch: Live Auto-Fetching HTML Terminal
echo ========================================================
echo Starting live feed at http://localhost:8888...
echo Opening in your browser...
echo.

start http://localhost:8888
node live_web_server.js 8888
pause
