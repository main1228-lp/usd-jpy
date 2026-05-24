// USD/JPY ダッシュボード 安定復旧版 + API節約版 + タブ切替デバウンス
const RATE_URL = "/api/rate";
const REFRESH_MS = 10 * 60 * 1000;
const STRENGTH_REFRESH_MS = 30 * 60 * 1000;

let currentTF = "5min";
let lastStrengthFetch = 0;
let cachedStrength = null;
let tfSwitchTimer = null;
let lastTFUpdateAt = 0;
const TF_SWITCH_DEBOUNCE_MS = 800;
const TF_SWITCH_MIN_GAP_MS = 3000;

const TF_BARS_PER_DAY = { "5min":288, "1h":24, "4h":6, "1day":1 };

const $ = function(id){ return document.getElementById(id); };
const el = {
  dayChange: $("dayChange"),
  dayChangePct: $("dayChangePct"),
  rsiVal: $("rsiVal"),
  rsiText: $("rsiText"),
  biasText: $("biasText"),
  priceCanvas: $("priceChart"),
  macdCanvas: $("macdChart"),
  pills: $("intervalPills")
};
let priceChart, macdChart;

function sma(a,p){
  const o=Array(a.length).fill(null);
  let s=0;
  for(let i=0;i<a.length;i++){
    s+=a[i];
    if(i>=p)s-=a[i-p];
    if(i>=p-1)o[i]=s/p;
  }
  return o;
}

function ema(a,p){
  const o=Array(a.length).fill(null);
  const k=2/(p+1);
  let pv=a[0];
  o[0]=pv;
  for(let i=1;i<a.length;i++){
    pv=a[i]*k+pv*(1-k);
    o[i]=pv;
  }
  return o;
}

function rsi(a,p){
  p=p||14;
  const o=Array(a.length).fill(null);
  let g=0,l=0;
  for(let i=1;i<a.length;i++){
    const d=a[i]-a[i-1];
    const gg=Math.max(d,0),ll=Math.max(-d,0);
    if(i<=p){
      g+=gg;
      l+=ll;
      if(i===p)o[i]=100-100/(1+g/(l||1e-9));
    }else{
      g=(g*(p-1)+gg)/p;
      l=(l*(p-1)+ll)/p;
      o[i]=100-100/(1+g/(l||1e-9));
    }
  }
  return o;
}

function macdCalc(a){
  const e12=ema(a,12),e26=ema(a,26);
  const line=a.map(function(_,i){return e12[i]-e26[i];});
  const sig=ema(line,9);
  const hist=line.map(function(v,i){return v-sig[i];});
  return {line:line,signal:sig,hist:hist};
}

function bollinger(a,p,m){
  p=p||20;
  m=m||2;
  const mid=sma(a,p);
  const up=Array(a.length).fill(null);
  const lo=Array(a.length).fill(null);
  for(let i=p-1;i<a.length;i++){
    const sl=a.slice(i-p+1,i+1);
    const av=mid[i];
    const v=sl.reduce(function(s,x){return s+(x-av)*(x-av);},0)/p;
    const sd=Math.sqrt(v);
    up[i]=av+m*sd;
    lo[i]=av-m*sd;
  }
  return {mid:mid,up:up,lo:lo};
}

function atr(candles,p){
  const out=[];
  let sum=0;
  for(let i=0;i<candles.length;i++){
    if(i===0){
      out.push(null);
      continue;
    }
    const h=candles[i].high,l=candles[i].low,pc=candles[i-1].close;
    const tr=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));
    sum+=tr;
    if(i<p){
      out.push(null);
      continue;
    }
    if(i>p){
      sum-=Math.max(
        candles[i-p].high-candles[i-p].low,
        Math.abs(candles[i-p].high-candles[i-p-1].close),
        Math.abs(candles[i-p].low-candles[i-p-1].close)
      );
    }
    out.push(sum/p);
  }
  return out;
}

