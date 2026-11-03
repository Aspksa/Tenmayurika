'use strict';
/* «Мозг» Тэнмаюрики — живая карта памяти.
   Ядро — рой частиц; вокруг него зоны (дела, заметки, факты по субъектам, противоречия).
   Каждая запись — нейрон внутри своей зоны. Новые записи прилетают импульсом из ядра и вспыхивают.
   Только canvas 2D, без библиотек. Монтируется в раздел «Мозг»: window.TenmaBrain.mount(element). */
(()=>{
const TAU=Math.PI*2;
const SEEN_KEY='tenma.brain.seen.v1',CFG_KEY='tenma.brain.cfg.v1';
const reduceQuery=matchMedia('(prefers-reduced-motion: reduce)');
const read=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch{return d}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){let a=seed>>>0||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=t=>1-Math.pow(1-clamp(t,0,1),3);
const rgba=(c,a)=>'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';

const COLORS={core:[245,178,92],personal:[242,210,122],work:[236,150,72],notes:[250,226,176],facts:[255,190,112],conflicts:[255,92,72],done:[160,136,96]};
const DAY=86400000;

/* ---------- Частицы облака: туманность с яркими «завихрениями» ---------- */
function unit(r){const z=2*r()-1,t=TAU*r(),q=Math.sqrt(1-z*z);return [q*Math.cos(t),z,q*Math.sin(t)]}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function norm(a){const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l]}
function makeParticles(n,seed){
 const r=rng(seed),bands=[0,1,2].map(()=>{const a=unit(r),u=norm(cross(a,Math.abs(a[1])<.9?[0,1,0]:[1,0,0]));return {u,v:cross(a,u)}});
 const out=[];
 for(let i=0;i<n;i++){
  let p,b,s=r()<.07?2.1:1;
  if(r()<.38){const B=bands[i%3],f=TAU*r(),k=.35+.55*r(),j=.12;
   p=[0,1,2].map(d=>(B.u[d]*Math.cos(f)+B.v[d]*Math.sin(f))*k+(r()-.5)*j);b=.45+.55*r();}
  else{const d=unit(r),k=Math.min(1.15,(r()+r()+r())/3*1.35);p=d.map(x=>x*k);b=.18+.5*r()}
  out.push({x:p[0],y:p[1],z:p[2],s,b,f:.6+2*r(),ph:TAU*r()});
 }
 return out;
}

/* ---------- Данные: workspace + факты → зоны и нейроны ---------- */
function ts(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function buildModel(ws,facts,conflicts){
 const app=()=>window.TenmaApp;
 const lobes=[],events=[];
 const add=(id,label,color,items,open)=>{if(items.length)lobes.push({id,label,color,items,open})};
 const today=new Date();today.setHours(0,0,0,0);
 const taskItem=t=>({id:'t:'+t.id,title:t.title,meta:(t.done?'выполнено':t.due?'срок '+t.due+(t.time?' '+t.time:''):'без срока')+(t.priority==='high'?' · важное':''),ts:ts(t.createdAt),hot:!t.done&&t.due&&ts(t.due+'T00:00:00')<=today.getTime(),dim:!!t.done,weight:t.priority==='high'?1.5:1,open:()=>app()?.select?app().select('task',t.id):app()?.go('planner')});
 const tasks=ws.tasks||[],notes=ws.notes||[];
 add('personal','Дела · личное',COLORS.personal,tasks.filter(t=>t.category!=='work').map(taskItem),()=>app()?.go('tasks'));
 add('work','Дела · работа',COLORS.work,tasks.filter(t=>t.category==='work').map(taskItem),()=>app()?.go('tasks'));
 add('notes','Заметки',COLORS.notes,notes.map(n=>({id:'n:'+n.id,title:n.title,meta:(n.category==='work'?'рабочая':'личная')+' заметка'+(n.pinned?' · закреплена':''),ts:ts(n.createdAt),weight:n.pinned?1.4:1,open:()=>app()?.select?app().select('note',n.id):app()?.go('notes')})),()=>app()?.go('notes'));
 // Факты: крупные субъекты получают свою зону, остальные — общая зона «Факты».
 const bySubject=new Map();for(const f of facts){const k=f.subject.toLocaleLowerCase();if(!bySubject.has(k))bySubject.set(k,{name:f.subject,list:[]});bySubject.get(k).list.push(f)}
 const subjects=[...bySubject.values()].sort((a,b)=>b.list.length-a.list.length);
 const big=subjects.filter(s=>s.list.length>=2).slice(0,4),rest=subjects.filter(s=>!big.includes(s)).flatMap(s=>s.list);
 const factItem=f=>({id:'f:'+f.id,title:f.subject+' — '+f.predicate+' → '+f.object,meta:'факт · '+(f.source_id||'')+' · уверенность '+f.confidence,ts:ts(f.observed_at),weight:.6+.6*(+f.confidence||0),fact:f,open:()=>app()?.go('facts')});
 for(const s of big)add('fs:'+s.name.toLocaleLowerCase(),'Факты · '+s.name,COLORS.facts,s.list.map(factItem),()=>app()?.go('facts'));
 add('facts','Факты',COLORS.facts,rest.map(factItem),()=>app()?.go('facts'));
 add('conflicts','Противоречия',COLORS.conflicts,conflicts.map(c=>({id:'c:'+c.id,title:c.subject+' — '+c.predicate+': «'+c.earlier+'» или «'+c.newer+'»',meta:'противоречие',ts:ts(c.detected_at),weight:1.3,open:()=>app()?.go('facts')})),()=>app()?.go('facts'));
 // Журнал: что мозг узнал и когда.
 for(const t of tasks){events.push({t:ts(t.createdAt),kind:t.category==='work'?'работа':'дело',color:t.category==='work'?COLORS.work:COLORS.personal,text:t.title});if(t.doneAt)events.push({t:ts(t.doneAt),kind:'готово',color:COLORS.done,text:t.title})}
 for(const n of notes)events.push({t:ts(n.createdAt),kind:'заметка',color:COLORS.notes,text:n.title});
 for(const f of facts)events.push({t:ts(f.observed_at),kind:'факт',color:COLORS.facts,text:f.subject+' '+f.predicate+' '+f.object});
 for(const c of conflicts)events.push({t:ts(c.detected_at),kind:'сбой',color:COLORS.conflicts,text:c.subject+': '+c.earlier+' / '+c.newer});
 events.sort((a,b)=>b.t-a.t);
 // Связи между фактами: объект одного факта — субъект другого.
 const firstOf=new Map();for(const l of lobes)for(const it of l.items)if(it.fact){const k=it.fact.subject.toLocaleLowerCase();if(!firstOf.has(k))firstOf.set(k,it.id)}
 const links=[];for(const l of lobes)for(const it of l.items)if(it.fact){const to=firstOf.get(it.fact.object.toLocaleLowerCase());if(to&&to!==it.id&&links.length<240)links.push([it.id,to])}
 return {lobes,events,links,facts:facts.length};
}

/* ---------- Монтирование ---------- */
function mount(host){
 const cfg=Object.assign({paused:false},read(CFG_KEY,{}));
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const stage=el('div','brain-stage'),canvas=el('canvas'),tip=el('div','brain-tip');tip.hidden=true;
 const top=el('div','brain-top'),bar=el('div','brain-bar'),ctrl=el('div','brain-ctrl');
 const pauseBtn=el('button','brain-btn');pauseBtn.type='button';
 const resetBtn=el('button','brain-btn','Пробудить');resetBtn.type='button';resetBtn.title='Заново раскрыть мозг из ядра';
 ctrl.append(resetBtn,pauseBtn);top.append(bar,ctrl);
 const empty=el('div','brain-empty');empty.hidden=true;
 stage.append(canvas,top,tip,empty);
 stage.setAttribute('role','img');
 const teach=el('form','brain-teach'),tIn=el('input'),tBtn=el('button','primary','Научить');
 tIn.placeholder='Научи меня: Анна | любит | зелёный чай';tIn.setAttribute('aria-label','Новый факт: субъект | связь | объект');tIn.maxLength=900;tBtn.type='submit';
 const tHint=el('span','brain-hint','Факт пишется как «субъект | связь | объект». Он сразу станет новым нейроном.');
 teach.append(tIn,tBtn,tHint);
 const hud=el('div','brain-hud');
 const pLog=el('section','brain-panel'),pAct=el('section','brain-panel'),pTree=el('section','brain-panel');
 pLog.append(el('div','brain-k','01 // журнал памяти'));const logList=el('ul','brain-log');pLog.append(logList);
 pAct.append(el('div','brain-k','02 // обучение')); const actNum=el('div','brain-num'),actCap=el('div','brain-cap'),spark=el('canvas','brain-spark');pAct.append(actNum,actCap,spark);
 pTree.append(el('div','brain-k','03 // структура'));const tree=el('ul','brain-tree');pTree.append(tree);
 hud.append(pLog,pAct,pTree);
 host.replaceChildren(stage,teach,hud);
 const ctx=canvas.getContext('2d');

 let W=0,H=0,dpr=1,ui=1,model={lobes:[],events:[],links:[],facts:0},facts=[],conflicts=[];
 const core={parts:makeParticles(3200,7),pulse:0};
 const lobeState=new Map(); // id → {parts,x,y,r,pulse,streams,fil}
 const neurons=new Map(); // item id → {item,lobe,ox,oy,oz,flash,sx,sy}
 let impulses=[],seen=new Set(read(SEEN_KEY,[])),firstVisit=!seen.size,bloomStart=performance.now(),coreText='',coreTextT=0;
 let simT=0,last=performance.now(),raf=0,dirty=true,pinned=null,hover=null,dust=[];
 const still=()=>cfg.paused||reduceQuery.matches;

 function setPause(){pauseBtn.textContent=cfg.paused?'▶ Движение':'❚❚ Пауза';pauseBtn.setAttribute('aria-pressed',String(cfg.paused))}
 setPause();
 pauseBtn.onclick=()=>{cfg.paused=!cfg.paused;write(CFG_KEY,cfg);setPause();dirty=true};
 resetBtn.onclick=()=>{bloomStart=performance.now();dirty=true};

 function resize(){
  const r=stage.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);
  dpr=Math.min(2,window.devicePixelRatio||1);if(W*H*dpr*dpr>9e6)dpr=Math.sqrt(9e6/(W*H)); // 4K: не больше ~9 Мп
  ui=clamp(parseFloat(getComputedStyle(document.documentElement).fontSize)/16,.85,1.9); // подписи растут вместе с интерфейсом (4K)
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
  const r2=rng(99);dust=Array.from({length:Math.round(clamp(W*H/5000,60,320))},()=>({x:r2(),y:r2(),s:r2()<.1?1.6:.8,a:.05+.2*r2(),ph:TAU*r2()}));
  drawSpark();dirty=true;
 }
 const ro=new ResizeObserver(resize);ro.observe(stage);

 /* Обновление модели с сохранением уже живущих зон и нейронов. */
 function apply(){
  const ws=window.TenmaApp?.workspace||{notes:[],tasks:[]};
  model=buildModel(ws,facts,conflicts);
  const alive=new Set();
  for(const l of model.lobes){
   alive.add(l.id);
   let s=lobeState.get(l.id);
   const n=l.items.length,want=Math.round(clamp(140+70*Math.sqrt(n),160,800));
   if(!s){s={parts:makeParticles(want,hash(l.id)),pulse:0,x:0,y:0,r:0,fil:[],streams:[],seed:hash(l.id)};lobeState.set(l.id,s)}
   else if(Math.abs(s.parts.length-want)>30)s.parts=makeParticles(want,hash(l.id));
   const r=rng(s.seed^0x9e37);
   const nf=Math.round(clamp(14+n*2.5,14,44));
   if(s.fil.length!==nf)s.fil=Array.from({length:nf},()=>({a:TAU*r(),bend:(r()-.5)*.9,w:.4+r()}));
   const ns=Math.round(clamp(5+n*2.5,5,46));
   if(s.streams.length!==ns)s.streams=Array.from({length:ns},(_,i)=>({f:i%nf,u:r(),v:.08+.16*r()}));
   l.state=s;
   for(const it of l.items){
    let nn=neurons.get(it.id);
    if(!nn){const q=rng(hash(it.id)),d=unit(q),k=.15+.6*Math.cbrt(q());nn={ox:d[0]*k,oy:d[1]*k,oz:d[2]*k,flash:0,sx:0,sy:0,vis:0};neurons.set(it.id,nn)}
    nn.item=it;nn.lobe=l;alive.add(it.id);
    if(!seen.has(it.id)){seen.add(it.id);if(!firstVisit){impulses.push({lobe:l,item:it,u:0,f:Math.floor(Math.random()*l.state.fil.length),big:true});coreText=it.title;coreTextT=4.5}}
   }
  }
  for(const k of [...lobeState.keys()])if(!alive.has(k))lobeState.delete(k);
  for(const k of [...neurons.keys()])if(!alive.has(k))neurons.delete(k);
  if(seen.size>4000)seen=new Set([...neurons.keys()]);
  write(SEEN_KEY,[...seen]);
  renderHud();dirty=true;
 }

 function renderHud(){
  const total=model.lobes.reduce((s,l)=>s+l.items.length,0),links=model.facts+model.links.length;
  const week=Date.now()-7*DAY,learned=model.events.filter(e=>e.t>=week).length;
  bar.textContent='● TENMAYURIKA // МОЗГ · нейронов '+total+' · связей '+links+' · зон '+model.lobes.length;
  stage.setAttribute('aria-label','Карта памяти: '+total+' записей в '+model.lobes.length+' зонах');
  empty.hidden=total>0;empty.textContent=total?'':'Пока только ядро. Научи меня первому факту ниже, или добавь дело в Планере, и мозг начнёт расти.';
  logList.replaceChildren(...(model.events.slice(0,6).map(e=>{const li=el('li');const k=el('span','brain-tag',e.kind);k.style.color=rgba(e.color,1);const t=el('span','brain-ev',e.text);const d=el('time','',when(e.t));li.append(k,t,d);return li})));
  if(!model.events.length)logList.append(el('li','brain-muted','событий пока нет'));
  actNum.textContent=String(learned);actCap.textContent='новых записей за 7 дней';
  tree.replaceChildren(el('li','brain-root','ядро'),...model.lobes.map(l=>{const li=el('li');const dot=el('i');dot.style.background=rgba(l.color,1);dot.style.boxShadow='0 0 8px '+rgba(l.color,.8);const b=el('button','brain-link',l.label);b.type='button';b.onclick=l.open;li.append(dot,b,el('span','brain-count',String(l.items.length)));return li}));
  drawSpark();
 }
 function when(t){if(!t)return '';const d=new Date(t),now=new Date();const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');return d.toDateString()===now.toDateString()?hm:d.getDate()+'.'+String(d.getMonth()+1).padStart(2,'0')}
 function drawSpark(){
  const w=spark.clientWidth||200,h=spark.clientHeight||40,sd=Math.min(2,window.devicePixelRatio||1);
  spark.width=Math.round(w*sd);spark.height=Math.round(h*sd);const c=spark.getContext('2d');c.scale(sd,sd);
  const days=14,start=new Date();start.setHours(0,0,0,0);const base=start.getTime()-(days-1)*DAY;const counts=new Array(days).fill(0),bad=new Array(days).fill(0);
  for(const e of model.events){const i=Math.floor((e.t-base)/DAY);if(i>=0&&i<days){counts[i]++;if(e.kind==='сбой')bad[i]++}}
  const max=Math.max(1,...counts);c.lineWidth=1.6;c.lineJoin='round';
  const g=c.createLinearGradient(0,0,w,0);g.addColorStop(0,'rgba(212,175,55,.35)');g.addColorStop(1,'rgba(242,190,110,1)');c.strokeStyle=g;
  c.beginPath();counts.forEach((v,i)=>{const x=4+i*(w-8)/(days-1),y=h-4-(v/max)*(h-10);i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();
  counts.forEach((v,i)=>{if(!bad[i])return;const x=4+i*(w-8)/(days-1),y=h-4-(v/max)*(h-10);c.fillStyle='rgb(255,92,72)';c.beginPath();c.arc(x,y,2.5,0,TAU);c.fill()});
  const lx=w-4,ly=h-4-(counts[days-1]/max)*(h-10);c.fillStyle='#f2d27a';c.shadowColor='#f2d27a';c.shadowBlur=8;c.beginPath();c.arc(lx,ly,2.6,0,TAU);c.fill();
 }

 /* ---------- Геометрия ---------- */
 function layout(t){
  // Верхняя плашка занимает часть холста — мозг рисуется под ней.
  const inset=Math.min(H*.3,(top.offsetHeight||0)+(W<640?28:12)),h=H-inset,m=Math.min(W,h),cx=W/2,cy=inset+h/2;
  const rx=W>=h?Math.min(W*.37,m*.78):W*.3,ry=W>=h?h*.35:Math.min(h*.38,W*.75);
  const b=reduceQuery.matches?1:ease((performance.now()-bloomStart)/1800);
  const N=model.lobes.length;
  const coreR=m*(N?.2:.26)*(0.85+.15*b+(N?0:.15*(1-b)));
  model.lobes.forEach((l,i)=>{
   const s=l.state,a=-Math.PI/2+TAU*i/Math.max(N,1)+(N%2?0:Math.PI/N/2);
   const wob=still()?0:1;
   const x=cx+Math.cos(a)*rx*b+Math.sin(t*.27+s.seed%7)*m*.012*wob,y=cy+Math.sin(a)*ry*b+Math.cos(t*.21+s.seed%5)*m*.012*wob;
   s.x=x;s.y=y;s.a=a;s.r=m*clamp(.042+.014*Math.sqrt(l.items.length),.055,.105)*(.4+.6*b);
  });
  return {cx,cy,coreR,m,b};
 }
 // Нить ядро→зона: квадратичная кривая с изгибом; u∈[0,1].
 function curve(G,s,f,u){
  const sx=G.cx+Math.cos(f.a)*G.coreR*.55,sy=G.cy+Math.sin(f.a)*G.coreR*.55;
  const ex=s.x+Math.cos(f.a*1.7)*s.r*.5,ey=s.y+Math.sin(f.a*1.7)*s.r*.5;
  const mx=(sx+ex)/2,my=(sy+ey)/2,dx=ex-sx,dy=ey-sy;
  const qx=mx-dy*f.bend*.35,qy=my+dx*f.bend*.35,v=1-u;
  return [v*v*sx+2*v*u*qx+u*u*ex,v*v*sy+2*v*u*qy+u*u*ey];
 }

 /* ---------- Отрисовка ---------- */
 let sprite=null;
 function glowSprite(){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,250,235,1)');gr.addColorStop(.18,'rgba(255,214,140,.85)');gr.addColorStop(.5,'rgba(240,150,60,.22)');gr.addColorStop(1,'rgba(240,150,60,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return c}
 function cloud(parts,x,y,r,rot,col,inten,hazeA){
  const R=r*dpr,X=x*dpr,Y=y*dpr;
  const hz=ctx.createRadialGradient(X,Y,0,X,Y,R*1.35);hz.addColorStop(0,rgba(col,.34*hazeA));hz.addColorStop(.5,rgba(col,.12*hazeA));hz.addColorStop(1,rgba(col,0));
  ctx.globalAlpha=1;ctx.fillStyle=hz;ctx.fillRect(X-R*1.4,Y-R*1.4,R*2.8,R*2.8);
  const ca=Math.cos(rot),sa=Math.sin(rot),ct=Math.cos(.38),st=Math.sin(.38),tw=still()?0:1;
  ctx.fillStyle=rgba([Math.min(255,col[0]+10),Math.min(255,col[1]+25),Math.min(255,col[2]+40)],1);
  const ps=Math.max(1,dpr*1.25*ui);
  for(const p of parts){
   const x1=p.x*ca+p.z*sa,z1=-p.x*sa+p.z*ca,y1=p.y*ct-z1*st,z2=p.y*st+z1*ct;
   const d=(z2+1.3)/2.6,a=p.b*d*inten*1.35*(tw?.72+.28*Math.sin(simT*p.f+p.ph):1);
   if(a<.02)continue;
   const s=p.s*ps*(.6+.7*d);ctx.globalAlpha=Math.min(1,a);ctx.fillRect(X+x1*R-s/2,Y+y1*R-s/2,s,s);
  }
  ctx.globalAlpha=1;
 }
 function draw(dt){
  if(!sprite)sprite=glowSprite();
  const G=layout(simT);
  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  // Пыль-звёзды.
  ctx.fillStyle='#f2d27a';for(const d of dust){ctx.globalAlpha=d.a*(still()?1:.6+.4*Math.sin(simT*.6+d.ph));ctx.fillRect(d.x*canvas.width,d.y*canvas.height,d.s*dpr,d.s*dpr)}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='lighter';
  // Нити.
  for(const l of model.lobes){const s=l.state;ctx.strokeStyle=rgba(l.color,.07*G.b);ctx.lineWidth=dpr*.7;
   for(const f of s.fil){ctx.beginPath();for(let k=0;k<=12;k++){const [x,y]=curve(G,s,f,k/12);k?ctx.lineTo(x*dpr,y*dpr):ctx.moveTo(x*dpr,y*dpr)}ctx.stroke()}}
  // Потоки: факты текут в ядро (обучение), дела — из ядра наружу (действия).
  for(const l of model.lobes){const s=l.state,inward=l.id==='facts'||l.id.startsWith('fs:'),c=l.color;
   for(const p of s.streams){if(!still())p.u=(p.u+p.v*dt)%1;const u=inward?1-p.u:p.u,f=s.fil[p.f%s.fil.length];if(!f)continue;
    const [x,y]=curve(G,s,f,u),[x0,y0]=curve(G,s,f,clamp(inward?u+.018:u-.018,0,1));
    ctx.strokeStyle=rgba(c,.75*G.b*Math.sin(Math.PI*u));ctx.lineWidth=dpr*1.4;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x0*dpr,y0*dpr);ctx.lineTo(x*dpr,y*dpr);ctx.stroke()}}
  // Ядро.
  core.pulse=Math.max(0,core.pulse-dt*1.2);
  cloud(core.parts,G.cx,G.cy,G.coreR*(1+core.pulse*.05),simT*.12,COLORS.core,1.15+core.pulse*.6,1.7+core.pulse);
  const hot=G.coreR*dpr*(.55+core.pulse*.3);ctx.globalAlpha=.5+.4*core.pulse;ctx.drawImage(sprite,G.cx*dpr-hot,G.cy*dpr-hot,hot*2,hot*2);ctx.globalAlpha=1;
  // Зоны и нейроны.
  for(const l of model.lobes){const s=l.state;s.pulse=Math.max(0,s.pulse-dt*1.4);
   const rot=simT*(.18+(s.seed%5)*.02)+s.seed;
   cloud(s.parts,s.x,s.y,s.r*(1+s.pulse*.15),rot,l.color,(l.id==='conflicts'?1.1:.9)+s.pulse,1+s.pulse*1.5);
   const ca=Math.cos(rot),sa=Math.sin(rot);
   for(const it of l.items){const n=neurons.get(it.id);if(!n)continue;n.flash=Math.max(0,n.flash-dt*.45);
    const x1=n.ox*ca+n.oz*sa,z1=-n.ox*sa+n.oz*ca,d=(z1+1.2)/2.4;
    n.sx=s.x+x1*s.r;n.sy=s.y+n.oy*s.r;n.vis=G.b;
    const size=ui*dpr*(5+3*it.weight+(it.hot?3:0)+n.flash*22)*(.7+.5*d)*(hover&&hover.id===it.id?1.6:1);
    ctx.globalAlpha=clamp((it.dim?.35:.75)*d+n.flash,0,1)*G.b;ctx.drawImage(sprite,n.sx*dpr-size/2,n.sy*dpr-size/2,size,size);
    if(n.flash>0){ctx.globalAlpha=n.flash*.8;ctx.strokeStyle=rgba(l.color,1);ctx.lineWidth=dpr*1.2;ctx.beginPath();ctx.arc(n.sx*dpr,n.sy*dpr,dpr*(6+(1-n.flash)*40),0,TAU);ctx.stroke()}
   }}
  ctx.globalAlpha=1;
  // Связи факт→факт.
  ctx.lineWidth=dpr*.9;for(const [a,b] of model.links){const A=neurons.get(a),B=neurons.get(b);if(!A||!B)continue;ctx.strokeStyle='rgba(242,210,122,'+(.22*G.b)+')';ctx.beginPath();ctx.moveTo(A.sx*dpr,A.sy*dpr);const mx=(A.sx+B.sx)/2,my=(A.sy+B.sy)/2;ctx.quadraticCurveTo(mx*dpr+(G.cx-mx)*.3*dpr,my*dpr+(G.cy-my)*.3*dpr,B.sx*dpr,B.sy*dpr);ctx.stroke()}
  // Импульсы.
  impulses=impulses.filter(p=>{const s=p.lobe.state,f=s&&s.fil[p.f];if(!f)return false;p.u+=dt*(reduceQuery.matches?4:p.big?.55:.9);
   if(p.u>=1){if(p.item){const n=neurons.get(p.item.id);if(n)n.flash=1;s.pulse=1}return false}
   const [x,y]=curve(G,s,f,ease(p.u)),z=dpr*(p.big?26:12);ctx.globalAlpha=p.big?1:.55;ctx.drawImage(sprite,x*dpr-z/2,y*dpr-z/2,z,z);return true});
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  labels(G);
  if(coreTextT>0){coreTextT-=dt;const a=clamp(coreTextT,0,1);ctx.font=(600*1)+' '+Math.round(12*ui*dpr)+'px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';ctx.textAlign='center';ctx.fillStyle='rgba(255,244,220,'+a+')';ctx.fillText('запомнила → '+trim(coreText,38),G.cx*dpr,(G.cy+G.coreR*1.25)*dpr)}
 }
 function trim(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s}
 function labels(G){
  const mono='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',small=W<520;
  ctx.textBaseline='alphabetic';
  for(const l of model.lobes){const s=l.state;if(G.b<.6)continue;
   const right=Math.cos(s.a)>=-.15,title=trim(l.label,small?18:28),count=l.items.length+' '+plural(l.items.length,'запись','записи','записей');
   const f1='600 '+Math.round((small?10:11.5)*ui*dpr)+'px '+mono,f2=Math.round((small?9:10)*ui*dpr)+'px '+mono;
   ctx.font=f1;const tw=ctx.measureText(title).width,pad=6*dpr;
   // Подпись не выходит за край холста (важно на телефоне).
   let x=(s.x+(right?1:-1)*(s.r*.8+6))*dpr;const y=(s.y-s.r*.85-6)*dpr;
   x=right?Math.min(x,canvas.width-tw-pad):Math.max(x,tw+pad);
   ctx.textAlign=right?'left':'right';ctx.globalAlpha=clamp((G.b-.6)/.4,0,1);
   ctx.fillStyle=l.id==='conflicts'?'#ff8a70':'#f6ead0';ctx.fillText(title,x,y);
   ctx.font=f2;ctx.fillStyle='rgba(205,190,160,.7)';ctx.fillText(count,x,y+13*ui*dpr);
   ctx.strokeStyle='rgba(246,234,208,.35)';ctx.lineWidth=dpr;ctx.beginPath();ctx.moveTo(x+(right?-4:4)*dpr,y+3*dpr);ctx.lineTo((s.x+(right?1:-1)*s.r*.45)*dpr,(s.y-s.r*.45)*dpr);ctx.stroke();
  }
  ctx.globalAlpha=1;
 }
 function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c}

 /* ---------- Наведение и клик ---------- */
 function pick(x,y){
  let best=null,bd=(W<640?22:14)**2;
  for(const n of neurons.values()){if(!n.vis)continue;const d=(n.sx-x)**2+(n.sy-y)**2;if(d<bd){bd=d;best=n}}
  if(best)return {type:'neuron',n:best};
  for(const l of model.lobes){const s=l.state;if((s.x-x)**2+(s.y-y)**2<(s.r*1.1)**2)return {type:'lobe',l}}
  return null;
 }
 function showTip(hit,x,y,withButton){
  if(!hit){tip.hidden=true;return}
  tip.replaceChildren();
  if(hit.type==='neuron'){const it=hit.n.item;tip.append(el('div','brain-tip-k',hit.n.lobe.label),el('div','brain-tip-t',trim(it.title,140)),el('div','brain-tip-m',it.meta));
   if(withButton){const b=el('button','brain-btn','Открыть');b.type='button';b.onclick=()=>it.open();tip.append(b)}}
  else{const l=hit.l;tip.append(el('div','brain-tip-k','зона'),el('div','brain-tip-t',l.label),el('div','brain-tip-m',l.items.length+' '+plural(l.items.length,'запись','записи','записей')));
   if(withButton){const b=el('button','brain-btn','Открыть раздел');b.type='button';b.onclick=()=>l.open();tip.append(b)}}
  tip.hidden=false;tip.classList.toggle('pinned',!!withButton);
  const tw=tip.offsetWidth,th=tip.offsetHeight;tip.style.left=clamp(x+14,8,W-tw-8)+'px';tip.style.top=clamp(y+14,8,H-th-8)+'px';
 }
 const local=e=>{const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
 canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||pinned)return;const [x,y]=local(e),hit=pick(x,y);hover=hit&&hit.type==='neuron'?hit.n.item:null;canvas.style.cursor=hit?'pointer':'default';showTip(hit,x,y,false);dirty=true});
 canvas.addEventListener('pointerleave',()=>{if(!pinned){tip.hidden=true;hover=null;dirty=true}});
 canvas.addEventListener('click',e=>{const [x,y]=local(e),hit=pick(x,y);pinned=hit;hover=hit&&hit.type==='neuron'?hit.n.item:null;showTip(hit,x,y,true);if(hit&&hit.type==='lobe')hit.l.state.pulse=1;dirty=true});
 document.addEventListener('keydown',onKey);
 function onKey(e){if(e.key==='Escape'&&pinned){pinned=null;tip.hidden=true;hover=null;dirty=true}}

 /* ---------- Обучение: новый факт прямо отсюда ---------- */
 teach.onsubmit=async e=>{
  e.preventDefault();const parts=tIn.value.split('|').map(x=>x.trim());
  if(parts.length!==3||parts.some(x=>!x)){tHint.textContent='Нужно три части через «|»: субъект | связь | объект.';tHint.classList.add('err');tIn.focus();return}
  tBtn.disabled=true;
  try{const r=await fetch('/api/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:parts[0],predicate:parts[1],object:parts[2],sourceId:'brain'})});const data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка');
   tIn.value='';tHint.classList.remove('err');tHint.textContent=data.duplicate?'Это я уже знаю.':data.conflicts?'Запомнила, но это противоречит прежним фактам ('+data.conflicts+').':'Запомнила. Смотри, как вспыхнул новый нейрон.';core.pulse=1;await loadFacts()}
  catch(err){tHint.textContent=err.message;tHint.classList.add('err')}finally{tBtn.disabled=false}
 };

 /* ---------- Данные и цикл ---------- */
 async function loadFacts(){
  try{const [f,c]=await Promise.all([fetch('/api/facts?limit=500').then(r=>r.ok?r.json():[]),fetch('/api/facts/conflicts?limit=100').then(r=>r.ok?r.json():[])]);facts=Array.isArray(f)?f:[];conflicts=Array.isArray(c)?c:[]}catch{}
  if(host.isConnected)apply();
 firstVisit=false;
 }
 const onWorkspace=()=>apply();
 const onMemory=()=>loadFacts();
 window.addEventListener('tenma:workspace',onWorkspace);window.addEventListener('tenma:memory',onMemory);
 const poll=setInterval(()=>{if(!document.hidden)loadFacts()},20000);
 // Фоновая «болтовня» синапсов: редкие слабые импульсы, чтобы мозг выглядел живым.
 let chatter=0;
 function frame(now){
  if(!host.isConnected){destroy();return}
  raf=requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000||0);last=now;
  const blooming=!reduceQuery.matches&&now-bloomStart<1900,busy=impulses.length||blooming||coreTextT>0||core.pulse>0||[...neurons.values()].some(n=>n.flash>0);
  if(!still()){simT+=dt;chatter-=dt;if(chatter<=0&&model.lobes.length){const l=model.lobes[Math.floor(Math.random()*model.lobes.length)];impulses.push({lobe:l,u:0,f:Math.floor(Math.random()*l.state.fil.length)});chatter=.5+Math.random()*1.4}}
  else if(!busy&&!dirty)return;
  dirty=false;draw(dt);
 }
 function destroy(){cancelAnimationFrame(raf);clearInterval(poll);ro.disconnect();window.removeEventListener('tenma:workspace',onWorkspace);window.removeEventListener('tenma:memory',onMemory);document.removeEventListener('keydown',onKey)}
 resize();apply();loadFacts();raf=requestAnimationFrame(frame);
 return {destroy};
}
window.TenmaBrain={mount};
})();
