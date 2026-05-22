const state = { charts: { price: null, macd: null }, lastRate: null };

const el = {
  currentRate: document.getElementById('currentRate'),
  dayChange: document.getElementById('dayChange'),
  dayChangePct: document.getElementById('dayChangePct'),
  rsiVal: document.getElementById('rsiVal'),
  rsiText: document.getElementById('rsiText'),
  biasText: document.getElementById('biasText'),
  supportText: document.getElementById('supportText'),
  resistanceText: document.getElementById('resistanceText'),
  priceChart: document.getElementById('priceChart'),
  macdChart: document.getElementById('macdChart')
};

const fmt = n => Number(n).toFixed(3);
const ma = (arr, n) => arr.map((_, i) => i < n - 1 ? null : +(arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n).toFixed(3));
const ema = (arr, n) => { const k = 2 / (n + 1), out = [arr[0]]; let prev = arr[0]; for (let i = 1; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out.push(prev); } return out; };
const calcRSI = (close, period = 14) => { const delta = close.map((v, i) => i === 0 ? 0 : v - close[i - 1]); const gain = delta.map(v => Math.max(v, 0)); const loss = delta.map(v => Math.max(-v, 0)); const avgGain = ma(gain, period); const avgLoss = ma(loss, period); return close.map((_, i) => { if (i < period - 1) return null; const g = avgGain[i], l = avgLoss[i]; if (l === 0) return 100; return +(100 - (100 / (1 + (g / l)))).toFixed(1); }); };
const calcBollinger = (close, period = 20, mult = 2) => { const mid = ma(close, period); const std = close.map((_, i) => { if (i < period - 1) return null; const v = close.slice(i - period + 1, i + 1), m = v.reduce((a, b) => a + b, 0) / period; return Math.sqrt(v.reduce((a, b) => a + Math.pow(b - m, 2), 0) / period); }); return { mid, up: close.map((_, i) => std[i] == null ? null : +(mid[i] + mult * std[i]).toFixed(3)), low: close.map((_, i) => std[i] == null ? null : +(mid[i] - mult * std[i]).toFixed(3)) }; };
const calcMACD = close => { const ema12 = ema(close, 12), ema26 = ema(close, 26); const macd = close.map((_, i) => +(ema12[i] - ema26[i]).toFixed(5)); const signal = ema(macd, 9).map(v => +v.toFixed(5)); const hist = macd.map((v, i) => +(v - signal[i]).toFixed(5)); return { macd, signal, hist } };

function buildCandles(rate) {
  const now = new Date();
  const base = rate ?? 159.2;
  const out = [];
  for (let i = 119; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60 * 60 * 1000);
    const trend = (120 - i) * 0.0065;
    const wave = Math.sin((120 - i) / 4) * 0.05 + Math.cos((120 - i) / 11) * 0.03;
    const c = +(base + trend + wave).toFixed(3);
    const o = +(c - 0.01 + Math.sin(i) * 0.006).toFixed(3);
    const h = +(Math.max(o, c) + 0.05).toFixed(3);
    const l = +(Math.min(o, c) - 0.05).toFixed(3);
    out.push({ x: t.toISOString().slice(5, 16).replace('T', ' '), o, h, l, c });
  }
  return out;
}

async function fetchRate() {
  const r = await fetch('/api/rate', { cache: 'no-store' });
  if (!r.ok) throw new Error(`rate api ${r.status}`);
  return r.json();
}