function perfectOrder(closes){
  const n=closes.length-1;
  if(n<76)return {kind:"none",label:"データ不足",color:"#8ea0ba",bonus:0};

  const ma5=sma(closes,5);
  const ma25=sma(closes,25);
  const ma75=sma(closes,75);
  const a5=ma5[n],a25=ma25[n],a75=ma75[n];

  const slope=function(arr){
    if(n<3||arr[n-3]==null)return 0;
    return arr[n]-arr[n-3];
  };

  const s5=slope(ma5),s25=slope(ma25),s75=slope(ma75);
  const orderUp=a5>a25&&a25>a75;
  const orderDown=a5<a25&&a25<a75;
  const allUp=s5>0&&s25>0&&s75>0;
  const allDown=s5<0&&s25<0&&s75<0;

  if(orderUp&&allUp)return {kind:"po_up",label:"🟢 パーフェクトオーダー(上)強い上昇トレンド",color:"#31d27c",bonus:+1};
  if(orderDown&&allDown)return {kind:"po_dn",label:"🔴 パーフェクトオーダー(下)強い下降トレンド",color:"#ff6b6b",bonus:-1};
  if(orderUp)return {kind:"semi_up",label:"🟡 準PO(上) 弱い上昇 — 様子見",color:"#f5c451",bonus:0};
  if(orderDown)return {kind:"semi_dn",label:"🟡 準PO(下) 弱い下降 — 様子見",color:"#f5c451",bonus:0};
  return {kind:"none",label:"⚪ MA乱れ — レンジ相場 (エントリー非推奨)",color:"#8ea0ba",bonus:0};
}

function getSession(){
  const now=new Date();
  const utc=now.getTime()+now.getTimezoneOffset()*60000;
  const jst=new Date(utc+9*3600000);
  const h=jst.getHours();
  const m=jst.getMinutes();

  let main,color,kind;
  if(h>=21||h<1){
    main="⚡ 欧州/NYオーバーラップ";
    color="#ff6b6b";
    kind="best";
  }else if(h>=15&&h<17){
    main="⚡ 東京/欧州オーバーラップ";
    color="#f5c451";
    kind="best";
  }else if(h>=9&&h<15){
    main="🗼 東京セッション";
    color="#31d27c";
    kind="high";
  }else if(h>=17&&h<21){
    main="🇪🇺 欧州(ロンドン)";
    color="#4ea1ff";
    kind="high";
  }else if(h>=1&&h<6){
    main="🗽 NYセッション後半";
    color="#8cc8ff";
    kind="mid";
  }else{
    main="🌙 アジア早朝(薄商い)";
    color="#8ea0ba";
    kind="low";
  }

  let flash="",flashColor="";
  if(m>=55||m<=5){
    const nextH=m>=55?(h+1)%24:h;
    flash="🔔 時間切替中("+String(nextH).padStart(2,"0")+":00 前後)";
    flashColor="#f5c451";
  }

  const keyHours=[0,9,15,17,21];
  if(keyHours.indexOf(h)>=0&&m<=10){
    flash="🔥 重要セッション切替直後 ("+String(h).padStart(2,"0")+":00)";
    flashColor="#ff6b6b";
  }
  if(keyHours.indexOf((h+1)%24)>=0&&m>=50){
    flash="🔥 重要セッション切替直前 ("+String((h+1)%24).padStart(2,"0")+":00)";
    flashColor="#ff6b6b";
  }

  return {
    main:main,
    color:color,
    kind:kind,
    flash:flash,
    flashColor:flashColor,
    timeStr:String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+" JST"
  };
}

function drawSession(){
  const s=getSession();
  const nowEl=document.getElementById("sessionNow");
  const flashEl=document.getElementById("sessionFlash");
  const timeEl=document.getElementById("sessionTime");

  if(nowEl){
    nowEl.textContent=s.main;
    nowEl.style.background=s.color+"22";
    nowEl.style.color=s.color;
    nowEl.style.border="1px solid "+s.color+"66";
  }

  if(flashEl){
    if(s.flash){
      flashEl.textContent=s.flash;
      flashEl.style.background=s.flashColor+"22";
      flashEl.style.color=s.flashColor;
      flashEl.style.border="1px solid "+s.flashColor+"66";
      flashEl.style.fontWeight="700";
    }else{
      flashEl.textContent="";
      flashEl.style.background="transparent";
      flashEl.style.border="none";
    }
  }

  if(timeEl){
    timeEl.textContent="現在: "+s.timeStr;
  }
}

