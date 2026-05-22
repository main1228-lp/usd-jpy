export default async function handler(req, res) {
  try {
    const r = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=JPY');
    if (!r.ok) throw new Error(`Upstream ${r.status}`);
    const j = await r.json();
    const rate = j?.rates?.JPY;
    if (!rate) throw new Error('JPY rate missing');

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ rate });
  } catch (err) {
    res.status(500).json({ error: 'rate fetch failed', detail: String(err) });
  }
}
