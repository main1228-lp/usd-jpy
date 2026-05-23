async function loadCalendar(){
  const box=document.getElementById("calendarList");
  if(!box)return;
  try{
    const r=await fetch("/api/calendar",{cache:"no-store"});
    const j=await r.json();
    if(!j.events||!j.events.length){
      box.innerHTML='<div class="no-ev">本日の★★★指標はありません</div>';
      return;
    }
    const html=j.events.map(function(ev){
      const t=ev.time?ev.time.slice(11,16):"--:--";
      const ccy=(ev.currency||"").toUpperCase();
      const fc=ev.forecast?'予想 <b>'+ev.forecast+'</b>':"";
      const pv=ev.previous?'前回 <b>'+ev.previous+'</b>':"";
      const ac=ev.actual?'結果 <b>'+ev.actual+'</b>':"";
      const va=[ac,fc,pv].filter(Boolean).join(" / ");
      return '<div class="ev"><div class="t">'+t+' UTC</div>'
        +'<div class="c '+ccy+'">'+ccy+'</div>'
        +'<div class="ti">'+ev.title+'</div>'
        +'<div class="va">'+va+'</div></div>';
    }).join("");
    box.innerHTML=html;
  }catch(e){
    box.innerHTML='<div class="no-ev">取得に失敗しました</div>';
  }
}
loadCalendar();
setInterval(loadCalendar,10*60*1000); // 10分ごとに更新