function computeSignal(candles){
  const n=candles.length-1;
  const closes=candles.map(function(c){return c.close;});
  const price=closes[n];

  const ma5=sma(closes,5)[n];
  const ma25=sma(closes,25)[n];
  const ma75=sma(closes,75)[n];
  const bb=bollinger(closes,20,2);
  const mid=bb.mid[n];
  const m=macdCalc(closes);
  const macdV=m.line[n],sigV=m.signal[n],histV=m.hist[n];
  const rsiV=rsi(closes,14)[n];
  const atrV=atr(candles,14)[n]||0.05;
  const po=perfectOrder(closes);

  let longScore=0,shortScore=0;

  if(ma5>ma25&&ma25>ma75)longScore++;
  if(ma5<ma25&&ma25<ma75)shortScore++;
  if(macdV>sigV&&histV>0)longScore++;
  if(macdV<sigV&&histV<0)shortScore++;
  if(rsiV>50&&rsiV<70)longScore++;
  if(rsiV<50&&rsiV>30)shortScore++;
  if(price>mid)longScore++;
  if(price<mid)shortScore++;
  if(po.kind==="po_up")longScore++;
  if(po.kind==="po_dn")shortScore++;

  const maxScore=5;
  let action="WAIT(待機)";
  let color="#f5c451";
  let tp=null;
  let sl=null;
  let reason="シグナル不一致 — ポジション見送り";

  if(longScore>=4){
    action="LONG(買い)★強";
    color="#31d27c";
    tp=price+atrV*2.5;
    sl=price-atrV*1;
    reason="MA上昇 / MACD強気 / RSI中立超 / BB上 / PO一致";
  }else if(longScore>=3){
    action="LONG(買い)";
    color="#31d27c";
    tp=price+atrV*2;
    sl=price-atrV*1;
    reason="MA上昇 / MACD強気 / RSI中立超 / BB上";
  }else if(shortScore>=4){
    action="SHORT(売り)★強";
    color="#ff6b6b";
    tp=price-atrV*2.5;
    sl=price+atrV*1;
    reason="MA下降 / MACD弱気 / RSI中立未 / BB下 / PO一致";
  }else if(shortScore>=3){
    action="SHORT(売り)";
    color="#ff6b6b";
    tp=price-atrV*2;
    sl=price+atrV*1;
    reason="MA下降 / MACD弱気 / RSI中立未 / BB下";
  }

  if(po.kind!=="po_up"&&po.kind!=="po_dn"){
    action="WAIT(PO不成立・エントリー禁止)";
    color="#8ea0ba";
    tp=null;
    sl=null;
    reason="パーフェクトオーダー未成立 — 及川式フィルターで強制待機";
  }

  if(action.indexOf("LONG")===0&&po.kind==="po_dn"){
    action="WAIT(方向矛盾・エントリー禁止)";
    color="#8ea0ba";
    tp=null;
    sl=null;
    reason="シグナルは買いだがPOは下降 — 矛盾のため強制待機";
  }

  if(action.indexOf("SHORT")===0&&po.kind==="po_up"){
    action="WAIT(方向矛盾・エントリー禁止)";
    color="#8ea0ba";
    tp=null;
    sl=null;
    reason="シグナルは売りだがPOは上昇 — 矛盾のため強制待機";
  }

  const fmt=function(v){return v==null?"--":v.toFixed(3);};
  const sa=document.getElementById("signalAction");
  if(!sa)return;

  sa.textContent=action;
  sa.style.color=color;

  document.getElementById("signalReason").textContent=reason;
  document.getElementById("sigEntry").textContent=fmt(price);
  document.getElementById("sigTP").textContent=fmt(tp);
  document.getElementById("sigSL").textContent=fmt(sl);
  document.getElementById("sigScore").textContent=Math.max(longScore,shortScore)+"/"+maxScore;
  document.getElementById("signalCard").style.borderColor=color;

  const poEl=document.getElementById("perfectOrder");
  if(poEl){
    poEl.textContent=po.label;
    poEl.style.background=po.color+"22";
    poEl.style.color=po.color;
    poEl.style.border="1px solid "+po.color+"66";
  }
}

