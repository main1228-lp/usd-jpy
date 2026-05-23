// USD/JPY ダッシュボード（Twelve Data + Chart.js + 時間足切替 + 通貨強弱）
const RATE_URL = "/api/rate";
const REFRESH_MS = 3 * 60 * 1000;

let currentTF = "5min"; // デフォルト
const TF_BARS_PER_DAY = { "5min":288, "1h":24, "4h":6, "1day":1 };

const $ = function(id){ return document.getElementById(id); };
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
  pills: $("intervalPills")
};
let priceChart, macdChart;

function sma(a,p){const o=Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=p)s-=a[i-p];if(i>=p-1)o[i]=s/p;}return o;}
function ema(a,p){const o=Array(a.length).fill(null);const k=2/(p+1);let pv=a[0];o[0]=pv;for(let i=1;i<a.length;i++){pv=a[i]*k+pv*(1-k);o[i]=pv;}return o;}
function rsi(a,p){p=p||14;const o=Array(a.length).fill(null);let g=0,l=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];const gg=Math.max(d,0),ll=Math.max(-d,0);if(i<=p){g+=gg;l+=ll;if(i===p)o[i]=100-100/(1+g/(l||1e-9));}else{g=(g*(p-1)+gg)/p;l=(l*(p-1)+ll)/p;o[i]=100-100/(1+g/(l||1e-9));}}return o;}
function macdCalc(a){const e12=ema(a,12),e26=ema(a,26);const line=a.map(function(_,i){return e12[i]-e26[i];});const sig=ema(line,9);const hist=line.map(function(v,i){return v-sig[i];});return {line:line,signal:sig,hist:hist};}
function bollinger(a,p,m){p=p||20;m=m||2;const mid=sma(a,p);const up=Array(a.length).fill(null);const lo=Array(a.length).fill(null);for(let i=p-1;i<a.length;i++){const sl=a.slice(i-p+1,i+1);const av=mid[i];const v=sl.reduce(function(s,x){return s+(x-av)*(x-av);},0)/p;const sd=Math.sqrt(v);up[i]=av+m*sd;lo[i]=av-m*sd;}return {mid:mid,up:up,lo:lo};}

function atr(candles,p){
  const out=[];let sum=0;
  for(let i=0;i<candles.length;i++){
    if(i===0){out.push(null);continue;}
    const h=candles[i].high,l=candles[i].low,pc=candles[i-1].close;
    const tr=Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));
    sum+=tr;
    if(i<p){out.push(null);continue;}
    if(i>p){sum-=Math.max(candles[i-p].high-candles[i-p].low,
      Math.abs(candles[i-p].high-candles[i-p-1].close),
      Math.abs(candles[i-p].low-candles[i-p-1].close));}
    out.push(sum/p);
  }
  return out;
}

function computeSignal(candles){
  const n=candles.length-1;
  const closes=candles.map(function(c){return c.close;});
  const price=closes[n];
  const ma5=sma(closes,5)[n], ma25=sma(closes,25)[n], ma75=sma(closes,75)[n];
  const bb=bollinger(closes,20,2);
  const mid=bb.mid[n];
  const m=macdCalc(closes);
  const macdV=m.line[n], sigV=m.signal[n], histV=m.hist[n];
  const rsiV=rsi(closes,14)[n];
  const atrV=atr(candles,14)[n]||0.05;

  let longScore=0, shortScore=0;
  if(ma5>ma25 && ma25>ma75) longScore++;
  if(ma5<ma25 && ma25<ma75) shortScore++;
  if(macdV>sigV && histV>0) longScore++;
  if(macdV<sigV && histV<0) shortScore++;
  if(rsiV>50 && rsiV<70) longScore++;
  if(rsiV<50 && rsiV>30) shortScore++;
  if(price>mid) longScore++;
  if(price<mid) shortScore++;

  let action="WAIT（待機）", color="#f5c451", tp=null, sl=null,
      reason="シグナル不一致 — ポジション見送り";
  if(longScore>=3){
    action="LONG（買い）"; color="#31d27c";
    tp=price+atrV*2; sl=price-atrV*1;
    reason="MA上昇 / MACD強気 / RSI中立超 / BB上";
  }else if(shortScore>=3){
    action="SHORT（売り）"; color="#ff6b6b";
    tp=price-atrV*2; sl=price+atrV*1;
    reason="MA下降 / MACD弱気 / RSI中立未 / BB下";
  }

  const fmt=function(v){return v==null?"--":v.toFixed(3);};
  const sa=document.getElementById("signalAction");
  if(!sa) return;
  sa.textContent=action; sa.style.color=color;
  document.getElementById("signalReason").textContent=reason;
  document.getElementById("sigEntry").textContent=fmt(price);
  document.getElementById("sigTP").textContent=fmt(tp);
  document.getElementById("sigSL").textContent=fmt(sl);
  document.getElementById("sigScore").textContent=Math.max(longScore,shortScore)+"/4";
  document.getElementById("signalCard").style.borderColor=color;
}

