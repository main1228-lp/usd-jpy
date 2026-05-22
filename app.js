const state = {
  charts: { price: null, macd: null },
  lastRate: null,
  lastEvents: [],
  busyRate: false,
  busyEvents: false,
  timers: { rate: null, events: null }
};

const el = {
  currentRate: document.getElementById('currentRate'),
  dayChange: document.getElementById('dayChange'),
  dayChangePct: document.getElementById('dayChangePct'),
  rsiVal: document.getElementById('rsiVal'),
  rsiText: document.getElementById('rsiText'),
  biasText: document.getElementById('biasText'),
  supportText: document.getElementById('supportText'),
  resistanceText: document.getElementById('resistanceText'),
  eventList: document.getElementById('eventList'),
  priceChart: document.getElementById('priceChart'),
  macdChart: document.getElementById('macdChart')
};

const ma = (arr, n) => arr.map((_, i) => i < n - 1 ? null : +(arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n).toFixed(3));
const ema = (arr, n) => {
  const k = 2 / (n + 1), out = [arr[0]];
  let prev = arr[0];
  for (let i = 1; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out.push(prev); }
  return out;
};
const calcRSI = (close, period = 14) => {
  const delta = close.map((v, i) => i === 0 ? 0 : v - close[i - 1]);
  const gain = delta.map(v => Math.max(v, 0));
  const loss = delta.map(v => Math.max(-v, 0));
  const avgGain = ma(gain, period);
  const avgLoss = ma(loss, period);
  return close.map((_, i) => {
    if (i < period - 1) return null;
    const g = avgGain[i], l = avgLoss[i];
    if (l === 0) return 100;
    return +(100 - (100 / (1 + (g / l)))).toFixed(1);
  });
};
const calcBollinger = (close, period = 20, mult = 2) => {
  const mid = ma(close, period);
  const std = close.map((_, i) => {
    if (i < period - 1) return null;
    const v = close.slice(i - period + 1, i + 1), m = v.reduce((a, b) => a + b, 0) / period;
    return Math.sqrt(v.reduce((a, b) => a + Math.pow(b - m, 2), 0) / period);
  });
  return {
    mid,
    up: close.map((_, i) => std[i] == null ? null : +(mid[i] + mult * std[i]).toFixed(3)),
    low: close.map((_, i) => std[i] == null ? null : +(mid[i] - mult * std[i]).toFixed(3))
  };
};
const calcMACD = close => {
  const ema12 = ema(close, 12), ema26 = ema(close, 26);
  const macd = close.map((_, i) => +(ema12[i] - ema26[i]).toFixed(5));
  const signal = ema(macd, 9).map(v => +v.toFixed(5));
  const hist = macd.map((v, i) => +(v - signal[i]).toFixed(5));
  return { macd, signal, hist };
};

function buildFallbackCandles(rate) {
  const now = new Date(), out = [], base = rate || 159.2;
  for (let i = 29; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 4 * 60 * 60 * 1000);
    const drift = (30 - i) * 0.018, wave = Math.sin((30 - i) / 3) * 0.04;
    const c = +(base + drift + wave).toFixed(3);
    const o = +(c - 0.012 + Math.sin(i) * 0.01).toFixed(3);
    const h = +(Math.max(o, c) + 0.06).toFixed(3);
    const l = +(Math.min(o, c) - 0.06).toFixed(3);
    out.push({ x: t.toISOString().slice(0, 19).replace('T', ' '), o, h, l, c });
  }
  return out;
}

async function fetchFXRate() {
  const res = await fetch('/api/rate', { cache: 'no-store' });
  if (!res.ok) throw new Error(`FX API ${res.status}`);
  const json = await res.json();
  const rate = json?.rate;
  if (!rate) throw new Error('JPY rate missing');
  return rate;
}

