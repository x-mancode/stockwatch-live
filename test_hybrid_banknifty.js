const https = require('https');

function fetchBankNiftyData() {
  return new Promise((resolve, reject) => {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?range=10y&interval=1d';
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        const json = JSON.parse(d);
        const result = json.chart.result[0];
        const quotes = result.indicators.quote[0];
        const timestamps = result.timestamp;
        const candles = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (quotes.close[i] !== null && quotes.open[i] !== null) {
            candles.push({
              date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
              open: quotes.open[i],
              high: quotes.high[i],
              low: quotes.low[i],
              close: quotes.close[i]
            });
          }
        }
        resolve(candles);
      });
    }).on('error', reject);
  });
}

function calcATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(0);
  const tr = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) tr[i] = candles[i].high - candles[i].low;
    else {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      tr[i] = Math.max(hl, hc, lc);
    }
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
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
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

// Scale-out Backtest Simulator: 50% booked at T1, remainder trailed to T2 with Breakeven Stop
function simulateScaleOut(candles, atr, ema50, slMult, tp1Mult, tp2Mult, compressionThreshold) {
  let trades = [];
  let inTrade = false;
  let type = null;
  let entryPrice = 0;
  let sl = 0;
  let t1 = 0;
  let t2 = 0;
  let t1Hit = false;
  let pnlTotal = 0;

  for (let i = 50; i < candles.length; i++) {
    const c = candles[i];
    const curATR = atr[i];

    if (inTrade) {
      if (type === 'LONG') {
        // Check T1
        if (!t1Hit && c.high >= t1) {
          t1Hit = true;
          pnlTotal += 0.5 * (t1 - entryPrice); // Bank 50% profit
          sl = entryPrice; // Move Stop to Breakeven!
        }
        // Check T2
        if (t1Hit && c.high >= t2) {
          pnlTotal += 0.5 * (t2 - entryPrice); // Bank remaining 50%
          trades.push({ pnl: pnlTotal });
          inTrade = false;
          continue;
        }
        // Check SL
        if (c.low <= sl) {
          const exitP = Math.min(c.open, sl);
          const remainingPortion = t1Hit ? 0.5 : 1.0;
          pnlTotal += remainingPortion * (exitP - entryPrice);
          trades.push({ pnl: pnlTotal });
          inTrade = false;
          continue;
        }
      } else if (type === 'SHORT') {
        // Check T1
        if (!t1Hit && c.low <= t1) {
          t1Hit = true;
          pnlTotal += 0.5 * (entryPrice - t1); // Bank 50% profit
          sl = entryPrice; // Move Stop to Breakeven!
        }
        // Check T2
        if (t1Hit && c.low <= t2) {
          pnlTotal += 0.5 * (entryPrice - t2); // Bank remaining 50%
          trades.push({ pnl: pnlTotal });
          inTrade = false;
          continue;
        }
        // Check SL
        if (c.high >= sl) {
          const exitP = Math.max(c.open, sl);
          const remainingPortion = t1Hit ? 0.5 : 1.0;
          pnlTotal += remainingPortion * (entryPrice - exitP);
          trades.push({ pnl: pnlTotal });
          inTrade = false;
          continue;
        }
      }
    }

    if (!inTrade) {
      // Range compression condition
      const rangePrev = candles[i - 1].high - candles[i - 1].low;
      const rangePrev2 = candles[i - 2].high - candles[i - 2].low;
      const isCompressed = rangePrev < rangePrev2 && rangePrev < atr[i - 1] * compressionThreshold;

      if (isCompressed) {
        if (candles[i].close > candles[i - 1].high && candles[i].close > ema50[i]) {
          inTrade = true;
          type = 'LONG';
          entryPrice = c.close;
          sl = entryPrice - slMult * curATR;
          t1 = entryPrice + tp1Mult * curATR;
          t2 = entryPrice + tp2Mult * curATR;
          t1Hit = false;
          pnlTotal = 0;
        } else if (candles[i].close < candles[i - 1].low && candles[i].close < ema50[i]) {
          inTrade = true;
          type = 'SHORT';
          entryPrice = c.close;
          sl = entryPrice + slMult * curATR;
          t1 = entryPrice - tp1Mult * curATR;
          t2 = entryPrice - tp2Mult * curATR;
          t1Hit = false;
          pnlTotal = 0;
        }
      }
    }
  }

  if (trades.length < 30) return null;
  let gp = 0, gl = 0, wins = 0;
  let peak = 0, maxDD = 0, eq = 0;

  for (const t of trades) {
    eq += t.pnl;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDD) maxDD = peak - eq;

    if (t.pnl > 0) { gp += t.pnl; wins++; }
    else { gl += Math.abs(t.pnl); }
  }

  const pf = gl === 0 ? 99 : gp / gl;
  const wr = (wins / trades.length) * 100;
  return {
    trades: trades.length,
    winRate: Math.round(wr * 10) / 10,
    profitFactor: Math.round(pf * 100) / 100,
    netPoints: Math.round(gp - gl),
    maxDD: Math.round(maxDD),
    slMult,
    tp1Mult,
    tp2Mult,
    compressionThreshold
  };
}

async function run() {
  const candles = await fetchBankNiftyData();
  const atr = calcATR(candles, 14);
  const closes = candles.map(c => c.close);
  const ema50 = calcEMA(closes, 50);

  const configs = [];
  for (const comp of [0.75, 0.85, 0.95]) {
    for (const sl of [1.25, 1.5, 1.75, 2.0]) {
      for (const tp1 of [1.25, 1.5, 1.75]) {
        for (const tp2 of [2.5, 3.0, 3.5, 4.0, 5.0]) {
          const res = simulateScaleOut(candles, atr, ema50, sl, tp1, tp2, comp);
          if (res) configs.push(res);
        }
      }
    }
  }

  configs.sort((a, b) => b.profitFactor - a.profitFactor);
  console.log('\nTop 5 Scale-Out Configurations:');
  console.table(configs.slice(0, 5));
}

run();
