export default async function handler(req, res) {
  try {
    const key = process.env.TE_API_KEY;
    if (!key) {
      res.status(500).json({ error: 'TE_API_KEY is not set' });
      return;
    }

    const url = `https://api.tradingeconomics.com/calendar?c=${encodeURIComponent(key)}&f=json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Upstream ${r.status}`);
    const j = await r.json();

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(j);
  } catch (err) {
    res.status(500).json({ error: 'calendar fetch failed', detail: String(err) });
  }
}