async function fetchCandles(tf){
  const url="/api/candles?interval="+tf+"&outputsize=100";
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error("candles HTTP "+r.status);

  const j=await r.json();
  if(j.error) throw new Error(j.detail||j.error);

  let arr=null;
  if(Array.isArray(j))arr=j;
  else if(Array.isArray(j.candles))arr=j.candles;
  else if(Array.isArray(j.values))arr=j.values;
  else if(j.data&&Array.isArray(j.data.candles))arr=j.data.candles;

  if(!arr||!arr.length){
    throw new Error("candles empty / keys: "+Object.keys(j).join(","));
  }

  return arr.map(function(c){
    return {
      time:c.time||c.datetime||c.date||c.timestamp,
      open:Number(c.open),
      high:Number(c.high),
      low:Number(c.low),
      close:Number(c.close)
    };
  }).filter(function(c){
    return c.time&&isFinite(c.open)&&isFinite(c.high)&&isFinite(c.low)&&isFinite(c.close);
  });
}

async function fetchRate(){
  try{
    const r=await fetch(RATE_URL,{cache:"no-store"});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.error)return null;
    const v=Number(j.rate||j.price||j.close);
    return isFinite(v)?v:null;
  }catch(e){
    return null;
  }
}

async function fetchStrength(){
  try{
    const r=await fetch("/api/strength",{cache:"no-store"});
    if(!r.ok)return null;
    const j=await r.json();
    if(j.error)return null;
    return j.strength||null;
  }catch(e){
    return null;
  }
}

function drawStrength(s){
  const box=document.getElementById("strengthBars");
  if(!box||!s)return;

  const order=["USD","JPY","EUR","GBP","AUD"];
  const vals=order.map(function(c){
    return {c:c,v:s[c]==null?0:s[c]};
  });

  const max=Math.max.apply(null,[0.05].concat(vals.map(function(x){
    return Math.abs(x.v);
  })));

  const sorted=vals.slice().sort(function(a,b){
    return b.v-a.v;
  });

  box.innerHTML=sorted.map(function(x,i){
    const pct=(Math.abs(x.v)/max)*50;
    const isPos=x.v>=0;
    const color=isPos?"#31d27c":"#ff6b6b";
    const left=isPos?"50%":(50-pct)+"%";
    const width=pct+"%";
    const rank=i===0?"🥇":(i===sorted.length-1?"🐢":"");

    return ''
      +'<div style="display:flex;align-items:center;gap:10px">'
      +'<div style="width:70px;font-weight:700">'+x.c+' '+rank+'</div>'
      +'<div style="flex:1;position:relative;height:18px;background:rgba(255,255,255,.05);border-radius:4px">'
      +'<div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,.3)"></div>'
      +'<div style="position:absolute;left:'+left+';top:0;bottom:0;width:'+width+';background:'+color+';border-radius:2px"></div>'
      +'</div>'
      +'<div style="width:80px;text-align:right;color:'+color+';font-weight:700">'+(isPos?"+":"")+x.v.toFixed(2)+'%</div>'
      +'</div>';
  }).join("");

  const top=sorted[0],bot=sorted[sorted.length-1];
  const hint=document.getElementById("strengthHint");

  if(hint&&top&&bot&&(top.v-bot.v)>0.1){
    hint.textContent="推奨方向: "+top.c+"買い / "+bot.c+"売り(例: "+top.c+"/"+bot.c+")";
    hint.style.color="#f5c451";
  }else if(hint){
    hint.textContent="強弱差が小さい — 様子見推奨";
    hint.style.color="";
  }
}

