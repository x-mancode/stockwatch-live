@echo off
title Open Google Sheets
echo ========================================================
echo   StockWatch - Google Sheets Live Scanner
echo ========================================================
echo Opening Google Sheets in your browser...
echo.
echo Once Google Sheets opens:
echo  1. Click 'File' -> 'Import' -> 'Upload'
echo  2. Select: %~dp0GoogleSheets_Live_Scanner.xlsx
echo  3. Choose 'Replace spreadsheet' -> 'Import data'
echo.
echo All stock prices will update continuously in real-time!
echo.

start https://sheets.new
explorer.exe /select,"%~dp0GoogleSheets_Live_Scanner.xlsx"
pause