async function fetchEconomicCalendar() {
  const res = await fetch('/api/calendar', { cache: 'no-store' });
  if (!res.ok) throw new Error(`ECON API ${res.status}`);
  const json = await res.json();
  const todayJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  return json
    .filter(e => {
      const c = e.Country || e.country;
      const imp = e.Importance || e.importance || e.economicImpact;
      const dt = e.Date || e.date || e.datetime;
      if (!(c === 'United States' || c === 'Japan')) return false;
      if (Number(imp) !== 3) return false;
      if (!dt) return false;
      return new Date(dt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) === todayJST;
    })
    .map(e => {
      const country = (e.Country || e.country) === 'United States' ? 'US' : 'JP';
      const dt = e.Date || e.date || e.datetime;
      const name = e.Event || e.event || e.report_name || 'Economic Event';
      return {
        time: dt ? new Date(dt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '--:--',
        country,
        name,
        note: (e.Forecast || e.forecast) ? `予想: ${e.Forecast || e.forecast}` : '',
        cls: country === 'US' ? 'usd' : 'jpy'
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

function renderEvents(events) {
  if (!events.length) {
    el.eventList.innerHTML = '<div class="small">本日の高重要度イベントは取得できませんでした。</div>';
    return;
  }
  el.eventList.innerHTML = events.map(e => `
    <div class="event">
      <div class="event-top">
        <div>
          <div class="time">${e.time}</div>
          <div class="country">${e.country}</div>
        </div>
        <div class="impact ${e.cls}">★★★</div>
      </div>
      <div class="event-name">${e.name}</div>
      <div class="event-note">${e.note || ''}</div>
    </div>
  `).join('');
}

function updateKpis(candles, rsi, macd, signal) {
  const close = candles.map(d => d.c);
  const current = close[close.length - 1];
  const prev = close[close.length - 2];
  const chg = +(current - prev).toFixed(3);
  const chgPct = +((chg / prev) * 100).toFixed(2);
  const rsiLast = rsi[rsi.length - 1];
  const ma25 = ma(close, 25);
  const bias = (current > (ma25[ma25.length - 1] || current) && macd[macd.length - 1] > signal[signal.length - 1] && rsiLast >= 50)
    ? 'ロング優勢'
    : 'ショート優勢';

  el.currentRate.textContent = current.toFixed(3);
  el.dayChange.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(3);
  el.dayChange.style.color = chg >= 0 ? 'var(--up)' : 'var(--down)';
  el.dayChangePct.textContent = (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%';
  el.dayChangePct.style.color = chg >= 0 ? 'var(--up)' : 'var(--down)';
  el.rsiVal.textContent = rsiLast.toFixed(1);
  el.rsiText.textContent = rsiLast >= 70 ? '買われすぎ' : rsiLast <= 30 ? '売られすぎ' : '中立';
  el.biasText.innerHTML = `<span class="badge ${bias.includes('ショート') ? 'short' : ''}">${bias}</span>`;
  el.supportText.textContent = [(current - 0.10).toFixed(3), (current - 0.25).toFixed(3), (current - 0.45).toFixed(3)].join(' / ');
  el.resistanceText.textContent = [(current + 0.10).toFixed(3), (current + 0.25).toFixed(3), (current + 0.45).toFixed(3)].join(' / ');
}

function buildCharts(candles) {
  const labels = candles.map(d => d.x);
  const close = candles.map(d => d.c);
  const ma5 = ma(close, 5);
  const ma25 = ma(close, 25);
  const ma75 = ma(close, 75);
  const ma200 = ma(close, 200);
  const rsi = calcRSI(close, 14);
  const bb = calcBollinger(close, 20, 2);
  const { macd, signal, hist } = calcMACD(close);
  const zoneLow = close[close.length - 1] - 0.10;
  const zoneHigh = close[close.length - 1] + 0.10;

  state.charts.price?.destroy();
  state.charts.macd?.destroy();

  state.charts.price = new Chart(el.priceChart, {
    type: 'candlestick',
    data: {
      datasets: [
        { label: 'USD/JPY', data: candles, color: { up: '#22c55e', down: '#ef4444', unchanged: '#94a3b8' }, borderColor: { up: '#22c55e', down: '#ef4444', unchanged: '#94a3b8' } },
        { type: 'line', label: '5MA', data: ma5.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: '#60a5fa', pointRadius: 0, tension: .25, spanGaps: true },
        { type: 'line', label: '25MA', data: ma25.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: '#f59e0b', pointRadius: 0, tension: .25, spanGaps: true },
        { type: 'line', label: '75MA', data: ma75.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: '#22c55e', pointRadius: 0, tension: .25, spanGaps: true },
        { type: 'line', label: '200MA', data: ma200.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: '#e879f9', pointRadius: 0, tension: .25, spanGaps: true },
        { type: 'line', label: 'BB上限', data: bb.up.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: 'rgba(168,85,247,.95)', pointRadius: 0, borderDash: [6, 4], tension: .2, spanGaps: true },
        { type: 'line', label: 'BB中心', data: bb.mid.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: 'rgba(168,85,247,.55)', pointRadius: 0, borderDash: [3, 4], tension: .2, spanGaps: true },
        { type: 'line', label: 'BB下限', data: bb.low.map((v, i) => ({ x: labels[i], y: v })).filter(d => d.y != null), borderColor: 'rgba(168,85,247,.95)', pointRadius: 0, borderDash: [6, 4], tension: .2, spanGaps: true }
      ]
    },
    options: {
      parsing: false,
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: '#cbd5e1' } },
        annotation: {
          annotations: {
            zone: {
              type: 'box',
              xMin: labels[Math.max(0, labels.length - 4)],
              xMax: labels[labels.length - 1],
              yMin: zoneLow,
              yMax: zoneHigh,
              backgroundColor: 'rgba(96,165,250,.12)',
              borderColor: 'rgba(96,165,250,.35)'
            }
          }
        }
      },
      scales: {
        x: { type: 'time', ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } }
      }
    }
  });

  state.charts.macd = new Chart(el.macdChart, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Hist', data: hist, backgroundColor: hist.map(v => v >= 0 ? 'rgba(34,197,94,.65)' : 'rgba(239,68,68,.65)'), borderWidth: 0 },
        { type: 'line', label: 'MACD', data: macd, borderColor: '#60a5fa', pointRadius: 0, tension: .25 },
        { type: 'line', label: 'Signal', data: signal, borderColor: '#f59e0b', pointRadius: 0, tension: .25 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { labels: { color: '#cbd5e1' } } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.12)' } }
      }
    }
  });

  updateKpis(candles, rsi, macd, signal);
}

