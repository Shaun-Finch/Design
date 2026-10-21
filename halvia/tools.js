/* Halvia tools: the clinical concept tools behind halvia.html and halvia/app.html.
   Halvia.mount(el, tool) renders a tool into el. Tools: ward, news, sbar, code, discharge, dna, plain.
   All patients are synthetic and everything runs in the browser: nothing is sent or stored anywhere.
   Halvia.router(tool, ctx) is set by the host page so one tool can open another (e.g. a bed -> its NEWS2 chart). */
(function(){
'use strict';
var H=window.Halvia=window.Halvia||{};
var inst={};H._inst=inst;

/* ---------- helpers ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function scope(root){return {q:function(s){return root.querySelector(s)},qa:function(s){return Array.prototype.slice.call(root.querySelectorAll(s))}}}
var uidN=0;function uid(p){return 'hv'+(p||'')+(++uidN)}
function pad(n){return String(n).padStart(2,'0')}
function hm(d){return pad(d.getHours())+':'+pad(d.getMinutes())}
var DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function dayHm(d,ref){return (ref&&d.toDateString()===ref.toDateString()?'':DAYS[d.getDay()]+' ')+hm(d)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function copyText(t,btn){
  function done(){if(btn){var o=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=o},1400)}}
  if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(done,fallback);else fallback();
  function fallback(){var a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(e){}a.remove();done()}
}
function printNode(node){
  node.classList.add('hv-print');document.body.classList.add('hv-printing');
  var off=function(){node.classList.remove('hv-print');document.body.classList.remove('hv-printing');window.removeEventListener('afterprint',off)};
  window.addEventListener('afterprint',off);window.print();setTimeout(off,1500);
}
H.copyText=copyText;H.printNode=printNode;H.esc=esc;
H.open=function(tool,ctx){if(H.router)H.router(tool,ctx||{});else if(inst[tool])inst[tool].select(ctx||{})};

/* ---------- NEWS2 (Royal College of Physicians, 2017; SpO2 scale 1) ---------- */
var OBS=[
  {k:'rr',label:'Respiration rate',short:'RR',unit:'/min',min:4,max:40,step:1,score:function(v){return v<=8?3:v<=11?1:v<=20?0:v<=24?2:3}},
  {k:'spo2',label:'SpO₂',short:'SpO₂',unit:'%',min:80,max:100,step:1,score:function(v){return v<=91?3:v<=93?2:v<=95?1:0}},
  {k:'o2',label:'Air or oxygen?',short:'Air/O₂',type:'seg',opts:['Air','Oxygen'],score:function(v){return v==='Oxygen'?2:0}},
  {k:'sbp',label:'Systolic BP',short:'BP',unit:'mmHg',min:60,max:240,step:1,score:function(v){return v<=90?3:v<=100?2:v<=110?1:v<=219?0:3}},
  {k:'hr',label:'Pulse',short:'HR',unit:'/min',min:30,max:180,step:1,score:function(v){return v<=40?3:v<=50?1:v<=90?0:v<=110?1:v<=130?2:3}},
  {k:'acvpu',label:'Consciousness',short:'ACVPU',type:'sel',opts:['Alert','New confusion','Voice','Pain','Unresponsive'],score:function(v){return v==='Alert'?0:3}},
  {k:'temp',label:'Temperature',short:'Temp',unit:'°C',min:34,max:41,step:0.1,score:function(v){return v<=35?3:v<=36?1:v<=38?0:v<=39?1:2}}
];
function score(v){var t=0,three=false,parts={};OBS.forEach(function(o){var s=o.score(v[o.k]);parts[o.k]=s;t+=s;if(s===3)three=true});return {total:t,three:three,parts:parts}}
function band(sc){
  if(sc.total>=7)return {name:'High',cls:'b3',freq:30,resp:'<b>Emergency response.</b> Urgent assessment by a team with critical-care skills, usually with transfer to a higher level of care. Continuous monitoring of vital signs.'};
  if(sc.total>=5)return {name:'Medium',cls:'b2',freq:60,resp:'<b>Urgent response.</b> The registered nurse informs the medical team immediately and asks for an urgent assessment by a clinician with competence in acute illness. Observations at least every hour.'};
  if(sc.three)return {name:'Low-medium',cls:'b2',freq:60,resp:'<b>Urgent ward-based response.</b> A score of 3 in one parameter: the nurse informs the medical team for an urgent review. Observations at least every hour.'};
  if(sc.total>=1)return {name:'Low',cls:'b1',freq:240,resp:'<b>Ward-based response.</b> The registered nurse assesses the patient and decides whether to increase monitoring or escalate. Observations at least every 4 to 6 hours.'};
  return {name:'Low',cls:'b0',freq:720,resp:'<b>Continue routine care.</b> Observations at least every 12 hours.'};
}
function fmtObs(o,v){return o.type?v:(o.step<1?(+v).toFixed(1):v)+(o.unit==='%'?'%':'')}
H.news={OBS:OBS,score:score,band:band};

/* ---------- the ward: six synthetic patients ---------- */
var NOTE_B3="A.P., 78, bed 3. Admitted yesterday with community acquired pneumonia, on IV co-amoxiclav. PMH COPD, type 2 diabetes on insulin, AF on apixaban. Allergic to penicillin? Family say he had a rash in 2019, pharmacy to confirm. Obs this afternoon RR 22, sats 93% on 2L, BP 118/70, HR 96, temp 37.9, NEWS 5. A bit more confused tonight than this morning. Eating poorly, blood sugars 14-16. Mobilising with frame, had a near-miss fall at 15:00. Plan: chase CRP and U&Es from this morning, repeat obs hourly, medical review if NEWS rises, update falls assessment.";
var NOTE_B1="M.H., 84, bed 1. Day 2 after right hip fracture repair (hemiarthroplasty). PMH osteoporosis, hypertension. No known drug allergies. Obs stable, NEWS 1. Pain controlled with regular paracetamol and PRN oramorph, last dose 18:00. Wound clean and dry. Physio got her up with a frame today. Catheter out at 12:00, not passed urine since. On enoxaparin for VTE prophylaxis. Plan: bladder scan at 20:00, encourage fluids, OT assessment tomorrow.";
var NOTE_B6="G.E., 67, bed 6. Admitted 3 days ago with decompensated heart failure, on IV furosemide. PMH ischaemic heart disease, AF on apixaban, CKD stage 3. No known drug allergies. Obs this evening RR 19, sats 95% on air, BP 108/64, HR 90, NEWS 2. Weight down 2.1 kg since admission, still swollen to the knees. Fluid balance negative 1.2 L today. Creatinine up from 110 to 138, potassium 5.6. Plan: chase repeat U&Es tonight, daily weights, strict fluid balance, medical review of diuretic dose in the morning.";
var DIS_B5="T.W., 72 M. Admitted 14/10 via ED with 2 days of fever, rigors and dysuria.\nDx: urosepsis (E. coli in blood and urine cultures).\nAlso: AKI on admission (creatinine 168, baseline 95), resolved with IV fluids (102 on discharge).\nPMH: hypertension, type 2 diabetes, benign prostatic hyperplasia.\nAllergies: none known.\nCourse: IV gentamicin for 48 hours, then oral co-trimoxazole. Bladder scan 320 ml residual, catheter not needed. Mobile and back to baseline.\nMeds: new tamsulosin 400mcg od (incomplete bladder emptying); ramipril reduced 5mg -> 2.5mg od (AKI); metformin held on admission, restarted 18/10; co-trimoxazole 960mg bd to complete 7 days (last dose 21/10).\nGP to: repeat U&Es in 1 week; increase ramipril back to 5mg if renal function stable; consider urology referral if a further UTI.\nTold patient: finish the antibiotics; come back if fever, shivering or confusion return; drink regularly.\nDischarged home with wife 19/10.";
var DIS_B6="G.E., 67 F. Admitted 15/10 with 1 week of worsening breathlessness and leg swelling.\nDx: decompensated heart failure with reduced ejection fraction (EF 35% on echo).\nAlso: hyperkalaemia (K 5.8) on admission, resolved after spironolactone held.\nPMH: ischaemic heart disease, AF, CKD stage 3.\nAllergies: none known.\nCourse: IV furosemide for 4 days, weight down 4.2 kg (82.1 -> 77.9 kg). Seen by the heart failure nurse.\nMeds: furosemide changed 40mg -> 80mg od; stop spironolactone (hyperkalaemia); new dapagliflozin 10mg od (heart failure); continue apixaban 5mg bd.\nGP to: U&Es and potassium in 5 days; review if weight rises by more than 2 kg in 3 days; heart failure nurse follow-up in 2 weeks.\nTold patient: weigh every morning; keep to 1.5 litres of fluid a day; call if breathless lying flat or ankles swell more.\nDischarged home 21/10.";
var PATIENTS=[
  {id:'b1',bed:'Bed 1',who:'M.H. · 84 F',why:'Day 2 after hip fracture repair',pmh:'osteoporosis, hypertension',allergy:'None known',flags:['Falls risk'],traj:'stable',ago:190,notes:NOTE_B1,
   start:{rr:18,spo2:95,o2:'Air',sbp:128,hr:88,acvpu:'Alert',temp:37.4}},
  {id:'b2',bed:'Bed 2',who:'D.O. · 46 M',why:'Community-acquired pneumonia, day 4',pmh:'asthma',allergy:'None known',flags:[],traj:'improving',ago:70,
   start:{rr:23,spo2:93,o2:'Oxygen',sbp:112,hr:104,acvpu:'Alert',temp:38.4}},
  {id:'b3',bed:'Bed 3',who:'A.P. · 78 M',why:'Community-acquired pneumonia, day 2',pmh:'COPD, type 2 diabetes on insulin, AF on apixaban',allergy:'Penicillin? (to confirm)',flags:['Allergy query','Falls risk'],traj:'deteriorating',ago:45,notes:NOTE_B3,
   start:{rr:18,spo2:96,o2:'Air',sbp:132,hr:84,acvpu:'Alert',temp:37.3}},
  {id:'b4',bed:'Bed 4',who:'P.S. · 59 F',why:'Diabetic foot infection, IV antibiotics',pmh:'type 2 diabetes, peripheral neuropathy',allergy:'None known',flags:[],traj:'stable',ago:130,
   start:{rr:16,spo2:97,o2:'Air',sbp:142,hr:86,acvpu:'Alert',temp:37.4}},
  {id:'b5',bed:'Bed 5',who:'T.W. · 72 M',why:'Urosepsis, improving: going home today',pmh:'hypertension, type 2 diabetes, BPH',allergy:'None known',flags:['Discharge today'],traj:'improving',ago:290,discharge:DIS_B5,
   start:{rr:21,spo2:95,o2:'Air',sbp:104,hr:98,acvpu:'Alert',temp:38.2}},
  {id:'b6',bed:'Bed 6',who:'G.E. · 67 F',why:'Heart failure, IV diuretics',pmh:'ischaemic heart disease, AF on apixaban, CKD stage 3',allergy:'None known',flags:[],traj:'drift',ago:160,notes:NOTE_B6,discharge:DIS_B6,
   start:{rr:18,spo2:96,o2:'Air',sbp:118,hr:84,acvpu:'Alert',temp:36.9}}
];
var NORMAL={rr:16,spo2:97,sbp:126,hr:76,temp:36.9};
function step(v,traj,rng){
  var n=function(a){return (rng()-.5)*2*a},x=Object.assign({},v);
  if(traj==='stable'||traj==='treated-stable'){
    x.rr+=Math.round(n(1));x.spo2+=Math.round(n(1));x.sbp+=Math.round(n(6));x.hr+=Math.round(n(5));x.temp+=n(.2);
  }else if(traj==='improving'||traj==='treated'){
    x.rr+=Math.round((NORMAL.rr-x.rr)*.35+n(1));x.spo2+=Math.round((NORMAL.spo2-x.spo2)*.4+n(.6));x.sbp+=Math.round((NORMAL.sbp-x.sbp)*.3+n(4));
    x.hr+=Math.round((NORMAL.hr-x.hr)*.3+n(3));x.temp+=(NORMAL.temp-x.temp)*.35+n(.1);
    if(x.o2==='Oxygen'&&x.spo2>=96)x.o2='Air';
    if(x.acvpu!=='Alert'&&rng()<.5)x.acvpu='Alert';
  }else{
    var k=traj==='drift'?.3:.6;
    x.rr+=Math.round((1+rng())*k);x.spo2-=Math.round((rng()<.7?1:0)*k+(k<1?0:0));x.sbp-=Math.round((3+rng()*4)*k);x.hr+=Math.round((4+rng()*4)*k);x.temp+=(.1+rng()*.2)*k;
    if(x.o2==='Air'&&x.spo2<=92){x.o2='Oxygen';x.spo2+=3}
    if(traj==='deteriorating'&&score(x).total>=6&&x.acvpu==='Alert'&&rng()<.45)x.acvpu='New confusion';
  }
  x.rr=clamp(x.rr,9,34);x.spo2=clamp(x.spo2,86,100);x.sbp=clamp(x.sbp,84,190);x.hr=clamp(x.hr,48,148);x.temp=Math.round(clamp(x.temp,35.6,40)*10)/10;
  return x;
}
var store=H.store={patients:[],log:[],subs:[],live:true};
function rebuild(){
  var now=new Date();now.setSeconds(0,0);now.setMinutes(Math.floor(now.getMinutes()/5)*5);
  store.now=now;store.log=[];
  store.patients=PATIENTS.map(function(p,i){
    var rng=mulberry(11+i*7),v=Object.assign({},p.start),hist=[],last=new Date(now.getTime()-p.ago*6e4);
    for(var k=5;k>=0;k--){hist.push({t:new Date(last.getTime()-k*4*36e5),v:v,by:'ward'});v=step(v,p.traj,rng)}
    return Object.assign({},p,{hist:hist,rng:mulberry(101+i*13),traj0:p.traj,escalated:null});
  });
}
rebuild();
store.reset=function(){rebuild();emit('reset')};
store.get=function(id){for(var i=0;i<store.patients.length;i++)if(store.patients[i].id===id)return store.patients[i];return store.patients[0]};
store.latest=function(p){return p.hist[p.hist.length-1]};
store.scoreOf=function(p){return score(store.latest(p).v)};
store.due=function(p){var l=store.latest(p);return new Date(l.t.getTime()+band(score(l.v)).freq*6e4)};
store.on=function(fn){store.subs.push(fn)};
function emit(why){store.subs.forEach(function(fn){try{fn(why)}catch(e){console.error(e)}})}
store.emit=emit;
store.addLog=function(text){store.log.unshift({t:new Date(store.now),text:text});emit('log')};
store.addObs=function(id,v){var p=store.get(id);p.hist.push({t:new Date(store.now),v:Object.assign({},v),by:'you'});store.addLog(p.bed+': observations charted, NEWS2 '+score(v).total);emit('obs')};
store.escalate=function(id){var p=store.get(id);p.escalated=new Date(store.now);if(p.traj==='deteriorating'||p.traj==='drift')p.traj='treated';store.addLog(p.bed+': escalation sent to the outreach team');emit('escalate')};
store.tick=function(mins){
  store.now=new Date(store.now.getTime()+(mins||15)*6e4);
  var changed=[];
  store.patients.forEach(function(p){
    var due=store.due(p);
    if(due<=store.now){
      var v=step(store.latest(p).v,p.traj,p.rng);
      if(p.traj==='treated'&&score(v).total<=2)p.traj='treated-stable';
      p.hist.push({t:due,v:v,by:'ward'});changed.push(p.id);
      var sc=score(v);if(sc.total>=5||sc.three)store.log.unshift({t:due,text:p.bed+': NEWS2 '+sc.total+', '+band(sc).name.toLowerCase()+' risk'});
    }
  });
  store.lastChanged=changed;emit('tick');
};

/* small SVG trend line used on bed cards and in the NEWS2 tool */
function sparkSVG(points,opts){
  opts=opts||{};var W=opts.w||360,Hh=opts.h||110,px=opts.px==null?30:opts.px,py=opts.py||14;
  var vals=points.map(function(p){return p.v}),max=Math.max(8,Math.max.apply(null,vals)+1),n=points.length;
  var x=function(i){return px+(n<2?0:i*(W-px-14)/(n-1))},y=function(v){return Hh-py-v*(Hh-2*py)/max};
  var s='';
  if(opts.guides!==false)[[5,'#FFB27A'],[7,'#F08A8A']].forEach(function(t){s+='<line x1="'+px+'" x2="'+(W-8)+'" y1="'+y(t[0])+'" y2="'+y(t[0])+'" stroke="'+t[1]+'" stroke-width="1.2" stroke-dasharray="4 3"/>'+(opts.labels!==false?'<text x="'+(px-6)+'" y="'+(y(t[0])+3)+'" text-anchor="end">'+t[0]+'</text>':'')});
  var solid=points.filter(function(p){return !p.pending});
  s+='<polyline fill="none" style="stroke:var(--spark)" stroke-width="2" stroke-linejoin="round" points="'+solid.map(function(p,i){return x(i)+','+y(p.v)}).join(' ')+'"/>';
  if(points.length>solid.length){var a=solid.length-1;s+='<line x1="'+x(a)+'" y1="'+y(solid[a].v)+'" x2="'+x(a+1)+'" y2="'+y(points[a+1].v)+'" style="stroke:var(--spark)" stroke-width="2" stroke-dasharray="3 3"/>'}
  points.forEach(function(p,i){var last=i===n-1;
    s+='<circle cx="'+x(i)+'" cy="'+y(p.v)+'" r="'+(last?(opts.small?3.4:5):(opts.small?0:3.2))+'" style="fill:'+(last&&!p.pending?'var(--spark)':'var(--spark-bg)')+';stroke:var(--spark)" stroke-width="1.6"/>';
    if(opts.labels!==false){s+='<text x="'+x(i)+'" y="'+(y(p.v)-9)+'" text-anchor="middle" style="fill:var(--ink)">'+p.v+'</text><text x="'+x(i)+'" y="'+(Hh-1)+'" text-anchor="middle">'+esc(p.label||'')+'</text>'}
  });
  return s;
}

/* ---------- tool: ward overview ---------- */
function ward(root){
  var S=scope(root),sortBy='risk',onlyAttn=false,inView=true,timer=null,drawer=null;
  root.innerHTML=
   '<div class="hv-wardbar"><span class="ttl">Ward 6 · Acute medicine</span>'+
   '<span class="hv-clock"><span class="hv-live" data-live-dot></span>Ward time <b data-clock></b><span data-speed>demo clock, 15 min every 2.5 s</span></span>'+
   '<span class="ctl"><button class="hv-btn sm" data-k="live" type="button"></button>'+
   '<span class="hv-seg" role="group" aria-label="Sort beds"><button type="button" data-sort="risk" aria-pressed="true">By risk</button><button type="button" data-sort="bed" aria-pressed="false">By bed</button></span>'+
   '<button class="hv-btn sm" data-k="attn" type="button" aria-pressed="false">Needs attention</button></span></div>'+
   '<div class="hv-kpis"><div class="hv-kpi"><b data-kpi="n"></b><span>patients on the ward</span></div><div class="hv-kpi hot"><b data-kpi="hi"></b><span>NEWS2 of 5 or more</span></div><div class="hv-kpi"><b data-kpi="due"></b><span>obs due in the next 30 min</span></div><div class="hv-kpi"><b data-kpi="esc"></b><span>escalations sent</span></div></div>'+
   '<ul class="hv-alerts" data-alerts aria-live="polite"></ul>'+
   '<div class="hv-beds" data-beds></div>'+
   '<div class="hv-legend"><span><span class="hv-band b0">0</span> routine, 12-hourly</span><span><span class="hv-band b1">1-4</span> 4-6 hourly</span><span><span class="hv-band b2">5-6</span> hourly, urgent review</span><span><span class="hv-band b3">7+</span> continuous, emergency</span></div>';
  function attn(p){var sc=store.scoreOf(p),mins=(store.due(p)-store.now)/6e4;return sc.total>=5||sc.three||mins<=30}
  function render(){
    var fk=document.activeElement&&root.contains(document.activeElement)?document.activeElement.getAttribute('data-k'):null;
    S.q('[data-clock]').textContent=hm(store.now);
    var lb=S.q('[data-k="live"]');lb.innerHTML=store.live?'&#10073;&#10073; Pause':'&#9654; Live';lb.setAttribute('aria-label',store.live?'Pause the demo clock':'Start the demo clock');
    S.q('[data-live-dot]').classList.toggle('on',store.live);
    var ps=store.patients.slice();
    if(sortBy==='risk')ps.sort(function(a,b){return store.scoreOf(b).total-store.scoreOf(a).total||(a.bed<b.bed?-1:1)});
    var hi=0,due=0,escs=0;
    store.patients.forEach(function(p){var sc=store.scoreOf(p);if(sc.total>=5)hi++;if((store.due(p)-store.now)/6e4<=30)due++;if(p.escalated)escs++});
    S.q('[data-kpi="n"]').textContent=store.patients.length;S.q('[data-kpi="hi"]').textContent=hi;S.q('[data-kpi="due"]').textContent=due;S.q('[data-kpi="esc"]').textContent=escs;
    var al=store.patients.filter(function(p){var sc=store.scoreOf(p),l=store.latest(p);return (sc.total>=5||sc.three)&&!(p.escalated&&p.escalated>=l.t)});
    S.q('[data-alerts]').innerHTML=al.map(function(p){var sc=store.scoreOf(p),b=band(sc);
      return '<li class="hv-alert"><span class="hv-chip fill-r">NEWS2 '+sc.total+'</span><span><b>'+p.bed+' · '+esc(p.who)+'</b> · '+b.name.toLowerCase()+' risk, '+(sc.total>=7?'emergency':'urgent')+' response needed</span><button class="hv-btn sm primary" type="button" data-k="esc-'+p.id+'" data-open="news" data-pid="'+p.id+'">Review and escalate &rarr;</button></li>'}).join('');
    S.q('[data-beds]').innerHTML=ps.filter(function(p){return !onlyAttn||attn(p)}).map(function(p){
      var l=store.latest(p),sc=score(l.v),b=band(sc),d=store.due(p),mins=Math.round((d-store.now)/6e4);
      var pts=p.hist.slice(-8).map(function(h){return {v:score(h.v).total}});
      var prev=p.hist.length>1?score(p.hist[p.hist.length-2].v).total:sc.total,arrow=sc.total>prev?'↗ rising':sc.total<prev?'↘ falling':'→ steady';
      var dueTxt=mins<0?'<span class="due over">Obs overdue '+(-mins)+' min</span>':mins<=30?'<span class="due soon">Obs due '+hm(d)+' ('+mins+' min)</span>':'<span class="due">Next obs '+hm(d)+'</span>';
      var isNew=store.lastChanged&&store.lastChanged.indexOf(p.id)>=0;
      return '<div class="hv-bed'+((sc.total>=5||sc.three)&&!(p.escalated&&p.escalated>=l.t)?' alert':'')+(isNew?' flash':'')+'" data-bed="'+p.id+'">'+
        '<div class="top"><span class="bn">'+p.bed+'</span><span class="who">'+esc(p.who)+'</span><span class="hv-band '+b.cls+'" style="margin-left:auto">'+b.name+'</span></div>'+
        '<div class="why">'+esc(p.why)+'</div>'+
        '<div class="mid"><span class="ns">'+sc.total+'<small>NEWS2</small></span><svg viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">'+sparkSVG(pts,{w:200,h:44,px:2,py:6,labels:false,small:true})+'</svg></div>'+
        '<div class="meta"><span>'+arrow+'</span><span>· last '+hm(l.t)+'</span>'+dueTxt+'</div>'+
        '<div class="meta">'+p.flags.map(function(f){return '<span class="hv-chip '+(/allergy/i.test(f)?'r':/discharge/i.test(f)?'g':'a')+'">'+esc(f)+'</span>'}).join('')+(p.escalated?'<span class="hv-chip b">escalated '+hm(p.escalated)+'</span>':'')+'</div>'+
        '<div class="acts"><button class="hv-btn sm" type="button" data-k="chart-'+p.id+'" data-chart="'+p.id+'">Obs chart</button>'+
        '<button class="hv-btn sm" type="button" data-k="obs-'+p.id+'" data-open="news" data-pid="'+p.id+'">Record obs</button>'+
        (p.notes?'<button class="hv-btn sm ghost" type="button" data-k="ho-'+p.id+'" data-open="sbar" data-pid="'+p.id+'">Handover</button>':'')+
        (p.discharge?'<button class="hv-btn sm ghost" type="button" data-k="dc-'+p.id+'" data-open="discharge" data-pid="'+p.id+'">Discharge letter</button>':'')+'</div></div>'}).join('')||'<p class="hv-note">No patients need attention right now.</p>';
    store.lastChanged=null;
    if(fk){var f=root.querySelector('[data-k="'+fk+'"]');if(f)f.focus()}
    if(drawer)drawChart(drawer.pid);
  }
  function openChart(pid,from){
    if(!drawer){var d=document.createElement('div');d.className='hv hv-drawer';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
      d.innerHTML='<div tabindex="-1"></div>';document.body.appendChild(d);
      d.addEventListener('click',function(e){if(e.target===d||e.target.closest('[data-close]'))closeChart();var o=e.target.closest('[data-open]');if(o){closeChart();H.open(o.dataset.open,{pid:o.dataset.pid})}});
      d.addEventListener('keydown',function(e){if(e.key==='Escape'){closeChart();return}
        if(e.key==='Tab'){var f=Array.prototype.filter.call(d.querySelectorAll('button,a[href],[tabindex]:not([tabindex="-1"])'),function(x){return x.offsetParent!==null});if(!f.length)return;var a=f[0],z=f[f.length-1];
          if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}});
      drawer={el:d,from:from}}
    drawer.pid=pid;drawChart(pid);drawer.el.querySelector('[data-close]').focus();
  }
  function closeChart(){if(!drawer)return;var f=drawer.from;drawer.el.remove();drawer=null;if(f&&f.focus)f.focus()}
  function drawChart(pid){
    var p=store.get(pid),box=drawer.el.firstChild;drawer.el.setAttribute('aria-label',p.bed+' observation chart');
    var rows=p.hist.slice().reverse().map(function(h){var sc=score(h.v);
      return '<tr><td>'+dayHm(h.t,store.now)+(h.by==='you'?' <span class="hv-chip b">you</span>':'')+'</td>'+OBS.map(function(o){var s=sc.parts[o.k];return '<td class="'+(s?'s'+s:'')+'">'+esc(o.k==='sbp'?h.v.sbp:o.k==='acvpu'?(h.v.acvpu==='Alert'?'A':h.v.acvpu==='New confusion'?'C':h.v.acvpu.charAt(0)):fmtObs(o,h.v[o.k]))+'</td>'}).join('')+'<td class="tot">'+sc.total+'</td></tr>'}).join('');
    var pts=p.hist.slice(-8).map(function(h){return {v:score(h.v).total,label:hm(h.t)}});
    box.innerHTML='<div style="display:flex;align-items:flex-start;gap:1rem"><div style="flex:1"><h2>'+p.bed+' · '+esc(p.who)+'</h2><p class="sub">'+esc(p.why)+' · PMH: '+esc(p.pmh)+' · Allergies: '+esc(p.allergy)+'</p></div><button class="hv-btn sm" type="button" data-close>Close</button></div>'+
      '<svg class="hv-spark" viewBox="0 0 360 120" role="img" aria-label="NEWS2 trend">'+sparkSVG(pts,{h:120})+'</svg>'+
      '<div class="hv-scroll" tabindex="0" role="region" aria-label="Observation chart" style="margin-top:.6rem"><table class="hv-obstbl"><thead><tr><th>Time</th>'+OBS.map(function(o){return '<th>'+o.short+'</th>'}).join('')+'<th>NEWS2</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '<p class="hv-note">Shaded cells score 1, 2 or 3 on the NEWS2 chart. Synthetic patient.</p>'+
      '<div class="hv-row"><button class="hv-btn primary" type="button" data-open="news" data-pid="'+p.id+'">Record new observations</button>'+(p.notes?'<button class="hv-btn" type="button" data-open="sbar" data-pid="'+p.id+'">Handover notes</button>':'')+'</div>';
  }
  root.addEventListener('click',function(e){
    var t=e.target.closest('button');
    if(t){
      if(t.dataset.k==='live'){store.live=!store.live;render();return}
      if(t.dataset.k==='attn'){onlyAttn=!onlyAttn;t.setAttribute('aria-pressed',onlyAttn);t.classList.toggle('on',onlyAttn);render();return}
      if(t.dataset.sort){sortBy=t.dataset.sort;S.qa('[data-sort]').forEach(function(b){b.setAttribute('aria-pressed',b===t)});render();return}
      if(t.dataset.chart){openChart(t.dataset.chart,t);return}
      if(t.dataset.open){H.open(t.dataset.open,{pid:t.dataset.pid});return}
      return;
    }
    var bed=e.target.closest('[data-bed]');if(bed)openChart(bed.dataset.bed,bed.querySelector('[data-chart]'));
  });
  if('IntersectionObserver' in window){new IntersectionObserver(function(es){inView=es[0].isIntersecting}).observe(root)}
  timer=setInterval(function(){if(store.live&&inView&&!document.hidden)store.tick(15)},2500);
  store.on(render);render();
  return {select:function(){},root:root};
}

/* ---------- tool: early warning (NEWS2) ---------- */
function news(root){
  var S=scope(root),pid='b3',cur={},edited=false,touched=false,ids={};
  root.innerHTML=
   '<div class="hv-row top"><label class="hv-lbl" for="'+(ids.p=uid('p'))+'">Patient</label><select class="inline" id="'+ids.p+'" data-k="pid">'+store.patients.map(function(p){return '<option value="'+p.id+'">'+p.bed+' · '+esc(p.who)+'</option>'}).join('')+'</select><span class="hv-lbl" data-last></span></div>'+
   '<div class="hv-grid">'+
    '<div class="hv-card"><h3>New observations <span class="r">SpO₂ scale 1</span></h3><div class="hv-obs" data-obs></div></div>'+
    '<div class="hv-card tint"><h3 class="b">NEWS2 score</h3><div class="hv-score"><span class="big" data-total>0</span><span class="hv-band b0" data-band>Low</span></div><p class="hv-resp" data-resp></p></div>'+
    '<div class="hv-card hv-span"><h3 class="o">AI layer · trend and escalation draft <span class="r" data-freq></span></h3><div class="hv-grid">'+
      '<div><svg class="hv-spark" data-spark viewBox="0 0 360 120" role="img" aria-label="NEWS2 score trend"></svg><p style="font-size:.8rem;margin:0" data-trend></p></div>'+
      '<div><div class="hv-draft" data-draft contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="Escalation message draft, editable"></div>'+
      '<label class="hv-row chk" style="margin-top:.7rem"><input type="checkbox" data-ok> I’ve checked the patient and this message</label>'+
      '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="save">Save to chart</button><button class="hv-btn" type="button" data-k="send" disabled>Send to outreach team</button><button class="hv-btn ghost sm" type="button" data-k="copy">Copy</button></div>'+
      '<div class="hv-status" data-status role="status"></div></div>'+
    '</div></div></div>';
  var obsEl=S.q('[data-obs]');
  OBS.forEach(function(o){
    var d=document.createElement('div');d.className='hv-ob';var id=uid('o');
    if(o.type==='seg')d.innerHTML='<label id="'+id+'">'+o.label+'</label><span class="hv-seg" role="group" aria-labelledby="'+id+'">'+o.opts.map(function(x){return '<button type="button" data-k="'+o.k+'" data-v="'+x+'" aria-pressed="false">'+x+'</button>'}).join('')+'</span><output></output><span class="hv-pts"></span>';
    else if(o.type==='sel')d.innerHTML='<label for="'+id+'">'+o.label+'</label><select id="'+id+'" data-k="'+o.k+'">'+o.opts.map(function(x){return '<option>'+x+'</option>'}).join('')+'</select><output></output><span class="hv-pts"></span>';
    else d.innerHTML='<label for="'+id+'">'+o.label+'</label><input type="range" id="'+id+'" data-k="'+o.k+'" min="'+o.min+'" max="'+o.max+'" step="'+o.step+'"><output for="'+id+'"></output><span class="hv-pts"></span>';
    d._o=o;obsEl.appendChild(d);
  });
  var rows=Array.prototype.slice.call(obsEl.children);
  obsEl.addEventListener('input',function(e){var k=e.target.dataset.k;if(!k)return;var o=OBS.filter(function(x){return x.k===k})[0];cur[k]=o.type==='sel'?e.target.value:+e.target.value;touched=true;render()});
  obsEl.addEventListener('click',function(e){var b=e.target.closest('button[data-k]');if(!b)return;cur[b.dataset.k]=b.dataset.v;touched=true;render()});
  function sync(){cur=Object.assign({},store.latest(store.get(pid)).v);touched=false;
    rows.forEach(function(r){var o=r._o;if(o.type==='sel')r.querySelector('select').value=cur[o.k];else if(!o.type)r.querySelector('input').value=cur[o.k]})}
  function load(id){
    pid=id;edited=false;sync();
    S.q('[data-k="pid"]').value=id;S.q('[data-ok]').checked=false;S.q('[data-status]').textContent='';
    render(true);
  }
  function render(resetDraft){
    var p=store.get(pid),sc=score(cur),b=band(sc),l=store.latest(p);
    rows.forEach(function(r){var o=r._o,v=cur[o.k],s=sc.parts[o.k];r.querySelector('output').textContent=o.type?'':fmtObs(o,v);
      var pe=r.querySelector('.hv-pts');pe.textContent=s;pe.className='hv-pts'+(s?' s'+s:'');pe.setAttribute('aria-label',s+' points');
      if(o.type==='seg')r.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',x.dataset.v===v)})});
    S.q('[data-total]').textContent=sc.total;var be=S.q('[data-band]');be.textContent=b.name;be.className='hv-band '+b.cls;
    S.q('[data-resp]').innerHTML=b.resp+'<small>From the RCP NEWS2 clinical response chart. Local escalation policy always applies.</small>';
    S.q('[data-last]').textContent='Last charted '+dayHm(l.t,store.now)+' · NEWS2 '+score(l.v).total;
    S.q('[data-freq]').textContent='next obs within '+(b.freq>=60?b.freq/60+' h':b.freq+' min');
    var same=JSON.stringify(cur)===JSON.stringify(l.v);
    var hist=p.hist.slice(-6).map(function(h){return {v:score(h.v).total,label:hm(h.t)}});
    if(!same)hist=hist.slice(-5).concat([{v:sc.total,label:'new',pending:true}]);
    S.q('[data-spark]').innerHTML=sparkSVG(hist);
    var first=hist[0].v,d=sc.total-first,hrs=Math.round((store.now-p.hist[Math.max(0,p.hist.length-(same?6:5))].t)/36e5),txt;
    if(d>=3)txt='<span class="hv-chip r">rising</span> Up '+d+' points in about '+hrs+' hours. Each score alone may not have triggered a call, but the trend is clear. Suggest escalating now rather than waiting for the next set.';
    else if(d>=1)txt='<span class="hv-chip a">creeping up</span> Up '+d+' point'+(d>1?'s':'')+' in about '+hrs+' hours. Worth a closer look on the next round.';
    else if(d<0)txt='<span class="hv-chip g">improving</span> Down '+(-d)+' point'+(d<-1?'s':'')+' in about '+hrs+' hours.';
    else txt='<span class="hv-chip g">steady</span> No upward trend across recent observations.';
    if(p.escalated)txt+=' Escalated at '+hm(p.escalated)+'.';
    S.q('[data-trend]').innerHTML=txt;
    if(resetDraft||!edited)S.q('[data-draft]').textContent=draft(p,sc,b,d,hrs);
    S.q('[data-k="send"]').disabled=!S.q('[data-ok]').checked||sc.total===0;
    S.q('[data-k="save"]').disabled=same;
  }
  function draft(p,sc,b,d,hrs){
    var abn=OBS.filter(function(o){return sc.parts[o.k]>0}).map(function(o){var v=cur[o.k];return o.type?(o.k==='o2'?'on supplemental oxygen':v.toLowerCase()):o.label.replace('₂','2')+' '+fmtObs(o,v)+(o.unit==='/min'?'/min':o.unit==='°C'?'C':'')});
    if(!sc.total)return 'No escalation needed. NEWS2 0, observations within normal range. Continue routine monitoring.';
    return 'S: '+p.bed+', '+p.who.split(' · ')[0]+', NEWS2 '+sc.total+' ('+b.name.toLowerCase()+')'+(d>=3?', up '+d+' points in about '+hrs+' hours':'')+'.\n'+
      'B: '+p.why+'. PMH '+p.pmh+'. Allergies: '+p.allergy+'.\n'+
      'A: '+(abn.length?abn.join(', '):'observations otherwise normal')+'. I am '+(sc.total>=5?'concerned':'monitoring closely')+'.\n'+
      'R: Please '+(sc.total>=7?'attend now for an emergency review':sc.total>=5||sc.three?'review urgently within the hour':'review on your next round')+'. I will repeat observations '+(b.freq<=30?'continuously':b.freq<=60?'hourly':'every 4 hours')+'.';
  }
  root.addEventListener('change',function(e){if(e.target.dataset.k==='pid')load(e.target.value);if(e.target.matches('[data-ok]'))render()});
  S.q('[data-draft]').addEventListener('input',function(){edited=true});
  root.addEventListener('click',function(e){var b=e.target.closest('button[data-k]');if(!b)return;
    if(b.dataset.k==='save'){touched=false;store.addObs(pid,cur);S.q('[data-status]').textContent='✓ Saved to '+store.get(pid).bed+'’s chart at '+hm(store.now)+'. The ward board has updated.';render()}
    else if(b.dataset.k==='send'){store.escalate(pid);S.q('[data-status]').textContent='✓ Escalation logged at '+hm(store.now)+' (simulated: nothing is sent). The message and who approved it go in the audit trail.';S.q('[data-ok]').checked=false;edited=false;render()}
    else if(b.dataset.k==='copy')copyText(S.q('[data-draft]').innerText,b);
  });
  // follow new charted observations unless the nurse is part-way through entering a set
  store.on(function(why){if(why==='reset'){load(pid);return}if(!touched)sync();render()});
  load(pid);
  return {select:function(ctx){if(ctx.pid)load(ctx.pid)}};
}

/* ---------- tool: handover (SBAR) ---------- */
var FLAGS=[
  {sev:'hi',test:function(t){return /allerg\w*\s+to\s+penicillin|penicillin\s+allerg/i.test(t)&&/co-amoxiclav|amoxicillin|flucloxacillin|piperacillin|tazocin|benzylpenicillin/i.test(t)},msg:'Possible penicillin allergy while prescribed a penicillin-based antibiotic. Check with the prescriber and pharmacy before the next dose.',src:/[^.]*(penicillin|co-amoxiclav)[^.]*\.?/i},
  {sev:'hi',test:function(t){return /(more|new(ly)?|increas\w*)\s+confus|confus\w*\s+(tonight|today|than)/i.test(t)},msg:'New or worsening confusion: possible delirium. Consider a 4AT screen and look for a cause.',src:/[^.]*confus[^.]*\.?/i},
  {sev:'hi',test:function(t){var m=t.match(/potassium\s*(?:of\s*)?(\d+(?:\.\d+)?)|\bK\+?\s*(\d+(?:\.\d+)?)/i);return m&&+(m[1]||m[2])>=5.5},msg:'High potassium. Check the repeat result is chased tonight and follow local hyperkalaemia guidance.',src:/[^.]*(potassium|\bK\+?\s*\d)[^.]*\.?/i},
  {sev:'md',test:function(t){var m=t.match(/NEWS2?\s*(?:score\s*)?(\d+)/i);return m&&+m[1]>=5},msg:'NEWS2 of 5 or more: urgent response threshold. Confirm the medical team is aware.',src:/[^.]*NEWS2?\s*\d+[^.]*\.?/i},
  {sev:'md',test:function(t){return /creatinine\s+(up|rose|rising)/i.test(t)},msg:'Creatinine rising: possible acute kidney injury. Review fluid balance, diuretic dose and nephrotoxic medicines.',src:/[^.]*creatinine[^.]*\.?/i},
  {sev:'md',test:function(t){return /fall|fell/i.test(t)},msg:'Fall or near-miss fall this shift. Update the falls assessment and consider bed rails, alarms and footwear.',src:/[^.]*(fall|fell)[^.]*\.?/i},
  {sev:'md',test:function(t){return /apixaban|rivaroxaban|edoxaban|dabigatran|warfarin|enoxaparin|dalteparin|heparin/i.test(t)},msg:'On an anticoagulant. Bleeding risk after any fall or before procedures; check doses against kidney function.',src:/[^.]*(apixaban|rivaroxaban|edoxaban|dabigatran|warfarin|enoxaparin|dalteparin|heparin)[^.]*\.?/i},
  {sev:'md',test:function(t){return /insulin/i.test(t)&&/(sugars?|glucose|BMs?|CBGs?)\s*\d{2}/i.test(t)},msg:'High blood glucose on insulin. Check the insulin plan and monitoring frequency, especially while eating poorly.',src:/[^.]*(sugars?|glucose|BMs?|CBGs?)\s*\d[^.]*\.?/i},
  {sev:'md',test:function(t){return /not\s+passed\s+urine|retention|no\s+urine\s+output/i.test(t)},msg:'Hasn’t passed urine since the catheter came out. Make sure the bladder scan happens on time.',src:/[^.]*(not passed urine|retention|no urine)[^.]*\.?/i},
  {sev:'lo',test:function(t){return /allerg\w*[^.]*\?|pharmacy to confirm/i.test(t)},msg:'Allergy status unconfirmed. Make sure it’s resolved and recorded before handover ends.',src:/[^.]*allerg[^.]*\?[^.]*\.?|[^.]*pharmacy to confirm[^.]*\.?/i},
  {sev:'lo',test:function(t){return /chase|pending|awaiting/i.test(t)},msg:'Results to chase. Added to the recommendations so they aren’t lost.',src:/[^.]*(chase|pending|awaiting)[^.]*\.?/i},
  {sev:'lo',test:function(t){return /oramorph|morphine|oxycodone|fentanyl/i.test(t)},msg:'Controlled drug given as needed. Hand over the time of the last dose.',src:/[^.]*(oramorph|morphine|oxycodone|fentanyl)[^.]*\.?/i}
];
function sbar(root){
  var S=scope(root),ids={n:uid('n'),p:uid('p')},withNotes=store.patients.filter(function(p){return p.notes}),pid=withNotes[0]?'b3':null;
  root.innerHTML=
   '<div class="hv-row top"><label class="hv-lbl" for="'+ids.p+'">Notes for</label><select class="inline" id="'+ids.p+'" data-k="pid">'+withNotes.map(function(p){return '<option value="'+p.id+'">'+p.bed+' · '+esc(p.who)+'</option>'}).join('')+'</select></div>'+
   '<div class="hv-grid">'+
    '<div class="hv-card"><h3>Free-text notes <span class="r">type or paste</span></h3><label class="sr" for="'+ids.n+'">Handover notes</label><textarea id="'+ids.n+'" data-notes spellcheck="false"></textarea>'+
    '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="go">Structure into SBAR</button></div></div>'+
    '<div class="hv-card tint"><h3 class="o">Safety flags <span class="r" data-count></span></h3><ul class="hv-flags" data-flags></ul></div>'+
    '<div class="hv-card hv-span" data-out><h3 class="b">SBAR handover <span class="r">click any section to edit, then approve it</span></h3><div class="hv-sbar" data-sbar></div>'+
    '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="sign" disabled>Sign off handover</button><button class="hv-btn sm" type="button" data-k="copy">Copy</button><button class="hv-btn sm" type="button" data-k="print">Print</button><span class="hv-status" data-status role="status" style="margin:0"></span></div></div>'+
   '</div>';
  var noteIn=S.q('[data-notes]');
  function split(t){return t.replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean)}
  function run(){
    var t=noteIn.value,s=split(t),SB=[[],[],[],[]];
    s.forEach(function(x,i){
      if(/^(plan|to do|todo|actions?)\s*[:\-]/i.test(x)){x.replace(/^[^:\-]+[:\-]\s*/,'').split(/,\s*|;\s*|\s+and\s+(?=[a-z])/).forEach(function(y){y=y.replace(/\.$/,'').trim();if(y)SB[3].push(y.charAt(0).toUpperCase()+y.slice(1))});return}
      if(/^(please|needs|chase|repeat|for\s)/i.test(x)){SB[3].push(x);return}
      if(i===0||/admitted|presented|day\s+\d+\s+(after|post)|post[- ]op/i.test(x)){SB[0].push(x);return}
      if(/PMH|history|background|known|allerg|NKDA|family say|^on\s/i.test(x)){SB[1].push(x);return}
      SB[2].push(x);
    });
    S.q('[data-sbar]').innerHTML=[['S','Situation'],['B','Background'],['A','Assessment'],['R','Recommendation']].map(function(z,i){return '<div class="hv-sb"><h4><i>'+z[0]+'</i>'+z[1]+'</h4><div class="hv-edit" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="'+z[1]+', editable"><ul>'+SB[i].map(function(y){return '<li>'+esc(y)+'</li>'}).join('')+'</ul></div><label class="chk"><input type="checkbox"> Approve '+z[1].toLowerCase()+'</label></div>'}).join('');
    var f=FLAGS.filter(function(x){return x.test(t)}),order={hi:0,md:1,lo:2};f.sort(function(a,b){return order[a.sev]-order[b.sev]});
    S.q('[data-flags]').innerHTML=f.length?f.map(function(x){var m=s.filter(function(y){return x.src.test(y)})[0];return '<li class="'+x.sev+'"><span class="hv-chip '+(x.sev==='hi'?'r':x.sev==='md'?'a':'m')+'">'+(x.sev==='hi'?'high':x.sev==='md'?'check':'note')+'</span> <b>'+esc(x.msg)+'</b>'+(m?'<q>From notes: “'+esc(m.trim())+'”</q>':'')+'</li>'}).join(''):'<li class="lo">No flags found. That doesn’t mean there are no risks: check the notes yourself.</li>';
    S.q('[data-count]').textContent=f.length+' found';S.q('[data-status]').textContent='';check();
  }
  function check(){var c=S.qa('[data-sbar] input[type=checkbox]');S.qa('[data-sbar] .hv-sb').forEach(function(sb){sb.classList.toggle('ok',sb.querySelector('input').checked)});S.q('[data-k="sign"]').disabled=!(c.length&&c.every(function(x){return x.checked}))}
  function asText(){return S.qa('[data-sbar] .hv-sb').map(function(sb){return sb.querySelector('h4').textContent.slice(1)+':\n'+Array.prototype.map.call(sb.querySelectorAll('li'),function(l){return '- '+l.textContent}).join('\n')}).join('\n\n')}
  S.q('[data-sbar]').addEventListener('change',check);
  S.q('[data-sbar]').addEventListener('input',function(e){var sb=e.target.closest('.hv-sb');if(sb&&e.target.closest('.hv-edit')){sb.querySelector('input').checked=false;check()}});
  root.addEventListener('change',function(e){if(e.target.dataset.k==='pid')load(e.target.value)});
  root.addEventListener('click',function(e){var b=e.target.closest('button[data-k]');if(!b)return;
    if(b.dataset.k==='go')run();
    else if(b.dataset.k==='sign'){S.q('[data-status]').textContent='✓ Handover signed off at '+hm(store.now)+' (simulated)';b.disabled=true;store.addLog(store.get(pid).bed+': handover signed off')}
    else if(b.dataset.k==='copy')copyText(asText(),b);
    else if(b.dataset.k==='print')printNode(S.q('[data-out]'));
  });
  function load(id){pid=id;S.q('[data-k="pid"]').value=id;noteIn.value=store.get(id).notes;run()}
  load(pid);
  return {select:function(ctx){if(ctx.pid&&store.get(ctx.pid).notes)load(ctx.pid)}};
}

/* ---------- tool: clinical coding (ICD-10) ---------- */
var DS_A="81-year-old woman admitted via ED with 3 days of increasing breathlessness and productive cough. Chest X-ray showed right lower lobe consolidation consistent with community-acquired pneumonia. Background of COPD, hypertension and type 2 diabetes (diet controlled). On admission she was in fast atrial fibrillation, rate controlled with bisoprolol. Creatinine rose from 88 to 162 on day 2: acute kidney injury, likely pre-renal, improved with IV fluids. Sodium 128 on admission (hyponatraemia), corrected by discharge. Troponin negative, no evidence of myocardial infarction. Urine dip positive, but urinary tract infection was ruled out on culture. Treated with antibiotics and discharged home on day 6.";
var DS_B="72-year-old man admitted via ED with 2 days of fever, rigors and dysuria. Blood and urine cultures grew E. coli: sepsis secondary to urinary tract infection. Acute kidney injury on admission (creatinine 168, baseline 95), resolved with IV fluids. Background of hypertension, type 2 diabetes and benign prostatic hyperplasia. No evidence of pyelonephritis on ultrasound. Treated with IV gentamicin then oral co-trimoxazole and discharged home on day 5.";
// WHO ICD-10 titles. conf: h = named directly, m = inferred from a related phrase
var ICD=[
  {c:'J18.9',d:'Pneumonia, unspecified',re:[[/community[- ]acquired pneumonia|pneumonia/i,'h'],[/consolidation/i,'m']],note:'Lobar pattern noted: coder to decide between J18.1 and J18.9.'},
  {c:'J44.9',d:'Chronic obstructive pulmonary disease, unspecified',re:[[/\bCOPD\b|chronic obstructive pulmonary disease/i,'h']],note:'No exacerbation documented, so not J44.1.'},
  {c:'J44.1',d:'Chronic obstructive pulmonary disease with acute exacerbation, unspecified',re:[[/exacerbation of (COPD|chronic obstructive)|(COPD|chronic obstructive pulmonary disease) exacerbation|infective exacerbation/i,'h']]},
  {c:'I10',d:'Essential (primary) hypertension',re:[[/hypertension/i,'h']]},
  {c:'E11.9',d:'Non-insulin-dependent diabetes mellitus without complications',re:[[/type 2 diabetes|T2DM|\bT2 diabetes/i,'h']]},
  {c:'E10.9',d:'Insulin-dependent diabetes mellitus without complications',re:[[/type 1 diabetes|T1DM/i,'h']]},
  {c:'I48.9',d:'Atrial fibrillation and atrial flutter, unspecified',re:[[/atrial fibrillation/i,'h'],[/\bAF\b/,'h']],note:'Type of AF (paroxysmal, persistent, permanent) not stated.'},
  {c:'N17.9',d:'Acute renal failure, unspecified',re:[[/acute kidney injury|\bAKI\b|acute renal failure/i,'h'],[/creatinine rose/i,'m']]},
  {c:'E87.1',d:'Hypo-osmolality and hyponatraemia',re:[[/hyponatr(a)?emia/i,'h'],[/sodium 1[0-2]\d\b/i,'m']]},
  {c:'I21.9',d:'Acute myocardial infarction, unspecified',re:[[/myocardial infarction|\bNSTEMI\b|\bSTEMI\b|heart attack/i,'h']]},
  {c:'A41.9',d:'Sepsis, unspecified',re:[[/sepsis|septic/i,'h']],note:'Organism documented (E. coli): coder to consider A41.5 and local sequencing rules.'},
  {c:'N39.0',d:'Urinary tract infection, site not specified',re:[[/urinary tract infection|\bUTI\b/i,'h']]},
  {c:'N10',d:'Acute tubulo-interstitial nephritis (includes acute pyelonephritis)',re:[[/pyelonephritis/i,'h']]},
  {c:'N40',d:'Hyperplasia of prostate',re:[[/benign prostatic hyperplasia|\bBPH\b/i,'h']]},
  {c:'I50.9',d:'Heart failure, unspecified',re:[[/heart failure|\bCCF\b/i,'h']]},
  {c:'F05.9',d:'Delirium, unspecified',re:[[/delirium/i,'h'],[/acute confusion/i,'m']]},
  {c:'J45.9',d:'Asthma, unspecified',re:[[/asthma/i,'h']]},
  {c:'I63.9',d:'Cerebral infarction, unspecified',re:[[/ischaemic stroke|cerebral infarct/i,'h']]},
  {c:'I26.9',d:'Pulmonary embolism without mention of acute cor pulmonale',re:[[/pulmonary embol/i,'h'],[/\bPE\b/,'h']]},
  {c:'D64.9',d:'Anaemia, unspecified',re:[[/an(a)?emia/i,'h']]},
  {c:'F03',d:'Unspecified dementia',re:[[/dementia/i,'h']]},
  {c:'E03.9',d:'Hypothyroidism, unspecified',re:[[/hypothyroid/i,'h']]}
];
var NEG_BEFORE=/\b(no|not|without|denies|denied|negative for|no evidence of|no signs? of|ruled out|excluded|unlikely)\b[^.,;:]{0,40}$/i;
var NEG_AFTER=/^[^.;]{0,30}\b(ruled out|excluded|unlikely|not confirmed)\b/i;
function code(root){
  var S=scope(root),ids={d:uid('d'),e:uid('e')};
  root.innerHTML=
   '<div class="hv-row top"><label class="hv-lbl" for="'+ids.e+'">Example</label><select class="inline" id="'+ids.e+'" data-k="ex"><option value="a">Pneumonia, 81-year-old woman</option><option value="b">Urosepsis, Bed 5 (T.W.)</option></select></div>'+
   '<div class="hv-grid">'+
    '<div class="hv-card"><h3>Discharge summary <span class="r">synthetic</span></h3><label class="sr" for="'+ids.d+'">Discharge summary text</label><textarea id="'+ids.d+'" data-ds spellcheck="false"></textarea>'+
    '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="go">Suggest codes</button></div></div>'+
    '<div class="hv-card tint"><h3 class="b">Evidence view <span class="r">tap a highlight</span></h3><div class="hv-doc" data-doc aria-live="polite"></div><p class="hv-note">Highlighted: a suggested code. Struck through: mentioned but negated (“no evidence of”, “ruled out”), so not coded.</p></div>'+
    '<div class="hv-card hv-span"><h3>Suggested ICD-10 codes <span class="r" data-count></span></h3><div class="hv-codes" data-codes></div><div class="hv-episode" data-ep></div>'+
    '<div class="hv-row"><button class="hv-btn sm" type="button" data-k="copy">Copy coded episode</button></div>'+
    '<p class="hv-note">Code titles follow the WHO ICD-10. This demo knows about twenty common diagnoses; a real tool would use the full classification, the national coding standards and your trust’s local rules.</p></div>'+
   '</div>';
  var ds=S.q('[data-ds]');
  function run(){
    var t=ds.value,hits=[],found={};
    ICD.forEach(function(x){x.re.forEach(function(r){
      var g=new RegExp(r[0].source,r[0].flags.indexOf('i')>=0?'gi':'g'),m;
      while((m=g.exec(t))){
        var pre=t.slice(Math.max(0,m.index-60),m.index),ss=pre.lastIndexOf('.');pre=ss>=0?pre.slice(ss+1):pre;
        var post=t.slice(m.index+m[0].length,m.index+m[0].length+40),neg=NEG_BEFORE.test(pre)||NEG_AFTER.test(post);
        if(hits.some(function(h){return m.index<h.e&&m.index+m[0].length>h.s}))continue;
        hits.push({s:m.index,e:m.index+m[0].length,c:x.c,neg:neg});
        var f=found[x.c]||(found[x.c]={x:x,conf:'m',neg:true,ev:[]});if(r[1]==='h')f.conf='h';if(!neg)f.neg=false;
        var a=t.lastIndexOf('.',m.index-1)+1,b=t.indexOf('.',m.index);f.ev.push(t.slice(a,b<0?t.length:b+1).trim());
      }
    })});
    hits.sort(function(a,b){return a.s-b.s});
    var html='',p=0;hits.forEach(function(h){html+=esc(t.slice(p,h.s))+'<mark data-c="'+h.c+'" class="'+(h.neg?'neg':'')+'" tabindex="0">'+esc(t.slice(h.s,h.e))+'</mark>';p=h.e});html+=esc(t.slice(p));
    S.q('[data-doc]').innerHTML=html;
    var list=Object.keys(found).map(function(k){return found[k]});list.sort(function(a,b){return (a.neg-b.neg)||(t.indexOf(a.ev[0])-t.indexOf(b.ev[0]))});
    S.q('[data-codes]').innerHTML=list.length?list.map(function(f){var x=f.x;
      return '<div class="hv-code'+(f.neg?' neg':'')+'" data-c="'+x.c+'"><span class="c">'+x.c+'</span><span class="d">'+esc(x.d)+'<small>'+(f.neg?'Mentioned but negated: not coded':(f.conf==='h'?'<span class="hv-chip g">named in text</span>':'<span class="hv-chip a">inferred, check</span>')+(x.note?' '+esc(x.note):''))+'</small></span>'+
      (f.neg?'<span class="acts"><span class="hv-chip m">excluded</span></span>':'<span class="acts"><button class="hv-btn sm" type="button" data-a="acc" aria-pressed="false">Accept</button><button class="hv-btn sm ghost" type="button" data-a="rej" aria-pressed="false">Reject</button></span>')+'</div>'}).join(''):'<p class="hv-note">No codes found. Try mentioning a diagnosis such as pneumonia, AF or heart failure.</p>';
    var pos=list.filter(function(f){return !f.neg}).length;S.q('[data-count]').textContent=pos+' suggested · '+(list.length-pos)+' excluded';episode();
  }
  function episode(){var acc=S.qa('.hv-code.acc').map(function(e){return e.dataset.c});
    S.q('[data-ep]').innerHTML=acc.length?'<b>Coded episode:</b> '+acc.map(function(c,i){return c+(i===0?' (primary)':'')}).join(', ')+'<br><span style="color:var(--dim);font-size:.72rem">The first accepted code is the primary diagnosis; the coder can reorder. Signed off by the coder, not the tool.</span>':'<span style="color:var(--dim)">Accept codes to build the coded episode. The first one you accept becomes the primary diagnosis.</span>'}
  function hot(c){S.qa('[data-doc] mark').forEach(function(m){m.classList.toggle('hot',!!c&&m.dataset.c===c)});if(c){var m=S.q('[data-doc] mark[data-c="'+c+'"]'),d=S.q('[data-doc]');if(m)d.scrollTop=m.offsetTop-d.offsetTop-40}}
  S.q('[data-codes]').addEventListener('click',function(e){var b=e.target.closest('button[data-a]');if(!b)return;var row=b.closest('.hv-code'),a=b.dataset.a,was=row.classList.contains(a);
    row.classList.remove('acc','rej');if(!was)row.classList.add(a);row.querySelectorAll('[data-a]').forEach(function(x){x.setAttribute('aria-pressed',row.classList.contains(x.dataset.a))});
    if(a==='acc'&&!was){var box=row.parentNode;box.appendChild(row);var first=box.querySelector('.hv-code:not(.acc)');S.qa('.hv-code.acc').forEach(function(r){box.insertBefore(r,first)});b.focus()}
    episode()});
  S.q('[data-codes]').addEventListener('mouseover',function(e){var r=e.target.closest('.hv-code');hot(r&&r.dataset.c)});
  S.q('[data-codes]').addEventListener('focusin',function(e){var r=e.target.closest('.hv-code');hot(r&&r.dataset.c)});
  function pick(m){hot(m.dataset.c);S.qa('.hv-code').forEach(function(r){r.classList.toggle('pick',r.dataset.c===m.dataset.c)})}
  S.q('[data-doc]').addEventListener('click',function(e){var m=e.target.closest('mark');if(m)pick(m)});
  S.q('[data-doc]').addEventListener('keydown',function(e){var m=e.target.closest('mark');if(m&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pick(m)}});
  root.addEventListener('change',function(e){if(e.target.dataset.k==='ex'){ds.value=e.target.value==='b'?DS_B:DS_A;run()}});
  root.addEventListener('click',function(e){var b=e.target.closest('button[data-k]');if(!b)return;if(b.dataset.k==='go')run();else if(b.dataset.k==='copy')copyText(S.q('[data-ep]').innerText,b)});
  ds.value=DS_A;run();
  return {select:function(ctx){if(ctx.example){S.q('[data-k="ex"]').value=ctx.example;ds.value=ctx.example==='b'?DS_B:DS_A;run()}}};
}

/* ---------- tool: discharge summary -> GP letter ---------- */
var FREQ={od:'once a day',bd:'twice a day',tds:'three times a day',qds:'four times a day',nocte:'at night',prn:'when needed'};
function parseMed(item){
  var s=item.trim().replace(/\.$/,''),reason=(s.match(/\(([^)]+)\)/)||[])[1]||'',base=s.replace(/\s*\([^)]*\)/g,'').trim();
  var type='Continued',tag='course';
  if(/^(new|start(ed)?)\s+/i.test(base)){type='Started';tag='new';base=base.replace(/^(new|start(ed)?)\s+/i,'')}
  else if(/^stop(ped)?\s+/i.test(base)){type='Stopped';tag='stop';base=base.replace(/^stop(ped)?\s+/i,'')}
  else if(/^continue\s+/i.test(base)){type='Continued';tag='course';base=base.replace(/^continue\s+/i,'')}
  else if(/\b(reduced|increased|changed)\b/i.test(base)){type='Changed';tag='chg'}
  else if(/\b(held|withheld)\b/i.test(base)){type='Held, restarted';tag='chg'}
  else if(/to complete|course/i.test(base)){type='Course to finish';tag='course'}
  var name=(base.match(/^[A-Za-z][A-Za-z-]+/)||[''])[0];name=name.charAt(0).toUpperCase()+name.slice(1).toLowerCase();
  var ch=base.match(/(\d+(?:\.\d+)?\s?(?:mg|mcg|g))\s*(?:->|→|to)\s*(\d+(?:\.\d+)?\s?(?:mg|mcg|g))/i);
  var dose=ch?ch[1].replace(/\s/,'')+' → '+ch[2].replace(/\s/,''):((base.match(/\d+(?:\.\d+)?\s?(?:mg|mcg|g)\b/i)||[''])[0]).replace(/\s/,'');
  var fq=(base.match(/\b(od|bd|tds|qds|nocte|prn)\b/i)||[])[1];
  var extra=(base.match(/(to complete[^;]*|restarted[^;]*)/i)||[])[1]||'';
  return {type:type,tag:tag,name:name,dose:dose,freq:fq?FREQ[fq.toLowerCase()]:'',reason:reason,extra:extra,src:item.trim()};
}
function parseDischarge(t){
  var lines=t.split(/\n+/).map(function(l){return l.trim()}).filter(Boolean),o={src:{},meds:[],gp:[],told:[],flags:[]};
  function field(re){for(var i=0;i<lines.length;i++){var m=lines[i].match(re);if(m){return {v:m[1].trim().replace(/\.$/,''),src:lines[i]}}}return null}
  var id=lines[0]||'',m=id.match(/^([A-Z]\.[A-Z]\.),?\s*(\d+)\s*([MF])?/);o.who=m?m[1]+', '+m[2]+(m[3]?' '+m[3]:''):'Patient';
  var adm=t.match(/admitted\s+(?:on\s+)?(\d{1,2}\/\d{1,2})/i),dis=t.match(/discharged[^\n]*?(\d{1,2}\/\d{1,2})/i);
  o.adm=adm?adm[1]:'';o.dis=dis?dis[1]:'';
  if(o.adm&&o.dis){var a=o.adm.split('/'),b=o.dis.split('/'),y=new Date().getFullYear();o.los=Math.round((new Date(y,b[1]-1,b[0])-new Date(y,a[1]-1,a[0]))/864e5)}
  o.presentation=(id.match(/with\s+([^.]+)/i)||[])[1]||'';
  o.dx=field(/^(?:dx|diagnosis)\s*:\s*(.+)$/i);o.also=field(/^(?:also|secondary)\s*:\s*(.+)$/i);o.pmh=field(/^(?:pmh|background)\s*:\s*(.+)$/i);
  o.allergy=field(/^allerg(?:y|ies)\s*:\s*(.+)$/i);o.course=field(/^course\s*:\s*(.+)$/i);
  var meds=field(/^meds?\s*:\s*(.+)$/i);if(meds)o.meds=meds.v.split(/;\s*/).filter(Boolean).map(parseMed);
  var gp=field(/^gp(?:\s+to)?\s*:\s*(.+)$/i);if(gp)o.gp=gp.v.split(/;\s*/).filter(Boolean).map(function(x){return x.charAt(0).toUpperCase()+x.slice(1)});
  var told=field(/^(?:told patient|patient told|advice)\s*:\s*(.+)$/i);if(told)o.told=told.v.split(/;\s*/).filter(Boolean).map(function(x){return x.charAt(0).toUpperCase()+x.slice(1)});
  o.where=(t.match(/discharged\s+(home[^\n\d]*?)\s*\d/i)||[])[1]||'';
  if(!o.allergy)o.flags.push(['hi','Allergy status not recorded. Add it before sending.']);
  o.meds.forEach(function(md){if(md.type==='Changed')o.flags.push(['md',md.name+' dose changed ('+md.dose+'). Make sure the GP action covers when to review it.']);
    if(md.type==='Course to finish'){var e=md.extra.match(/last dose\s+(\d{1,2}\/\d{1,2})/i);o.flags.push(['lo',md.name+': course to finish'+(e?' (last dose '+e[1]+')':'')+'. Check enough supply was dispensed.'])}});
  if(!o.gp.length)o.flags.push(['md','No actions for the GP listed. Add any follow-up the GP needs to do.']);
  return o;
}
function discharge(root){
  var S=scope(root),ids={n:uid('n'),p:uid('p')},withDc=store.patients.filter(function(p){return p.discharge}),pid=withDc[0].id;
  root.innerHTML=
   '<div class="hv-row top"><label class="hv-lbl" for="'+ids.p+'">Notes for</label><select class="inline" id="'+ids.p+'" data-k="pid">'+withDc.map(function(p){return '<option value="'+p.id+'">'+p.bed+' · '+esc(p.who)+'</option>'}).join('')+'</select></div>'+
   '<div class="hv-cols2">'+
    '<div class="hv-card"><h3>Ward discharge notes <span class="r">type or paste</span></h3><label class="sr" for="'+ids.n+'">Discharge notes</label><textarea id="'+ids.n+'" data-notes spellcheck="false" style="min-height:24rem"></textarea>'+
    '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="go">Write the GP letter</button></div>'+
    '<p class="hv-note">Labels like Dx:, PMH:, Meds:, GP to: and Told patient: help it find each part. Medicines go in one line, separated by semicolons.</p>'+
    '<h3 style="margin-top:1rem" class="o">Checks before sending</h3><ul class="hv-flags" data-flags></ul></div>'+
    '<div class="hv-card tint"><h3 class="b">GP discharge letter <span class="r">hover blue text to see its source</span></h3><div class="hv-letterdoc" data-letter></div>'+
    '<label class="hv-row chk"><input type="checkbox" data-ok> I’ve checked the medicines against the drug chart</label>'+
    '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="send" disabled>Approve and send to GP</button><button class="hv-btn sm" type="button" data-k="copy">Copy</button><button class="hv-btn sm" type="button" data-k="print">Print</button></div><div class="hv-status" data-status role="status"></div></div>'+
   '</div>';
  var notes=S.q('[data-notes]');
  function src(v,s){return '<span class="src" title="From the notes: '+esc(s)+'">'+esc(v)+'</span>'}
  function run(){
    var o=parseDischarge(notes.value),p=store.get(pid);
    var meds=o.meds.length?'<table><thead><tr><th>Medicine</th><th>Change</th><th>Dose</th><th>Why</th></tr></thead><tbody>'+o.meds.map(function(m){
      return '<tr><td>'+src(m.name,m.src)+'</td><td><span class="hv-tag '+m.tag+'">'+esc(m.type)+'</span>'+(m.extra?'<br><small>'+esc(m.extra)+'</small>':'')+'</td><td>'+esc(m.dose)+(m.freq?' '+esc(m.freq):'')+'</td><td>'+esc(m.reason)+'</td></tr>'}).join('')+'</tbody></table>':'<p>No medicine changes recorded.</p>';
    S.q('[data-letter]').innerHTML=
      '<div class="lh"><div><b>Discharge summary</b><br><span>Halvia General (demo) · Ward 6, Acute medicine</span></div><div style="text-align:right"><span>To: the patient’s GP</span><br><span>Synthetic patient</span></div></div>'+
      '<dl><dt>Patient</dt><dd>'+esc(o.who)+'</dd><dt>Admitted</dt><dd>'+esc(o.adm||'not stated')+(o.presentation?' with '+src(o.presentation,notes.value.split('\n')[0]):'')+'</dd><dt>Discharged</dt><dd>'+esc(o.dis||'not stated')+(o.los!=null?' · '+o.los+' days':'')+(o.where?' · '+esc(o.where):'')+'</dd><dt>Allergies</dt><dd>'+(o.allergy?src(o.allergy.v,o.allergy.src):'<b style="color:#C42121">not recorded</b>')+'</dd></dl>'+
      '<h5>Diagnosis</h5><dl><dt>Primary</dt><dd>'+(o.dx?src(o.dx.v,o.dx.src):'not stated')+'</dd>'+(o.also?'<dt>Also</dt><dd>'+src(o.also.v,o.also.src)+'</dd>':'')+(o.pmh?'<dt>Background</dt><dd>'+src(o.pmh.v,o.pmh.src)+'</dd>':'')+'</dl>'+
      (o.course?'<h5>What happened</h5><p style="margin:0">'+src(o.course.v,o.course.src)+'</p>':'')+
      '<h5>Medicine changes</h5>'+meds+
      '<h5>Actions for the GP</h5>'+(o.gp.length?o.gp.map(function(g){return '<div class="todo">'+esc(g)+'</div>'}).join(''):'<p>None listed.</p>')+
      (o.told.length?'<h5>What the patient was told</h5><ul>'+o.told.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>':'')+
      '<p style="margin:1rem 0 0;font-size:.72rem;color:#666C7A">Drafted by Halvia from ward notes. Checked and approved by the discharging clinician before sending.</p>';
    S.q('[data-flags]').innerHTML=o.flags.length?o.flags.map(function(f){return '<li class="'+f[0]+'"><span class="hv-chip '+(f[0]==='hi'?'r':f[0]==='md'?'a':'m')+'">'+(f[0]==='hi'?'high':f[0]==='md'?'check':'note')+'</span> '+esc(f[1])+'</li>'}).join(''):'<li class="lo">No issues found.</li>';
    S.q('[data-ok]').checked=false;S.q('[data-k="send"]').disabled=true;S.q('[data-status]').textContent='';
  }
  function load(id){pid=id;S.q('[data-k="pid"]').value=id;notes.value=store.get(id).discharge;run()}
  root.addEventListener('change',function(e){if(e.target.dataset.k==='pid')load(e.target.value);if(e.target.matches('[data-ok]'))S.q('[data-k="send"]').disabled=!e.target.checked});
  root.addEventListener('click',function(e){var b=e.target.closest('button[data-k]');if(!b)return;
    if(b.dataset.k==='go')run();
    else if(b.dataset.k==='send'){S.q('[data-status]').textContent='✓ Approved and sent at '+hm(store.now)+' (simulated: nothing is sent).';b.disabled=true;S.q('[data-ok]').checked=false;store.addLog(store.get(pid).bed+': discharge letter approved')}
    else if(b.dataset.k==='copy')copyText(S.q('[data-letter]').innerText,b);
    else if(b.dataset.k==='print')printNode(S.q('[data-letter]'));
  });
  load(pid);
  return {select:function(ctx){if(ctx.pid&&store.get(ctx.pid).discharge)load(ctx.pid)}};
}

/* ---------- tool: missed appointments ---------- */
var APPTS0=[
  {t:'08:30',p:'Patient 0412',cl:'Diabetes',lead:61,prev:2,rem:false,first:false,travel:55,early:true},
  {t:'09:00',p:'Patient 1187',cl:'Diabetes',lead:14,prev:0,rem:true,first:false,travel:15,early:false},
  {t:'09:20',p:'Patient 0930',cl:'Respiratory',lead:84,prev:1,rem:false,first:true,travel:40,early:false},
  {t:'09:40',p:'Patient 2205',cl:'Respiratory',lead:21,prev:0,rem:true,first:true,travel:10,early:false},
  {t:'10:00',p:'Patient 1764',cl:'Cardiology',lead:35,prev:0,rem:false,first:false,travel:25,early:false},
  {t:'10:20',p:'Patient 0058',cl:'Cardiology',lead:98,prev:3,rem:false,first:false,travel:70,early:false},
  {t:'10:40',p:'Patient 3321',cl:'Fracture',lead:7,prev:0,rem:true,first:true,travel:20,early:false},
  {t:'11:00',p:'Patient 2649',cl:'Fracture',lead:42,prev:1,rem:false,first:false,travel:35,early:false}
];
var W={base:-3.4,prev:0.8,lead:0.01,first:0.45,travel:0.012,early:0.35,rem:-0.75,video:-0.6};
function dna(root){
  var S=scope(root),A=APPTS0.map(function(a){return Object.assign({},a)}),sel=5,log=[];
  function factors(a){var f=[['Previous missed appointments ('+a.prev+')',W.prev*a.prev],['Booked '+a.lead+' days ago',W.lead*a.lead],['First appointment',a.first?W.first:0],['Travel time '+(a.video?'(video: none)':'~'+a.travel+' min'),a.video?0:W.travel*a.travel],['Early morning slot',a.early?W.early:0],['Text reminder sent',a.rem?W.rem:0]];if(a.video)f.push(['Video appointment offered',W.video]);return f}
  function risk(a){var z=W.base;factors(a).forEach(function(f){z+=f[1]});return 1/(1+Math.exp(-z))}
  A.forEach(function(a){a.p0=risk(a)});
  root.innerHTML=
   '<div class="hv-kpirow"><div><b data-kpi="exp"></b>expected missed appointments</div><div><b data-kpi="saved"></b>prevented by actions taken</div><div><b data-kpi="act"></b>patients offered help</div></div>'+
   '<div class="hv-grid">'+
    '<div class="hv-card hv-span"><h3>Tuesday clinic · synthetic list <span class="r">select a row to see why</span></h3><div class="hv-scroll" tabindex="0" role="region" aria-label="Clinic list"><table class="hv-tbl"><thead><tr><th scope="col">Time</th><th scope="col">Patient</th><th scope="col">Clinic</th><th scope="col">Booked</th><th scope="col">Reminder</th><th scope="col">Risk of missing</th></tr></thead><tbody data-rows></tbody></table></div>'+
    '<div class="hv-row"><button class="hv-btn sm" type="button" data-k="bulk">Text everyone at 30% or more</button><button class="hv-btn sm ghost" type="button" data-k="csv">Download list (CSV)</button></div></div>'+
    '<div class="hv-card"><h3 class="b">Why this estimate <span class="r" data-who></span></h3><ul class="hv-why" data-why></ul><p class="hv-note">Illustrative weights, not a trained model. A real model is trained on local data, checked for bias across groups, and never uses protected characteristics.</p></div>'+
    '<div class="hv-card tint"><h3 class="o">Offer help</h3><div class="hv-row" style="margin-top:0"><button class="hv-btn sm primary" type="button" data-k="sms">Send text reminder</button><button class="hv-btn sm" type="button" data-k="video">Offer video appointment</button><button class="hv-btn sm" type="button" data-k="sooner">Offer an earlier date</button></div><div class="hv-sms" data-sms></div><ul class="hv-log" data-log aria-live="polite"></ul></div>'+
   '</div>';
  function render(){
    S.q('[data-rows]').innerHTML=A.map(function(a,i){var r=risk(a),pc=Math.round(r*100),c=r>=.35?'var(--red)':r>=.18?'var(--warn)':'var(--green)';
      return '<tr data-i="'+i+'" class="'+(i===sel?'sel':'')+'" tabindex="0" aria-selected="'+(i===sel)+'"><td>'+a.t+'</td><td>'+a.p+(a.video?' <span class="hv-chip b">video</span>':'')+'</td><td>'+a.cl+'</td><td>'+a.lead+' days ago</td><td>'+(a.rem?'<span class="hv-chip g">sent</span>':'<span class="hv-chip m">none</span>')+'</td><td><span class="hv-riskbar"><i style="--w:'+pc+'%;--c:'+c+'"></i>'+pc+'%</span></td></tr>'}).join('');
    var exp=0,ex0=0;A.forEach(function(a){exp+=risk(a);ex0+=a.p0});
    S.q('[data-kpi="exp"]').textContent=exp.toFixed(1);S.q('[data-kpi="saved"]').textContent=(ex0-exp).toFixed(1);S.q('[data-kpi="act"]').textContent=A.filter(function(a){return a.helped}).length;
    var a=A[sel];S.q('[data-who]').textContent=a.p+' · '+Math.round(risk(a)*100)+'%';
    S.q('[data-why]').innerHTML=factors(a).filter(function(x){return x[1]!==0}).map(function(x){var w=Math.min(50,Math.abs(x[1])/1.6*50),pos=x[1]>0;
      return '<li><span>'+esc(x[0])+'</span><span class="bar2"><span style="'+(pos?'left:50%;':'right:50%;')+'width:'+w+'%;background:'+(pos?'var(--warn)':'var(--green)')+'"></span><span style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:var(--line2)"></span></span><span class="v">'+(pos?'+':'−')+Math.abs(x[1]).toFixed(2)+'</span></li>'}).join('')+'<li style="color:var(--dim)"><span>Orange raises the chance of missing, green lowers it</span><span></span><span></span></li>';
    S.q('[data-k="sms"]').disabled=a.rem;S.q('[data-k="video"]').disabled=!!a.video||a.cl==='Fracture';S.q('[data-k="sooner"]').disabled=a.lead<=14;
    S.q('[data-k="video"]').title=a.cl==='Fracture'?'Fracture clinic usually needs an in-person visit':'';
    S.q('[data-sms]').innerHTML='<b style="font-weight:500">Text preview</b><br>Hello, this is a reminder of your '+a.cl.toLowerCase()+' appointment on Tuesday at '+a.t+'. Reply 1 to confirm, 2 if you need to change it, or 3 for a video appointment if that would be easier. You can also call us to rearrange.';
    S.q('[data-log]').innerHTML=log.map(function(l){return '<li>'+esc(l)+'</li>'}).join('');
  }
  function act(i,fn,msg){var a=A[i],b=risk(a);fn(a);a.helped=true;log.unshift(a.p+': '+msg+' ('+Math.round(b*100)+'% → '+Math.round(risk(a)*100)+'%)')}
  S.q('[data-rows]').addEventListener('click',function(e){var r=e.target.closest('tr');if(r){sel=+r.dataset.i;render()}});
  S.q('[data-rows]').addEventListener('keydown',function(e){var r=e.target.closest('tr');if(!r)return;var i=+r.dataset.i;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();sel=i}else if(e.key==='ArrowDown'){e.preventDefault();sel=Math.min(A.length-1,i+1)}else if(e.key==='ArrowUp'){e.preventDefault();sel=Math.max(0,i-1)}else return;
    render();var n=S.q('[data-rows] tr[data-i="'+sel+'"]');if(n)n.focus()});
  root.addEventListener('click',function(e){var b=e.target.closest('button[data-k]');if(!b)return;var k=b.dataset.k;
    if(k==='sms')act(sel,function(a){a.rem=true},'reminder text sent');
    else if(k==='video')act(sel,function(a){a.video=true;a.early=false},'video appointment offered and accepted');
    else if(k==='sooner')act(sel,function(a){a.lead=7;a.rem=true},'moved to a date next week, with a reminder');
    else if(k==='bulk'){A.forEach(function(a,i){if(!a.rem&&risk(a)>=.3)act(i,function(x){x.rem=true},'reminder text sent (bulk)')})}
    else if(k==='csv'){var rows=[['time','patient','clinic','booked_days_ago','reminder','risk_pct']].concat(A.map(function(a){return [a.t,a.p,a.cl,a.lead,a.rem?'sent':'none',Math.round(risk(a)*100)]}));
      var blob=new Blob([rows.map(function(r){return r.join(',')}).join('\n')],{type:'text/csv'}),u=URL.createObjectURL(blob),l=document.createElement('a');l.href=u;l.download='clinic-list-synthetic.csv';document.body.appendChild(l);l.click();l.remove();setTimeout(function(){URL.revokeObjectURL(u)},1000);return}
    render();
  });
  render();
  return {select:function(){}};
}

/* ---------- tool: plain-English letters ---------- */
var LTR="Dear Dr Patel,\n\nRe: Mrs C, 67\n\nI reviewed Mrs C in the cardiology clinic today. She has a history of hypertension and paroxysmal AF. She reports intermittent palpitations and exertional dyspnoea but denies syncope. On examination there was mild bilateral pedal oedema. Her ECG showed sinus rhythm. Echocardiogram demonstrated mild LV systolic dysfunction.\n\nPlan: commence ramipril 2.5mg od and furosemide 20mg od, titrate as tolerated. Repeat U&Es in 2 weeks. Review in 3 months, sooner PRN.\n\nYours sincerely,\nDr R. Shah, Consultant Cardiologist";
var GLOSS=[
  [/paroxysmal AF|paroxysmal atrial fibrillation/gi,'an uneven heartbeat that comes and goes (AF)','Atrial fibrillation (AF) is an irregular, often fast heartbeat. Paroxysmal means it comes and goes.'],
  [/intermittent palpitations and exertional dyspnoea/gi,'a fast or fluttering heartbeat now and then. You also get out of breath when you are active','Palpitations: noticing your heartbeat. Dyspnoea: breathlessness.'],
  [/exertional dyspnoea/gi,'getting out of breath when you are active','Dyspnoea means breathlessness.'],
  [/dyspnoea/gi,'breathlessness','Shortness of breath.'],
  [/hypertension/gi,'high blood pressure','Blood pressure that is higher than it should be.'],
  [/intermittent palpitations/gi,'a fluttering or pounding heartbeat that comes and goes','Palpitations are when you notice your own heartbeat.'],
  [/palpitations/gi,'a fluttering or pounding heartbeat','Noticing your own heartbeat.'],
  [/\s*but denies syncope/gi,'. You have not fainted','Syncope means fainting.'],
  [/syncope/gi,'fainting','Losing consciousness for a short time.'],
  [/mild bilateral pedal oedema/gi,'some swelling in your feet and ankles','Oedema is swelling caused by fluid.'],
  [/oedema/gi,'swelling','Swelling caused by fluid.'],
  [/sinus rhythm/gi,'a normal heart rhythm','The heart’s normal, regular rhythm.'],
  [/echocardiogram/gi,'a heart scan (echo)','An ultrasound scan of the heart.'],
  [/mild LV systolic dysfunction/gi,'that your heart pumps a little less well than it should','LV is the left ventricle, the heart’s main pumping chamber.'],
  [/\bECG\b/g,'heart trace (ECG)','A quick test that records the heart’s electrical activity.'],
  [/titrate as tolerated/gi,'we may adjust the dose step by step, depending on how you feel','Titrate means adjust the dose gradually.'],
  [/\bU&Es\b/g,'kidney blood tests (U&Es)','Urea and electrolytes: blood tests that check how your kidneys are working.'],
  [/\bPRN\b/g,'if you need to','From the Latin “pro re nata”: as needed.'],
  [/\bcommence\b/gi,'start',''],
  [/\bod\b/g,'once a day',''],[/\bbd\b/g,'twice a day',''],[/\btds\b/g,'three times a day',''],[/\bqds\b/g,'four times a day',''],[/\bnocte\b/g,'at night','']
];
var DOSE={od:'Once a day',bd:'Twice a day',tds:'Three times a day',qds:'Four times a day',nocte:'At night'};
var MEDUSE={ramipril:'Lowers blood pressure and helps the heart pump',furosemide:'A “water tablet” to reduce swelling and breathlessness',bisoprolol:'Slows and steadies the heartbeat',apixaban:'Thins the blood to lower the risk of stroke',atorvastatin:'Lowers cholesterol'};
function syl(w){w=w.toLowerCase().replace(/[^a-z]/g,'');if(!w)return 0;if(w.length<=3)return 1;w=w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');var m=w.match(/[aeiouy]{1,2}/g);return Math.max(1,m?m.length:1)}
function readAge(t){
  t=t.replace(/\b(Dear|Re|Yours)[^\n]*\n?/g,'');
  var s=t.split(/[.!?\n]+/).filter(function(x){return x.trim().split(/\s+/).length>2}).length||1,w=t.match(/[A-Za-z][A-Za-z'&-]*/g)||[];if(!w.length)return 0;
  var sy=w.reduce(function(n,x){return n+syl(x)},0);return Math.max(5,Math.min(21,Math.round(0.39*(w.length/s)+11.8*(sy/w.length)-15.59+5)));
}
H.readAge=readAge;
function plainText(src){
  var body=src.replace(/^[\s\S]*?\n\n(?=I |We )/,'').replace(/\n\n(Yours|Kind regards|Best wishes)[\s\S]*$/,'');
  var parts=body.split(/\n\s*\n/),find=parts[0]||'',plan=(parts.slice(1).join(' ')).replace(/^plan\s*:\s*/i,'');
  function outside(t,fn){return t.split(/(\u0001[^\u0003]*\u0003)/).map(function(x){return x.charAt(0)==='\u0001'?x:fn(x)}).join('')}
  function tr(t){
    GLOSS.forEach(function(g){t=outside(t,function(x){return x.replace(g[0],function(){return '\u0001'+g[2]+'\u0002'+g[1]+'\u0003'})})});
    t=outside(t,function(x){return x.replace(/\bMrs C\b|\bMr [A-Z]\b|\bMs [A-Z]\b/g,'you').replace(/\bShe has\b|\bHe has\b/g,'You have').replace(/\bShe reports\b|\bHe reports\b/g,'You told me about').replace(/\bShe\b|\bHe\b/g,'You').replace(/\bher\b|\bhis\b/gi,'your').replace(/\bOn examination there was\b/gi,'I found').replace(/\bdemonstrated\b/gi,'showed').replace(/\bI reviewed you\b/gi,'I saw you').replace(/\bYou have a history of\b/g,'You have')});
    t=esc(t).replace(/\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003/g,function(_,tip,txt){return tip?'<abbr title="'+tip+'">'+txt+'</abbr>':txt});
    return t.replace(/(^|[.!?]\s+)((?:<abbr[^>]*>)?)([a-z])/g,function(_,a,b,c){return a+b+c.toUpperCase()});
  }
  var meds=[],mre=/\b([a-z]+)\s+(\d+(?:\.\d+)?\s?mg)\s+(od|bd|tds|qds|nocte)\b/gi,m;
  while((m=mre.exec(src)))meds.push([m[1].charAt(0).toUpperCase()+m[1].slice(1).toLowerCase(),m[2].replace(/\s/,''),DOSE[m[3].toLowerCase()],MEDUSE[m[1].toLowerCase()]||'Ask your pharmacist what this is for']);
  var steps=plan.split(/\.\s+|\.$/).map(function(x){return x.trim()}).filter(function(x){return x&&!/^(commence|start)\b/i.test(x)});
  steps=steps.map(function(x){return tr(x).replace(/^Repeat /,'Have ').replace(/^Review in/,'Come back to clinic in').replace(/, sooner /,', or sooner ')});
  var html='<h4>What we found</h4><p>'+tr(find).replace(/\n/g,' ')+'</p>';
  if(meds.length)html+='<h4>Your medicines</h4><table class="hv-meds"><thead><tr><th>Medicine</th><th>Dose</th><th>When</th><th>What it’s for</th></tr></thead><tbody>'+meds.map(function(r){return '<tr><td>'+esc(r[0])+' <span class="hv-chip b">new</span></td><td>'+esc(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td></tr>'}).join('')+'</tbody></table>';
  if(/titrate/i.test(plan))html+='<p style="margin-top:.5rem">We may adjust the doses step by step, depending on how you feel.</p>';
  if(steps.length)html+='<h4>What happens next</h4><p>'+steps.filter(function(x){return !/adjust the dose/i.test(x)}).map(function(x){return '&rarr; '+x+(/[.!?]$/.test(x)?'':'.')}).join('<br>')+'</p>';
  html+='<h4>When to get help</h4><p>Call 999 if you have chest pain, faint, or are suddenly very short of breath. If your ankles swell more or you feel dizzy on the new medicines, contact your GP.</p>';
  return html;
}
function plain(root){
  var S=scope(root),ids={n:uid('n')};
  root.innerHTML=
   '<div class="hv-cols2">'+
    '<div class="hv-card"><h3>Clinician’s letter <span class="r">type or paste</span></h3><label class="sr" for="'+ids.n+'">Clinic letter text</label><textarea id="'+ids.n+'" data-in spellcheck="false" style="min-height:15rem"></textarea>'+
    '<div class="hv-row"><button class="hv-btn primary" type="button" data-k="go">Write the patient version</button><button class="hv-btn sm ghost" type="button" data-k="reset">Reset example</button></div></div>'+
    '<div class="hv-card tint" data-outcard><h3 class="b">Patient version <span class="r" style="display:flex;gap:.35rem;align-items:center;flex-wrap:wrap"><span class="hv-seg" role="group" aria-label="Text size"><button type="button" data-size="" aria-pressed="true">A</button><button type="button" data-size="lg" aria-pressed="false">A+</button><button type="button" data-size="xl" aria-pressed="false">A++</button></span><button class="hv-btn sm" data-k="speak" type="button">&#9654; Read aloud</button><button class="hv-btn sm" data-k="print" type="button">Print</button></span></h3><div class="hv-letter" data-out aria-live="polite"></div></div>'+
    '<div class="hv-card hv-span"><h3 class="o">Reading age <span class="r">Flesch–Kincaid estimate · shaded band is the 9 to 11 target</span></h3><div class="hv-age" data-age></div></div>'+
   '</div>';
  var inp=S.q('[data-in]');
  function run(){
    S.q('[data-out]').innerHTML=plainText(inp.value);
    var a=readAge(inp.value),b=readAge(S.q('[data-out]').innerText),pos=function(v){return ((v-5)/16*100).toFixed(1)+'%'};
    root.dispatchEvent(new CustomEvent('hv:age',{bubbles:true,detail:{before:a,after:b}}));
    S.q('[data-age]').innerHTML=[['Clinician',a,'var(--red)'],['Patient',b,'var(--green)']].map(function(x){return '<div class="ln"><span>'+x[0]+'</span><span class="tr"><span class="tgt" style="left:'+pos(9)+';width:'+((2/16)*100)+'%"></span><span class="pin" style="left:'+pos(x[1])+';background:'+x[2]+'"></span></span><b>'+(x[1]>=21?'21+':x[1])+' yrs</b></div>'}).join('')+'<div class="ln" style="color:var(--dim)"><span></span><span style="display:flex;justify-content:space-between"><span>5</span><span>13</span><span>21+</span></span><span></span></div>';
  }
  root.addEventListener('click',function(e){
    var s=e.target.closest('[data-size]');if(s){S.qa('[data-size]').forEach(function(x){x.setAttribute('aria-pressed',x===s)});S.q('[data-out]').className='hv-letter'+(s.dataset.size?' '+s.dataset.size:'');return}
    var b=e.target.closest('button[data-k]');if(!b)return;var k=b.dataset.k;
    if(k==='go')run();else if(k==='reset'){inp.value=LTR;run()}else if(k==='print')printNode(S.q('[data-out]'));
    else if(k==='speak'){if(!('speechSynthesis' in window))return;if(speechSynthesis.speaking){speechSynthesis.cancel();b.innerHTML='&#9654; Read aloud';return}
      var u=new SpeechSynthesisUtterance(S.q('[data-out]').innerText);u.lang='en-GB';u.rate=.95;u.onend=u.onerror=function(){b.innerHTML='&#9654; Read aloud'};speechSynthesis.speak(u);b.innerHTML='&#9632; Stop'}
  });
  if(!('speechSynthesis' in window))S.q('[data-k="speak"]').hidden=true;
  inp.value=LTR;run();
  return {select:function(){}};
}

var TOOLS={ward:ward,news:news,sbar:sbar,code:code,discharge:discharge,dna:dna,plain:plain};
H.mount=function(el,tool){if(!el.classList.contains('hv'))el.classList.add('hv');var api=TOOLS[tool](el);inst[tool]=api;return api};
H.mountAll=function(scopeEl){Array.prototype.forEach.call((scopeEl||document).querySelectorAll('[data-tool]'),function(el){H.mount(el,el.getAttribute('data-tool'))})};
})();
