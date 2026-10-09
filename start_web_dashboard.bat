@echo off
title StockWatch - Live Web Dashboard (Port 8888)
cd /d "%~dp0"
echo ========================================================
echo   StockWatch: Live Real-Time Web Dashboard Link
echo ========================================================
echo Starting local live server at http://localhost:8888...
echo Opening in your browser...
echo.

start http://localhost:8888
node live_web_server.js 8888
pause