async function refreshRate() {
  if (state.busyRate) return;
  state.busyRate = true;
  try {
    const r = await fetch('/api/rate', { cache: 'no-store' });
    if (!r.ok) throw new Error(`FX API ${r.status}`);
    const json = await r.json();
    state.lastRate = json.rate;
    buildCharts(buildFallbackCandles(json.rate));
  } catch (e) {
    console.warn('rate refresh failed', e);
  } finally {
    state.busyRate = false;
  }
}

async function refreshEvents() {
  if (state.busyEvents) return;
  state.busyEvents = true;
  try {
    const r = await fetch('/api/calendar', { cache: 'no-store' });
    if (!r.ok) throw new Error(`ECON API ${r.status}`);
    const events = await r.json();
    const todayJST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const filtered = events
      .filter(e => {
        const c = e.Country || e.country;
        const imp = e.Importance || e.importance || e.economicImpact;
        const dt = e.Date || e.date || e.datetime;
        if (!(c === 'United States' || c === 'Japan')) return false;
        if (Number(imp) !== 3) return false;
        if (!dt) return false;
        return new Date(dt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) === todayJST;
      })
      .map(e => {
        const country = (e.Country || e.country) === 'United States' ? 'US' : 'JP';
        const dt = e.Date || e.date || e.datetime;
        const name = e.Event || e.event || e.report_name || 'Economic Event';
        return {
          time: dt ? new Date(dt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '--:--',
          country,
          name,
          note: (e.Forecast || e.forecast) ? `予想: ${e.Forecast || e.forecast}` : '',
          cls: country === 'US' ? 'usd' : 'jpy'
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time));

    state.lastEvents = filtered;
    renderEvents(filtered);
  } catch (e) {
    console.warn('events refresh failed', e);
    if (!state.lastEvents.length) renderEvents([]);
  } finally {
    state.busyEvents = false;
  }
}

function init() {
  Chart.defaults.color = '#cbd5e1';
  Chart.defaults.borderColor = 'rgba(148,163,184,.12)';
  Chart.defaults.plugins.legend.position = 'top';

  const seed = buildFallbackCandles(state.lastRate || 159.2);
  buildCharts(seed);
  renderEvents([]);

  refreshRate();
  refreshEvents();

  state.timers.rate = setInterval(refreshRate, 15000);
  state.timers.events = setInterval(refreshEvents, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshRate();
      refreshEvents();
    }
  });
}

init();
