@echo off
title StockWatch - 15s Live Streamer
cd /d "%~dp0"
echo ========================================================
echo   StockWatch: Real-Time Live Streamer (Every 15s)
echo ========================================================
echo Auto-updating Excel with LIVE market ticks...
echo To stop auto-updating, close this window or press Ctrl+C.
echo.

node live_scanner.js --watch 15
pause
