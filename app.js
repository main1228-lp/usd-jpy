// USD/JPY ダッシュボード（Twelve Data 実ローソク足 + Chart.js）
// 取得元: /api/candles?interval=15min   /api/rate（現在レート, 任意）

const CANDLES_URL = "/api/candles?interval=15min&outputsize=200";
const RATE_URL = "/api/rate";
const REFRESH_MS = 3 * 60 * 1000; // 3分ごと

const $ = (id) => document.getElementById(id);
const el = {
  currentRate: $("currentRate"),
  dayChange: $("dayChange"),
  dayChangePct: $("dayChangePct"),
  rsiVal: $("rsiVal"),
  rsiText: $("rsiText"),
  biasText: $("biasText"),
  supportText: $("supportText"),
  resistanceText: $("resistanceText"),
  priceCanvas: $("priceChart"),
  macdCanvas: $("macdChart"),
};

let priceChart, macdChart;

// ===== 指標 =====
function sma(arr, p) {
  const out = Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= p) s -= arr[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}
function ema(arr, p) {
  const out = Array(arr.length).fill(null);
  const k = 2 / (p + 1);
  let prev = arr[0];
  out[0] = prev;
  for (let i = 1; i < arr.length; i++) {
    prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsi(arr, p = 14) {
  const out = Array(arr.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    const gg = Math.max(d, 0), ll = Math.max(-d, 0);
    if (i <= p) {
      g += gg; l += ll;
      if (i === p) out[i] = 100 - 100 / (1 + g / (l || 1e-9));
    } else {
      g = (g * (p - 1) + gg) / p;
      l = (l * (p - 1) + ll) / p;
      out[i] = 100 - 100 / (1 + g / (l || 1e-9));
    }
  }
  return out;
}
function macdCalc(arr) {
  const e12 = ema(arr, 12);
  const e26 = ema(arr, 26);
  const line = arr.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}
function bollinger(arr, p = 20, m = 2) {
  const mid = sma(arr, p);
  const up = Array(arr.length).fill(null);
  const lo = Array(arr.length).fill(null);
  for (let i = p - 1; i < arr.length; i++) {
    const sl = arr.slice(i - p + 1, i + 1);
    const a = mid[i];
    const v = sl.reduce((s, x) => s + (x - a) ** 2, 0) / p;
    const sd = Math.sqrt(v);
    up[i] = a + m * sd;
    lo[i] = a - m * sd;
  }
  return { mid, up, lo };
}

// ===== 取得 =====
async function fetchCandles() {
  const r = await fetch(CANDLES_URL, { cache: "no-store" });
  const j = await r.json();
  if (!j.candles || !j.candles.length) throw new Error("no candles");
  return j.candles;
}
async function fetchRate() {
  try {
    const r = await fetch(RATE_URL, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    const v = Number(j.rate ?? j.price ?? j.close);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// ===== 描画 =====
const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: "index", intersect: false },
  plugins: { legend: { labels: { color: "#cdd9ee" } }, tooltip: { mode: "index" } },
  scales: {
    x: { ticks: { color: "#8ea0ba", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
         grid: { color: "rgba(255,255,255,0.05)" } },
    y: { ticks: { color: "#8ea0ba" }, grid: { color: "rgba(255,255,255,0.05)" } },
  },
};

function drawPrice(times, closes) {
  const bb = bollinger(closes, 20, 2);
  const ma5 = sma(closes, 5);
  const ma25 = sma(closes, 25);
  const ma75 = sma(closes, 75);

  const data = {
    labels: times,
    datasets: [
      { label: "Close", data: closes, borderColor: "#8cc8ff", backgroundColor: "rgba(140,200,255,.08)", borderWidth: 2, pointRadius: 0, tension: 0.15, fill: false },
      { label: "5MA", data: ma5, borderColor: "#31d27c", borderWidth: 1, pointRadius: 0 },
      { label: "25MA", data: ma25, borderColor: "#f5c451", borderWidth: 1, pointRadius: 0 },
      { label: "75MA", data: ma75, borderColor: "#ff8aa5", borderWidth: 1, pointRadius: 0 },
      { label: "BB+", data: bb.up, borderColor: "rgba(180,200,230,.6)", borderWidth: 1, pointRadius: 0, borderDash: [4, 4] },
      { label: "BB-", data: bb.lo, borderColor: "rgba(180,200,230,.6)", borderWidth: 1, pointRadius: 0, borderDash: [4, 4] },
    ],
  };
  if (priceChart) {
    priceChart.data = data;
    priceChart.update();
  } else {
    priceChart = new Chart(el.priceCanvas, { type: "line", data, options: baseOpts });
  }
}

function drawMacd(times, closes) {
  const m = macdCalc(closes);
  const data = {
    labels: times,
    datasets: [
      { type: "bar", label: "Hist", data: m.hist,
        backgroundColor: m.hist.map(v => (v ?? 0) >= 0 ? "rgba(49,210,124,.6)" : "rgba(255,107,107,.6)") },
      { type: "line", label: "MACD", data: m.line, borderColor: "#4ea1ff", borderWidth: 1.5, pointRadius: 0 },
      { type: "line", label: "Signal", data: m.signal, borderColor: "#f5c451", borderWidth: 1.5, pointRadius: 0 },
    ],
  };
  if (macdChart) {
    macdChart.data = data;
    macdChart.update();
  } else {
    macdChart = new Chart(el.macdCanvas, { data, options: baseOpts });
  }
  return m;
}

// ===== サポレジ簡易計算 =====
function supportResistance(highs, lows, lastClose) {
  const window = Math.min(96, highs.length); // 直近96本(15min×96 ≒ 1日)
  const hSlice = highs.slice(-window);
  const lSlice = lows.slice(-window);
  const maxH = Math.max(...hSlice);
  const minL = Math.min(...lSlice);
  const pivot = (maxH + minL + lastClose) / 3;
  const r1 = 2 * pivot - minL;
  const s1 = 2 * pivot - maxH;
  return { support: Math.min(s1, minL), resistance: Math.max(r1, maxH) };
}

// ===== 更新 =====
async function update() {
  try {
    const candles = await fetchCandles();
    const times = candles.map(c => c.time.slice(5, 16)); // MM-DD HH:MM
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    drawPrice(times, closes);
    const m = drawMacd(times, closes);

    const last = closes[closes.length - 1];
    const prev24 = closes[Math.max(0, closes.length - 96 - 1)] ?? closes[0];
    const diff = last - prev24;
    const pct = (diff / prev24) * 100;

    const live = await fetchRate();
    const shown = live ?? last;
    el.currentRate.textContent = shown.toFixed(3);
    const sign = diff >= 0 ? "+" : "";
    el.dayChange.textContent = `${sign}${diff.toFixed(3)}`;
    el.dayChange.style.color = diff >= 0 ? "#31d27c" : "#ff6b6b";
    el.dayChangePct.textContent = `${sign}${pct.toFixed(2)}%`;

    const rsiArr = rsi(closes, 14);
    const rsiLast = rsiArr[rsiArr.length - 1];
    el.rsiVal.textContent = rsiLast ? rsiLast.toFixed(1) : "--";
    el.rsiText.textContent = rsiLast > 70 ? "買われすぎ" : rsiLast < 30 ? "売られすぎ" : "中立";

    const macdNow = m.line[m.line.length - 1];
    const sigNow = m.signal[m.signal.length - 1];
    let bias = "中立";
    if (macdNow > sigNow && rsiLast < 70) bias = "買い優勢";
    else if (macdNow < sigNow && rsiLast > 30) bias = "売り優勢";
    el.biasText.textContent = bias;

    const sr = supportResistance(highs, lows, last);
    el.supportText.textContent = sr.support.toFixed(3);
    el.resistanceText.textContent = sr.resistance.toFixed(3);
  } catch (e) {
    console.error(e);
    el.currentRate.textContent = "Err";
  }
}

update();
setInterval(update, REFRESH_MS);
