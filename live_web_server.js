const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || parseInt(process.argv[2], 10) || 8888;
const stocksTxtPath = path.join(__dirname, 'stocks.txt');

// Technical Indicator Helper Functions
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

async function fetchLiveStock(rawSymbol) {
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

    const livePrice = meta.regularMarketPrice || valid[valid.length - 1].close;
    const prevClose = valid.length > 1 ? valid[valid.length - 2].close : livePrice;
    const changePct = (meta.regularMarketChangePercent !== undefined && meta.regularMarketChangePercent !== null)
      ? meta.regularMarketChangePercent
      : (((livePrice - prevClose) / prevClose) * 100);

    valid[valid.length - 1].close = livePrice;
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

      if (score >= 40) rationale = 'Strong Uptrend: Momentum expansion';
      else if (score >= 20) rationale = 'Uptrend pullback near 20 EMA';
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
      else if (score <= -40) rationale = 'Overextended near resistance band (profit taking)';
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
      stopLoss = Math.round((livePrice + 1.5 * atr) * 100) / 100;
      target1 = Math.round((livePrice - 1.5 * atr) * 100) / 100;
      target2 = Math.round((livePrice - 3.0 * atr) * 100) / 100;
    } else {
      signal = 'NO TRADE';
      tradeAction = '⚪ STAND ASIDE (Consolidation)';
      stopLoss = Math.round((livePrice - 1.5 * atr) * 100) / 100;
      target1 = Math.round((livePrice + 1.5 * atr) * 100) / 100;
      target2 = Math.round((livePrice + 3.0 * atr) * 100) / 100;
    }

    const slPct = Math.round((Math.abs(livePrice - stopLoss) / livePrice) * 1000) / 10;

    return {
      symbol: cleanSymbol,
      name: meta.longName || cleanSymbol,
      price: Math.round(livePrice * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      regime: isTrending ? 'TRENDING' : 'RANGE-BOUND',
      score,
      signal,
      tradeAction,
      stopLoss,
      slPct,
      target1,
      target2,
      atr: Math.round(atr * 100) / 100,
      rsi: Math.round(rsi * 10) / 10,
      rationale
    };
  } catch (e) {
    return null;
  }
}