const baseOpts={
  responsive:true,
  maintainAspectRatio:false,
  animation:false,
  interaction:{mode:"index",intersect:false},
  plugins:{legend:{labels:{color:"#cdd9ee"}}},
  scales:{
    x:{
      ticks:{color:"#8ea0ba",maxRotation:0,autoSkip:true,maxTicksLimit:8},
      grid:{color:"rgba(255,255,255,0.05)"}
    },
    y:{
      ticks:{color:"#8ea0ba"},
      grid:{color:"rgba(255,255,255,0.05)"}
    }
  }
};

function parseJST(timeStr){
  if(!timeStr) return Date.now();
  const s=String(timeStr).trim();

  const d1=new Date(s);
  if(!isNaN(d1.getTime())) return d1.getTime();

  const isoLike=s.replace(" ","T");
  const d2=new Date(isoLike);
  if(!isNaN(d2.getTime())) return d2.getTime();

  const d3=new Date(isoLike+"Z");
  if(!isNaN(d3.getTime())) return d3.getTime();

  return Date.now();
}

function supRes(highs,lows,lastClose,tf){
  const barsPerDay=TF_BARS_PER_DAY[tf]||24;
  const w=Math.min(barsPerDay,highs.length);
  const hS=highs.slice(-w),lS=lows.slice(-w);
  const maxH=Math.max.apply(null,hS),minL=Math.min.apply(null,lS);
  const pv=(maxH+minL+lastClose)/3;

  return {
    support:Math.min(2*pv-maxH,minL),
    resistance:Math.max(2*pv-minL,maxH)
  };
}

function drawPrice(candles){
  const closes=candles.map(function(c){return c.close;});
  const highs=candles.map(function(c){return c.high;});
  const lows=candles.map(function(c){return c.low;});
  const labels=candles.map(function(c){return c.time;});

  const bb=bollinger(closes,20,2);
  const ma5=sma(closes,5);
  const ma25=sma(closes,25);
  const ma75=sma(closes,75);

  const ohlc=candles.map(function(c){
    return {x:parseJST(c.time),o:c.open,h:c.high,l:c.low,c:c.close};
  });

  const sr=supRes(highs,lows,closes[closes.length-1],currentTF);
  const last=closes[closes.length-1];
  const xMin=parseJST(labels[0]);
  const xMax=parseJST(labels[labels.length-1]);

  const supLine=[{x:xMin,y:sr.support},{x:xMax,y:sr.support}];
  const resLine=[{x:xMin,y:sr.resistance},{x:xMax,y:sr.resistance}];
  const rateLine=[{x:xMin,y:last},{x:xMax,y:last}];

  const data={
    datasets:[
      {
        type:"candlestick",
        label:"USD/JPY",
        data:ohlc,
        color:{up:"#31d27c",down:"#ff6b6b",unchanged:"#8ea0ba"},
        borderColor:{up:"#31d27c",down:"#ff6b6b",unchanged:"#8ea0ba"}
      },
      {
        type:"line",
        label:"5MA",
        data:labels.map(function(t,i){return {x:parseJST(t),y:ma5[i]};}),
        borderColor:"#31d27c",
        borderWidth:1,
        pointRadius:0
      },
      {
        type:"line",
        label:"25MA",
        data:labels.map(function(t,i){return {x:parseJST(t),y:ma25[i]};}),
        borderColor:"#f5c451",
        borderWidth:1,
        pointRadius:0
      },
      {
        type:"line",
        label:"75MA",
        data:labels.map(function(t,i){return {x:parseJST(t),y:ma75[i]};}),
        borderColor:"#ff8aa5",
        borderWidth:1,
        pointRadius:0
      },
      {
        type:"line",
        label:"BB+",
        data:labels.map(function(t,i){return {x:parseJST(t),y:bb.up[i]};}),
        borderColor:"rgba(180,200,230,.6)",
        borderWidth:1,
        pointRadius:0,
        borderDash:[4,4]
      },
      {
        type:"line",
        label:"BB-",
        data:labels.map(function(t,i){return {x:parseJST(t),y:bb.lo[i]};}),
        borderColor:"rgba(180,200,230,.6)",
        borderWidth:1,
        pointRadius:0,
        borderDash:[4,4]
      },
      {
        type:"line",
        label:"サポート "+sr.support.toFixed(3),
        data:supLine,
        borderColor:"#31d27c",
        borderWidth:2,
        pointRadius:0,
        borderDash:[8,4]
      },
      {
        type:"line",
        label:"レジスタンス "+sr.resistance.toFixed(3),
        data:resLine,
        borderColor:"#ff6b6b",
        borderWidth:2,
        pointRadius:0,
        borderDash:[8,4]
      },
      {
        type:"line",
        label:"★ 現在レート "+last.toFixed(3),
        data:rateLine,
        borderColor:"#8cc8ff",
        borderWidth:2.5,
        pointRadius:0,
        borderDash:[2,2]
      }
    ]
  };

  const opts={
    responsive:true,
    maintainAspectRatio:false,
    animation:false,
    plugins:{
      legend:{labels:{color:"#cdd9ee"}},
      tooltip:{
        callbacks:{
          title:function(items){
            if(!items.length)return "";
            const d=new Date(items[0].parsed.x);
            return d.toLocaleString("ja-JP",{
              timeZone:"Asia/Tokyo",
              month:"2-digit",
              day:"2-digit",
              hour:"2-digit",
              minute:"2-digit"
            })+" JST";
          }
        }
      }
    },
    scales:{
      x:{
        type:"timeseries",
        adapters:{date:{zone:"Asia/Tokyo"}},
        time:{
          displayFormats:{
            minute:"HH:mm",
            hour:"M/d HH:mm",
            day:"M/d",
            week:"M/d",
            month:"yyyy-MM"
          }
        },
        ticks:{color:"#8ea0ba",maxRotation:0,autoSkip:true,maxTicksLimit:8},
        grid:{color:"rgba(255,255,255,0.05)"}
      },
      y:{
        ticks:{color:"#8ea0ba"},
        grid:{color:"rgba(255,255,255,0.05)"}
      }
    }
  };

  if(priceChart){
    priceChart.destroy();
  }

  priceChart=new Chart(el.priceCanvas,{type:"candlestick",data:data,options:opts});
}

