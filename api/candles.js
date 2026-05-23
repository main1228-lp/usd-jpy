// Twelve Data から USD/JPY の実ローソク足を取得する Vercel Serverless Function
// 使い方: /api/candles?interval=15min  (1min, 5min, 15min, 30min, 1h, 1day などに対応)

export default async function handler(req, res) {
  try {
    const interval = (req.query.interval || "15min").toString();
    const outputsize = (req.query.outputsize || "200").toString();

    const allowed = ["1min", "5min", "15min", "30min", "45min", "1h", "2h", "4h", "1day"];
    if (!allowed.includes(interval)) {
      return res.status(400).json({ error: "invalid interval", allowed });
    }

    const apiKey = process.env.TWELVE_DATA_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "TWELVE_DATA_KEY is not set" });
    }

    const url =
      "https://api.twelvedata.com/time_series" +
      "?symbol=USD/JPY" +
      `&interval=${encodeURIComponent(interval)}` +
      `&outputsize=${encodeURIComponent(outputsize)}` +
      "&format=JSON" +
      `&apikey=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url);
    const data = await r.json();

    if (data.status === "error" || !Array.isArray(data.values)) {
      return res.status(502).json({
        error: "twelvedata error",
        detail: data.message || data
      });
    }

    // Twelve Data は新しい順で返るので、古い順に並べ替える
    const candles = data.values
      .map((v) => ({
        time: v.datetime,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close)
      }))
      .reverse();

    // ブラウザにも軽くキャッシュさせて無料枠を節約
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({
      symbol: "USD/JPY",
      interval,
      candles
    });
  } catch (e) {
    return res.status(500).json({ error: "server error", detail: String(e) });
  }
}
