const fs = require('fs');
const path = require('path');
let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  try {
    XLSX = require('C:\\Users\\aba_s\\node_modules\\xlsx');
  } catch (err) {
    XLSX = require('C:\\Users\\aba_s\\.gemini\\antigravity-cli\\brain\\4b7a1808-71e2-4541-996f-bd435efa889e\\scratch\\node_modules\\xlsx');
  }
}

// Helper Functions for Live Technical Calculation
function calculateATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hl, hc, lc));
  }
  const atr = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calculateRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgG = gains / period, avgL = losses / period;
  rsi[period] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgL = (avgL * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return rsi;
}

function calculateER(closes, period = 14) {
  const er = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const netChange = Math.abs(closes[i] - closes[i - period]);
    let totalPath = 0;
    for (let j = i - period + 1; j <= i; j++) {
      totalPath += Math.abs(closes[j] - closes[j - 1]);
    }
    er[i] = totalPath === 0 ? 0 : netChange / totalPath;
  }
  return er;
}

function calculateSMF(highs, lows, closes, volumes, period = 14) {
  const smf = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let clvVolSum = 0;
    let volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const range = highs[j] - lows[j];
      const clv = range === 0 ? 0 : ((closes[j] - lows[j]) - (highs[j] - closes[j])) / range;
      clvVolSum += clv * volumes[j];
      volSum += volumes[j];
    }
    smf[i] = volSum === 0 ? 0 : clvVolSum / volSum;
  }
  return smf;
}