function drawMacd(times,closes){
  const m=macdCalc(closes);
  const canvas=document.getElementById("macdChart");

  if(!canvas)return m;

  const data={
    labels:times,
    datasets:[
      {
        type:"bar",
        label:"Hist",
        data:m.hist,
        backgroundColor:m.hist.map(function(v){
          return (v||0)>=0?"rgba(49,210,124,.6)":"rgba(255,107,107,.6)";
        })
      },
      {
        type:"line",
        label:"MACD",
        data:m.line,
        borderColor:"#4ea1ff",
        borderWidth:1.5,
        pointRadius:0
      },
      {
        type:"line",
        label:"Signal",
        data:m.signal,
        borderColor:"#f5c451",
        borderWidth:1.5,
        pointRadius:0
      }
    ]
  };

  if(macdChart){
    macdChart.data=data;
    macdChart.update();
  }else{
    macdChart=new Chart(canvas,{data:data,options:baseOpts});
  }

  return m;
}

function fmtLabel(t,tf){
  if(tf==="1day")return t.slice(0,10);
  return t.slice(5,16);
}

function showUpdateError(e){
  console.error(e);

  const reason=e&&e.message?e.message:String(e);
  const sa=document.getElementById("signalAction");
  const sr=document.getElementById("signalReason");
  const po=document.getElementById("perfectOrder");
  const box=document.getElementById("strengthBars");

  if(sa){
    sa.textContent="ERROR";
    sa.style.color="#ff6b6b";
  }

  if(sr){
    sr.textContent="update失敗: "+reason;
    sr.style.color="#ff6b6b";
  }

  if(po){
    po.textContent="エラー内容を確認してください";
    po.style.background="rgba(255,107,107,.15)";
    po.style.color="#ff6b6b";
    po.style.border="1px solid rgba(255,107,107,.5)";
  }

  if(box){
    box.innerHTML='<div class="small" style="color:#ff6b6b">API/JSエラー: '+reason+'</div>';
  }
}

