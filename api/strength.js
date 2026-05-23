// /api/strength.js  — 通貨強弱（24h変化率）
export default async function handler(req, res){
  const KEY = process.env.TWELVE_DATA_API_KEY;
  const pairs = [
    "USD/JPY","EUR/USD","GBP/USD","AUD/USD",
    "EUR/JPY","GBP/JPY","AUD/JPY","EUR/GBP","EUR/AUD"
  ];
  const symbol = pairs.join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${KEY}`;
  try{
    const r = await fetch(url);
    const j = await r.json();
    const changes = {};
    pairs.forEach(p=>{
      const row = j[p] || j[p.replace("/","")] || null;
      if(row && row.percent_change!=null){
        changes[p] = Number(row.percent_change);
      }
    });
    // 通貨ごとの平均強さ
    const map = {
      USD: ["USD/JPY","-EUR/USD","-GBP/USD","-AUD/USD"],
      JPY: ["-USD/JPY","-EUR/JPY","-GBP/JPY","-AUD/JPY"],
      EUR: ["EUR/USD","EUR/JPY","EUR/GBP","EUR/AUD"],
      GBP: ["GBP/USD","GBP/JPY","-EUR/GBP"],
      AUD: ["AUD/USD","AUD/JPY","-EUR/AUD"]
    };
    const result = {};
    Object.keys(map).forEach(cur=>{
      let sum=0, n=0;
      map[cur].forEach(p=>{
        const inv = p.startsWith("-");
        const key = inv ? p.slice(1) : p;
        const v = changes[key];
        if(v!=null){ sum += inv ? -v : v; n++; }
      });
      result[cur] = n ? +(sum/n).toFixed(3) : null;
    });
    res.setHeader("Cache-Control","s-maxage=60");
    res.status(200).json({ strength: result, raw: changes });
  }catch(e){
    res.status(500).json({ error: String(e) });
  }
}