// Fetch live quote + historical candles in a single call
async function fetchLiveStockData(rawSymbol) {
  const symbol = rawSymbol.toUpperCase().endsWith('.NS') ? rawSymbol.toUpperCase() : `${rawSymbol.toUpperCase()}.NS`;
  const cleanSymbol = symbol.replace('.NS', '');

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();

    if (!data.chart || !data.chart.result || data.chart.result.length === 0) return null;

    const meta = data.chart.result[0].meta;
    const quote = data.chart.result[0].indicators.quote[0];
    const timestamps = data.chart.result[0].timestamp;

    const valid = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.close[i] !== null && quote.open[i] !== null && quote.high[i] !== null && quote.low[i] !== null) {
        valid.push({
          close: quote.close[i],
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          volume: quote.volume[i] || 0
        });
      }
    }

    if (valid.length < 50) return null;

    // Inject the real-time live price into the latest candle
    const livePrice = meta.regularMarketPrice || valid[valid.length - 1].close;
    const dayHigh = meta.regularMarketDayHigh || Math.max(livePrice, valid[valid.length - 1].high);
    const dayLow = meta.regularMarketDayLow || Math.min(livePrice, valid[valid.length - 1].low);
    const prevClose = valid.length > 1 ? valid[valid.length - 2].close : livePrice;
    const changePct = (meta.regularMarketChangePercent !== undefined && meta.regularMarketChangePercent !== null)
      ? meta.regularMarketChangePercent
      : (((livePrice - prevClose) / prevClose) * 100);

    valid[valid.length - 1].close = livePrice;
    valid[valid.length - 1].high = dayHigh;
    valid[valid.length - 1].low = dayLow;

    const closes = valid.map(d => d.close);
    const highs = valid.map(d => d.high);
    const lows = valid.map(d => d.low);
    const volumes = valid.map(d => d.volume);

    const atr14 = calculateATR(highs, lows, closes, 14);
    const ema20 = calculateEMA(closes, 20);
    const ema200 = calculateEMA(closes, Math.min(200, closes.length - 1));
    const er14 = calculateER(closes, 14);
    const smf14 = calculateSMF(highs, lows, closes, volumes, 14);
    const rsi14 = calculateRSI(closes, 14);

    const lastIdx = valid.length - 1;
    const atr = atr14[lastIdx] || (livePrice * 0.02);
    const er = er14[lastIdx] || 0.2;
    const smf = smf14[lastIdx] || 0;
    const rsi = rsi14[lastIdx] || 50;
    const mean = ema20[lastIdx] || livePrice;
    const zATR = (livePrice - mean) / atr;

    const isTrending = er >= 0.38;
    let score = 0;
    let rationale = '';

    if (isTrending) {
      const isAbove200 = ema200[lastIdx] ? livePrice > ema200[lastIdx] : true;
      const trendDir = isAbove200 ? 1 : -1;
      const trendScore = trendDir * (livePrice > mean ? 40 : 20);
      const momScore = Math.max(-35, Math.min(35, (rsi - 50) * 1.5 + smf * 20));
      let pullback = 0;
      if (trendDir === 1 && zATR > -1.5 && zATR < 0.5) pullback = 25;
      else if (trendDir === -1 && zATR > -0.5 && zATR < 1.5) pullback = -25;
      score = trendScore + momScore + pullback;

      if (score >= 40) rationale = 'Strong Uptrend: Directional momentum & volume expansion';
      else if (score >= 20) rationale = 'Uptrend pullback near 20 EMA support';
      else if (score <= -40) rationale = 'Downtrend breakdown with institutional distribution';
      else rationale = 'Trend deceleration / consolidation';
    } else {
      const meanRev = -Math.max(-45, Math.min(45, zATR * 25));
      const smScore = smf * 35;
      let rsiExt = 0;
      if (rsi < 35) rsiExt = +20;
      else if (rsi > 65) rsiExt = -20;
      score = meanRev + smScore + rsiExt;

      if (score >= 40) rationale = 'Oversold dip at lower band + Smart Money accumulation';
      else if (score >= 20) rationale = 'Value zone rebound inside trading range';
      else if (score <= -40) rationale = 'Overextended near resistance band with profit taking';
      else rationale = 'Trading in equilibrium near mean';
    }

    score = Math.round(Math.max(-100, Math.min(100, score)));

    let signal = 'NO TRADE';
    let tradeAction = '⚪ STAND ASIDE (Wait)';
    let stopLoss = 0, target1 = 0, target2 = 0;

    if (score >= 20) {
      signal = score >= 45 ? 'STRONG LONG' : 'LONG';
      tradeAction = score >= 45 ? '🟢 BUY FUTURE (High Conviction)' : '🟢 BUY FUTURE (Pullback Entry)';
      stopLoss = Math.round((livePrice - 1.5 * atr) * 100) / 100;
      target1 = Math.round((livePrice + 1.5 * atr) * 100) / 100;
      target2 = Math.round((livePrice + 3.0 * atr) * 100) / 100;
    } else if (score <= -20) {
      signal = score <= -45 ? 'STRONG SHORT' : 'SHORT';
      tradeAction = score <= -45 ? '🔴 SELL / SHORT FUTURE (High Conviction)' : '🔴 SELL / SHORT FUTURE (Resistance)';
      // INVERTED FOR SHORT FUTURES TRADING:
      stopLoss = Math.round((livePrice + 1.5 * atr) * 100) / 100; // Above Entry
      target1 = Math.round((livePrice - 1.5 * atr) * 100) / 100;  // Below Entry
      target2 = Math.round((livePrice - 3.0 * atr) * 100) / 100;  // Below Entry
    } else {
      signal = 'NO TRADE';
      tradeAction = '⚪ STAND ASIDE (Consolidation)';
      stopLoss = Math.round((livePrice - 1.5 * atr) * 100) / 100;
      target1 = Math.round((livePrice + 1.5 * atr) * 100) / 100;
      target2 = Math.round((livePrice + 3.0 * atr) * 100) / 100;
    }

    const slPct = Math.round((Math.abs(livePrice - stopLoss) / livePrice) * 1000) / 10;
    const marketTime = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'Live';

    return {
      symbol: cleanSymbol,
      name: meta.longName || cleanSymbol,
      price: Math.round(livePrice * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      time: marketTime,
      regime: isTrending ? 'TRENDING' : 'RANGE-BOUND',
      score,
      signal,
      tradeAction,
      stopLoss,
      slPct,
      target1,
      target2,
      riskReward: '1 : 2.0',
      atr: Math.round(atr * 100) / 100,
      rsi: Math.round(rsi * 10) / 10,
      rationale
    };
  } catch (err) {
    return null;
  }
}