async function update(){
  drawSession();

  try{
    const candles=await fetchCandles(currentTF);
    if(!candles || candles.length < 80){
      throw new Error("candles不足");
    }

    const times=candles.map(function(c){
      return fmtLabel(c.time,currentTF);
    });

    const closes=candles.map(function(c){
      return c.close;
    });

    const m=drawMacd(times,closes);
    const barsDay=TF_BARS_PER_DAY[currentTF]||24;
    const prev=closes[Math.max(0,closes.length-barsDay-1)]||closes[0];

    const live=await fetchRate();

    if(live!==null){
      const lastBar=candles[candles.length-1];
      lastBar.close=live;
      lastBar.high=Math.max(lastBar.high,live);
      lastBar.low=Math.min(lastBar.low,live);
    }

    const updatedCloses=candles.map(function(c){
      return c.close;
    });

    const last=updatedCloses[updatedCloses.length-1];
    const diff=last-prev;
    const pct=(diff/prev)*100;

    drawPrice(candles);

    if(el.dayChange){
      el.dayChange.textContent=(diff>=0?"+":"")+diff.toFixed(3);
      el.dayChange.style.color=diff>=0?"#31d27c":"#ff6b6b";
    }

    if(el.dayChangePct){
      el.dayChangePct.textContent=(diff>=0?"+":"")+pct.toFixed(2)+"%";
    }

    const rArr=rsi(updatedCloses,14);
    const rL=rArr[rArr.length-1];

    if(el.rsiVal){
      el.rsiVal.textContent=rL?rL.toFixed(1):"--";
    }

    if(el.rsiText){
      el.rsiText.textContent=rL>70?"買われすぎ":rL<30?"売られすぎ":"中立";
    }

    const mN=m.line[m.line.length-1];
    const sN=m.signal[m.signal.length-1];

    let bias="中立";
    if(mN>sN&&rL<70)bias="買い優勢";
    else if(mN<sN&&rL>30)bias="売り優勢";

    if(el.biasText){
      el.biasText.textContent=bias;
    }

    computeSignal(candles);

    const now=Date.now();
    if(now-lastStrengthFetch>STRENGTH_REFRESH_MS||!cachedStrength){
      cachedStrength=await fetchStrength();
      lastStrengthFetch=now;
    }

    if(cachedStrength){
      drawStrength(cachedStrength);
    }

  }catch(e){
    showUpdateError(e);
  }
}

function applyTF(tf){
  if(tf === currentTF){
    return;
  }

  currentTF=tf;

  const btns=el.pills?el.pills.querySelectorAll(".tf"):[];
  btns.forEach(function(b){
    if(b.getAttribute("data-tf")===tf){
      b.classList.add("active");
    }else{
      b.classList.remove("active");
    }
  });

  clearTimeout(tfSwitchTimer);
  tfSwitchTimer=setTimeout(function(){
    const now=Date.now();
    const gap=now-lastTFUpdateAt;

    if(gap<TF_SWITCH_MIN_GAP_MS){
      clearTimeout(tfSwitchTimer);
      tfSwitchTimer=setTimeout(function(){
        lastTFUpdateAt=Date.now();
        update();
      }, TF_SWITCH_MIN_GAP_MS-gap);
      return;
    }

    lastTFUpdateAt=now;
    update();
  }, TF_SWITCH_DEBOUNCE_MS);
}

if(el.pills){
  el.pills.addEventListener("click",function(ev){
    const t=ev.target;
    if(t&&t.classList.contains("tf")){
      applyTF(t.getAttribute("data-tf"));
    }
  });
}

if(el.pills){
  const active=el.pills.querySelector('.tf[data-tf="'+currentTF+'"]');
  if(active) active.classList.add("active");
}

drawSession();
update();

setInterval(update,REFRESH_MS);
setInterval(drawSession,60*1000);