async function fetchCandles(tf){
  const url="/api/candles?interval="+tf+"&outputsize=200";
  const r=await fetch(url,{cache:"no-store"});
  const j=await r.json();
  if(!j.candles||!j.candles.length)throw new Error("no candles");
  return j.candles;
}
async function fetchRate(){try{const r=await fetch(RATE_URL,{cache:"no-store"});if(!r.ok)return null;const j=await r.json();const v=Number(j.rate||j.price||j.close);return isFinite(v)?v:null;}catch(e){return null;}}

async function fetchStrength(){
  try{
    const r=await fetch("/api/strength",{cache:"no-store"});
    if(!r.ok)return null;
    const j=await r.json();
    return j.strength||null;
  }catch(e){return null;}
}

function drawStrength(s){
  const box=document.getElementById("strengthBars");
  if(!box||!s)return;
  const order=["USD","JPY","EUR","GBP","AUD"];
  const vals=order.map(function(c){return {c:c,v:s[c]==null?0:s[c]};});
  const max=Math.max.apply(null,[0.05].concat(vals.map(function(x){return Math.abs(x.v);})));
  const sorted=vals.slice().sort(function(a,b){return b.v-a.v;});
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
  const top=sorted[0], bot=sorted[sorted.length-1];
  const hint=document.getElementById("strengthHint");
  if(hint && top && bot && (top.v-bot.v)>0.1){
    hint.textContent="推奨方向: "+top.c+"買い / "+bot.c+"売り（例: "+top.c+"/"+bot.c+"）";
    hint.style.color="#f5c451";
  }else if(hint){
    hint.textContent="強弱差が小さい — 様子見推奨";
    hint.style.color="";
  }
}

const baseOpts={responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:"index",intersect:false},plugins:{legend:{labels:{color:"#cdd9ee"}}},scales:{x:{ticks:{color:"#8ea0ba",maxRotation:0,autoSkip:true,maxTicksLimit:8},grid:{color:"rgba(255,255,255,0.05)"}},y:{ticks:{color:"#8ea0ba"},grid:{color:"rgba(255,255,255,0.05)"}}}};

function drawPrice(candles){
  const closes=candles.map(function(c){return c.close;});
  const labels=candles.map(function(c){return c.time;});
  const bb=bollinger(closes,20,2);
  const ohlc=candles.map(function(c){return {x:new Date(c.time).getTime(),o:c.open,h:c.high,l:c.low,c:c.close};});

  const data={datasets:[
    {type:"candlestick",label:"USD/JPY",data:ohlc,
      color:{up:"#31d27c",down:"#ff6b6b",unchanged:"#8ea0ba"},
      borderColor:{up:"#31d27c",down:"#ff6b6b",unchanged:"#8ea0ba"}},
    {type:"line",label:"5MA",data:labels.map(function(t,i){return {x:new Date(t).getTime(),y:sma(closes,5)[i]};}),borderColor:"#31d27c",borderWidth:1,pointRadius:0},
    {type:"line",label:"25MA",data:labels.map(function(t,i){return {x:new Date(t).getTime(),y:sma(closes,25)[i]};}),borderColor:"#f5c451",borderWidth:1,pointRadius:0},
    {type:"line",label:"75MA",data:labels.map(function(t,i){return {x:new Date(t).getTime(),y:sma(closes,75)[i]};}),borderColor:"#ff8aa5",borderWidth:1,pointRadius:0},
    {type:"line",label:"BB+",data:labels.map(function(t,i){return {x:new Date(t).getTime(),y:bb.up[i]};}),borderColor:"rgba(180,200,230,.6)",borderWidth:1,pointRadius:0,borderDash:[4,4]},
    {type:"line",label:"BB-",data:labels.map(function(t,i){return {x:new Date(t).getTime(),y:bb.lo[i]};}),borderColor:"rgba(180,200,230,.6)",borderWidth:1,pointRadius:0,borderDash:[4,4]}
  ]};

  const opts={
    responsive:true,maintainAspectRatio:false,animation:false,
    plugins:{legend:{labels:{color:"#cdd9ee"}}},
    scales:{
      x:{type:"timeseries",ticks:{color:"#8ea0ba",maxRotation:0,autoSkip:true,maxTicksLimit:8},grid:{color:"rgba(255,255,255,0.05)"}},
      y:{ticks:{color:"#8ea0ba"},grid:{color:"rgba(255,255,255,0.05)"}}
    }
  };

  if(priceChart){priceChart.destroy();}
  priceChart=new Chart(el.priceCanvas,{type:"candlestick",data:data,options:opts});
}

