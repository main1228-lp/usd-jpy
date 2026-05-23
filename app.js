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

  const po = perfectOrder(closes);

  let longScore=0, shortScore=0;
  if(ma5>ma25 && ma25>ma75) longScore++;
  if(ma5<ma25 && ma25<ma75) shortScore++;
  if(macdV>sigV && histV>0) longScore++;
  if(macdV<sigV && histV<0) shortScore++;
  if(rsiV>50 && rsiV<70) longScore++;
  if(rsiV<50 && rsiV>30) shortScore++;
  if(price>mid) longScore++;
  if(price<mid) shortScore++;
  if(po.kind==="po_up") longScore++;
  if(po.kind==="po_dn") shortScore++;

  const maxScore = 5;
  let action="WAIT（待機）", color="#f5c451", tp=null, sl=null,
      reason="シグナル不一致 — ポジション見送り";
  if(longScore>=4){
    action="LONG（買い）★強"; color="#31d27c";
    tp=price+atrV*2.5; sl=price-atrV*1;
    reason="MA上昇 / MACD強気 / RSI中立超 / BB上 / PO一致";
  }else if(longScore>=3){
    action="LONG（買い）"; color="#31d27c";
    tp=price+atrV*2; sl=price-atrV*1;
    reason="MA上昇 / MACD強気 / RSI中立超 / BB上";
  }else if(shortScore>=4){
    action="SHORT（売り）★強"; color="#ff6b6b";
    tp=price-atrV*2.5; sl=price+atrV*1;
    reason="MA下降 / MACD弱気 / RSI中立未 / BB下 / PO一致";
  }else if(shortScore>=3){
    action="SHORT（売り）"; color="#ff6b6b";
    tp=price-atrV*2; sl=price+atrV*1;
    reason="MA下降 / MACD弱気 / RSI中立未 / BB下";
  }

  // === 強制トレンドフィルター（常時オン） ===
  if(po.kind !== "po_up" && po.kind !== "po_dn"){
    action = "WAIT（PO不成立・エントリー禁止）";
    color  = "#8ea0ba";
    tp = null; sl = null;
    reason = "パーフェクトオーダー未成立 — 及川式フィルターで強制待機";
  }
  if(action.indexOf("LONG")===0 && po.kind === "po_dn"){
    action = "WAIT（方向矛盾・エントリー禁止）";
    color  = "#8ea0ba";
    tp = null; sl = null;
    reason = "シグナルは買いだがPOは下降 — 矛盾のため強制待機";
  }
  if(action.indexOf("SHORT")===0 && po.kind === "po_up"){
    action = "WAIT（方向矛盾・エントリー禁止）";
    color  = "#8ea0ba";
    tp = null; sl = null;
    reason = "シグナルは売りだがPOは上昇 — 矛盾のため強制待機";
  }

  const fmt=function(v){return v==null?"--":v.toFixed(3);};
  const sa=document.getElementById("signalAction");
  if(!sa) return;
  sa.textContent=action; sa.style.color=color;
  document.getElementById("signalReason").textContent=reason;
  document.getElementById("sigEntry").textContent=fmt(price);
  document.getElementById("sigTP").textContent=fmt(tp);
  document.getElementById("sigSL").textContent=fmt(sl);
  document.getElementById("sigScore").textContent=Math.max(longScore,shortScore)+"/"+maxScore;
  document.getElementById("signalCard").style.borderColor=color;

  const poEl = document.getElementById("perfectOrder");
  if(poEl){
    poEl.textContent = po.label;
    poEl.style.background = po.color + "22";
    poEl.style.color = po.color;
    poEl.style.border = "1px solid " + po.color + "66";
  }
}