async function updateLiveExcel(stockList, targetExcelPath) {
  const timestamp = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`\n[${timestamp}] Fetching LIVE NSE prices for ${stockList.length} stocks...`);

  const results = [];
  for (const sym of stockList) {
    const res = await fetchLiveStockData(sym);
    if (res) results.push(res);
  }

  // Display Live Terminal Table
  console.log('-----------------------------------------------------------------------------------------------------------------------------------');
  console.log('SYMBOL      | LIVE PRICE  | 1D CHG % | FUTURES ACTION                      | SCORE | STOP-LOSS (₹) | TARGET 2 (₹) | REGIME');
  console.log('------------|-------------|----------|-------------------------------------|-------|---------------|--------------|-------------');
  results.forEach(r => {
    const chgStr = (r.changePct >= 0 ? '+' : '') + r.changePct.toFixed(2) + '%';
    console.log(
      `${r.symbol.padEnd(11)} | ₹${r.price.toFixed(2).padStart(9)} | ${chgStr.padStart(8)} | ${r.tradeAction.padEnd(35)} | ${r.score.toString().padStart(5)} | ₹${r.stopLoss.toFixed(2).padStart(11)} | ₹${r.target2.toFixed(2).padStart(10)} | ${r.regime}`
    );
  });
  console.log('-----------------------------------------------------------------------------------------------------------------------------------');

  // Write to Excel
  const headers = [
    'Stock Symbol',
    'Company Name',
    'Live Price (₹)',
    '1D Change (%)',
    'Last Tick Time',
    'Indicator Signal',
    'Futures Trade Action',
    'DRO Score (-100 to +100)',
    'Stop-Loss Level (₹)',
    'Stop-Loss Risk (%)',
    'Target 1 (1:1 ₹)',
    'Target 2 (1:2 ₹)',
    'Risk / Reward',
    'Market Regime',
    'Daily ATR (₹)',
    'RSI (14)',
    'Indicator Rationale'
  ];

  const sheetData = [headers];
  results.forEach(r => {
    sheetData.push([
      r.symbol,
      r.name,
      r.price,
      r.changePct,
      r.time,
      r.signal,
      r.tradeAction,
      r.score,
      r.stopLoss,
      `${r.slPct}%`,
      r.target1,
      r.target2,
      r.riskReward,
      r.regime,
      r.atr,
      r.rsi,
      r.rationale
    ]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
    { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 22 },
    { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 },
    { wch: 55 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Live Signals & Stop-Loss');

  // Instructions Sheet
  const wsInfo = XLSX.utils.aoa_to_sheet([
    ['STOCKWATCH - LIVE NSE PRICE SCANNER & FORMULA GUIDE'],
    ['Last Updated:', `${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`],
    ['Folder Location:', `${path.dirname(targetExcelPath)}`],
    [''],
    ['1. Live Refresh Modes:'],
    [' • Single 1-Click Update:', 'Double click refresh_scanner.bat in this folder'],
    [' • Continuous Auto-Update (every 15s):', 'Double click start_live_stream.bat in this folder'],
    [''],
    ['2. Customizing Stocks:'],
    [' • Edit stocks.txt in this folder to add or delete any NSE ticker.'],
    [''],
    ['3. Native Excel 365 Formula (Alternative):'],
    ['  =A2.Price'],
    [''],
    ['4. Google Sheets Formula (Alternative):'],
    ['  =GOOGLEFINANCE("NSE:" & A2, "price")']
  ]);
  wsInfo['!cols'] = [{ wch: 45 }, { wch: 65 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, 'User Guide');

  XLSX.writeFile(wb, targetExcelPath);
  console.log(`Saved live update to: ${targetExcelPath}`);
}

async function main() {
  const currentDir = __dirname;
  const stocksTxtPath = path.join(currentDir, 'stocks.txt');
  const targetExcelPath = path.join(currentDir, 'NSE_Stock_Indicator_Scanner.xlsx');

  let stockList = ['PETRONET', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'LT', 'ONGC', 'COALINDIA', 'BHARTIARTL', 'WIPRO', 'TITAN', 'BEL'];
  if (fs.existsSync(stocksTxtPath)) {
    const lines = fs.readFileSync(stocksTxtPath, 'utf8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
    if (lines.length > 0) stockList = lines;
  }

  const args = process.argv.slice(2);
  const watchIndex = args.indexOf('--watch');

  if (watchIndex !== -1) {
    const intervalSec = parseInt(args[watchIndex + 1], 10) || 30;
    console.log(`\n======================================================`);
    console.log(` STARTING CONTINUOUS LIVE MONITORING (Interval: ${intervalSec}s)`);
    console.log(` Folder: ${currentDir}`);
    console.log(` Press Ctrl+C in terminal to stop.`);
    console.log(`======================================================`);
    
    await updateLiveExcel(stockList, targetExcelPath);
    setInterval(async () => {
      await updateLiveExcel(stockList, targetExcelPath);
    }, intervalSec * 1000);
  } else {
    await updateLiveExcel(stockList, targetExcelPath);
  }
}

main();
