import { getDb } from "../store/db.js";
import { getPnLSummary } from "../settlement/pnl.js";
import { logger } from "../logger.js";
import { join } from "path";

const PORT = 3456;

// Web dashboard served by Bun. Reads from SQLite, renders glassmorphism UI.
export function startWebDashboard(): void {
  Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);

      // serve the logo from disk so <img src="/logo.png"> works
      if (url.pathname === "/logo.png") {
        try {
          const logoPath = join(import.meta.dir, "../../logo.png");
          return new Response(Bun.file(logoPath), {
            headers: { "Content-Type": "image/png" },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      }

      if (url.pathname === "/api/data") {
        return Response.json(getDashboardData());
      }

      return new Response(HTML, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  logger.info({ port: PORT }, "Web dashboard started");
}

function getDashboardData() {
  const db = getDb();
  const pnl = getPnLSummary();

  const positions = db.query(
    `SELECT * FROM positions ORDER BY entry_time DESC LIMIT 100`,
  ).all() as any[];

  const signals = db.query(
    `SELECT * FROM signals ORDER BY created_at DESC LIMIT 50`,
  ).all() as any[];

  const settled = db.query(
    `SELECT settle_time, pnl FROM positions WHERE status IN ('won','lost') ORDER BY settle_time ASC`,
  ).all() as any[];

  let cumPnl = 0;
  const equityCurve = settled.map((p) => {
    cumPnl += p.pnl ?? 0;
    return { time: p.settle_time, pnl: cumPnl };
  });

  const cityStats = db.query(`
    SELECT city,
      COUNT(*) as total,
      SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as losses,
      SUM(COALESCE(pnl,0)) as pnl
    FROM positions WHERE status IN ('won','lost')
    GROUP BY city
  `).all() as any[];

  // Compute consecutive losses from DB directly (avoids importing risk module state)
  const riskRows = db.query(
    `SELECT status FROM positions WHERE status IN ('won','lost') ORDER BY settle_time DESC LIMIT 10`,
  ).all() as any[];
  let consecutiveLosses = 0;
  for (const p of riskRows) {
    if (p.status === "lost") consecutiveLosses++;
    else break;
  }

  // Extract wallet address from env if available
  let walletAddress = "";
  if (process.env.POLYGON_PRIVATE_KEY) {
    try {
        const { ethers } = require("ethers");
        const wallet = new ethers.Wallet(process.env.POLYGON_PRIVATE_KEY);
        walletAddress = wallet.address;
    } catch (e) {
        // ignore if ethers not ready or key invalid
    }
  }

  return {
    mode: process.env.MODE || "paper",
    pnl,
    positions: positions.map(mapPos),
    signals,
    equityCurve,
    cityStats,
    consecutiveLosses,
    circuitBroken: consecutiveLosses >= 3,
    walletAddress
  };
}

function mapPos(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    conditionId: r.condition_id,
    city: r.city,
    date: r.date,
    metric: r.metric,
    bracketType: r.bracket_type,
    bracketMin: r.bracket_min,
    bracketMax: r.bracket_max,
    side: r.side,
    entryPrice: r.entry_price,
    size: r.size,
    potentialPayout: r.potential_payout,
    edge: r.edge,
    status: r.status,
    pnl: r.pnl,
    actualTemp: r.actual_temp,
    entryTime: r.entry_time,
    settleTime: r.settle_time,
    modelProbability: r.model_probability,
  };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WeatherClaw</title>
<link rel="icon" type="image/png" href="/logo.png">
<style>
  :root {
    --bg: #050810;
    --surface: rgba(255,255,255,0.04);
    --border: rgba(255,255,255,0.08);
    --text: #e2e8f0;
    --dim: #64748b;
    --cyan: #00d4ff;
    --green: #00ff88;
    --red: #ff4466;
    --yellow: #ffd60a;
    --purple: #bf5af2;
    --orange: #ff9f0a;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    background: var(--bg);
    background-image:
      radial-gradient(ellipse at 15% 15%, rgba(0,212,255,0.05) 0%, transparent 55%),
      radial-gradient(ellipse at 85% 85%, rgba(191,90,242,0.05) 0%, transparent 55%);
    color: var(--text);
    min-height: 100vh;
  }
  .container { max-width: 1600px; margin: 0 auto; padding: 24px 32px; }

  /* Header */
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 20px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 28px;
  }
  .logo {
    font-size: 22px; font-weight: 700; color: var(--cyan);
    text-shadow: 0 0 30px rgba(0,212,255,0.5);
    letter-spacing: -0.5px; display: flex; align-items: center; gap: 10px;
  }
  .logo-sub { color: var(--dim); font-weight: 400; font-size: 12px; letter-spacing: 0; }
  .header-right { display: flex; align-items: center; gap: 14px; }
  .mode-badge {
    padding: 4px 14px; border-radius: 20px; font-size: 11px;
    font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
  }
  .mode-paper { background: rgba(0,255,136,0.12); color: var(--green); border: 1px solid rgba(0,255,136,0.25); }
  .mode-live  { background: rgba(255,159,10,0.12); color: var(--orange); border: 1px solid rgba(255,159,10,0.25); }
  .live-time  { color: var(--dim); font-size: 12px; }

  /* Glass card base */
  .glass {
    background: var(--surface);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }

  /* Stat cards */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 14px; margin-bottom: 24px;
  }
  @media (max-width: 1200px) { .stats-grid { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 700px)  { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
  .stat-card {
    padding: 18px 20px; position: relative; overflow: hidden;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .stat-card:hover { 
    transform: translateY(-2px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  }
  .stat-card[onclick]:hover {
    background: rgba(255,255,255,0.06);
  }
  .stat-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: var(--accent-color, rgba(255,255,255,0.1));
    border-radius: 16px 16px 0 0;
  }
  .stat-label { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 10px; }
  .stat-value { font-size: 26px; font-weight: 700; line-height: 1; }
  .stat-value.positive { color: var(--green); }
  .stat-value.negative { color: var(--red); }
  .stat-value.cyan   { color: var(--cyan); }
  .stat-value.yellow { color: var(--yellow); }
  .stat-value.red    { color: var(--red); }

  /* Split row: chart left, city cards right */
  .split-row {
    display: grid; grid-template-columns: 3fr 2fr;
    gap: 20px; margin-bottom: 24px; align-items: start;
  }
  @media (max-width: 1000px) { .split-row { grid-template-columns: 1fr; } }

  /* Chart */
  .chart-card { padding: 20px; }
  .card-header { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 14px; }
  #equityChart { width: 100%; height: 220px; display: block; cursor: crosshair; }

  /* City performance cards */
  .city-section-header { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 12px; }
  .city-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .city-card { padding: 14px 16px; border-left: 3px solid rgba(255,255,255,0.08); }
  .city-card.profit { border-left-color: var(--green); }
  .city-card.loss    { border-left-color: var(--red); }
  .city-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .city-name { font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .city-pnl  { font-size: 15px; font-weight: 700; }
  .progress-bar  { height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; margin-bottom: 6px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 2px; }
  .city-stats-row { display: flex; justify-content: space-between; font-size: 10px; color: var(--dim); }

  /* Sections */
  .section { margin-bottom: 24px; }
  .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .section-title { font-size: 15px; font-weight: 600; color: var(--cyan); }
  .badge-count {
    background: rgba(0,212,255,0.12); color: var(--cyan);
    border-radius: 10px; padding: 2px 9px; font-size: 11px; font-weight: 600;
  }

  /* Tables */
  .table-wrap { overflow-x: auto; }
  .table-wrap table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 600px; }
  th {
    color: var(--dim); text-align: left; padding: 11px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; white-space: nowrap;
  }
  td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: rgba(255,255,255,0.03); }
  tbody tr[onclick]:hover { background: rgba(0,212,255,0.08); }
  .empty-row td { text-align: center; color: var(--dim); padding: 28px; }

  /* Badges */
  .badge {
    display: inline-flex; align-items: center;
    padding: 2px 9px; border-radius: 20px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.5px; white-space: nowrap;
  }
  .badge-yes      { background: rgba(0,255,136,0.15);  color: var(--green); }
  .badge-no       { background: rgba(255,68,102,0.15); color: var(--red); }
  .badge-lock     { background: rgba(191,90,242,0.15); color: var(--purple); }
  .badge-strong   { background: rgba(0,212,255,0.15);  color: var(--cyan); }
  .badge-safe     { background: rgba(0,255,136,0.12);  color: var(--green); }
  .badge-near-safe { background: rgba(255,214,10,0.15); color: var(--yellow); }
  .badge-open     { background: rgba(0,212,255,0.12);  color: var(--cyan); }
  .badge-won      { background: rgba(0,255,136,0.12);  color: var(--green); }
  .badge-lost     { background: rgba(255,68,102,0.12); color: var(--red); }
  .badge-expired  { background: rgba(100,116,139,0.15); color: var(--dim); }
  .badge-h { background: rgba(255,214,10,0.12);  color: var(--yellow); font-size: 9px; padding: 1px 7px; }
  .badge-l { background: rgba(191,90,242,0.12); color: var(--purple); font-size: 9px; padding: 1px 7px; }

  /* Color helpers */
  .positive  { color: var(--green); }
  .negative  { color: var(--red); }
  .edge-high { color: var(--green); }
  .edge-mid  { color: var(--yellow); }

  /* Tooltip */
  #chart-tooltip {
    position: fixed; display: none;
    background: rgba(10,14,23,0.96);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px; padding: 9px 14px;
    font-size: 12px; pointer-events: none; z-index: 1000; line-height: 1.7;
  }

  /* Footer */
  .footer { text-align: center; color: var(--dim); font-size: 11px; padding: 24px 0 8px; }
</style>
</head>
<body>
<div class="container">

  <header>
    <div class="logo">
      <img src="/logo.png" alt="WeatherClaw" style="height:36px;width:auto;display:block;">
      WeatherClaw
      <span class="logo-sub">Weather Prediction Market Bot &mdash; Polymarket</span>
    </div>
    <div class="header-right">
      <span id="modeBadge" class="mode-badge">&mdash;</span>
      <span class="live-time" id="liveClock"></span>
    </div>
  </header>

  <div id="stats" class="stats-grid"></div>

  <div class="split-row">
    <div class="glass chart-card">
      <div class="card-header">Equity Curve</div>
      <canvas id="equityChart"></canvas>
    </div>
    <div>
      <div class="city-section-header">City Performance</div>
      <div id="cityCards" class="city-grid"></div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-title">Active Signals</span>
      <span id="signalCount" class="badge-count">0</span>
    </div>
    <div class="glass table-wrap">
      <table>
        <thead><tr>
          <th>City</th><th>Date</th><th>Bracket</th><th>H/L</th>
          <th>Side</th><th>Model%</th><th>Mkt&cent;</th><th>Edge%</th>
          <th>Size</th><th>Confidence</th>
        </tr></thead>
        <tbody id="signals"></tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <span class="section-title">Positions</span>
      <span id="posCount" class="badge-count">0</span>
    </div>
    <div class="glass table-wrap">
      <table>
        <thead><tr>
          <th>City</th><th>Date</th><th>Bracket</th><th>H/L</th>
          <th>Side</th><th>Model%</th><th>Entry&cent;</th><th>Size</th>
          <th>Payout</th><th>Edge%</th><th>Actual</th><th>P&amp;L</th><th>Status</th>
        </tr></thead>
        <tbody id="positions"></tbody>
      </table>
    </div>
  </div>

  <p class="footer">Auto-refreshes every 30s &middot; WeatherClaw v0.1.0</p>
</div>

<div id="chart-tooltip"></div>

<script>
// Chart padding constants (shared between draw and tooltip)
var CP = { l: 58, r: 12, t: 12, b: 28 };
// Global chart data for mousemove tooltip
var _chartData = [];

// All 6 tracked cities
var ALL_CITIES = ['nyc', 'chicago', 'miami', 'atlanta', 'seattle', 'dallas'];

// ---- Helpers ----

function fmt(n) {
  if (n == null) return '&mdash;';
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}

function bracketStr(type, min, max) {
  if (type === 'between') return min + '&ndash;' + (max - 1) + '&deg;F';
  if (type === 'above')   return 'above ' + min + '&deg;F';
  if (type === 'below')   return 'below ' + max + '&deg;F';
  return '?';
}

function relTime(ms) {
  if (!ms) return '&mdash;';
  var m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function sideBadge(side) {
  var s = (side || '').toUpperCase();
  return '<span class="badge badge-' + s.toLowerCase() + '">' + s + '</span>';
}

function confBadge(conf) {
  var cls = conf === 'LOCK' ? 'lock' : conf === 'STRONG' ? 'strong' : conf === 'SAFE' ? 'safe' : 'near-safe';
  return '<span class="badge badge-' + cls + '">' + (conf || '') + '</span>';
}

function statusBadge(st) {
  return '<span class="badge badge-' + (st || 'open') + '">' + (st || 'open').toUpperCase() + '</span>';
}

function metricBadge(m) {
  var v = (m || 'h').charAt(0).toLowerCase();
  return '<span class="badge badge-' + v + '">' + v.toUpperCase() + '</span>';
}

function edgeCls(e) {
  if (e >= 0.15) return 'edge-high';
  if (e >= 0.10) return 'edge-mid';
  return '';
}

function statCard(label, value, valueCls, accentColor, clickAction) {
  var attrs = clickAction ? ' style="cursor:pointer;--accent-color:' + accentColor + '" onclick="' + clickAction + '"' : ' style="--accent-color:' + accentColor + '"';
  return '<div class="glass stat-card"' + attrs + '>' +
    '<div class="stat-label">' + label + '</div>' +
    '<div class="stat-value ' + (valueCls || '') + '">' + value + '</div>' +
    '</div>';
}

// ---- Renderers ----

function renderStats(pnl, circuitBroken, consecLosses, walletAddress) {
  var pnlPos  = pnl.totalPnl >= 0;
  var pnlCls  = pnlPos ? 'positive' : 'negative';
  var pnlAccent = pnlPos ? 'rgba(0,255,136,0.8)' : 'rgba(255,68,102,0.8)';
  var lossAccent = consecLosses > 0 ? 'rgba(255,68,102,0.8)' : 'rgba(255,255,255,0.1)';
  var lossCls    = consecLosses > 0 ? 'red' : '';
  var lossLabel  = circuitBroken ? '&#9940; Circuit' : 'Streak Loss';
  
  var polyscanUrl = walletAddress ? 'https://polygonscan.com/address/' + walletAddress : 'https://polygonscan.com';

  document.getElementById('stats').innerHTML =
    statCard('Total P&amp;L',  fmt(pnl.totalPnl), pnlCls, pnlAccent, "window.open('" + polyscanUrl + "', '_blank')") +
    statCard('Win Rate',  pnl.totalTrades > 0 ? (pnl.winRate * 100).toFixed(1) + '%' : 'N/A', '', 'rgba(0,212,255,0.8)', "window.open('" + polyscanUrl + "', '_blank')") +
    statCard('Trades',    String(pnl.totalTrades), '', 'rgba(0,212,255,0.5)', "window.open('" + polyscanUrl + "', '_blank')") +
    statCard('Open Pos.', String(pnl.openPositions), 'cyan', 'rgba(0,212,255,0.8)') +
    statCard('Exposure',  '$' + pnl.openExposure.toFixed(2), 'yellow', 'rgba(255,214,10,0.8)') +
    statCard(lossLabel,   String(consecLosses), lossCls, lossAccent);
}

function drawChart(data) {
  _chartData = data;
  var canvas = document.getElementById('equityChart');
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 2;
  var W = canvas.offsetWidth;
  var H = canvas.offsetHeight || 220;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  var padL = CP.l, padR = CP.r, padT = CP.t, padB = CP.b;
  var plotW = W - padL - padR;
  var plotH = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  if (data.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for settlements...', W / 2, H / 2);
    return;
  }

  var pnls = data.map(function(d) { return d.pnl; });
  var minVal = Math.min(0, Math.min.apply(null, pnls));
  var maxVal = Math.max(0, Math.max.apply(null, pnls));
  var range  = maxVal - minVal || 1;

  function toX(i) { return padL + (i / (data.length - 1)) * plotW; }
  function toY(v) { return padT + ((maxVal - v) / range) * plotH; }

  // Horizontal grid lines + Y-axis labels
  var gridCount = 4;
  for (var g = 0; g <= gridCount; g++) {
    var gv = minVal + (range / gridCount) * g;
    var gy = toY(gv);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    var lbl = (gv >= 0 ? '+$' : '-$') + Math.abs(gv).toFixed(2);
    ctx.fillText(lbl, padL - 5, gy + 3);
  }

  // Zero line
  var zeroY = toY(0);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(padL + plotW, zeroY); ctx.stroke();

  var isProfit  = pnls[pnls.length - 1] >= 0;
  var lineColor = isProfit ? '#00ff88' : '#ff4466';
  var fillTop   = isProfit ? 'rgba(0,255,136,0.22)' : 'rgba(255,68,102,0.22)';
  var fillBot   = isProfit ? 'rgba(0,255,136,0)'    : 'rgba(255,68,102,0)';

  // Gradient fill under curve
  var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, fillTop);
  grad.addColorStop(1, fillBot);
  ctx.beginPath();
  data.forEach(function(d, i) { i === 0 ? ctx.moveTo(toX(i), toY(d.pnl)) : ctx.lineTo(toX(i), toY(d.pnl)); });
  ctx.lineTo(toX(data.length - 1), zeroY);
  ctx.lineTo(toX(0), zeroY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Curve line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach(function(d, i) { i === 0 ? ctx.moveTo(toX(i), toY(d.pnl)) : ctx.lineTo(toX(i), toY(d.pnl)); });
  ctx.stroke();

  // X-axis date labels
  var step = Math.max(1, Math.floor(data.length / 5));
  ctx.fillStyle = '#64748b';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  for (var i = 0; i < data.length; i += step) {
    if (data[i].time) {
      var dt = new Date(data[i].time);
      ctx.fillText((dt.getMonth() + 1) + '/' + dt.getDate(), toX(i), H - padB + 14);
    }
  }
}

function renderCityCards(cityStats) {
  var map = {};
  cityStats.forEach(function(c) { map[c.city] = c; });
  document.getElementById('cityCards').innerHTML = ALL_CITIES.map(function(city) {
    var s = map[city];
    if (!s) {
      return '<div class="glass city-card">' +
        '<div class="city-header"><span class="city-name">' + city.toUpperCase() + '</span>' +
        '<span style="color:#64748b;font-size:12px">&mdash;</span></div>' +
        '<div style="color:#64748b;font-size:10px;margin-top:2px">No settled trades</div>' +
        '</div>';
    }
    var wr     = s.total > 0 ? (s.wins / s.total) : 0;
    var barClr = wr >= 0.5 ? '#00ff88' : '#ff4466';
    var pnlCls = s.pnl >= 0 ? 'positive' : 'negative';
    var bdrCls = s.pnl >= 0 ? 'profit' : 'loss';
    return '<div class="glass city-card ' + bdrCls + '">' +
      '<div class="city-header">' +
        '<span class="city-name">' + city.toUpperCase() + '</span>' +
        '<span class="city-pnl ' + pnlCls + '">' + fmt(s.pnl) + '</span>' +
      '</div>' +
      '<div class="progress-bar"><div class="progress-fill" style="width:' + (wr * 100).toFixed(0) + '%;background:' + barClr + '"></div></div>' +
      '<div class="city-stats-row"><span>' + s.wins + 'W / ' + s.losses + 'L</span><span>' + (wr * 100).toFixed(0) + '% win</span></div>' +
      '</div>';
  }).join('');
}

function renderSignals(signals) {
  document.getElementById('signalCount').textContent = String(signals.length);
  if (!signals.length) {
    document.getElementById('signals').innerHTML = '<tr class="empty-row"><td colspan="10">No active signals</td></tr>';
    return;
  }
  document.getElementById('signals').innerHTML = signals.map(function(s) {
    var edge = s.edge || 0;
    var conditionId = s.condition_id || '';
    var slug = s.slug || '';
    var marketUrl = (slug && conditionId) 
      ? ('https://polymarket.com/event/' + slug + '?tid=' + conditionId)
      : (conditionId ? ('https://polymarket.com/market/' + conditionId) : 'https://polymarket.com');
    return '<tr style="cursor:pointer" onclick=\\'window.open(' + JSON.stringify(marketUrl) + ', "_blank")\\' title="Click to view on Polymarket">' +
      '<td>' + (s.city || '').toUpperCase() + '</td>' +
      '<td>' + (s.date || '') + '</td>' +
      '<td>' + bracketStr(s.bracket_type, s.bracket_min, s.bracket_max) + '</td>' +
      '<td>' + metricBadge(s.metric) + '</td>' +
      '<td>' + sideBadge(s.side) + '</td>' +
      '<td>' + ((s.model_probability || 0) * 100).toFixed(1) + '%</td>' +
      '<td>' + ((s.market_price || 0) * 100).toFixed(1) + '&cent;</td>' +
      '<td class="' + edgeCls(edge) + '">' + (edge * 100).toFixed(1) + '%</td>' +
      '<td>$' + (s.size || 0).toFixed(2) + '</td>' +
      '<td>' + confBadge(s.confidence) + '</td>' +
      '</tr>';
  }).join('');
}

function renderPositions(positions) {
  document.getElementById('posCount').textContent = String(positions.length);
  if (!positions.length) {
    document.getElementById('positions').innerHTML = '<tr class="empty-row"><td colspan="13">No positions yet</td></tr>';
    return;
  }
  document.getElementById('positions').innerHTML = positions.map(function(p) {
    var edge   = p.edge || 0;
    var pnlHtml = p.pnl != null
      ? '<span class="' + (p.pnl >= 0 ? 'positive' : 'negative') + '">' + fmt(p.pnl) + '</span>'
      : '&mdash;';
    var actualHtml = p.actualTemp != null ? p.actualTemp + '&deg;F' : '&mdash;';
    var payoutHtml = p.potentialPayout != null ? '$' + p.potentialPayout.toFixed(2) : '&mdash;';
    
    var conditionId = p.conditionId || '';
    var slug = p.slug || '';
    var marketUrl = (slug && conditionId) 
      ? ('https://polymarket.com/event/' + slug + '?tid=' + conditionId)
      : (conditionId ? ('https://polymarket.com/market/' + conditionId) : 'https://polymarket.com');

    return '<tr style="cursor:pointer" onclick=\\'window.open(' + JSON.stringify(marketUrl) + ', "_blank")\\' title="' + (p.entryTime ? new Date(p.entryTime).toLocaleString() : '') + '">' +
      '<td>' + (p.city || '').toUpperCase() + '</td>' +
      '<td>' + (p.date || '') + '</td>' +
      '<td>' + bracketStr(p.bracketType, p.bracketMin, p.bracketMax) + '</td>' +
      '<td>' + metricBadge(p.metric) + '</td>' +
      '<td>' + sideBadge(p.side) + '</td>' +
      '<td>' + ((p.modelProbability || 0) * 100).toFixed(1) + '%</td>' +
      '<td>' + ((p.entryPrice || 0) * 100).toFixed(1) + '&cent;</td>' +
      '<td>$' + (p.size || 0).toFixed(2) + '</td>' +
      '<td>' + payoutHtml + '</td>' +
      '<td class="' + edgeCls(edge) + '">' + (edge * 100).toFixed(1) + '%</td>' +
      '<td>' + actualHtml + '</td>' +
      '<td>' + pnlHtml + '</td>' +
      '<td>' + statusBadge(p.status) + '</td>' +
      '</tr>';
  }).join('');
}

// ---- Main load ----

function load() {
  fetch('/api/data')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      // Mode badge
      var mb = document.getElementById('modeBadge');
      if (mb) {
        mb.textContent = (d.mode || 'paper').toUpperCase();
        mb.className = 'mode-badge mode-' + (d.mode || 'paper');
      }

      renderStats(d.pnl, d.circuitBroken, d.consecutiveLosses, d.walletAddress);
      drawChart(d.equityCurve);
      renderCityCards(d.cityStats);
      renderSignals(d.signals);
      renderPositions(d.positions);
    })
    .catch(function(e) {
      console.error('Load failed:', e);
    });
}

// ---- Chart tooltip (registered once) ----

(function() {
  var canvas = document.getElementById('equityChart');
  var tip = document.getElementById('chart-tooltip');
  canvas.addEventListener('mousemove', function(e) {
    if (_chartData.length < 2) return;
    var rect = canvas.getBoundingClientRect();
    var relX = (e.clientX - rect.left) - CP.l;
    var plotW = rect.width - CP.l - CP.r;
    if (relX < 0 || relX > plotW) { tip.style.display = 'none'; return; }
    var idx = Math.round((relX / plotW) * (_chartData.length - 1));
    idx = Math.max(0, Math.min(idx, _chartData.length - 1));
    var pt = _chartData[idx];
    var dateStr = pt.time ? new Date(pt.time).toLocaleDateString() : '';
    tip.innerHTML =
      (dateStr ? '<span style="color:#64748b;font-size:10px">' + dateStr + '</span><br>' : '') +
      '<span style="color:' + (pt.pnl >= 0 ? '#00ff88' : '#ff4466') + ';font-weight:700">' + fmt(pt.pnl) + '</span>';
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 10) + 'px';
  });
  canvas.addEventListener('mouseleave', function() { tip.style.display = 'none'; });
})();

// ---- Init ----

load();
setInterval(load, 30000);
setInterval(function() {
  var el = document.getElementById('liveClock');
  if (el) el.textContent = new Date().toLocaleTimeString();
}, 1000);
</script>
</body>
</html>`;