function getStockList() {
  if (fs.existsSync(stocksTxtPath)) {
    const lines = fs.readFileSync(stocksTxtPath, 'utf8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
    if (lines.length > 0) return lines;
  }
  return ['PETRONET', 'RELIANCE', 'SBIN', 'INFY', 'TCS', 'HDFCBANK', 'ICICIBANK', 'LT', 'ITC', 'ONGC', 'COALINDIA', 'BHARTIARTL', 'WIPRO', 'TITAN', 'BEL'];
}

function saveStockList(list) {
  fs.writeFileSync(stocksTxtPath, '# StockWatch Watchlist\n' + list.join('\n') + '\n', 'utf8');
}

function getMarketStatus() {
  const now = new Date();
  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istDate = new Date(istString);
  const day = istDate.getDay(); // 0 = Sun, 6 = Sat
  const hour = istDate.getHours();
  const minute = istDate.getMinutes();
  const timeInMins = hour * 60 + minute;

  // Weekend
  if (day === 0 || day === 6) {
    return {
      isOpen: false,
      isPreOpen: false,
      badgeText: 'NSE CLOSED (Weekend)',
      badgeClass: 'market-closed',
      detail: 'Last Close Data • Opens Monday 9:15 AM'
    };
  }

  // Pre-market: 9:00 AM to 9:14 AM
  if (timeInMins >= 540 && timeInMins < 555) {
    return {
      isOpen: false,
      isPreOpen: true,
      badgeText: 'PRE-OPEN (9:00 - 9:15 AM)',
      badgeClass: 'market-pre',
      detail: 'Order Collection / Discovery Phase'
    };
  }

  // Normal Trading Session: 9:15 AM to 3:30 PM (555 to 930 mins)
  if (timeInMins >= 555 && timeInMins <= 930) {
    return {
      isOpen: true,
      isPreOpen: false,
      badgeText: 'LIVE NSE (Market Open)',
      badgeClass: 'market-live',
      detail: 'Live Streaming Quotes • Closes 3:30 PM'
    };
  }

  // Weekday After Hours (Before 9:00 AM or after 3:30 PM)
  const detail = timeInMins < 540 ? 'Last Close Data • Opens today at 9:15 AM' : 'Last Close Data • Opens tomorrow at 9:15 AM';
  return {
    isOpen: false,
    isPreOpen: false,
    badgeText: 'NSE CLOSED',
    badgeClass: 'market-closed',
    detail
  };
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // API 1: Fetch all stocks
  if (url === '/api/stocks') {
    const list = getStockList();
    const fetched = await Promise.all(list.map(sym => fetchLiveStock(sym)));
    const results = fetched.filter(d => d !== null);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      market: getMarketStatus(),
      stocks: results
    }));
    return;
  }

  // API 2: Add new stock
  if (url === '/api/add-stock' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { symbol } = JSON.parse(body);
        const clean = symbol.trim().toUpperCase().replace('.NS', '');
        
        // Verify symbol on NSE before adding
        const test = await fetchLiveStock(clean);
        if (!test) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: `Stock '${clean}' not found on NSE!` }));
          return;
        }

        const list = getStockList();
        if (!list.includes(clean)) {
          list.push(clean);
          saveStockList(list);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, stock: test }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: err.message }));
      }
    });
    return;
  }

  // API 3: Delete stock
  if (url === '/api/delete-stock' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { symbol } = JSON.parse(body);
        let list = getStockList();
        list = list.filter(s => s !== symbol);
        saveStockList(list);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // Serve Main HTML Dashboard Page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>StockWatch Live Real-Time Terminal</title>
  <style>
    :root {
      --bg-main: #0b0f19;
      --bg-card: #131b2e;
      --bg-input: #1e293b;
      --border-color: #1e293b;
      --border-light: #334155;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --green-bg: rgba(34, 197, 94, 0.15);
      --green-border: rgba(34, 197, 94, 0.35);
      --green-text: #4ade80;
      --red-bg: rgba(239, 68, 68, 0.15);
      --red-border: rgba(239, 68, 68, 0.35);
      --red-text: #f87171;
      --blue-btn: #2563eb;
    }

    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; }
    body { background: var(--bg-main); color: var(--text-main); padding: 14px; min-height: 100vh; scroll-behavior: smooth; }
    .container { max-width: 1440px; margin: 0 auto; display: flex; flex-direction: column; min-height: calc(100vh - 28px); }

    /* Custom Modern Scrollbars */
    ::-webkit-scrollbar { width: 7px; height: 7px; }
    ::-webkit-scrollbar-track { background: #0b0f19; border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }
    * { scrollbar-width: thin; scrollbar-color: #334155 #0b0f19; }

    /* Top Bar */
    .top-bar {
      background: var(--bg-card);
      padding: 14px 18px;
      border-radius: 12px;
      border: 1px solid var(--border-color);
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .brand-title {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #fff;
    }
    .market-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 4px 11px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
      transition: 0.3s;
    }
    .market-badge.market-live {
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.35);
      color: #4ade80;
    }
    .market-badge.market-live .status-dot {
      width: 7px;
      height: 7px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 8px #22c55e;
      animation: pulse 1.5s infinite;
    }

    .market-badge.market-pre {
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.35);
      color: #fbbf24;
    }
    .market-badge.market-pre .status-dot {
      width: 7px;
      height: 7px;
      background: #f59e0b;
      border-radius: 50%;
      box-shadow: 0 0 8px #f59e0b;
      animation: pulse 1.5s infinite;
    }

    .market-badge.market-closed {
      background: rgba(148, 163, 184, 0.1);
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #94a3b8;
    }
    .market-badge.market-closed .status-dot {
      width: 7px;
      height: 7px;
      background: #ef4444;
      border-radius: 50%;
      box-shadow: none;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }

    .meta-group {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }
    .stat-pill {
      background: #1e293b;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid #334155;
    }
    .stat-pill.bull { color: #4ade80; }
    .stat-pill.bear { color: #f87171; }
    .stat-pill.neutral { color: #94a3b8; }

    /* ===================================================
       LIVE SCROLLING TICKER TAPE (Continuous Marquee)
       =================================================== */
    .ticker-wrapper {
      background: #0f172a;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      margin-bottom: 12px;
      overflow: hidden;
      white-space: nowrap;
      position: relative;
      display: flex;
      align-items: center;
      height: 38px;
    }
    .ticker-label {
      background: #1e293b;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0 14px;
      height: 100%;
      display: flex;
      align-items: center;
      border-right: 1px solid var(--border-color);
      z-index: 2;
      flex-shrink: 0;
      letter-spacing: 0.5px;
    }
    .ticker-scroll-area {
      overflow: hidden;
      flex: 1;
      display: flex;
      align-items: center;
      position: relative;
    }
    .ticker-track {
      display: inline-flex;
      gap: 20px;
      padding-left: 20px;
      animation: tickerAnimation 40s linear infinite;
      white-space: nowrap;
      will-change: transform;
    }
    .ticker-track:hover {
      animation-play-state: paused;
    }
    @keyframes tickerAnimation {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    .ticker-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
    }

    /* Warning Banner */
    #warningBox {
      display: none;
      padding: 10px 14px;
      background: #7f1d1d;
      border: 1px solid #ef4444;
      color: #fee2e2;
      border-radius: 8px;
      margin-bottom: 12px;
      font-size: 13px;
      align-items: center;
      gap: 8px;
    }

    /* Controls Bar */
    .controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      gap: 10px;
      flex-wrap: wrap;
    }
    .add-form {
      display: flex;
      gap: 8px;
      align-items: center;
      flex: 1;
      max-width: 520px;
      min-width: 260px;
    }
    .input-box {
      background: var(--bg-input);
      border: 1px solid var(--border-light);
      color: #fff;
      padding: 9px 14px;
      border-radius: 8px;
      font-size: 13px;
      flex: 1;
      outline: none;
      transition: 0.2s;
      min-height: 40px;
    }
    .input-box:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    .btn {
      background: var(--blue-btn);
      color: #fff;
      border: none;
      padding: 9px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 40px;
      white-space: nowrap;
    }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
    }
    .btn-secondary:hover { background: #334155; color: #fff; }
    .btn-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* Common typography / badges */
    .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
    .up { color: var(--green-text); font-weight: 600; }
    .down { color: var(--red-text); font-weight: 600; }

    .badge {
      padding: 5px 10px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 11px;
      display: inline-block;
      letter-spacing: 0.3px;
    }
    .badge-buy { background: var(--green-bg); color: var(--green-text); border: 1px solid var(--green-border); }
    .badge-short { background: var(--red-bg); color: var(--red-text); border: 1px solid var(--red-border); }
    .badge-hold { background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2); }

    .del-btn {
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      padding: 6px 8px;
      border-radius: 6px;
      transition: 0.2s;
      font-size: 15px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .del-btn:hover { color: #ef4444; background: rgba(239, 68, 68, 0.12); }

    /* ===================================================
       1. RESPONSIVE CARDS VIEW (Scrollable)
       =================================================== */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
      max-height: calc(100vh - 215px);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding-right: 6px;
      padding-bottom: 20px;
    }
    .stock-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: transform 0.15s, border-color 0.15s;
    }
    .stock-card:hover {
      border-color: #334155;
      transform: translateY(-2px);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .card-symbol-block {
      display: flex;
      flex-direction: column;
    }
    .card-symbol {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      letter-spacing: 0.3px;
    }
    .card-company {
      font-size: 11px;
      color: var(--text-muted);
      max-width: 170px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-price-block {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .card-price {
      font-size: 17px;
      font-weight: 700;
      color: #fff;
    }
    .card-chg {
      font-size: 12px;
      font-weight: 700;
    }

    .card-action-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: #0d1424;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.03);
    }

    .card-levels-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 6px;
    }
    .level-box {
      background: #0d1424;
      border-radius: 8px;
      padding: 8px 6px;
      text-align: center;
      border: 1px solid #1e293b;
    }
    .level-box.sl { border-color: rgba(239, 68, 68, 0.25); }
    .level-box.t1 { border-color: rgba(34, 197, 94, 0.2); }
    .level-box.t2 { border-color: rgba(34, 197, 94, 0.4); }
    .level-label {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 2px;
    }
    .level-val {
      font-size: 13px;
      font-weight: 700;
    }
    .level-box.sl .level-val { color: #fca5a5; }
    .level-box.t1 .level-val { color: #86efac; }
    .level-box.t2 .level-val { color: #4ade80; }
    .level-sub {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
    }

    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--text-muted);
      border-top: 1px solid rgba(255,255,255,0.05);
      padding-top: 8px;
    }
    .card-rationale {
      font-size: 11px;
      color: #94a3b8;
      font-style: italic;
      line-height: 1.3;
    }

    /* ===================================================
       2. RESPONSIVE TABLE VIEW (Vertical & Horizontal Scroll + Sticky Headers)
       =================================================== */
    .table-container {
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      overflow-x: auto;
      overflow-y: auto;
      max-height: calc(100vh - 215px);
      -webkit-overflow-scrolling: touch;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
      position: relative;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      text-align: left;
      min-width: 980px;
    }
    th {
      background: #0b1120;
      color: var(--text-muted);
      padding: 12px 14px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 10;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-color);
      font-size: 13px;
      vertical-align: middle;
      white-space: nowrap;
    }
    tr:hover td { background: #1a243b; }

    /* Sticky first column (Symbol) for horizontal and vertical scrolling */
    th:first-child {
      position: sticky;
      left: 0;
      top: 0;
      z-index: 25;
      background: #0b1120;
      box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.5);
    }
    td:first-child {
      position: sticky;
      left: 0;
      z-index: 5;
      background: #101728;
      box-shadow: 2px 0 5px rgba(0, 0, 0, 0.4);
    }
    tr:hover td:first-child {
      background: #162035;
    }

    /* Responsive Breakpoints */
    @media (max-width: 768px) {
      body { padding: 8px; }
      .brand-title { font-size: 17px; }
      .top-bar { padding: 12px 14px; }
      .controls { flex-direction: column; align-items: stretch; }
      .add-form { max-width: 100%; width: 100%; }
      .btn-group { width: 100%; justify-content: space-between; }
      .btn-group .btn { flex: 1; }
      .cards-grid { grid-template-columns: 1fr; max-height: calc(100vh - 250px); }
      .table-container { max-height: calc(100vh - 250px); }
    }

    /* Help & Calculation Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(3, 7, 18, 0.85);
      backdrop-filter: blur(6px);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-box {
      background: #131b2e;
      border: 1px solid #334155;
      border-radius: 14px;
      max-width: 820px;
      width: 100%;
      max-height: 85vh;
      overflow-y: auto;
      padding: 22px 24px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #1e293b;
      padding-bottom: 12px;
    }
    .modal-title {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .modal-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 22px;
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 6px;
      transition: 0.2s;
    }
    .modal-close-btn:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.12);
    }
    .calc-card {
      background: #0d1424;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 14px 16px;
    }
    .calc-card-title {
      font-size: 13px;
      font-weight: 700;
      color: #38bdf8;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .calc-text {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .calc-code {
      background: #1e293b;
      color: #f8fafc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,0.05);
    }
    .calc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 8px;
    }
    @media (max-width: 640px) {
      .calc-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Top Bar -->
    <div class="top-bar">
      <div class="brand-group">
        <h1 class="brand-title">📈 StockWatch Terminal</h1>
        <div id="marketBadge" class="market-badge market-closed">
          <div class="status-dot"></div>
          <span id="marketBadgeText">CHECKING MARKET...</span>
        </div>
      </div>
      <div class="meta-group">
        <span class="stat-pill bull" id="statBull">0 Longs</span>
        <span class="stat-pill bear" id="statBear">0 Shorts</span>
        <span class="stat-pill neutral" id="statNeutral">0 Hold</span>
        <span style="color: #64748b;">|</span>
        <span id="marketDetailText" style="color: #94a3b8; font-size: 12px;">Market Closed</span>
        <span style="color: #64748b;">|</span>
        <span>IST: <b id="updateTime" style="color: #f1f5f9;">Loading...</b></span>
      </div>
    </div>

    <!-- Live Scrolling Ticker Tape -->
    <div class="ticker-wrapper">
      <div class="ticker-label" id="tickerLabel">⚡ LIVE TICKER</div>
      <div class="ticker-scroll-area">
        <div class="ticker-track" id="tickerTrack">
          <span style="color: #94a3b8; font-size: 12px;">Loading live market prices...</span>
        </div>
      </div>
    </div>

    <!-- Alert Box -->
    <div id="warningBox">
      <span>⚠️</span> <span id="warningMsg">Invalid stock symbol!</span>
    </div>

    <!-- Controls -->
    <div class="controls">
      <form class="add-form" onsubmit="addStock(event)">
        <input type="text" id="symInput" class="input-box" placeholder="Add NSE Symbol (e.g. TATASTEEL, ZOMATO)" autocomplete="off" />
        <button type="submit" class="btn">+ Add</button>
      </form>
      <div class="btn-group">
        <button id="viewToggleBtn" onclick="toggleViewMode()" class="btn btn-secondary">📱 Cards View</button>
        <button onclick="openHelpModal()" class="btn btn-secondary" title="View exact indicators and math formulas">❓ How It Calculates</button>
        <button onclick="fetchData()" class="btn btn-secondary">🔄 Refresh</button>
      </div>
    </div>

    <!-- View Container: Cards (Scrollable) -->
    <div id="cardsView" class="cards-grid" style="display: none;"></div>

    <!-- View Container: Table (Scrollable with Sticky Header) -->
    <div id="tableView" class="table-container" style="display: none;">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Live Price (₹)</th>
            <th>1D Change</th>
            <th>Futures Action</th>
            <th>Score</th>
            <th>Stop-Loss (₹)</th>
            <th>Target 1 (1:1)</th>
            <th>Target 2 (1:2)</th>
            <th>Regime</th>
            <th>Rationale</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="stockRows">
          <tr><td colspan="11" style="text-align: center; padding: 40px; color: #94a3b8;">Connecting to live NSE feed...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Help & Quantitative Calculation Guide Modal -->
  <div id="helpModal" class="modal-overlay" onclick="if(event.target===this)closeHelpModal()">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-title">📊 How Every Indicator & Signal is Calculated</div>
        <button class="modal-close-btn" onclick="closeHelpModal()">✕</button>
      </div>

      <!-- Section 1: Regime -->
      <div class="calc-card">
        <div class="calc-card-title">1. Market Regime (Trending vs. Range-Bound)</div>
        <p class="calc-text">
          Uses <b>Kaufman's Efficiency Ratio (ER 14)</b> to detect whether a stock is in a trending wave or sideways consolidation:
          <br><br>
          <span class="calc-code">Efficiency Ratio = |Net Price Change over 14 Days| / Sum of Absolute Daily Swings</span>
          <br><br>
          • <b>TRENDING (ER ≥ 0.38)</b>: Clean directional momentum. System hunts trend-continuation pullbacks.<br>
          • <b>RANGE-BOUND (ER &lt; 0.38)</b>: Choppy equilibrium. System hunts mean-reversion bounces off support/resistance.
        </p>
      </div>

      <!-- Section 2: Score -->
      <div class="calc-card">
        <div class="calc-card-title">2. Quantitative Score (-100 to +100)</div>
        <p class="calc-text">
          Blends 4 institutional indicators:
          <br>
          • <b>Trend Alignment (40 pts)</b>: Direction vs 20 EMA and 200 EMA (Bullish if above, Bearish if below).<br>
          • <b>Momentum (35 pts)</b>: RSI(14) expansion above/below 50 line.<br>
          • <b>Smart Money Flow (20 pts)</b>: Chaikin Money Flow volume accumulation vs distribution.<br>
          • <b>Mean Distance Z-Score (25 pts)</b>: Normalized distance to 20 EMA in terms of ATR (rewards value pullbacks).
        </p>
      </div>

      <!-- Section 3: Signals -->
      <div class="calc-card">
        <div class="calc-card-title">3. Futures Action & Conviction Levels</div>
        <div class="calc-grid">
          <div style="background:#0b1120; padding:10px; border-radius:8px; border:1px solid rgba(34,197,94,0.3);">
            <b style="color:#4ade80;">🟢 BUY FUTURE (Longs)</b>
            <p class="calc-text" style="font-size:12px; margin-top:4px;">
              • <b>Score ≥ +45</b>: High Conviction (Breakout expansion)<br>
              • <b>Score +20 to +44</b>: Pullback Entry (Buying value dip at 20 EMA)
            </p>
          </div>
          <div style="background:#0b1120; padding:10px; border-radius:8px; border:1px solid rgba(239,68,68,0.3);">
            <b style="color:#f87171;">🔴 SELL / SHORT FUTURE (Shorts)</b>
            <p class="calc-text" style="font-size:12px; margin-top:4px;">
              • <b>Score ≤ -45</b>: High Conviction Short (Heavy institutional breakdown)<br>
              • <b>Score -20 to -44</b>: Resistance Entry (Fading upper band)
            </p>
          </div>
        </div>
        <p class="calc-text" style="margin-top:8px;">
          • <b>⚪ STAND ASIDE (Score -19 to +19)</b>: Market is in fair-value consolidation. Protects capital from whipsaws.
        </p>
      </div>

      <!-- Section 4: Stop-Loss & Targets -->
      <div class="calc-card">
        <div class="calc-card-title">4. Dynamic Volatility-Based Stop-Loss & Targets (ATR)</div>
        <p class="calc-text">
          Uses <b>14-period Average True Range (ATR)</b> — measuring actual daily market volatility in Rupees:
          <br><br>
          <b>For BUY Trades (Long):</b><br>
          • <span style="color:#fca5a5;">Stop-Loss</span> = <span class="calc-code">Live Price - (1.5 × ATR)</span> <i>(Places stop outside random intraday market noise)</i><br>
          • <span style="color:#86efac;">Target 1</span> = <span class="calc-code">Live Price + (1.5 × ATR)</span> <i>(1:1 Risk-to-Reward)</i><br>
          • <span style="color:#4ade80;">Target 2</span> = <span class="calc-code">Live Price + (3.0 × ATR)</span> <i>(1:2 High-Reward Runner)</i>
          <br><br>
          <b>For SHORT Trades (Selling Futures):</b><br>
          • <span style="color:#fca5a5;">Stop-Loss</span> = <span class="calc-code">Live Price + (1.5 × ATR)</span> <i>(Placed above price to cap upside risk)</i><br>
          • <span style="color:#86efac;">Target 1</span> = <span class="calc-code">Live Price - (1.5 × ATR)</span> <i>(1:1 Risk-to-Reward downside)</i><br>
          • <span style="color:#4ade80;">Target 2</span> = <span class="calc-code">Live Price - (3.0 × ATR)</span> <i>(1:2 Breakdown Target)</i>
        </p>
      </div>

      <!-- Section 5: Clock -->
      <div class="calc-card">
        <div class="calc-card-title">5. Official NSE Market Hours Schedule</div>
        <p class="calc-text">
          • <b>09:00 - 09:15 AM IST</b>: Pre-Market Order Matching.<br>
          • <b>09:15 - 03:30 PM IST</b>: Live Continuous Regular Trading.<br>
          • <b>Outside Market Hours</b>: Terminal displays verified previous day closing prices and sets status to <b>🔴 NSE CLOSED</b>.
        </p>
      </div>

      <div style="text-align: right; padding-top: 8px;">
        <button class="btn" onclick="closeHelpModal()">Close Guide</button>
      </div>
    </div>
  </div>

  <script>
    function openHelpModal() {
      document.getElementById('helpModal').style.display = 'flex';
    }
    function closeHelpModal() {
      document.getElementById('helpModal').style.display = 'none';
    }
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeHelpModal();
    });

    // State management: Card vs Table view
    let currentView = localStorage.getItem('stockwatch_view') || (window.innerWidth < 768 ? 'cards' : 'table');

    function applyViewMode() {
      const cardsEl = document.getElementById('cardsView');
      const tableEl = document.getElementById('tableView');
      const toggleBtn = document.getElementById('viewToggleBtn');

      if (currentView === 'cards') {
        cardsEl.style.display = 'grid';
        tableEl.style.display = 'none';
        toggleBtn.innerHTML = '📊 Table View';
      } else {
        cardsEl.style.display = 'none';
        tableEl.style.display = 'block';
        toggleBtn.innerHTML = '📱 Cards View';
      }
      localStorage.setItem('stockwatch_view', currentView);
    }

    function toggleViewMode() {
      currentView = currentView === 'cards' ? 'table' : 'cards';
      applyViewMode();
    }

    applyViewMode();

    async function fetchData() {
      try {
        const res = await fetch('/api/stocks');
        const data = await res.json();
        document.getElementById('updateTime').innerText = data.timestamp;

        if (data.market) {
          const mBadge = document.getElementById('marketBadge');
          const mText = document.getElementById('marketBadgeText');
          const mDetail = document.getElementById('marketDetailText');
          const tLabel = document.getElementById('tickerLabel');

          if (mBadge) mBadge.className = 'market-badge ' + data.market.badgeClass;
          if (mText) mText.innerText = data.market.badgeText;
          if (mDetail) mDetail.innerText = data.market.detail;
          if (tLabel) tLabel.innerText = data.market.isOpen ? '⚡ LIVE TICKER' : '⏸️ LAST CLOSE';
        }

        let bullCount = 0, bearCount = 0, neutralCount = 0;

        const tbody = document.getElementById('stockRows');
        tbody.innerHTML = '';

        const cardsContainer = document.getElementById('cardsView');
        cardsContainer.innerHTML = '';

        // 1. Populate Live Scrolling Ticker Tape
        const tickerTrack = document.getElementById('tickerTrack');
        if (tickerTrack && data.stocks.length > 0) {
          let tickerHtml = '';
          // Duplicate items to ensure continuous infinite loop animation
          const loopedStocks = [...data.stocks, ...data.stocks];
          loopedStocks.forEach(s => {
            const chgClass = s.changePct >= 0 ? 'up' : 'down';
            const chgSign = s.changePct >= 0 ? '+' : '';
            tickerHtml += \`<span class="ticker-item"><b>\${s.symbol}</b> <span class="num">₹\${s.price.toFixed(2)}</span> <span class="\${chgClass} num">(\${chgSign}\${s.changePct.toFixed(2)}%)</span></span><span style="color:#334155;">&bull;</span>\`;
          });
          tickerTrack.innerHTML = tickerHtml;
        }

        // 2. Populate Table and Cards
        data.stocks.forEach(s => {
          const isShort = s.signal.includes('SHORT');
          const isLong = s.signal.includes('LONG');
          if (isLong) bullCount++;
          else if (isShort) bearCount++;
          else neutralCount++;

          const badgeClass = isShort ? 'badge-short' : (isLong ? 'badge-buy' : 'badge-hold');
          const chgClass = s.changePct >= 0 ? 'up' : 'down';
          const chgSign = s.changePct >= 0 ? '+' : '';

          // Render Table Row
          const tr = document.createElement('tr');
          tr.innerHTML = \`
            <td><b>\${s.symbol}</b></td>
            <td class="num"><b>₹\${s.price.toFixed(2)}</b></td>
            <td class="\${chgClass} num">\${chgSign}\${s.changePct.toFixed(2)}%</td>
            <td><span class="badge \${badgeClass}">\${s.tradeAction}</span></td>
            <td class="num" style="font-weight: 600;">\${s.score > 0 ? '+' : ''}\${s.score}</td>
            <td class="num" style="color: #fca5a5;"><b>₹\${s.stopLoss.toFixed(2)}</b> (\${s.slPct}%)</td>
            <td class="num" style="color: #86efac;">₹\${s.target1.toFixed(2)}</td>
            <td class="num" style="color: #4ade80;"><b>₹\${s.target2.toFixed(2)}</b></td>
            <td style="color: #94a3b8; font-size: 12px;">\${s.regime}</td>
            <td style="color: #94a3b8; font-size: 12px;">\${s.rationale}</td>
            <td><button class="del-btn" title="Remove" onclick="deleteStock('\${s.symbol}')">✕</button></td>
          \`;
          tbody.appendChild(tr);

          // Render Mobile Card
          const card = document.createElement('div');
          card.className = 'stock-card';
          card.innerHTML = \`
            <div class="card-top">
              <div class="card-symbol-block">
                <span class="card-symbol">\${s.symbol}</span>
                <span class="card-company">\${s.name}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="card-price-block">
                  <span class="card-price num">₹\${s.price.toFixed(2)}</span>
                  <span class="card-chg \${chgClass} num">\${chgSign}\${s.changePct.toFixed(2)}%</span>
                </div>
                <button class="del-btn" title="Remove" onclick="deleteStock('\${s.symbol}')">✕</button>
              </div>
            </div>

            <div class="card-action-bar">
              <span class="badge \${badgeClass}">\${s.tradeAction}</span>
              <span class="num" style="font-size: 12px; font-weight: 700; color: \${s.score >= 0 ? '#4ade80' : '#f87171'}">Score \${s.score > 0 ? '+' : ''}\${s.score}</span>
            </div>

            <div class="card-levels-grid">
              <div class="level-box sl">
                <div class="level-label">Stop-Loss</div>
                <div class="level-val num">₹\${s.stopLoss.toFixed(2)}</div>
                <div class="level-sub num">\${s.slPct}%</div>
              </div>
              <div class="level-box t1">
                <div class="level-label">Target 1</div>
                <div class="level-val num">₹\${s.target1.toFixed(2)}</div>
                <div class="level-sub">1:1 R:R</div>
              </div>
              <div class="level-box t2">
                <div class="level-label">Target 2</div>
                <div class="level-val num">₹\${s.target2.toFixed(2)}</div>
                <div class="level-sub">1:2 R:R</div>
              </div>
            </div>

            <div class="card-rationale">"\${s.rationale}"</div>

            <div class="card-footer">
              <span>\${s.regime}</span>
              <span class="num">RSI \${s.rsi} &bull; ATR ₹\${s.atr.toFixed(2)}</span>
            </div>
          \`;
          cardsContainer.appendChild(card);
        });

        document.getElementById('statBull').innerText = bullCount + ' Longs';
        document.getElementById('statBear').innerText = bearCount + ' Shorts';
        document.getElementById('statNeutral').innerText = neutralCount + ' Neutral';
      } catch (err) {
        console.error(err);
      }
    }

    async function addStock(e) {
      e.preventDefault();
      const input = document.getElementById('symInput');
      const val = input.value.trim().toUpperCase();
      if (!val) return;

      const wBox = document.getElementById('warningBox');
      const wMsg = document.getElementById('warningMsg');
      wBox.style.display = 'none';

      try {
        const res = await fetch('/api/add-stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: val })
        });
        const data = await res.json();

        if (!data.success) {
          wBox.style.display = 'flex';
          wMsg.innerText = data.message || 'Stock not found on NSE!';
          return;
        }

        input.value = '';
        fetchData();
      } catch (err) {
        wBox.style.display = 'flex';
        wMsg.innerText = 'Network error while adding stock!';
      }
    }

    async function deleteStock(sym) {
      if (!confirm('Remove ' + sym + ' from watchlist?')) return;
      await fetch('/api/delete-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym })
      });
      fetchData();
    }

    // Auto-fetch on load and repeat every 10 seconds
    fetchData();
    setInterval(fetchData, 10000);
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Live StockWatch HTML Terminal running at: http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
});
