// USD/JPY ダッシュボード（Twelve Data 実ローソク足 + Chart.js）
const CANDLES_URL = "/api/candles?interval=15min&outputsize=200";
const RATE_URL = "/api/rate";
const REFRESH_MS = 3 * 60 * 1000;

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
  macdCanvas: $("macdChart")
};
let priceChart, macdChart;

function sma(a,p){const o=Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=p)s-=a[i-p];if(i>=p-1)o[i]=s/p;}return o;}
function ema(a,p){const o=Array(a.length).fill(null);const k=2/(p+1);let pv=a[0];o[0]=pv;for(let i=1;i<a.length;i++){pv=a[i]*k+pv*(1-k);o[i]=pv;}return o;}
function rsi(a,p){p=p||14;const o=Array(a.length).fill(null);let g=0,l=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1];const gg=Math.max(d,0),ll=Math.max(-d,0);if(i<=p){g+=gg;l+=ll;if(i===p)o[i]=100-100/(1+g/(l||1e-9));}else{g=(g*(p-1)+gg)/p;l=(l*(p-1)+ll)/p;o[i]=100-100/(1+g/(l||1e-9));}}return o;}
function macdCalc(a){const e12=ema(a,12),e26=ema(a,26);const line=a.map(function(_,i){return e12[i]-e26[i];});const sig=ema(line,9);const hist=line.map(function(v,i){return v-sig[i];});return {line:line,signal:sig,hist:hist};}
function bollinger(a,p,m){p=p||20;m=m||2;const mid=sma(a,p);const up=Array(a.length).fill(null);const lo=Array(a.length).fill(null);for(let i=p-1;i<a.length;i++){const sl=a.slice(i-p+1,i+1);const av=mid[i];const v=sl.reduce(function(s,x){return s+(x-av)*(x-av);},0)/p;const sd=Math.sqrt(v);up[i]=av+m*sd;lo[i]=av-m*sd;}return {mid:mid,up:up,lo:lo};}

async function fetchCandles(){const r=await fetch(CANDLES_URL,{cache:"no-store"});const j=await r.json();if(!j.candles||!j.candles.length)throw new Error("no candles");return j.candles;}
async function fetchRate(){try{const r=await fetch(RATE_URL,{cache:"no-store"});if(!r.ok)return null;const j=await r.json();const v=Number(j.rate||j.price||j.close);return isFinite(v)?v:null;}catch(e){return null;}}

const baseOpts = {
  responsive:true,maintainAspectRatio:false,animation:false,
  interaction:{mode:"index",intersect:false},
  plugins:{legend:{labels:{color:"#cdd9ee"}}},
  scales:{
    x:{ticks:{color:"#8ea0ba",maxRotation:0,autoSkip:true,maxTicksLimit:8},grid:{color:"rgba(255,255,255,0.05)"}},
    y:{ticks:{color:"#8ea0ba"},grid:{color:"rgba(255,255,255,0.05)"}}
  }
};

function drawPrice(times,closes){
  const bb=bollinger(closes,20,2);
  const data={labels:times,datasets:[
    {label:"Close",data:closes,borderColor:"#8cc8ff",borderWidth:2,pointRadius:0,tension:0.15},
    {label:"5MA",data:sma(closes,5),borderColor:"#31d27c",borderWidth:1,pointRadius:0},
    {label:"25MA",data:sma(closes,25),borderColor:"#f5c451",borderWidth:1,pointRadius:0},
    {label:"75MA",data:sma(closes,75),borderColor:"#ff8aa5",borderWidth:1,pointRadius:0},
    {label:"BB+",data:bb.up,borderColor:"rgba(180,200,230,.6)",borderWidth:1,pointRadius:0,borderDash:[4,4]},
    {label:"BB-",data:bb.lo,borderColor:"rgba(180,200,230,.6)",borderWidth:1,pointRadius:0,borderDash:[4,4]}
  ]};
  if(priceChart){priceChart.data=data;priceChart.update();}
  else{priceChart=new Chart(el.priceCanvas,{type:"line",data:data,options:baseOpts});}
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

function supRes(highs,lows,lastClose){
  const w=Math.min(96,highs.length);
  const hS=highs.slice(-w),lS=lows.slice(-w);
  const maxH=Math.max.apply(null,hS),minL=Math.min.apply(null,lS);
  const pv=(maxH+minL+lastClose)/3;
  return {support:Math.min(2*pv-maxH,minL),resistance:Math.max(2*pv-minL,maxH)};
}

async function update(){
  try{
    const candles=await fetchCandles();
    const times=candles.map(function(c){return c.time.slice(5,16);});
    const closes=candles.map(function(c){return c.close;});
    const highs=candles.map(function(c){return c.high;});
    const lows=candles.map(function(c){return c.low;});
    drawPrice(times,closes);
    const m=drawMacd(times,closes);
    const last=closes[closes.length-1];
    const prev=closes[Math.max(0,closes.length-96-1)]||closes[0];
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
    const sr=supRes(highs,lows,last);
    el.supportText.textContent=sr.support.toFixed(3);
    el.resistanceText.textContent=sr.resistance.toFixed(3);
  }catch(e){console.error(e);el.currentRate.textContent="Err";}
}
update();
setInterval(update,REFRESH_MS);
