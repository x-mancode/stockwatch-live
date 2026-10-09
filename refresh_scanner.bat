@echo off
title StockWatch - Live Refresh
cd /d "%~dp0"
echo ===================================================
echo   StockWatch: Live NSE Stock Indicator Scanner
echo ===================================================
echo Fetching live prices and updating Excel...
echo.

node live_scanner.js

echo.
echo ===================================================
echo Excel file updated with LIVE prices!
echo Location: %~dp0NSE_Stock_Indicator_Scanner.xlsx
echo ===================================================
echo.
pause
