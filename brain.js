'use strict';
/* «Мозг» Тэнмаюрики — живая карта памяти в стиле роя частиц.
   Ядро — плотная медно-огненная туманность с горячими пятнами; из него вырастают кластеры-зоны
   (дела, заметки, факты по субъектам, противоречия), вокруг крупных зон — спутники.
   Между ядром и зонами — пучки нитей со штрихами. Каждая запись — нейрон в своей зоне;
   новая запись прилетает импульсом из ядра и вспыхивает. Противоречия — «сбой узла»: серый узел,
   красная подпись, красный график. HUD как у роя: 01 журнал, 02 активность, 03 структура (веер).
   Только canvas 2D, без библиотек. Монтируется в раздел «Мозг»: window.TenmaBrain.mount(element). */
(()=>{
const TAU=Math.PI*2;
const SEEN_KEY='tenma.brain.seen.v1',CFG_KEY='tenma.brain.cfg.v1';
const reduceQuery=matchMedia('(prefers-reduced-motion: reduce)');
const wideQuery=matchMedia('(min-width: 900px)');
const read=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch{return d}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){let a=seed>>>0||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=t=>1-Math.pow(1-clamp(t,0,1),3);
const rgba=(c,a)=>'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';
const MONO='ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';

// Палитра роя: медь и угли. tones — три слоя частиц: тёмные угли, медь, раскалённые искры.
const EMBER={haze:[150,62,22],tones:[[150,70,30],[226,128,60],[255,214,160]]};
const PALE={haze:[95,95,100],tones:[[120,120,128],[200,200,208],[245,245,250]]};
const COLORS={personal:[236,140,66],work:[240,118,52],notes:[246,170,96],facts:[232,132,60],conflicts:[255,72,56],done:[150,110,80],core:[236,136,62]};
const DAY=86400000;

/* ---------- Частицы: объёмный шар + горячие пятна + завихрения ---------- */
function unit(r){const z=2*r()-1,t=TAU*r(),q=Math.sqrt(1-z*z);return [q*Math.cos(t),z,q*Math.sin(t)]}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function norm(a){const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l]}
function gauss(r){return (r()+r()+r()+r()-2)/2}
function makeParticles(n,seed){
 const r=rng(seed);
 const spots=Array.from({length:3+Math.floor(r()*3)},()=>{const d=unit(r),k=.15+.45*r();return {c:d.map(x=>x*k),s:.12+.16*r()}});
 const bands=[0,1].map(()=>{const a=unit(r),u=norm(cross(a,Math.abs(a[1])<.9?[0,1,0]:[1,0,0]));return {u,v:cross(a,u)}});
 const out=[];
 for(let i=0;i<n;i++){
  const kind=r();let p,tone,b;
  if(kind<.24){const S=spots[i%spots.length];p=S.c.map(c=>c+gauss(r)*S.s);tone=r()<.55?2:1;b=.55+.45*r()}
  else if(kind<.36){const B=bands[i%2],f=TAU*r(),k=.4+.45*r();p=[0,1,2].map(d=>(B.u[d]*Math.cos(f)+B.v[d]*Math.sin(f))*k+gauss(r)*.07);tone=r()<.4?2:1;b=.4+.5*r()}
  else{const d=unit(r),k=Math.cbrt(r())*(.78+.32*r());p=d.map(x=>x*k);tone=r()<.55?0:1;b=.25+.55*r()}
  out.push({x:p[0],y:p[1],z:p[2],t:tone,s:r()<.06?2:1,b,f:.6+2*r(),ph:TAU*r()});
 }
 // Перемешано: при низком качестве рисуется только начало массива — распределение не ломается.
 for(let i=out.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
 return out;
}

/* ---------- Данные: workspace + факты → зоны и нейроны ---------- */
function ts(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c}
function buildModel(ws,facts,conflicts){
 const app=()=>window.TenmaApp;
 const lobes=[],events=[];
 const add=(id,label,sub,color,items,open)=>{if(items.length)lobes.push({id,label,sub,color,items,open})};
 const today=new Date();today.setHours(0,0,0,0);const t0=today.getTime();
 const taskItem=t=>({id:'t:'+t.id,title:t.title,meta:(t.done?'выполнено':t.due?'срок '+t.due+(t.time?' '+t.time:''):'без срока')+(t.priority==='high'?' · важное':''),ts:ts(t.createdAt),hot:!t.done&&t.due&&ts(t.due+'T00:00:00')<=t0,dim:!!t.done,weight:t.priority==='high'?1.5:1,open:()=>app()?.select?app().select('task',t.id):app()?.go('planner')});
 const tasks=ws.tasks||[],notes=ws.notes||[];
 const taskSub=list=>{const open=list.filter(t=>!t.done),hot=open.filter(t=>t.due&&ts(t.due+'T00:00:00')<=t0).length;return open.length+' открыто'+(hot?' · '+hot+' сегодня':'')};
 const personal=tasks.filter(t=>t.category!=='work'),work=tasks.filter(t=>t.category==='work');
 add('personal','личные дела',taskSub(personal),COLORS.personal,personal.map(taskItem),()=>app()?.go('tasks'));
 add('work','рабочие дела',taskSub(work),COLORS.work,work.map(taskItem),()=>app()?.go('tasks'));
 const pinned=notes.filter(n=>n.pinned).length;
 add('notes','заметки',notes.length+' '+plural(notes.length,'заметка','заметки','заметок')+(pinned?' · '+pinned+' закреп.':''),COLORS.notes,notes.map(n=>({id:'n:'+n.id,title:n.title,meta:(n.category==='work'?'рабочая':'личная')+' заметка'+(n.pinned?' · закреплена':''),ts:ts(n.createdAt),weight:n.pinned?1.4:1,open:()=>app()?.select?app().select('note',n.id):app()?.go('notes')})),()=>app()?.go('notes'));
 // Факты: крупные субъекты получают свою зону, остальные — общая зона «факты».
 const bySubject=new Map();for(const f of facts){const k=f.subject.toLocaleLowerCase();if(!bySubject.has(k))bySubject.set(k,{name:f.subject,list:[]});bySubject.get(k).list.push(f)}
 const subjects=[...bySubject.values()].sort((a,b)=>b.list.length-a.list.length);
 const big=subjects.filter(s=>s.list.length>=2).slice(0,4),rest=subjects.filter(s=>!big.includes(s)).flatMap(s=>s.list);
 const factItem=f=>({id:'f:'+f.id,title:f.subject+' — '+f.predicate+' → '+f.object,meta:'факт · '+(f.source_id||'')+' · уверенность '+f.confidence,ts:ts(f.observed_at),weight:.6+.6*(+f.confidence||0),fact:f,open:()=>app()?.go('facts')});
 const factSub=list=>[...new Set(list.map(f=>f.predicate))].slice(0,2).join(' · ');
 for(const s of big)add('fs:'+s.name.toLocaleLowerCase(),s.name.toLocaleLowerCase(),factSub(s.list),COLORS.facts,s.list.map(factItem),()=>app()?.go('facts'));
 add('facts','факты',rest.length+' '+plural(rest.length,'факт','факта','фактов'),COLORS.facts,rest.map(factItem),()=>app()?.go('facts'));
 add('conflicts','противоречия','сбой · '+conflicts.length,COLORS.conflicts,conflicts.map(c=>({id:'c:'+c.id,title:c.subject+' — '+c.predicate+': «'+c.earlier+'» или «'+c.newer+'»',meta:'противоречие',ts:ts(c.detected_at),weight:1.3,open:()=>app()?.go('facts')})),()=>app()?.go('facts'));
 // Журнал: что мозг узнал и когда.
 for(const t of tasks){events.push({t:ts(t.createdAt),kind:t.category==='work'?'работа':'дело',color:t.category==='work'?COLORS.work:COLORS.personal,text:t.title});if(t.doneAt)events.push({t:ts(t.doneAt),kind:'готово',color:COLORS.done,text:t.title})}
 for(const n of notes)events.push({t:ts(n.createdAt),kind:'заметка',color:COLORS.notes,text:n.title});
 for(const f of facts)events.push({t:ts(f.observed_at),kind:'факт',color:COLORS.facts,text:f.subject+' '+f.predicate+' '+f.object});
 for(const c of conflicts)events.push({t:ts(c.detected_at),kind:'сбой',color:COLORS.conflicts,text:c.subject+': '+c.earlier+' / '+c.newer,bad:true});
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
 const resetBtn=el('button','brain-btn','Пробудить');resetBtn.type='button';resetBtn.title='Заново вырастить мозг из ядра';
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
 const logHead=el('div','brain-k'),logAlert=el('span','brain-alert','сбой узла');logAlert.hidden=true;logHead.append(el('span','','01 // журнал событий'),logAlert);
 const logList=el('ul','brain-log');pLog.append(logHead,logList);
 const actNum=el('div','brain-num'),actCap=el('div','brain-cap'),spark=el('canvas','brain-spark');
 pAct.append(el('div','brain-k','02 // записей / сутки'),actNum,spark,actCap);
 const treeHead=el('div','brain-k'),treeN=el('span','brain-n');treeHead.append(el('span','','03 // структура'),treeN);
 const fan=el('canvas','brain-fan'),fanFoot=el('div','brain-cap'),tree=el('ul','brain-tree');
 pTree.append(treeHead,fan,fanFoot,tree);
 hud.append(pLog,pAct,pTree);
 // На широком экране HUD лежит поверх холста внизу, как в рое; на телефоне — под ним.
 function placeHud(){if(wideQuery.matches){hud.classList.add('over');stage.append(hud);host.replaceChildren(stage,teach)}else{hud.classList.remove('over');host.replaceChildren(stage,teach,hud)}drawSpark();drawFan();dirty=true}
 const ctx=canvas.getContext('2d');

 let W=0,H=0,dpr=1,ui=1,quality=1,baseQ=1,fpsT=0,fpsN=0,model={lobes:[],events:[],links:[],facts:0},facts=[],conflicts=[];
 const core={parts:makeParticles(9000,7),pulse:0};
 const satParts=makeParticles(220,31);
 const lobeState=new Map();
 const neurons=new Map();
 let impulses=[],seen=new Set(read(SEEN_KEY,[])),firstVisit=!seen.size,bloomStart=performance.now(),coreText='',coreKind='',coreTextT=0;
 let simT=0,last=performance.now(),raf=0,dirty=true,pinned=null,hover=null,stars=[],spikes=[];
 const still=()=>cfg.paused||reduceQuery.matches;

 function setPause(){pauseBtn.textContent=cfg.paused?'▶ Движение':'❚❚ Пауза';pauseBtn.setAttribute('aria-pressed',String(cfg.paused))}
 setPause();
 pauseBtn.onclick=()=>{cfg.paused=!cfg.paused;write(CFG_KEY,cfg);setPause();dirty=true};
 resetBtn.onclick=()=>{bloomStart=performance.now();dirty=true};

 function resize(){
  const r=stage.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);
  dpr=Math.min(2,window.devicePixelRatio||1);if(W*H*dpr*dpr>9e6)dpr=Math.sqrt(9e6/(W*H)); // 4K: не больше ~9 Мп
  ui=clamp(parseFloat(getComputedStyle(document.documentElement).fontSize)/16,.85,1.9); // подписи растут вместе с интерфейсом (4K)
  baseQ=clamp(W*H/(1500*800),.45,1);quality=Math.min(quality,baseQ); // на телефоне частиц меньше
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
  // Фон: далёкие созвездия — маленькие рои-графы, как в финале ролика.
  const r2=rng(99),nc=Math.round(clamp(W*H/60000,8,40));
  stars=Array.from({length:nc},()=>{const cx=r2(),cy=r2(),k=4+Math.floor(r2()*9),pts=[];for(let i=0;i<k;i++)pts.push([cx+(r2()-.5)*.08,cy+(r2()-.5)*.08*W/H]);return {pts,a:.08+.18*r2(),ph:TAU*r2()}});
  drawSpark();drawFan();dirty=true;
 }
 const ro=new ResizeObserver(resize);ro.observe(stage);
 const hudRo=new ResizeObserver(()=>{drawSpark();drawFan()});hudRo.observe(spark);hudRo.observe(fan);

 /* Обновление модели с сохранением уже живущих зон и нейронов. */
 function apply(){
  const ws=window.TenmaApp?.workspace||{notes:[],tasks:[]};
  model=buildModel(ws,facts,conflicts);
  const alive=new Set();
  for(const l of model.lobes){
   alive.add(l.id);
   let s=lobeState.get(l.id);
   const n=l.items.length,want=Math.round(clamp(450+220*Math.sqrt(n),600,1800));
   if(!s){s={parts:makeParticles(want,hash(l.id)),pulse:0,x:0,y:0,r:0,fil:[],streaks:[],sats:[],seed:hash(l.id)};lobeState.set(l.id,s)}
   else if(Math.abs(s.parts.length-want)>120)s.parts=makeParticles(want,hash(l.id));
   const r=rng(s.seed^0x9e37);
   const nf=Math.round(clamp(30+n*4,30,90));
   if(s.fil.length!==nf)s.fil=Array.from({length:nf},()=>({a:TAU*r(),bend:(r()-.5)*.7,off:(r()-.5)*.9}));
   const ns=Math.round(clamp(60+n*10,60,240));
   if(s.streaks.length!==ns)s.streaks=Array.from({length:ns},(_,i)=>({f:i%nf,u:r(),v:.05+.12*r(),len:.025+.07*r(),a:.2+.45*r()}));
   const nsat=n>=4?Math.min(4,Math.floor(Math.sqrt(n))):0;
   if(s.sats.length!==nsat)s.sats=Array.from({length:nsat},()=>({a:TAU*r(),d:1.55+.6*r(),k:.28+.18*r(),sp:(r()-.5)*.3}));
   l.state=s;l.bad=l.id==='conflicts';
   for(const it of l.items){
    let nn=neurons.get(it.id);
    if(!nn){const q=rng(hash(it.id)),d=unit(q),k=.15+.6*Math.cbrt(q());nn={ox:d[0]*k,oy:d[1]*k,oz:d[2]*k,flash:0,sx:0,sy:0,vis:0};neurons.set(it.id,nn)}
    nn.item=it;nn.lobe=l;alive.add(it.id);
    if(!seen.has(it.id)){seen.add(it.id);if(!firstVisit){impulses.push({lobe:l,item:it,u:0,f:Math.floor(Math.random()*l.state.fil.length),big:true});coreText=it.title;coreKind=l.label;coreTextT=4.5}}
   }
  }
  for(const k of [...lobeState.keys()])if(!alive.has(k))lobeState.delete(k);
  for(const k of [...neurons.keys()])if(!alive.has(k))neurons.delete(k);
  if(seen.size>4000)seen=new Set([...neurons.keys()]);
  write(SEEN_KEY,[...seen]);
  renderHud();dirty=true;
 }

 const recentBad=()=>model.events.some(e=>e.bad&&e.t>=Date.now()-DAY);
 function renderHud(){
  const total=model.lobes.reduce((s,l)=>s+l.items.length,0),links=model.facts+model.links.length;
  const day=model.events.filter(e=>e.t>=Date.now()-DAY).length,week=model.events.filter(e=>e.t>=Date.now()-7*DAY).length;
  bar.textContent='● TENMAYURIKA // МОЗГ · нейронов '+total+' · связей '+links+' · записей '+day+'/сутки · зон '+model.lobes.length;
  stage.setAttribute('aria-label','Карта памяти: '+total+' записей в '+model.lobes.length+' зонах');
  empty.hidden=total>0;empty.textContent=total?'':'Пока только ядро. Научи меня первому факту ниже, или добавь дело в Планере, и мозг начнёт расти.';
  const bad=recentBad();logAlert.hidden=!bad;actNum.classList.toggle('bad',bad);
  logList.replaceChildren(...(model.events.slice(0,5).map(e=>{const li=el('li');if(e.bad)li.className='bad';const k=el('span','brain-tag',e.kind);k.style.color=rgba(e.color,1);const t=el('span','brain-ev',e.text);const d=el('time','',when(e.t));li.append(k,t,d);return li})));
  if(!model.events.length)logList.append(el('li','brain-muted','событий пока нет'));
  actNum.textContent=day.toLocaleString('ru-RU');actCap.textContent='за 7 дней: '+week+' · L1:'+model.lobes.length+' L2:'+total+' L3:'+links;
  treeN.textContent='N='+total;fanFoot.textContent='ядро → '+model.lobes.length+' '+plural(model.lobes.length,'зона','зоны','зон')+' → '+total+' '+plural(total,'нейрон','нейрона','нейронов');
  tree.replaceChildren(...model.lobes.map(l=>{const li=el('li');const dot=el('i');dot.style.background=rgba(l.color,1);dot.style.boxShadow='0 0 8px '+rgba(l.color,.8);const b=el('button','brain-link',l.label);b.type='button';b.onclick=l.open;li.append(dot,b,el('span','brain-count',String(l.items.length)));return li}));
  drawSpark();drawFan();
 }
 function when(t){if(!t)return '';const d=new Date(t),now=new Date();const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');return d.toDateString()===now.toDateString()?hm:d.getDate()+'.'+String(d.getMonth()+1).padStart(2,'0')}
 function prep(c){const w=c.clientWidth||200,h=c.clientHeight||48,sd=Math.min(2,window.devicePixelRatio||1);c.width=Math.round(w*sd);c.height=Math.round(h*sd);const g=c.getContext('2d');g.scale(sd,sd);return [g,w,h]}
 // 02: волнистая линия по часам за последние 48 ч; при сбое — красная и рваная, как в ролике.
 function drawSpark(){
  const [c,w,h]=prep(spark),bins=48,base=Date.now()-bins*3600000,counts=new Array(bins).fill(0);
  for(const e of model.events){const i=Math.floor((e.t-base)/3600000);if(i>=0&&i<bins)counts[i]+=e.bad?3:1}
  const bad=recentBad(),max=Math.max(1,...counts);
  const pts=counts.map((v,i)=>{const x=3+i*(w-6)/(bins-1),wave=Math.sin(i*.55)*.18+Math.sin(i*1.7)*.06;return [x,h/2-(v/max-.35)*(h*.55)-wave*h*(bad?.9:.5)+(bad&&i%2?(Math.random()-.5)*h*.35:0)]});
  c.lineWidth=1.6;c.lineJoin='round';c.strokeStyle=bad?'#ff4a38':'#ee8a3c';c.shadowColor=c.strokeStyle;c.shadowBlur=6;c.beginPath();c.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++){const [x0,y0]=pts[i-1],[x1,y1]=pts[i];if(bad)c.lineTo(x1,y1);else c.quadraticCurveTo(x0,y0,(x0+x1)/2,(y0+y1)/2)}c.stroke();
 }
 // 03: веер — ядро → зоны → колонки нейронов.
 function drawFan(){
  const [c,w,h]=prep(fan),L=model.lobes,n=Math.max(1,L.length),x0=8,y0=h/2,x1=w*.42,x2=w*.6;
  c.lineWidth=1;L.forEach((l,i)=>{const y=n>1?8+i*(h-16)/(n-1):h/2;
   c.strokeStyle=rgba(l.color,.55);c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y);c.stroke();
   const k=Math.min(l.items.length,24);for(let j=0;j<k;j++){const xx=x2+(j%12)*((w-x2-4)/12),yy=y+(Math.floor(j/12)-.5)*4;c.fillStyle=rgba(l.color,.85);c.fillRect(xx,yy,2,2)}
   c.strokeStyle=rgba(l.color,.25);c.beginPath();c.moveTo(x1,y);c.lineTo(x2-3,y);c.stroke();
   c.fillStyle=l.bad?'#ff4a38':rgba(l.color,1);c.beginPath();c.arc(x1,y,2.4,0,TAU);c.fill()});
  c.fillStyle='#ffe2b8';c.shadowColor='#ffb060';c.shadowBlur=8;c.beginPath();c.arc(x0,y0,3.4,0,TAU);c.fill();
 }

 /* ---------- Геометрия ---------- */
 function layout(t){
  const topH=(top.offsetHeight||0)+(W<640?28:16),botH=hud.classList.contains('over')?(hud.offsetHeight||0)+8:0;
  const inset=Math.min(H*.3,topH),h=Math.max(H*.4,H-inset-botH),m=Math.min(W,h),cx=W/2,cy=inset+h/2;
  const rx=W>=h?Math.min(W*.36,m*.82):W*.32,ry=W>=h?h*.36:Math.min(h*.36,W*.75);
  // Рост как в ролике: сначала одно ядро, затем кластеры «отпочковываются» и уходят по местам.
  const b=reduceQuery.matches?1:ease(((performance.now()-bloomStart)/1000-.5)/2);
  const N=model.lobes.length;
  const coreR=m*(N?.2:.26)*(1.15-.15*b);
  model.lobes.forEach((l,i)=>{
   const s=l.state,a=-Math.PI/2+TAU*i/Math.max(N,1)+(N%2?0:Math.PI/N/2)+(s.seed%100-50)/100*.25;
   const wob=still()?0:1;
   const x=cx+Math.cos(a)*rx*b+Math.sin(t*.27+s.seed%7)*m*.012*wob,y=cy+Math.sin(a)*ry*b+Math.cos(t*.21+s.seed%5)*m*.012*wob;
   s.x=x;s.y=y;s.a=a;s.r=m*clamp(.05+.016*Math.sqrt(l.items.length),.06,.12)*(.35+.65*b);
  });
  return {cx,cy,coreR,m,b};
 }
 // Нить ядро→зона: квадратичная кривая; f.off раздвигает нити в пучок.
 function curve(G,s,f,u){
  const sx=G.cx+Math.cos(f.a)*G.coreR*.7,sy=G.cy+Math.sin(f.a)*G.coreR*.7;
  const ex=s.x+Math.cos(f.a*1.7)*s.r*.55,ey=s.y+Math.sin(f.a*1.7)*s.r*.55;
  const mx=(sx+ex)/2,my=(sy+ey)/2,dx=ex-sx,dy=ey-sy;
  const qx=mx-dy*(f.bend*.3+f.off*.12),qy=my+dx*(f.bend*.3+f.off*.12),v=1-u;
  return [v*v*sx+2*v*u*qx+u*u*ex,v*v*sy+2*v*u*qy+u*u*ey];
 }

 /* ---------- Отрисовка ---------- */
 let sprite=null,spriteBad=null;
 function glowSprite(c1,c2,c3){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,c1);gr.addColorStop(.2,c2);gr.addColorStop(.55,c3);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return c}
 function cloud(parts,x,y,r,rot,pal,inten,hazeA,count){
  const R=r*dpr,X=x*dpr,Y=y*dpr;
  const hz=ctx.createRadialGradient(X,Y,0,X,Y,R*1.3);hz.addColorStop(0,rgba(pal.haze,.55*hazeA));hz.addColorStop(.55,rgba(pal.haze,.22*hazeA));hz.addColorStop(1,rgba(pal.haze,0));
  ctx.globalAlpha=1;ctx.fillStyle=hz;ctx.fillRect(X-R*1.35,Y-R*1.35,R*2.7,R*2.7);
  const ca=Math.cos(rot),sa=Math.sin(rot),ct=Math.cos(.38),st=Math.sin(.38),tw=still()?0:1;
  const ps=Math.max(1,dpr*1.15*ui),lim=Math.min(parts.length,count||parts.length);
  for(let tone=0;tone<3;tone++){
   ctx.fillStyle=rgba(pal.tones[tone],1);
   for(let i=0;i<lim;i++){const p=parts[i];if(p.t!==tone)continue;
    const x1=p.x*ca+p.z*sa,z1=-p.x*sa+p.z*ca,y1=p.y*ct-z1*st,z2=p.y*st+z1*ct;
    const d=(z2+1.3)/2.6,a=p.b*d*inten*(tone===0?.75:1)*(tw?.75+.25*Math.sin(simT*p.f+p.ph):1);
    if(a<.03)continue;
    const s=p.s*ps*(.6+.6*d)*(tone===2?1.15:1);ctx.globalAlpha=Math.min(1,a);ctx.fillRect(X+x1*R-s/2,Y+y1*R-s/2,s,s);
   }
  }
  ctx.globalAlpha=1;
 }
 function draw(dt){
  if(!sprite){sprite=glowSprite('rgba(255,248,230,1)','rgba(255,196,120,.85)','rgba(230,110,40,.2)');spriteBad=glowSprite('rgba(255,255,255,1)','rgba(230,230,240,.7)','rgba(180,180,190,.15)')}
  const G=layout(simT),pal=l=>l.bad?PALE:EMBER;
  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation='lighter';
  // Далёкие созвездия.
  ctx.lineWidth=dpr*.6;for(const c of stars){const a=c.a*(still()?1:.7+.3*Math.sin(simT*.4+c.ph));ctx.strokeStyle='rgba(220,120,60,'+a*.5+')';ctx.beginPath();c.pts.forEach(([x,y],i)=>{const X=x*canvas.width,Y=y*canvas.height;i?ctx.lineTo(X,Y):ctx.moveTo(X,Y)});ctx.stroke();
   ctx.fillStyle='rgba(255,170,100,'+a+')';for(const [x,y] of c.pts)ctx.fillRect(x*canvas.width,y*canvas.height,1.4*dpr,1.4*dpr)}
  // Пучки нитей.
  for(const l of model.lobes){const s=l.state,col=l.bad?[200,200,210]:l.color;ctx.strokeStyle=rgba(col,.045*G.b);ctx.lineWidth=dpr*.6;
   for(const f of s.fil){ctx.beginPath();for(let k=0;k<=14;k++){const [x,y]=curve(G,s,f,k/14);k?ctx.lineTo(x*dpr,y*dpr):ctx.moveTo(x*dpr,y*dpr)}ctx.stroke()}}
  // Штрихи-«волокна»: факты текут в ядро (обучение), дела — из ядра наружу (действия).
  ctx.lineCap='round';
  for(const l of model.lobes){const s=l.state,inward=l.id==='facts'||l.id.startsWith('fs:'),col=l.bad?[220,220,230]:l.color,lim=Math.ceil(s.streaks.length*quality);
   ctx.lineWidth=dpr*.7;
   for(let i=0;i<lim;i++){const p=s.streaks[i];if(!still())p.u=(p.u+p.v*dt)%1;const u=inward?1-p.u:p.u,f=s.fil[p.f%s.fil.length];if(!f)continue;
    const [x,y]=curve(G,s,f,u),[x0,y0]=curve(G,s,f,clamp(inward?u+p.len:u-p.len,0,1));
    ctx.strokeStyle=rgba(col,p.a*.45*G.b*Math.sin(Math.PI*u));ctx.beginPath();ctx.moveTo(x0*dpr,y0*dpr);ctx.lineTo(x*dpr,y*dpr);ctx.stroke()}}
  // Ядро и его лучи.
  core.pulse=Math.max(0,core.pulse-dt*1.2);
  if(spikes.length!==160){const r=rng(5);spikes=Array.from({length:160},()=>({a:TAU*r(),u:r(),v:.05+.1*r(),len:.15+.35*r()}))}
  ctx.lineWidth=dpr*.8;for(const p of spikes){if(!still())p.u=(p.u+p.v*dt)%1;const r0=G.coreR*(.85+p.u*.6),r1=r0+G.coreR*p.len*.4;ctx.strokeStyle='rgba(236,140,70,'+(.22*Math.sin(Math.PI*p.u))+')';ctx.beginPath();ctx.moveTo((G.cx+Math.cos(p.a)*r0)*dpr,(G.cy+Math.sin(p.a)*r0)*dpr);ctx.lineTo((G.cx+Math.cos(p.a)*r1)*dpr,(G.cy+Math.sin(p.a)*r1)*dpr);ctx.stroke()}
  cloud(core.parts,G.cx,G.cy,G.coreR*(1+core.pulse*.05),simT*.1,EMBER,1.3+core.pulse*.6,1.6+core.pulse,Math.round(core.parts.length*quality));
  const hot=G.coreR*dpr*(.5+core.pulse*.3);ctx.globalAlpha=.3+.4*core.pulse;ctx.drawImage(sprite,G.cx*dpr-hot,G.cy*dpr-hot,hot*2,hot*2);ctx.globalAlpha=1;
  // Зоны, спутники и нейроны.
  for(const l of model.lobes){const s=l.state;s.pulse=Math.max(0,s.pulse-dt*1.4);
   const rot=simT*(.18+(s.seed%5)*.02)+s.seed,P=pal(l),wob=still()?0:simT;
   for(const sat of s.sats){const a=sat.a+wob*sat.sp,sx=s.x+Math.cos(a)*s.r*sat.d,sy=s.y+Math.sin(a)*s.r*sat.d;
    ctx.strokeStyle=rgba(l.bad?[200,200,210]:l.color,.18*G.b);ctx.lineWidth=dpr*.7;ctx.beginPath();ctx.moveTo(s.x*dpr,s.y*dpr);ctx.lineTo(sx*dpr,sy*dpr);ctx.stroke();
    cloud(satParts,sx,sy,s.r*sat.k,rot*1.3+sat.a,P,.95*G.b,.9*G.b,Math.round(satParts.length*quality))}
   cloud(s.parts,s.x,s.y,s.r*(1+s.pulse*.15),rot,P,(l.bad?1.05:1)+s.pulse,1+s.pulse*1.5,Math.round(s.parts.length*quality));
   const ca=Math.cos(rot),sa=Math.sin(rot),spr=l.bad?spriteBad:sprite;
   for(const it of l.items){const n=neurons.get(it.id);if(!n)continue;n.flash=Math.max(0,n.flash-dt*.45);
    const x1=n.ox*ca+n.oz*sa,z1=-n.ox*sa+n.oz*ca,d=(z1+1.2)/2.4;
    n.sx=s.x+x1*s.r;n.sy=s.y+n.oy*s.r;n.vis=G.b;
    const size=ui*dpr*(5+3*it.weight+(it.hot?3:0)+n.flash*22)*(.7+.5*d)*(hover&&hover.id===it.id?1.6:1);
    ctx.globalAlpha=clamp((it.dim?.3:.65)*d+n.flash,0,1)*G.b;ctx.drawImage(spr,n.sx*dpr-size/2,n.sy*dpr-size/2,size,size);
    if(n.flash>0){ctx.globalAlpha=n.flash*.8;ctx.strokeStyle=rgba(l.color,1);ctx.lineWidth=dpr*1.2;ctx.beginPath();ctx.arc(n.sx*dpr,n.sy*dpr,dpr*(6+(1-n.flash)*40),0,TAU);ctx.stroke()}
   }}
  ctx.globalAlpha=1;
  // Связи факт→факт.
  ctx.lineWidth=dpr*.9;for(const [a,b] of model.links){const A=neurons.get(a),B=neurons.get(b);if(!A||!B)continue;ctx.strokeStyle='rgba(240,150,80,'+(.22*G.b)+')';ctx.beginPath();ctx.moveTo(A.sx*dpr,A.sy*dpr);const mx=(A.sx+B.sx)/2,my=(A.sy+B.sy)/2;ctx.quadraticCurveTo(mx*dpr+(G.cx-mx)*.3*dpr,my*dpr+(G.cy-my)*.3*dpr,B.sx*dpr,B.sy*dpr);ctx.stroke()}
  // Импульсы.
  impulses=impulses.filter(p=>{const s=p.lobe.state,f=s&&s.fil[p.f];if(!f)return false;p.u+=dt*(reduceQuery.matches?4:p.big?.55:.9);
   if(p.u>=1){if(p.item){const n=neurons.get(p.item.id);if(n)n.flash=1;s.pulse=1}return false}
   const [x,y]=curve(G,s,f,ease(p.u)),z=dpr*(p.big?26:12);ctx.globalAlpha=p.big?1:.55;ctx.drawImage(sprite,x*dpr-z/2,y*dpr-z/2,z,z);return true});
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  labels(G);
  // Подпись внутри ядра — как «тикет → решён» в ролике.
  if(coreTextT>0){coreTextT-=dt;const a=clamp(coreTextT,0,1);ctx.font='600 '+Math.round(11.5*ui*dpr)+'px '+MONO;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=6*dpr;ctx.fillStyle='rgba(255,246,230,'+a+')';ctx.fillText(trim(coreKind,16)+' → '+trim(coreText,W<520?18:30),G.cx*dpr,G.cy*dpr);ctx.shadowBlur=0;ctx.textBaseline='alphabetic'}
 }
 function trim(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s}
 // Подписи кластеров: рамка с названием и подзаголовком, точка на краю кластера и выноска.
 function labels(G){
  const small=W<520,fs1=(small?9.5:10.5)*ui,fs2=(small?8.5:9)*ui;
  for(const l of model.lobes){const s=l.state;if(G.b<.55)continue;
   const right=Math.cos(s.a)>=-.15,title=trim(l.label,small?16:26),sub=trim(l.sub,small?20:30);
   ctx.font='600 '+Math.round(fs1*dpr)+'px '+MONO;const w1=ctx.measureText(title).width;ctx.font=Math.round(fs2*dpr)+'px '+MONO;const w2=ctx.measureText(sub).width;
   const pad=5*dpr,bw=Math.max(w1,w2)+pad*2,bh=(fs1+fs2)*dpr+pad*2.4;
   const ax=(s.x+(right?1:-1)*s.r*.62)*dpr,ay=(s.y-s.r*.62)*dpr;
   let bx=right?ax+10*dpr:ax-10*dpr-bw,by=ay-bh-6*dpr;
   bx=clamp(bx,4*dpr,canvas.width-bw-4*dpr);by=clamp(by,4*dpr,canvas.height-bh-4*dpr);
   ctx.globalAlpha=clamp((G.b-.55)/.45,0,1);
   ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(bx,by,bw,bh);ctx.strokeStyle=l.bad?'rgba(255,80,60,.6)':'rgba(255,255,255,.16)';ctx.lineWidth=dpr;ctx.strokeRect(bx+.5,by+.5,bw-1,bh-1);
   ctx.textAlign='left';ctx.textBaseline='top';
   ctx.font='600 '+Math.round(fs1*dpr)+'px '+MONO;ctx.fillStyle=l.bad?'#ff5a44':'#f4efe6';ctx.fillText(title,bx+pad,by+pad);
   ctx.font=Math.round(fs2*dpr)+'px '+MONO;ctx.fillStyle=l.bad?'rgba(255,120,100,.85)':'rgba(190,180,165,.75)';ctx.fillText(sub,bx+pad,by+pad*1.4+fs1*dpr);
   const lx=right?bx:bx+bw;ctx.strokeStyle=l.bad?'rgba(255,90,70,.6)':'rgba(255,255,255,.35)';ctx.beginPath();ctx.moveTo(lx,by+bh);ctx.lineTo(ax,ay);ctx.stroke();
   ctx.fillStyle=l.bad?'#ff5a44':'#fff';ctx.beginPath();ctx.arc(ax,ay,2*dpr,0,TAU);ctx.fill();
   if(l.bad){ctx.font='600 '+Math.round(fs1*dpr)+'px '+MONO;ctx.fillStyle='#ff4a38';ctx.textAlign='center';ctx.fillText('сбой · '+trim(l.items[0]?.title.split(' — ')[0]||'',14),s.x*dpr,(s.y+s.r*1.15)*dpr)}
  }
  ctx.globalAlpha=1;ctx.textBaseline='alphabetic';
 }

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
 const onWide=()=>placeHud();
 window.addEventListener('tenma:workspace',onWorkspace);window.addEventListener('tenma:memory',onMemory);wideQuery.addEventListener('change',onWide);
 const poll=setInterval(()=>{if(!document.hidden)loadFacts()},20000);
 // Фоновая «болтовня» синапсов: редкие слабые импульсы, чтобы мозг выглядел живым.
 let chatter=0;
 function frame(now){
  if(!host.isConnected){destroy();return}
  raf=requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000||0);last=now;
  const blooming=!reduceQuery.matches&&now-bloomStart<2700,busy=impulses.length||blooming||coreTextT>0||core.pulse>0||[...neurons.values()].some(n=>n.flash>0);
  if(!still()){simT+=dt;chatter-=dt;if(chatter<=0&&model.lobes.length){const l=model.lobes[Math.floor(Math.random()*model.lobes.length)];impulses.push({lobe:l,u:0,f:Math.floor(Math.random()*l.state.fil.length)});chatter=.4+Math.random()*1.1}}
  else if(!busy&&!dirty)return;
  dirty=false;draw(dt);
  // Адаптивное качество: на слабой видеокарте частиц становится меньше, на сильной — возвращаются.
  fpsT+=dt;fpsN++;if(fpsT>=1.2){const fps=fpsN/fpsT;if(fps<42&&quality>.25)quality*=.8;else if(fps>56&&quality<baseQ)quality=Math.min(baseQ,quality*1.1);fpsT=0;fpsN=0}
 }
 function destroy(){cancelAnimationFrame(raf);clearInterval(poll);ro.disconnect();hudRo.disconnect();window.removeEventListener('tenma:workspace',onWorkspace);window.removeEventListener('tenma:memory',onMemory);wideQuery.removeEventListener('change',onWide);document.removeEventListener('keydown',onKey)}
 placeHud();resize();apply();loadFacts();raf=requestAnimationFrame(frame);
 return {destroy};
}
window.TenmaBrain={mount};
})();