function drawMacd(times,closes){
  const m=macdCalc(closes);
  const data={labels:times,datasets:[
    {type:"bar",label:"Hist",data:m.hist,backgroundColor:m.hist.map(function(v){return (v||0)>=0?"rgba(49,210,124,.6)":"rgba(255,107,107,.6)";})},
    {type:"line",label:"MACD",data:m.line,borderColor:"#4ea1ff",borderWidth:1.5,pointRadius:0},
    {type:"line",label:"Signal",data:m.signal,borderColor:"#f5c451",borderWidth:1.5,pointRadius:0}
  ]};
  if(macdChart){macdChart.data=data;macdChart.update();}
  else{macdChart=new Chart(el.macdCanvas,{data:data,options:baseOpts});}
  return m;
}

function supRes(highs,lows,lastClose,tf){
  const barsPerDay=TF_BARS_PER_DAY[tf]||24;
  const w=Math.min(barsPerDay,highs.length);
  const hS=highs.slice(-w),lS=lows.slice(-w);
  const maxH=Math.max.apply(null,hS),minL=Math.min.apply(null,lS);
  const pv=(maxH+minL+lastClose)/3;
  return {support:Math.min(2*pv-maxH,minL),resistance:Math.max(2*pv-minL,maxH)};
}

function fmtLabel(t,tf){
  if(tf==="1day")return t.slice(0,10);
  return t.slice(5,16);
}

async function update(){
  try{
    const candles=await fetchCandles(currentTF);
    const times=candles.map(function(c){return fmtLabel(c.time,currentTF);});
    const closes=candles.map(function(c){return c.close;});
    const highs=candles.map(function(c){return c.high;});
    const lows=candles.map(function(c){return c.low;});
    drawPrice(candles);
    const m=drawMacd(times,closes);
    const last=closes[closes.length-1];
    const barsDay=TF_BARS_PER_DAY[currentTF]||24;
    const prev=closes[Math.max(0,closes.length-barsDay-1)]||closes[0];
    const diff=last-prev;
    const pct=(diff/prev)*100;
    const live=await fetchRate();
    const shown=live!==null?live:last;
    el.currentRate.textContent=shown.toFixed(3);
    const sign=diff>=0?"+":"";
    el.dayChange.textContent=sign+diff.toFixed(3);
    el.dayChange.style.color=diff>=0?"#31d27c":"#ff6b6b";
    el.dayChangePct.textContent=sign+pct.toFixed(2)+"%";
    const rArr=rsi(closes,14);
    const rL=rArr[rArr.length-1];
    el.rsiVal.textContent=rL?rL.toFixed(1):"--";
    el.rsiText.textContent=rL>70?"買われすぎ":rL<30?"売られすぎ":"中立";
    const mN=m.line[m.line.length-1],sN=m.signal[m.signal.length-1];
    let bias="中立";
    if(mN>sN&&rL<70)bias="買い優勢";
    else if(mN<sN&&rL>30)bias="売り優勢";
    el.biasText.textContent=bias;
    const sr=supRes(highs,lows,last,currentTF);
    el.supportText.textContent=sr.support.toFixed(3);
    el.resistanceText.textContent=sr.resistance.toFixed(3);
    computeSignal(candles);
    const strength=await fetchStrength();
    if(strength)drawStrength(strength);
  }catch(e){console.error(e);el.currentRate.textContent="Err";}
}

function setActiveTF(tf){
  currentTF=tf;
  const btns=el.pills.querySelectorAll(".tf");
  btns.forEach(function(b){
    if(b.getAttribute("data-tf")===tf)b.classList.add("active");
    else b.classList.remove("active");
  });
  update();
}

if(el.pills){
  el.pills.addEventListener("click",function(ev){
    const t=ev.target;
    if(t && t.classList.contains("tf")){
      setActiveTF(t.getAttribute("data-tf"));
    }
  });
}
setActiveTF(currentTF);
setInterval(update,REFRESH_MS);