function render(rate) {
  const candles = buildCandles(rate);
  const close = candles.map(d => d.c);
  const ma5 = ma(close, 5), ma25 = ma(close, 25), ma75 = ma(close, 75), ma200 = ma(close, 100);
  const bb = calcBollinger(close, 20, 2);
  const rsi = calcRSI(close, 14);
  const macd = calcMACD(close);
  const latest = close.at(-1), prev = close.at(-2);
  const change = latest - prev;
  const pct = (change / prev) * 100;
  const bias = (rsi.at(-1) >= 70) ? 'ショート優勢' : (rsi.at(-1) <= 30 ? 'ロング優勢' : (macd.hist.at(-1) >= 0 ? 'ロング優勢' : 'ショート優勢'));
  const biasClass = bias === 'ロング優勢' ? 'badge' : 'badge short';

  el.currentRate.textContent = fmt(latest);
  el.dayChange.textContent = `${change >= 0 ? '+' : ''}${fmt(change)}`;
  el.dayChangePct.textContent = `${change >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  el.rsiVal.textContent = rsi.at(-1)?.toFixed(1) ?? '--';
  el.rsiText.textContent = rsi.at(-1) >= 70 ? '買われすぎ' : rsi.at(-1) <= 30 ? '売られすぎ' : '中立';
  el.biasText.innerHTML = `<span class="${biasClass}">${bias}</span>`;

  const support = Math.min(...close.slice(-24)) - 0.04;
  const resistance = Math.max(...close.slice(-24)) + 0.04;
  el.supportText.textContent = fmt(support);
  el.resistanceText.textContent = fmt(resistance);

  if (state.charts.price) state.charts.price.destroy();
  if (state.charts.macd) state.charts.macd.destroy();

  const labels = candles.map(d => d.x);
  state.charts.price = new Chart(el.priceChart.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Close', data: close, borderColor: '#4ea1ff', backgroundColor: 'rgba(78,161,255,.10)', tension: .28, fill: true, pointRadius: 0, borderWidth: 2 },
        { label: '5MA', data: ma5, borderColor: '#31d27c', pointRadius: 0, borderWidth: 1.5 },
        { label: '25MA', data: ma25, borderColor: '#f5c451', pointRadius: 0, borderWidth: 1.5 },
        { label: '75MA', data: ma75, borderColor: '#a855f7', pointRadius: 0, borderWidth: 1.5 },
        { label: '200MA', data: ma200, borderColor: '#ff6b6b', pointRadius: 0, borderWidth: 1.5 },
        { label: 'BB上', data: bb.up, borderColor: '#8ea0ba', borderDash: [6,4], pointRadius: 0, borderWidth: 1 },
        { label: 'BB中', data: bb.mid, borderColor: '#d7e3f7', borderDash: [4,4], pointRadius: 0, borderWidth: 1 },
        { label: 'BB下', data: bb.low, borderColor: '#8ea0ba', borderDash: [6,4], pointRadius: 0, borderWidth: 1 },
        { label: 'Support', data: labels.map(() => support), borderColor: '#31d27c', borderDash: [8,4], pointRadius: 0, borderWidth: 1 },
        { label: 'Resistance', data: labels.map(() => resistance), borderColor: '#ff6b6b', borderDash: [8,4], pointRadius: 0, borderWidth: 1 },
        { label: '+20pips', data: labels.map(() => latest + 0.20), borderColor: '#8cc8ff', borderDash: [2,4], pointRadius: 0, borderWidth: 1 },
        { label: '-20pips', data: labels.map(() => latest - 0.20), borderColor: '#ff9bb2', borderDash: [2,4], pointRadius: 0, borderWidth: 1 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#cfe0f7' } } },
      scales: {
        x: { ticks: { color: '#8ea0ba', maxRotation: 0, autoSkip: true } },
        y: { ticks: { color: '#8ea0ba' }, grid: { color: 'rgba(35,50,74,.35)' } }
      }
    }
  });

  state.charts.macd = new Chart(el.macdChart.getContext('2d'), {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Hist', data: macd.hist, backgroundColor: 'rgba(49,210,124,.45)', borderColor: '#31d27c' },
        { type: 'line', label: 'MACD', data: macd.macd, borderColor: '#4ea1ff', pointRadius: 0, borderWidth: 2, tension: .25 },
        { type: 'line', label: 'Signal', data: macd.signal, borderColor: '#f5c451', pointRadius: 0, borderWidth: 2, tension: .25 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: '#cfe0f7' } } },
      scales: {
        x: { ticks: { color: '#8ea0ba', maxRotation: 0, autoSkip: true } },
        y: { ticks: { color: '#8ea0ba' }, grid: { color: 'rgba(35,50,74,.35)' } }
      }
    }
  });
}

async function refresh() {
  try {
    const data = await fetchRate();
    const rate = Number(data.rate);
    state.lastRate = Number.isFinite(rate) ? rate : state.lastRate;
    render(state.lastRate ?? 159.2);
  } catch {
    render(state.lastRate ?? 159.2);
  }
}

function boot() {
  if (!window.Chart) return;
  Chart.defaults.color = '#cfe0f7';
  Chart.defaults.borderColor = 'rgba(35,50,74,.35)';
  Chart.defaults.plugins.legend.position = 'top';
  refresh();
  setInterval(refresh, 15000);
}

window.addEventListener('DOMContentLoaded', boot);
