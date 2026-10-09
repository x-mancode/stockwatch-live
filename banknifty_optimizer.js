/**
 * Bank Nifty Quantitative Strategy Optimizer & Backtest Engine
 * Searches across thousands of parameter combinations to find the strategy
 * that maximizes the Profit / Loss Ratio (Profit Factor) and Expectancy on Bank Nifty.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchBankNiftyData(range = '10y') {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?range=${range}&interval=1d`;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const result = json.chart.result[0];
          const quotes = result.indicators.quote[0];
          const timestamps = result.timestamp;
          const candles = [];

          for (let i = 0; i < timestamps.length; i++) {
            if (quotes.close[i] !== null && quotes.open[i] !== null && quotes.high[i] !== null && quotes.low[i] !== null) {
              candles.push({
                timestamp: timestamps[i],
                date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                open: quotes.open[i],
                high: quotes.high[i],
                low: quotes.low[i],
                close: quotes.close[i],
                volume: quotes.volume[i] || 0
              });
            }
          }
          resolve(candles);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Indicator Calculation Helpers
function calcATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr[i] = candles[i].high - candles[i].low;
    } else {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      tr[i] = Math.max(hl, hc, lc);
    }
  }

  let sum = 0;
  for (let i = 0; i < period && i < candles.length; i++) sum += tr[i];
  atr[period - 1] = sum / period;

  for (let i = period; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calcEMA(values, period) {
  const ema = new Array(values.length).fill(0);
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) sum += values[i];
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calcER(closes, period = 14) {
  const er = new Array(closes.length).fill(0);
  for (let i = period; i < closes.length; i++) {
    const net = Math.abs(closes[i] - closes[i - period]);
    let vol = 0;
    for (let j = 0; j < period; j++) {
      vol += Math.abs(closes[i - j] - closes[i - j - 1]);
    }
    er[i] = vol === 0 ? 0 : net / vol;
  }
  return er;
}

function calcDonchian(candles, period) {
  const upper = new Array(candles.length).fill(0);
  const lower = new Array(candles.length).fill(0);
  for (let i = period; i < candles.length; i++) {
    let max = -Infinity, min = Infinity;
    for (let j = 1; j <= period; j++) {
      max = Math.max(max, candles[i - j].high);
      min = Math.min(min, candles[i - j].low);
    }
    upper[i] = max;
    lower[i] = min;
  }
  return { upper, lower };
}

// Universal Backtest Simulator
function simulateStrategy(candles, atr, entrySignalFn, slMult, tpMult, trailing = false) {
  let trades = [];
  let inTrade = false;
  let tradeType = null; // 'LONG' or 'SHORT'
  let entryPrice = 0;
  let entryIdx = 0;
  let stopLoss = 0;
  let target = 0;

  for (let i = 50; i < candles.length; i++) {
    const c = candles[i];
    const curATR = atr[i] || (c.close * 0.015);

    if (inTrade) {
      if (tradeType === 'LONG') {
        // Trailing Stop adjustment if enabled
        if (trailing) {
          const newSL = c.close - slMult * curATR;
          if (newSL > stopLoss) stopLoss = newSL;
        }

        // Check if Stop-Loss hit
        if (c.low <= stopLoss) {
          const exitPrice = Math.min(c.open, stopLoss);
          const pnl = exitPrice - entryPrice;
          trades.push({ type: 'LONG', entry: entryPrice, exit: exitPrice, pnl, holdingDays: i - entryIdx });
          inTrade = false;
          continue;
        }

        // Check if Target hit
        if (tpMult > 0 && c.high >= target) {
          const exitPrice = Math.max(c.open, target);
          const pnl = exitPrice - entryPrice;
          trades.push({ type: 'LONG', entry: entryPrice, exit: exitPrice, pnl, holdingDays: i - entryIdx });
          inTrade = false;
          continue;
        }
      } else if (tradeType === 'SHORT') {
        // Trailing Stop adjustment if enabled
        if (trailing) {
          const newSL = c.close + slMult * curATR;
          if (newSL < stopLoss) stopLoss = newSL;
        }

        // Check if Stop-Loss hit
        if (c.high >= stopLoss) {
          const exitPrice = Math.max(c.open, stopLoss);
          const pnl = entryPrice - exitPrice;
          trades.push({ type: 'SHORT', entry: entryPrice, exit: exitPrice, pnl, holdingDays: i - entryIdx });
          inTrade = false;
          continue;
        }

        // Check if Target hit
        if (tpMult > 0 && c.low <= target) {
          const exitPrice = Math.min(c.open, target);
          const pnl = entryPrice - exitPrice;
          trades.push({ type: 'SHORT', entry: entryPrice, exit: exitPrice, pnl, holdingDays: i - entryIdx });
          inTrade = false;
          continue;
        }
      }
    }

    // Check New Entry if not currently in trade
    if (!inTrade) {
      const sig = entrySignalFn(i);
      if (sig === 'LONG') {
        inTrade = true;
        tradeType = 'LONG';
        entryPrice = c.close;
        entryIdx = i;
        stopLoss = entryPrice - slMult * curATR;
        target = tpMult > 0 ? entryPrice + tpMult * curATR : Infinity;
      } else if (sig === 'SHORT') {
        inTrade = true;
        tradeType = 'SHORT';
        entryPrice = c.close;
        entryIdx = i;
        stopLoss = entryPrice + slMult * curATR;
        target = tpMult > 0 ? entryPrice - tpMult * curATR : -Infinity;
      }
    }
  }

  // Calculate Performance Metrics
  if (trades.length < 30) return null; // Require statistically valid sample

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let peak = 0;
  let maxDD = 0;
  let runningEquity = 0;

  for (const t of trades) {
    runningEquity += t.pnl;
    if (runningEquity > peak) peak = runningEquity;
    const dd = peak - runningEquity;
    if (dd > maxDD) maxDD = dd;

    if (t.pnl > 0) {
      grossProfit += t.pnl;
      wins++;
    } else {
      grossLoss += Math.abs(t.pnl);
      losses++;
    }
  }

  const profitFactor = grossLoss === 0 ? 99 : grossProfit / grossLoss;
  const winRate = (wins / trades.length) * 100;
  const netProfit = grossProfit - grossLoss;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
  const expectancy = netProfit / trades.length;

  return {
    tradesCount: trades.length,
    wins,
    losses,
    winRate: Math.round(winRate * 10) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    payoffRatio: Math.round(payoffRatio * 100) / 100,
    netProfit: Math.round(netProfit),
    grossProfit: Math.round(grossProfit),
    grossLoss: Math.round(grossLoss),
    maxDrawdown: Math.round(maxDD),
    expectancy: Math.round(expectancy)
  };
}

async function runOptimization() {
  console.log('========================================================================');
  console.log('   BANK NIFTY QUANTITATIVE STRATEGY OPTIMIZER (10-Year Backtest)');
  console.log('========================================================================\n');

  console.log('Downloading 10-year official Bank Nifty (^NSEBANK) daily candle data...');
  const candles = await fetchBankNiftyData('10y');
  console.log(`Loaded ${candles.length} trading days from ${candles[0].date} to ${candles[candles.length - 1].date}.\n`);

  const closes = candles.map(c => c.close);
  const atr14 = calcATR(candles, 14);
  const atr20 = calcATR(candles, 20);

  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);

  const er10 = calcER(closes, 10);
  const er14 = calcER(closes, 14);
  const er20 = calcER(closes, 20);

  const results = [];

  console.log('Running Systematic Grid Search across Strategy Paradigms & Parameters...\n');

  // ==============================================================================
  // PARADIGM 1: Volatility Expansion & Kaufman Regime Breakout (Asymmetric Runner)
  // ==============================================================================
  const erPeriods = [10, 14, 20];
  const erThreshs = [0.35, 0.38, 0.42, 0.45];
  const slMults = [1.0, 1.25, 1.5, 1.75, 2.0];
  const tpMults = [2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
  const trailingOptions = [false, true];

  for (const erP of erPeriods) {
    const erArray = erP === 10 ? er10 : (erP === 14 ? er14 : er20);
    for (const erTh of erThreshs) {
      for (const sl of slMults) {
        for (const tp of tpMults) {
          for (const tr of trailingOptions) {
            const entrySignalFn = (i) => {
              const isTrending = erArray[i] >= erTh;
              if (!isTrending) return null;
              // Trend condition: Price above 50 EMA and 21 EMA > 50 EMA
              if (candles[i].close > ema21[i] && ema21[i] > ema50[i] && candles[i].close > candles[i - 1].high) {
                return 'LONG';
              }
              if (candles[i].close < ema21[i] && ema21[i] < ema50[i] && candles[i].close < candles[i - 1].low) {
                return 'SHORT';
              }
              return null;
            };

            const stats = simulateStrategy(candles, atr14, entrySignalFn, sl, tp, tr);
            if (stats && stats.tradesCount >= 40) {
              results.push({
                strategy: 'Kaufman Regime + Trend Breakout',
                params: `ER(${erP}) >= ${erTh} | SL: ${sl}x ATR | TP: ${tp}x ATR | Trailing: ${tr}`,
                ...stats
              });
            }
          }
        }
      }
    }
  }

  // ==============================================================================
  // PARADIGM 2: Volatility Contraction Breakout (Inside Bar / Range Compression Squeeze)
  // ==============================================================================
  for (const sl of [1.0, 1.25, 1.5, 1.75, 2.0]) {
    for (const tp of [2.0, 2.5, 3.0, 3.5, 4.0, 5.0]) {
      for (const tr of [false, true]) {
        for (const emaTrend of [true, false]) {
          const entrySignalFn = (i) => {
            // Check Inside Bar or NR4 (Range contraction) on previous day
            const prevRange = candles[i - 1].high - candles[i - 1].low;
            const prev2Range = candles[i - 2].high - candles[i - 2].low;
            const isCompression = prevRange < prev2Range && prevRange < atr14[i - 1] * 0.85;
            if (!isCompression) return null;

            if (candles[i].close > candles[i - 1].high && (!emaTrend || candles[i].close > ema200[i])) {
              return 'LONG';
            }
            if (candles[i].close < candles[i - 1].low && (!emaTrend || candles[i].close < ema200[i])) {
              return 'SHORT';
            }
            return null;
          };

          const stats = simulateStrategy(candles, atr14, entrySignalFn, sl, tp, tr);
          if (stats && stats.tradesCount >= 40) {
            results.push({
              strategy: 'Volatility Compression Squeeze (NR Breakout)',
              params: `EMA200 Filter: ${emaTrend} | SL: ${sl}x ATR | TP: ${tp}x ATR | Trailing: ${tr}`,
              ...stats
            });
          }
        }
      }
    }
  }

  // ==============================================================================
  // PARADIGM 3: Dual EMA Dynamic Pullback & Momentum Expansion
  // ==============================================================================
  for (const sl of [1.0, 1.25, 1.5, 1.75, 2.0]) {
    for (const tp of [2.5, 3.0, 3.5, 4.0, 5.0]) {
      for (const tr of [false, true]) {
        const entrySignalFn = (i) => {
          // Pullback into 9-21 EMA value zone followed by directional candle close
          const inBullZone = candles[i - 1].low <= ema21[i - 1] && candles[i - 1].close >= ema21[i - 1] && ema21[i] > ema50[i];
          const inBearZone = candles[i - 1].high >= ema21[i - 1] && candles[i - 1].close <= ema21[i - 1] && ema21[i] < ema50[i];

          if (inBullZone && candles[i].close > candles[i - 1].high) return 'LONG';
          if (inBearZone && candles[i].close < candles[i - 1].low) return 'SHORT';
          return null;
        };

        const stats = simulateStrategy(candles, atr14, entrySignalFn, sl, tp, tr);
        if (stats && stats.tradesCount >= 40) {
          results.push({
            strategy: 'Dual EMA Value Zone Pullback',
            params: `EMA(21/50) | SL: ${sl}x ATR | TP: ${tp}x ATR | Trailing: ${tr}`,
            ...stats
          });
        }
      }
    }
  }

  // ==============================================================================
  // PARADIGM 4: Donchian Channel High/Low Breakout (Turtle Trend Rider)
  // ==============================================================================
  for (const donchianLen of [10, 15, 20]) {
    const don = calcDonchian(candles, donchianLen);
    for (const sl of [1.0, 1.5, 2.0]) {
      for (const tp of [2.5, 3.0, 4.0, 5.0]) {
        for (const tr of [false, true]) {
          const entrySignalFn = (i) => {
            if (candles[i].close > don.upper[i] && candles[i].close > ema200[i]) return 'LONG';
            if (candles[i].close < don.lower[i] && candles[i].close < ema200[i]) return 'SHORT';
            return null;
          };

          const stats = simulateStrategy(candles, atr14, entrySignalFn, sl, tp, tr);
          if (stats && stats.tradesCount >= 40) {
            results.push({
              strategy: `Donchian Breakout (${donchianLen}-Day Channel)`,
              params: `SL: ${sl}x ATR | TP: ${tp}x ATR | Trailing: ${tr}`,
              ...stats
            });
          }
        }
      }
    }
  }

  console.log(`Evaluated ${results.length} valid strategy configurations.\n`);

  // Sort by Profit Factor (Profit / Loss Ratio) descending
  results.sort((a, b) => b.profitFactor - a.profitFactor);

  console.log('========================================================================');
  console.log('      TOP 10 STRATEGIES BY PROFIT / LOSS RATIO (PROFIT FACTOR)');
  console.log('========================================================================\n');

  const top10 = results.slice(0, 10);
  console.table(top10.map((r, idx) => ({
    Rank: idx + 1,
    Strategy: r.strategy,
    'Profit Factor': r.profitFactor,
    'Win Rate': `${r.winRate}%`,
    'Payoff (Win/Loss)': `${r.payoffRatio}x`,
    'Total Trades': r.tradesCount,
    'Net Points': `+${r.netProfit} pts`,
    'Max Drawdown': `-${r.maxDrawdown} pts`,
    'Parameters': r.params
  })));

  // Write full detailed results to disk for inspection
  fs.writeFileSync(
    path.join(__dirname, 'banknifty_optimization_results.json'),
    JSON.stringify(top10, null, 2),
    'utf8'
  );
  console.log('\nTop results saved to banknifty_optimization_results.json');
}

runOptimization().catch(console.error);
