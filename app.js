// USD/JPY ダッシュボード（Twelve Data 実ローソク足版）
// 取得元: /api/candles?interval=15min   /api/rate（現在レート）

const RATE_URL = "/api/rate";
const CANDLES_URL = "/api/candles?interval=15min&outputsize=200";
const REFRESH_MS = 3 * 60 * 1000; // 3分ごとに更新（無料枠を節約）

const el = {
  price: document.getElementById("price"),
  change: document.getElementById("change"),
  rsi: document.getElementById("rsi"),
  signal: document.getElementById("signal"),
  status: document.getElementById("status"),
  priceChart: document.getElementById("priceChart"),
  macdChart: document.getElementById("macdChart"),
};

let priceChart, macdChart;

// --- 指標計算 ---
function sma(arr, period) {
  const out = Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(arr, period) {
  const out = Array(arr.length).fill(null);
  const k = 2 / (period + 1);
  let prev;
  for (let i = 0; i < arr.length; i++) {
    if (i === 0) { prev = arr[i]; out[i] = prev; continue; }
    prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(arr, period = 14) {
  const out = Array(arr.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    const g = Math.max(diff, 0);
    const l = Math.max(-diff, 0);
    if (i <= period) {
      gain += g; loss += l;
      if (i === period) {
        const rs = gain / (loss || 1e-9);
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      const rs = gain / (loss || 1e-9);
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function macd(arr) {
  const e12 = ema(arr, 12);
  const e26 = ema(arr, 26);
  const line = arr.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

function bollinger(arr, period = 20, mult = 2) {
  const mid = sma(arr, period);
  const upper = [...arr].map(() => null);
  const lower = [...arr].map(() => null);
  for (let i = period - 1; i < arr.length; i++) {
    const slice = arr.slice(i - period + 1, i + 1);
    const m = mid[i];
    const variance = slice.reduce((s, v) => s + (v - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

// --- 描画 ---
function buildPriceChart(times, closes) {
  const ma5 = sma(closes, 5);
  const ma25 = sma(closes, 25);
  const ma75 = sma(closes, 75);
  const bb = bollinger(closes, 20, 2);

  const data = [
    { x: times, y: closes, type: "scatter", mode: "lines", name: "Close",
      line: { color: "#7dd3fc", width: 2 } },
    { x: times, y: ma5, type: "scatter", mode: "lines", name: "5MA",
      line: { color: "#34d399", width: 1 } },
    { x: times, y: ma25, type: "scatter", mode: "lines", name: "25MA",
      line: { color: "#a78bfa", width: 1 } },
    { x: times, y: ma75, type: "scatter", mode: "lines", name: "75MA",
      line: { color: "#f472b6", width: 1 } },
    { x: times, y: bb.upper, type: "scatter", mode: "lines", name: "BB+",
      line: { color: "#94a3b8", width: 1, dash: "dot" } },
    { x: times, y: bb.lower, type: "scatter", mode: "lines", name: "BB-",
      line: { color: "#94a3b8", width: 1, dash: "dot" } },
  ];

  const layout = {
    paper_bgcolor: "#0b1220",
    plot_bgcolor: "#0b1220",
    font: { color: "#e5e7eb" },
    margin: { l: 50, r: 20, t: 10, b: 30 },
    showlegend: true,
    legend: { orientation: "h", y: 1.1 },
    xaxis: { gridcolor: "#1f2937" },
    yaxis: { gridcolor: "#1f2937" },
  };

  Plotly.react(el.priceChart, data, layout, { displayModeBar: false, responsive: true });
}

function buildMacdChart(times, closes) {
  const m = macd(closes);
  const data = [
    { x: times, y: m.hist, type: "bar", name: "Hist",
      marker: { color: m.hist.map(v => v >= 0 ? "#10b981" : "#ef4444") } },
    { x: times, y: m.line, type: "scatter", mode: "lines", name: "MACD",
      line: { color: "#60a5fa", width: 1.5 } },
    { x: times, y: m.signal, type: "scatter", mode: "lines", name: "Signal",
      line: { color: "#f59e0b", width: 1.5 } },
  ];
  const layout = {
    paper_bgcolor: "#0b1220",
    plot_bgcolor: "#0b1220",
    font: { color: "#e5e7eb" },
    margin: { l: 50, r: 20, t: 10, b: 30 },
    showlegend: true,
    legend: { orientation: "h", y: 1.2 },
    xaxis: { gridcolor: "#1f2937" },
    yaxis: { gridcolor: "#1f2937" },
  };
  Plotly.react(el.macdChart, data, layout, { displayModeBar: false, responsive: true });

  return m;
}

// --- データ取得 ---
async function fetchCandles() {
  const r = await fetch(CANDLES_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("candles fetch failed: " + r.status);
  const j = await r.json();
  if (!j.candles || !j.candles.length) throw new Error("no candles");
  return j.candles;
}

async function fetchRate() {
  try {
    const r = await fetch(RATE_URL, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return Number(j.rate ?? j.price ?? j.close);
  } catch {
    return null;
  }
}

// --- 更新 ---
async function update() {
  try {
    el.status && (el.status.textContent = "Loading...");
    const candles = await fetchCandles();
    const times = candles.map(c => c.time);
    const closes = candles.map(c => c.close);

    buildPriceChart(times, closes);
    const m = buildMacdChart(times, closes);

    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2] ?? last;
    const diff = last - prev;
    const pct = (diff / prev) * 100;

    const rsiArr = rsi(closes, 14);
    const rsiLast = rsiArr[rsiArr.length - 1];

    const live = await fetchRate();
    const shown = live ?? last;

    if (el.price) el.price.textContent = shown.toFixed(3);
    if (el.change) {
      const sign = diff >= 0 ? "+" : "";
      el.change.textContent = `${sign}${diff.toFixed(3)} (${sign}${pct.toFixed(2)}%)`;
      el.change.style.color = diff >= 0 ? "#10b981" : "#ef4444";
    }
    if (el.rsi) el.rsi.textContent = rsiLast ? rsiLast.toFixed(1) : "--";

    if (el.signal) {
      const macdNow = m.line[m.line.length - 1];
      const sigNow = m.signal[m.signal.length - 1];
      let sig = "中立";
      if (macdNow > sigNow && rsiLast < 70) sig = "買い";
      else if (macdNow < sigNow && rsiLast > 30) sig = "売り";
      el.signal.textContent = sig;
    }

    el.status && (el.status.textContent = "Ready " + new Date().toLocaleTimeString("ja-JP"));
  } catch (e) {
    console.error(e);
    el.status && (el.status.textContent = "Error: " + e.message);
  }
}

update();
setInterval(update, REFRESH_MS);
