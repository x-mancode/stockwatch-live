# 📈 StockWatch: Live NSE Stock Indicator Scanner

Welcome to **StockWatch**! All your files, indicators, and Excel scanners are contained in this folder.

---

## 📁 Files in this Folder

1. **`NSE_Stock_Indicator_Scanner.xlsx`**
   * The main Excel workbook containing live stock prices, Buy/Sell/Hold signals, scores, recommended Stop-Loss, and Target prices.

2. **`stocks.txt`**
   * Your watchlist. Open this file in Notepad and add or remove any NSE stock symbol (one per line, e.g. `PETRONET`, `RELIANCE`, `ZOMATO`).

3. **`refresh_scanner.bat`**
   * **1-Click Live Update**: Double-click this file anytime to pull fresh live quotes from NSE and update the Excel sheet in ~3 seconds.

4. **`start_live_stream.bat`**
   * **Continuous Live Streamer**: Double-click during market hours (9:15 AM – 3:30 PM IST) to continuously refresh the Excel sheet every 15 seconds.

5. **`live_scanner.js`**
   * The underlying JavaScript quantitative calculation engine.

---

## 🎯 How to Read the Signals

* 🟢 **STRONG BUY (Score ≥ +45)**: High conviction entry. Oversold value dip with Smart Money accumulation or Strong Uptrend breakout.
* 🟡 **BUY (Score +20 to +44)**: Positive trend / value rebound. Favorable risk/reward.
* ⚪ **HOLD (Score -19 to +19)**: Equilibrium / consolidation. Do not enter new positions; hold existing shares.
* 🟠 **SELL (Score -20 to -44)**: Momentum decelerating or hitting upper range boundary. Take profits.
* 🔴 **STRONG SELL (Score ≤ -45)**: Severe breakdown in a downtrend. Exit or stop-loss immediately.

---

## 🛡️ Dynamic Volatility-Based Stop-Loss (ATR)

* **Stop-Loss Level**: `Live Price - (1.5 × ATR_14)`
* Adapts dynamically to each stock's daily swing width so you don't get shaken out by random market noise while protecting capital from major breakdowns.
