# 📚 StockWatch Quantitative Calculation Engine & Trading Methodology

This document outlines the exact mathematical models, indicators, and algorithmic logic powering the **StockWatch Terminal**.

---

## 1. 🎯 Market Regime Identification (Trending vs. Range-Bound)

Traditional trading indicators fail because momentum indicators lose money in choppy markets, and mean-reversion oscillators get crushed in strong trends. 
StockWatch first dynamically determines the market state using **Kaufman's Efficiency Ratio (ER)** over a 14-period lookback:

$$\text{ER} = \frac{|\text{Price}_t - \text{Price}_{t-14}|}{\sum_{i=0}^{13} |\text{Price}_{t-i} - \text{Price}_{t-i-1}|}$$

- **Range**: $0.0$ (pure erratic noise / chop) to $1.0$ (perfect frictionless trend).
- **Regime Trigger**:
  - **`TRENDING` (ER $\ge 0.38$)**: Clean institutional trend wave. The engine prioritizes trend-continuation setups and pullbacks to dynamic support.
  - **`RANGE-BOUND` (ER $< 0.38$)**: Consolidation / choppy equilibrium. The engine disables breakout signals and activates mean-reversion dip buying at lower bands and resistance fading.

---

## 2. 📊 Quantitative Composite Score (-100 to +100)

Every stock receives a normalized score balancing 4 distinct technical factors:

### A. In a `TRENDING` Regime:
1. **Trend Direction & Macro Alignment (40 Points)**:
   - Price > 200 EMA $\implies +40$ (Bullish Macro Trend).
   - Price < 200 EMA $\implies -40$ (Bearish Macro Trend).
2. **Momentum Expansion (35 Points)**:
   - Measures RSI(14) expansion above or below the neutral 50 centerline: $(\text{RSI} - 50) \times 1.5$.
3. **Smart Money Flow (20 Points)**:
   - Evaluates volume-weighted accumulation vs. distribution: $\text{SMF} \times 20$.
4. **Pullback Sweet-Spot (25 Points)**:
   - Calculates distance to the 20 EMA in terms of ATR: $z\text{ATR} = \frac{\text{Price} - \text{EMA}_{20}}{\text{ATR}_{14}}$.
   - Rewards entries that pull back into the 20 EMA value zone rather than chasing tops.

### B. In a `RANGE-BOUND` Regime:
1. **Mean Reversion Z-Score (45 Points)**:
   - Fades extremes away from the mean: $-z\text{ATR} \times 25$.
2. **Support / Resistance Smart Money Accumulation (35 Points)**:
   - Detects institutional absorption at range extremes: $\text{SMF} \times 35$.
3. **RSI Boundary Reversal (20 Points)**:
   - $\text{RSI} < 35 \implies +20$ (Oversold value bounce).
   - $\text{RSI} > 65 \implies -20$ (Overbought exhaustion).

---

## 3. 🚦 Trade Action Signals & Conviction Levels

| Composite Score | Signal | Futures Action | Trader Blueprint |
| :---: | :---: | :---: | :--- |
| **$+45$ to $+100$** | **STRONG LONG** | 🟢 **BUY FUTURE (High Conviction)** | High-probability breakout expansion with institutional volume. |
| **$+20$ to $+44$** | **LONG** | 🟢 **BUY FUTURE (Pullback Entry)** | Buying value dips near the 20 EMA inside an uptrend or range floor. |
| **$-19$ to $+19$** | **NO TRADE** | ⚪ **STAND ASIDE (Consolidation)** | Market in fair-value equilibrium. Protects capital from whipsaws. |
| **$-20$ to $-44$** | **SHORT** | 🔴 **SELL / SHORT FUTURE (Resistance)** | Resistance rejection or deceleration near supply zones. |
| **$-45$ to $-100$** | **STRONG SHORT** | 🔴 **SELL / SHORT FUTURE (High Conviction)**| Heavy breakdown with institutional distribution. |

---

## 4. 🛡️ Dynamic Volatility-Based Stop-Loss & Targets (ATR)

Fixed percentage stop-losses (e.g. 2% or 5%) fail because a volatile stock like Adani or Titan requires more breathing room than a low-beta stock like ITC or HDFC Bank.

We use **Average True Range (ATR 14)** — the actual rupee volatility per day:

$$\text{True Range} = \max(\text{High} - \text{Low}, |\text{High} - \text{Close}_{\text{prev}}|, |\text{Low} - \text{Close}_{\text{prev}}|)$$

### **For Long / Buy Positions:**
- **Stop-Loss** = $\text{Live Price} - (1.5 \times \text{ATR}_{14})$
  - *Why $1.5 \times \text{ATR}$?* 85% of normal intraday price swings stay within $1.0 \times \text{ATR}$. Placing the stop at $1.5 \times \text{ATR}$ prevents premature shakeouts while cutting real breakdowns.
- **Target 1 (1:1 Risk-to-Reward)** = $\text{Live Price} + (1.5 \times \text{ATR}_{14})$
- **Target 2 (1:2 Risk-to-Reward Runner)** = $\text{Live Price} + (3.0 \times \text{ATR}_{14})$

### **For Short / Sell Positions (Futures):**
- **Stop-Loss** = $\text{Live Price} + (1.5 \times \text{ATR}_{14})$ *(Placed above the price to protect upside risk)*
- **Target 1 (1:1 Risk-to-Reward)** = $\text{Live Price} - (1.5 \times \text{ATR}_{14})$
- **Target 2 (1:2 Risk-to-Reward Runner)** = $\text{Live Price} - (3.0 \times \text{ATR}_{14})$

---

## 5. 🕒 NSE Exchange Market Hours Detector

The terminal automatically synchronizes with Indian Standard Time (IST):
- **09:00 AM – 09:15 AM IST**: `🟠 PRE-OPEN` (Order matching & price discovery).
- **09:15 AM – 03:30 PM IST**: `🟢 LIVE NSE (Market Open)` (Real-time live streaming quotes).
- **Outside Hours / Weekends**: `🔴 NSE CLOSED` (Displays verified exchange closing prices with a note: *"Last Close Data • Opens at 9:15 AM IST"*).
