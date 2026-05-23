// /api/strength.js  — 通貨強弱（24h変化率）
export default async function handler(req, res){
  const KEY = process.env.TWELVE_DATA_API_KEY;
  if(!KEY){ res.status(500).json({error:"No API key (TWELVE_DATA_API_KEY)"}); return; }

  const pairs = [
    "USD/JPY","EUR/USD","GBP/USD","AUD/USD",
    "EUR/JPY","GBP/JPY","AUD/JPY","EUR/GBP","EUR/AUD"
  ];
  const symbol = pairs.join(",");
  const url = "https://api.twelvedata.com/quote?symbol="
    + encodeURIComponent(symbol) + "&apikey=" + KEY;

  try{
    const r = await fetch(url);
    const j = await r.json();

    // 1行から percent_change を取り出す（複数フォーマットに対応）
    const pick = function(row){
      if(!row || typeof row !== "object") return null;
      if(row.percent_change != null) return Number(row.percent_change);
      if(row.change != null && row.previous_close){
        return (Number(row.change)/Number(row.previous_close))*100;
      }
      if(row.close != null && row.previous_close){
        return ((Number(row.close)-Number(row.previous_close))/Number(row.previous_close))*100;
      }
      return null;
    };

    const changes = {};

    // ケース1: 配列で返ってくる
    if(Array.isArray(j)){
      j.forEach(function(row){
        if(row && row.symbol) changes[row.symbol] = pick(row);
      });
    }
    // ケース2: オブジェクトで返ってくる
    else if(j && typeof j === "object"){
      // 単一シンボル（symbolキーあり）
      if(j.symbol && j.percent_change != null){
        changes[j.symbol] = pick(j);
      }
      // 複数シンボル: キーが "USD/JPY" / "USDJPY" / "USD_JPY" の可能性
      pairs.forEach(function(p){
        const candidates = [p, p.replace("/",""), p.replace("/","_")];
        for(let i=0;i<candidates.length;i++){
          const row = j[candidates[i]];
          if(row && typeof row === "object"){
            const v = pick(row);
            if(v != null){ changes[p] = v; break; }
          }
        }
      });
    }

    // 通貨ごとの平均強さ（合算）
    const map = {
      USD: ["USD/JPY","-EUR/USD","-GBP/USD","-AUD/USD"],
      JPY: ["-USD/JPY","-EUR/JPY","-GBP/JPY","-AUD/JPY"],
      EUR: ["EUR/USD","EUR/JPY","EUR/GBP","EUR/AUD"],
      GBP: ["GBP/USD","GBP/JPY","-EUR/GBP"],
      AUD: ["AUD/USD","AUD/JPY","-EUR/AUD"]
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
    // デバッグ情報も一緒に返す
    res.status(200).json({
      strength: result,
      raw: changes,
      debug: {
        topLevelKeys: j && typeof j==="object" ? Object.keys(j).slice(0,15) : null,
        isArray: Array.isArray(j),
        sample: j && typeof j==="object" ? (Array.isArray(j) ? j[0] : j[Object.keys(j)[0]]) : null,
        apiStatus: j && j.status ? j.status : null,
        apiMessage: j && j.message ? j.message : null
      }
    });
  }catch(e){
    res.status(500).json({ error: String(e) });
  }
}
