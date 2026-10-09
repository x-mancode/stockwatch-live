const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || parseInt(process.argv[2], 10) || 8888;
const stocksTxtPath = path.join(__dirname, 'stocks.txt');
const indexHtmlPath = path.join(__dirname, 'index.html');
const bankNiftyHtmlPath = path.join(__dirname, 'banknifty.html');
const pineScriptPath = path.join(__dirname, 'BankNifty_Volatility_Squeeze_Strategy.pine');

// ==============================================================================
// TECHNICAL INDICATOR HELPER FUNCTIONS
// ==============================================================================
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
    let sumSwings = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSwings += Math.abs(closes[j] - closes[j - 1]);
    }
    er[i] = sumSwings === 0 ? 0 : netChange / sumSwings;
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

// ==============================================================================
// LIVE STOCK DATA FETCHER
// ==============================================================================
async function fetchLiveStock(rawSymbol) {
  const upper = rawSymbol.trim().toUpperCase();
  let querySymbol = upper;
  let cleanSymbol = upper.replace('.NS', '');

  if (upper === 'BANKNIFTY' || upper === '^NSEBANK') {
    querySymbol = '%5ENSEBANK';
    cleanSymbol = 'BANKNIFTY';
  } else if (upper === 'NIFTY' || upper === '^NSEI') {
    querySymbol = '%5ENSEI';
    cleanSymbol = 'NIFTY';
  } else {
    querySymbol = upper.endsWith('.NS') ? upper : `${upper}.NS`;
    cleanSymbol = upper.replace('.NS', '');
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${querySymbol}?range=1y&interval=1d`;
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

// ==============================================================================
// BANK NIFTY QUANT STRATEGY DATA ANALYZER
// ==============================================================================
async function getBankNiftyStrategyData() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEBANK?range=1y&interval=1d';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    if (!data.chart || !data.chart.result || data.chart.result.length === 0) return null;
    const meta = data.chart.result[0].meta;
    const quote = data.chart.result[0].indicators.quote[0];
    const timestamps = data.chart.result[0].timestamp;
    const valid = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.close[i] != null && quote.high[i] != null && quote.low[i] != null && quote.open[i] != null) {
        const d = new Date(timestamps[i] * 1000);
        valid.push({
          date: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0
        });
      }
    }
    if (valid.length < 30) return null;

    // Calculate ATR(14)
    const tr = [valid[0].high - valid[0].low];
    for (let i = 1; i < valid.length; i++) {
      const hl = valid[i].high - valid[i].low;
      const hc = Math.abs(valid[i].high - valid[i - 1].close);
      const lc = Math.abs(valid[i].low - valid[i - 1].close);
      tr.push(Math.max(hl, hc, lc));
    }
    const atr = new Array(valid.length).fill(0);
    let sum = 0;
    for (let i = 0; i < 14; i++) sum += tr[i];
    atr[13] = sum / 14;
    for (let i = 14; i < valid.length; i++) {
      atr[i] = (atr[i - 1] * 13 + tr[i]) / 14;
    }

    const lastIdx = valid.length - 1;
    const livePrice = meta.regularMarketPrice || valid[lastIdx].close;
    const prevClose = valid[lastIdx - 1].close;
    const changePts = livePrice - prevClose;
    const changePct = (changePts / prevClose) * 100;
    const curATR = atr[lastIdx];
    const curRange = valid[lastIdx].high - valid[lastIdx].low;

    // Yesterday setup
    const yBar = valid[lastIdx - 1];
    const yPrevBar = valid[lastIdx - 2];
    const yRange = yBar.high - yBar.low;
    const yPrevRange = yPrevBar.high - yPrevBar.low;
    const yATR = atr[lastIdx - 1];
    const yIsSqueeze = (yRange < 0.85 * yATR) && (yRange < yPrevRange);

    // Today compression check
    const todayIsSqueeze = (curRange < 0.85 * curATR) && (curRange < yRange);

    let activeSignal = 'WAITING (No Squeeze Yesterday)';
    let signalType = 'WAIT';
    let triggerPrice = null;

    if (yIsSqueeze) {
      if (livePrice > yBar.high) {
        activeSignal = '🟢 BULLISH BREAKOUT TRIGGERED (BUY)';
        signalType = 'BUY';
        triggerPrice = yBar.high;
      } else if (livePrice < yBar.low) {
        activeSignal = '🔴 BEARISH BREAKDOWN TRIGGERED (SELL)';
        signalType = 'SELL';
        triggerPrice = yBar.low;
      } else {
        activeSignal = '🟡 SQUEEZE ACTIVE / ENERGY COILED (Inside Range)';
        signalType = 'SQUEEZE';
      }
    }

    const longTrigger = yBar.high;
    const shortTrigger = yBar.low;
    const stopLossDist = 2.0 * yATR;
    const target1Dist = 2.0 * yATR;
    const target2Dist = 3.0 * yATR;
    const atmStrike = Math.round(livePrice / 100) * 100;

    // Recent 15 sessions log
    const recentSessions = [];
    for (let i = valid.length - 1; i >= Math.max(15, valid.length - 15); i--) {
      const b = valid[i];
      const p = valid[i - 1];
      const pp = valid[i - 2];
      const pRange = p.high - p.low;
      const ppRange = pp.high - pp.low;
      const pATR = atr[i - 1];
      const squeezeSetup = (pRange < 0.85 * pATR) && (pRange < ppRange);
      let sessionSignal = '-';
      let outcome = '-';
      if (squeezeSetup) {
        if (b.high > p.high) {
          sessionSignal = 'BUY BREAKOUT';
          const entry = p.high;
          const sl = entry - 2 * pATR;
          const tp = entry + 2 * pATR;
          outcome = b.high >= tp ? 'Target 1 Hit (+2x ATR)' : (b.low <= sl ? 'Stop-Loss Hit (-2x ATR)' : 'Active / In Play');
        } else if (b.low < p.low) {
          sessionSignal = 'SELL BREAKDOWN';
          const entry = p.low;
          const sl = entry + 2 * pATR;
          const tp = entry - 2 * pATR;
          outcome = b.low <= tp ? 'Target 1 Hit (+2x ATR)' : (b.high >= sl ? 'Stop-Loss Hit (-2x ATR)' : 'Active / In Play');
        } else {
          sessionSignal = 'INSIDE BAR';
          outcome = 'No Breakout';
        }
      }
      recentSessions.push({
        date: b.date,
        open: Math.round(b.open),
        high: Math.round(b.high),
        low: Math.round(b.low),
        close: Math.round(b.close),
        range: Math.round(b.high - b.low),
        atr: Math.round(atr[i]),
        compressionSetup: squeezeSetup,
        signal: sessionSignal,
        outcome
      });
    }

    return {
      live: {
        price: Math.round(livePrice * 100) / 100,
        changePts: Math.round(changePts * 100) / 100,
        changePct: Math.round(changePct * 100) / 100,
        open: Math.round(valid[lastIdx].open * 100) / 100,
        high: Math.round(valid[lastIdx].high * 100) / 100,
        low: Math.round(valid[lastIdx].low * 100) / 100,
        prevClose: Math.round(prevClose * 100) / 100,
        curATR: Math.round(curATR),
        curRange: Math.round(curRange),
        compressionRatio: Math.round((curRange / curATR) * 100) / 100,
        todayIsSqueeze
      },
      setup: {
        yIsSqueeze,
        activeSignal,
        signalType,
        triggerPrice: triggerPrice ? Math.round(triggerPrice) : null,
        longTrigger: Math.round(longTrigger),
        shortTrigger: Math.round(shortTrigger),
        stopLossDist: Math.round(stopLossDist),
        target1Dist: Math.round(target1Dist),
        target2Dist: Math.round(target2Dist),
        longSL: Math.round(longTrigger - stopLossDist),
        longTP1: Math.round(longTrigger + target1Dist),
        longTP2: Math.round(longTrigger + target2Dist),
        shortSL: Math.round(shortTrigger + stopLossDist),
        shortTP1: Math.round(shortTrigger - target1Dist),
        shortTP2: Math.round(shortTrigger - target2Dist),
        atmStrike,
        atmCE: `${atmStrike} CE`,
        atmPE: `${atmStrike} PE`
      },
      backtest: {
        period: "10 Years (2016 - 2026)",
        candlesTested: 2467,
        totalTrades: 170,
        tradesPerYear: 17,
        wins: 108,
        losses: 62,
        winRate: 63.5,
        profitFactor: 1.73,
        payoffRatio: 0.99,
        netPoints: 54335,
        grossProfitPoints: 128606,
        grossLossPoints: 74271,
        maxDrawdownPoints: 6097,
        expectancyPerTrade: 320,
        inrProfit1Lot: 815025,
        inrProfit2Lots: 1630050,
        inrProfit5Lots: 4075125,
        maxDDRupees1Lot: 91455
      },
      recentSessions
    };
  } catch (err) {
    console.error('Error in getBankNiftyStrategyData:', err);
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
      detail: 'Market opens Monday 9:15 AM'
    };
  }

  // Pre-market: 9:00 AM to 9:15 AM (540 to 555 mins)
  if (timeInMins >= 540 && timeInMins < 555) {
    return {
      isOpen: false,
      isPreOpen: true,
      badgeText: 'PRE-MARKET (Order Matching)',
      badgeClass: 'market-pre',
      detail: 'Regular session starts at 9:15 AM'
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

  // Favicon route
  if (url === '/favicon.ico') {
    const faviconSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#131b2e'/><path d='M12 44 L24 32 L34 40 L52 18' stroke='#22c55e' stroke-width='5' stroke-linecap='round' stroke-linejoin='round' fill='none'/><path d='M42 18 H52 V28' stroke='#22c55e' stroke-width='5' stroke-linecap='round' stroke-linejoin='round' fill='none'/></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    res.end(faviconSvg);
    return;
  }

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

  // API 4: Bank Nifty Quant Strategy
  if (url === '/api/banknifty-strategy') {
    const bnfData = await getBankNiftyStrategyData();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(bnfData || { success: false }));
    return;
  }

  // API 5: Pine Script Code
  if (url === '/api/pine-script') {
    let code = '// Pine Script not found';
    if (fs.existsSync(pineScriptPath)) {
      code = fs.readFileSync(pineScriptPath, 'utf8');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(code);
    return;
  }

  // Route: Bank Nifty Dedicated Quant & Options Paper Trading Terminal
  if (url === '/banknifty' || url === '/banknifty.html') {
    if (fs.existsSync(bankNiftyHtmlPath)) {
      const html = fs.readFileSync(bankNiftyHtmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }

  // Route: Default StockWatch Screener Terminal
  if (fs.existsSync(indexHtmlPath)) {
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('index.html not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Live StockWatch HTML Terminal running at: http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
});
