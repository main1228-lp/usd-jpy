// /api/strength.js  — 通貨強弱（24h変化率）8ペア版
export default async function handler(req, res){
  const KEY = process.env.TWELVE_DATA_KEY;
  if(!KEY){ res.status(500).json({error:"No API key (TWELVE_DATA_KEY)"}); return; }

  const pairs = [
    "USD/JPY","EUR/USD","GBP/USD","AUD/USD",
    "EUR/JPY","GBP/JPY","AUD/JPY","EUR/GBP"
  ]; // 8ペアに削減（無料プラン対応）
  const symbol = pairs.join(",");
  const url = "https://api.twelvedata.com/quote?symbol="
    + encodeURIComponent(symbol) + "&apikey=" + KEY;

  try{
    const r = await fetch(url);
    const j = await r.json();

    const pick = function(row){
      if(!row || typeof row !== "object") return null;
      if(row.percent_change != null) return Number(row.percent_change);
      if(row.change != null && row.previous_close){
        return (Number(row.change)/Number(row.previous_close))*100;
      }
      return null;
    };

    const changes = {};
    if(Array.isArray(j)){
      j.forEach(function(row){ if(row && row.symbol) changes[row.symbol] = pick(row); });
    }else if(j && typeof j === "object"){
      if(j.symbol && j.percent_change != null) changes[j.symbol] = pick(j);
      pairs.forEach(function(p){
        const cands = [p, p.replace("/",""), p.replace("/","_")];
        for(let i=0;i<cands.length;i++){
          const row = j[cands[i]];
          if(row && typeof row === "object"){
            const v = pick(row);
            if(v != null){ changes[p] = v; break; }
          }
        }
      });
    }

    const map = {
      USD: ["USD/JPY","-EUR/USD","-GBP/USD","-AUD/USD"],
      JPY: ["-USD/JPY","-EUR/JPY","-GBP/JPY","-AUD/JPY"],
      EUR: ["EUR/USD","EUR/JPY","EUR/GBP"],
      GBP: ["GBP/USD","GBP/JPY","-EUR/GBP"],
      AUD: ["AUD/USD","AUD/JPY"]
    };
    const result = {};
    Object.keys(map).forEach(function(cur){
      let sum=0, n=0;
      map[cur].forEach(function(p){
        const inv = p.startsWith("-");
        const key = inv ? p.slice(1) : p;
        const v = changes[key];
        if(v != null && isFinite(v)){ sum += inv ? -v : v; n++; }
      });
      result[cur] = n ? +(sum/n).toFixed(3) : null;
    });

    res.setHeader("Cache-Control","s-maxage=60");
    res.status(200).json({
      strength: result,
      raw: changes,
      debug: {
        apiStatus: j && j.status ? j.status : null,
        apiMessage: j && j.message ? j.message : null
      }
    });
  }catch(e){
    res.status(500).json({ error: String(e) });
  }
}
