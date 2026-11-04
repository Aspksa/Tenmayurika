'use strict';
// Агенты-огоньки: волшебные огоньки кружат вокруг хвостов Юрики. Когда у агента появляется дело
// (журнал /api/agents), его огонёк улетает к нужному разделу, колдует там, приносит результат Юрике
// и возвращается к хвостам. Помощь друг другу видна лучом: один огонёк зовёт другого.
// Рисуется на отдельном прозрачном холсте поверх страницы, клики не перехватывает.
(()=>{
 const BUILTIN=[
  {id:'guardian',name:'Хранитель',role:'библиотека',rgb:[120,210,255],page:'library',shape:'book'},
  {id:'reviewer',name:'Разборщик',role:'разбор разговора',rgb:[200,150,255],page:'brain',shape:'moon'},
  {id:'secretary',name:'Секретарь',role:'дела и календарь',rgb:[255,178,92],page:'planner',shape:'star'},
  {id:'researcher',name:'Исследователь',role:'факты и поиск',rgb:[125,255,176],page:'facts',shape:'crystal'}
 ];
 // Настройки огоньков: меню аватара меняет их через TenmaWisps.set().
 const CFG_KEY='tenmayurika.wisps.v1',CFG0={fly:true,labels:true,size:1,speed:1,off:{},colors:{},shapes:{}};
 let cfg=CFG0;try{const v=JSON.parse(localStorage.getItem(CFG_KEY));if(v&&typeof v==='object')cfg={...CFG0,...v,off:{...(v.off||{})},colors:{...(v.colors||{})},shapes:{...(v.shapes||{})}}}catch{}
 const saveCfg=()=>{try{localStorage.setItem(CFG_KEY,JSON.stringify(cfg))}catch{}};
 const hexRgb=x=>/^#[0-9a-f]{6}$/i.test(x||'')?[1,3,5].map(i=>parseInt(x.slice(i,i+2),16)):null;
 const rgbHex=rgb=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const canvas=document.createElement('canvas');canvas.className='wisps';canvas.setAttribute('aria-hidden','true');
 const label=document.createElement('div');label.className='wisp-label';label.hidden=true;
 document.body.append(canvas,label);
 const ctx=canvas.getContext('2d');let W=0,H=0,dpr=1;
 function resize(){dpr=Math.min(1.5,devicePixelRatio||1);W=innerWidth;H=innerHeight;canvas.width=W*dpr;canvas.height=H*dpr}
 resize();addEventListener('resize',resize);
 // Мягкое пятно света для свечения: рисуется один раз на цвет.
 const sprites=new Map();
 function sprite(rgb){const key=rgb.join();let c=sprites.get(key);if(c)return c;c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),gr=g.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.18,`rgba(${key},.9)`);gr.addColorStop(.5,`rgba(${key},.25)`);gr.addColorStop(1,`rgba(${key},0)`);g.fillStyle=gr;g.fillRect(0,0,64,64);sprites.set(key,c);return c}
 const rnd=(a,b)=>a+Math.random()*(b-a);
 let server={growth:{},custom:[]};
 const wisps=[];
 function makeWisp(a,i){return {...a,base:a.rgb,rgb:a.rgb,phase:i*2.4,x:W/2,y:H/2,state:'idle',t:0,from:null,task:'',job:null,queue:[],trail:[],sparks:[],bob:rnd(0,6),level:1}}
 function syncAgents(){const list=[...BUILTIN,...(server.custom||[]).map(c=>({id:c.id,name:c.name,role:c.about||'свой агент',rgb:hexRgb(c.color)||[255,211,107],page:c.page,shape:c.shape,custom:true}))];
  for(const a of list){const w=wisps.find(x=>x.id===a.id);if(w)Object.assign(w,{name:a.name,role:a.role,base:a.rgb,page:a.page,shape:a.shape});else wisps.push(makeWisp(a,wisps.length))}
  for(let i=wisps.length-1;i>=0;i--)if(!list.some(a=>a.id===wisps[i].id))wisps.splice(i,1);
  wisps.forEach((w,i)=>{w.phase=i/wisps.length*Math.PI*2;w.level=server.growth?.[w.id]?.level||1})}
 syncAgents();
 let lastAvatar=null;
 function avatarBox(){const el=document.querySelector('.avatar');if(!el||el.hidden||getComputedStyle(el).display==='none')return null;const r=el.getBoundingClientRect();if(!r.width)return null;return lastAvatar=r}
 function targetPoint(page){const el=document.querySelector(`.rail [data-page="${page}"]`);if(!el)return null;const r=el.getBoundingClientRect();if(!r.width)return null;return {x:r.left+r.width/2,y:r.top+r.height/2,r:Math.max(r.width,r.height)*.55}}
 // Точка на кончиках хвостов: эллипс вокруг фигуры, сзади огонёк тусклее.
 function tailPoint(w,box,time){const a=w.phase+time*.42,cx=box.left+box.width*.5,cy=box.top+box.height*.47;
  return {x:cx+Math.cos(a)*box.width*.47,y:cy+Math.sin(a)*box.height*.36+Math.sin(time*1.7+w.bob)*4,depth:(Math.sin(a)+1)/2}}
 const heart=box=>({x:box.left+box.width*.5,y:box.top+box.height*.38});
 const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
 function bezier(p0,p1,t,lift=1){const mx=(p0.x+p1.x)/2,my=Math.min(p0.y,p1.y)-(Math.abs(p1.x-p0.x)*.35+60)*lift,u=1-t;return {x:u*u*p0.x+2*u*t*mx+t*t*p1.x,y:u*u*p0.y+2*u*t*my+t*t*p1.y}}
 const emit=(type,w,job)=>window.dispatchEvent(new CustomEvent('tenma:agent',{detail:{type,agent:w.id,name:w.name,color:rgbHex(w.rgb),job:{...job}}}));
 // Дело встаёт в очередь огонька; огонёк берёт следующее, когда вернётся к хвостам.
 function enqueue(id,job){const w=wisps.find(x=>x.id===id);if(!w||cfg.off[id])return;if(w.job?.id===job.id||w.queue.some(j=>j.id===job.id))return;w.queue.push({min:2.2,...job,seenAt:performance.now()});if(w.queue.length>6)w.queue.splice(0,w.queue.length-6)}
 function take(w,now){const job=w.queue.shift();if(!job)return;w.job=job;w.task=job.task;
  if(job.from==='yurika')emit('sent',w,job);
  const helper=job.from&&job.from!=='yurika'&&wisps.find(x=>x.id===job.from&&!cfg.off[x.id]);
  if(helper){w.state='call';w.t=0;w.helper=helper}else{w.state='go';w.t=0;w.from={x:w.x,y:w.y}}w.workStart=0;w.startedAt=now}
 // Ручной полёт: показ или кнопка «Отправить в полёт».
 let localId=0;
 function send(id,task='',ms=4000,{from=null,result=''}={}){if(!cfg.fly)return;enqueue(id,{id:'local'+(++localId),task:task||wisps.find(x=>x.id===id)?.role||'',from,min:ms/1000,done:true,result,local:true})}
 function finishJob(id,ev){for(const w of wisps){if(w.job?.id===id)Object.assign(w.job,{done:true,result:ev.result,ok:ev.ok});const q=w.queue.find(j=>j.id===id);if(q)Object.assign(q,{done:true,result:ev.result,ok:ev.ok})}}
 // Формы огоньков: у каждого агента своя.
 const SHAPES={
  book(g,s){g.beginPath();g.moveTo(0,-s*.55);g.quadraticCurveTo(-s*.5,-s*.75,-s,-s*.5);g.lineTo(-s,s*.55);g.quadraticCurveTo(-s*.5,s*.3,0,s*.55);g.quadraticCurveTo(s*.5,s*.3,s,s*.55);g.lineTo(s,-s*.5);g.quadraticCurveTo(s*.5,-s*.75,0,-s*.55);g.closePath()},
  moon(g,s){g.beginPath();g.arc(0,0,s,Math.PI*.25,Math.PI*1.75);g.arc(s*.45,0,s*.75,Math.PI*1.6,Math.PI*.4,true);g.closePath()},
  star(g,s){g.beginPath();for(let i=0;i<10;i++){const r=i%2?s*.45:s,a=-Math.PI/2+i*Math.PI/5;g.lineTo(Math.cos(a)*r,Math.sin(a)*r)}g.closePath()},
  crystal(g,s){g.beginPath();g.moveTo(0,-s*1.1);g.lineTo(s*.65,-s*.15);g.lineTo(0,s*1.1);g.lineTo(-s*.65,-s*.15);g.closePath()},
  flame(g,s){g.beginPath();g.moveTo(0,-s*1.15);g.bezierCurveTo(s*.9,-s*.2,s*.8,s*.9,0,s*.9);g.bezierCurveTo(-s*.8,s*.9,-s*.9,-s*.2,0,-s*1.15);g.closePath()},
  leaf(g,s){g.beginPath();g.moveTo(0,-s);g.quadraticCurveTo(s*1.1,0,0,s);g.quadraticCurveTo(-s*1.1,0,0,-s);g.closePath()},
  heart(g,s){g.beginPath();g.moveTo(0,s*.9);g.bezierCurveTo(-s*1.3,0,-s*.6,-s*1.1,0,-s*.35);g.bezierCurveTo(s*.6,-s*1.1,s*1.3,0,0,s*.9);g.closePath()},
  drop(g,s){g.beginPath();g.moveTo(0,-s*1.1);g.bezierCurveTo(s*.4,-s*.4,s*.8,0,s*.8,s*.3);g.arc(0,s*.3,s*.8,0,Math.PI);g.bezierCurveTo(-s*.8,0,-s*.4,-s*.4,0,-s*1.1);g.closePath()}
 };
 function drawShape(w,s,time){const f=SHAPES[cfg.shapes[w.id]||w.shape]||SHAPES.star;ctx.save();ctx.translate(w.x,w.y);ctx.rotate(Math.sin(time*1.3+w.bob)*.25);f(ctx,s);
  ctx.globalCompositeOperation='source-over';ctx.fillStyle=`rgba(${w.rgb.map(v=>Math.round(v+(255-v)*.6)).join(',')},.95)`;ctx.fill();ctx.lineWidth=1;ctx.strokeStyle='rgba(255,255,255,.9)';ctx.stroke();ctx.restore();ctx.globalCompositeOperation='lighter'}
 let prev=performance.now(),hover=null;
 function frame(now){
  const dt=Math.min(.05,(now-prev)/1000);prev=now;const time=now/1000*(reduce.matches?.3:1)*cfg.speed,box=avatarBox();
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  if(!cfg.fly){label.hidden=true;setTimeout(()=>requestAnimationFrame(frame),400);return}
  if(!box&&!lastAvatar){requestAnimationFrame(frame);return}
  const b=box||lastAvatar;ctx.globalCompositeOperation='lighter';
  let shown=null;
  for(const w of wisps){
   if(cfg.off[w.id]){w.state='idle';w.job=null;w.queue.length=0;w.trail.length=0;w.sparks.length=0;continue}
   w.rgb=hexRgb(cfg.colors[w.id])||w.base;
   const home=tailPoint(w,b,time),tgt=targetPoint(w.page);let depth=1;
   if(w.state==='idle'&&w.queue.length)take(w,now);
   if(w.state==='idle'){w.x=home.x;w.y=home.y;depth=.35+.65*home.depth}
   else if(w.state==='call'){
    // Помощник зовёт: луч искр от его огонька к этому.
    w.t+=dt*cfg.speed;w.x=home.x;w.y=home.y;const hx=w.helper.x,hy=w.helper.y,k=Math.min(1,w.t/.9),spr=sprite(w.helper.rgb);
    for(let i=0;i<14;i++){const u=(i/14+time*1.5)%1;if(u>k)continue;const px=hx+(w.x-hx)*u,py=hy+(w.y-hy)*u+Math.sin(u*Math.PI)*-18;ctx.globalAlpha=.8*(1-Math.abs(u-.5));ctx.drawImage(spr,px-5,py-5,10,10)}
    if(w.t>=1.1){burst(w,w.x,w.y,10);w.state=tgt?'go':'deliver';w.t=0;w.from={x:w.x,y:w.y}}}
   else if(!tgt&&(w.state==='go'||w.state==='work')){w.state='deliver';w.t=0;w.from={x:w.x,y:w.y}}
   else if(w.state==='go'){w.t=Math.min(1,w.t+dt*cfg.speed/1.3);const p=bezier(w.from,{x:tgt.x,y:tgt.y},ease(w.t));w.x=p.x;w.y=p.y;if(w.t>=1){w.state='work';w.t=0;w.workStart=now;burst(w,tgt.x,tgt.y,18)}}
   else if(w.state==='work'){w.t+=dt;const a=w.t*3.2;w.x=tgt.x+Math.cos(a)*tgt.r;w.y=tgt.y+Math.sin(a)*tgt.r*.8;if(Math.random()<dt*14)burst(w,w.x,w.y,1);
    // Кольцо-заклинание вокруг иконки раздела.
    const pulse=(w.t*.9)%1;ctx.strokeStyle=`rgba(${w.rgb},${.55*(1-pulse)})`;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(tgt.x,tgt.y,tgt.r*(1+pulse*.9),0,Math.PI*2);ctx.stroke();shown=shown||{w,tgt};
    // Долго нет ответа от сервера (перезапуск) — не висеть у раздела вечно.
    if(w.job&&(w.job.done&&w.t>=w.job.min/cfg.speed||now-w.startedAt>180000)){w.state='deliver';w.t=0;w.from={x:w.x,y:w.y}}}
   else if(w.state==='deliver'){
    // Несёт результат Юрике: к её сердцу, вспышка, карточка в чате.
    w.t=Math.min(1,w.t+dt*cfg.speed/1.2);const p=bezier(w.from,heart(b),ease(w.t),.6);w.x=p.x;w.y=p.y;
    if(w.t>=1){burst(w,w.x,w.y,26);if(w.job&&!w.job.local||w.job?.result)emit('done',w,w.job);w.job=null;w.state='back';w.t=0;w.from={x:w.x,y:w.y}}}
   else if(w.state==='back'){w.t=Math.min(1,w.t+dt*cfg.speed/.9);const p=bezier(w.from,home,ease(w.t),.25);w.x=p.x;w.y=p.y;if(w.t>=1){w.state='idle';burst(w,w.x,w.y,6)}}
   w.trail.unshift({x:w.x,y:w.y});w.trail.length=Math.min(w.trail.length,w.state==='idle'?10:26);
   // Рост: чем выше уровень, тем крупнее и ярче огонёк, вокруг кружат искры-«короны».
   const grow=1+Math.min(6,w.level-1)*.09,spr=sprite(w.rgb);
   for(let i=w.trail.length-1;i>0;i--){const p=w.trail[i],k=1-i/w.trail.length,s=(w.state==='idle'?7:11)*k*grow;ctx.globalAlpha=.35*k*depth;ctx.drawImage(spr,p.x-s,p.y-s,s*2,s*2)}
   const flick=1+Math.sin(time*9+w.bob*3)*.12,s=(w.state==='idle'?16:20)*flick*cfg.size*grow;
   ctx.globalAlpha=depth*(.8+.2*grow-.2);ctx.drawImage(spr,w.x-s*1.8,w.y-s*1.8,s*3.6,s*3.6);
   ctx.globalAlpha=Math.max(.35,depth);drawShape(w,s*.36,time);
   for(let i=0;i<Math.min(6,w.level-1);i++){const a=time*2+i/Math.min(6,w.level-1)*Math.PI*2,r=s*.95;ctx.globalAlpha=.75*depth;ctx.drawImage(spr,w.x+Math.cos(a)*r-2.5,w.y+Math.sin(a)*r*.6-2.5,5,5)}
   for(let i=w.sparks.length-1;i>=0;i--){const p=w.sparks[i];p.life+=dt;if(p.life>p.max){w.sparks.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=20*dt;const k=1-p.life/p.max;ctx.globalAlpha=k;ctx.drawImage(spr,p.x-3,p.y-3,6,6)}
   if(w.state==='idle'&&Math.random()<dt*2)burst(w,w.x,w.y,1);
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  const show=!cfg.labels?null:hover&&!cfg.off[hover.id]?{w:hover,tgt:null}:shown;
  if(show){const w=show.w,lv=server.growth?.[w.id];label.hidden=false;label.style.setProperty('--wisp',`rgb(${w.rgb})`);
   const text=w.name+(lv?' · '+lv.title:'')+' · '+({idle:'отдыхает у хвостов',back:'возвращается',deliver:'несёт результат Юрике',call:'зовут на помощь'}[w.state]||w.task);if(label.textContent!==text)label.textContent=text;
   const lw=label.offsetWidth,lh=label.offsetHeight,t=show.tgt,below=t&&t.y>H*.7;
   // Нижняя панель на телефоне: подпись над иконкой, иначе — справа от неё.
   const x=t?(below?t.x-lw/2:t.x+t.r*2.2):w.x+16,y=t?(below?t.y-t.r*2.6-lh:t.y-lh/2):w.y-lh/2;
   label.style.transform=`translate(${Math.max(8,Math.min(W-lw-8,x))}px,${y}px)`}
  else label.hidden=true;
  requestAnimationFrame(frame);
 }
 function burst(w,x,y,n){for(let i=0;i<n;i++){const a=rnd(0,Math.PI*2),v=rnd(10,60);w.sparks.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-20,life:0,max:rnd(.4,.9)})}if(w.sparks.length>80)w.sparks.splice(0,w.sparks.length-80)}
 addEventListener('pointermove',e=>{let best=null,d=22;for(const w of wisps){const k=Math.hypot(w.x-e.clientX,w.y-e.clientY);if(k<d){d=k;best=w}}hover=best},{passive:true});
 requestAnimationFrame(frame);
 // Журнал агентов: новые дела → очередь огоньков. Старые (до открытия страницы) не повторяются.
 const seen=new Set();let primed=false;
 async function poll(){if(document.hidden)return;try{const r=await fetch('/api/agents',{cache:'no-store'});if(!r.ok)return;const d=await r.json();
  const before=JSON.stringify(server.custom);server=d;if(JSON.stringify(d.custom)!==before||!primed)syncAgents();else for(const w of wisps)w.level=d.growth?.[w.id]?.level||1;
  for(const ev of [...(d.recent||[])].reverse()){if(seen.has(ev.id+':done'))continue;seen.add(ev.id+':done');if(!primed){seen.add(ev.id);continue}if(!seen.has(ev.id)){seen.add(ev.id);enqueue(ev.agent,{id:ev.id,task:ev.task,from:ev.from,done:true,result:ev.result,ok:ev.ok})}else finishJob(ev.id,ev)}
  for(const ev of d.active||[]){if(seen.has(ev.id))continue;seen.add(ev.id);if(!primed)continue;enqueue(ev.agent,{id:ev.id,task:ev.task,from:ev.from,done:false})}
  primed=true;window.dispatchEvent(new CustomEvent('tenma:agents',{detail:d}))}catch{}}
 setInterval(poll,2500);poll();
 // Пока огоньки живут только в одной вкладке — опрос сразу после ответа чата ускоряет полёт.
 window.addEventListener('tenma:thinking',e=>{if(!e.detail?.on)setTimeout(poll,300)});
 function demo(){send('guardian','читает «Договор аренды.pdf»',5000,{result:'Нашла 3 факта и предложила папку «Договоры»'});
  setTimeout(()=>send('researcher','сверяет факты из «Договор аренды.pdf»',3500,{from:'guardian',result:'Противоречий нет'}),1500);
  setTimeout(()=>send('secretary','собирает утреннюю сводку',4000,{from:'yurika',result:'На сегодня 2 дела, просрочек нет'}),900);
  setTimeout(()=>send('reviewer','разбирает разговор',3500,{result:'Запомнила 1 пожелание'}),2600)}
 const state=id=>{const w=wisps.find(x=>x.id===id);return w?{state:cfg.off[id]?'off':w.state,task:w.task,queue:w.queue.length}:null};
 const set=patch=>{cfg={...cfg,...patch,off:{...cfg.off,...(patch.off||{})},colors:{...cfg.colors,...(patch.colors||{})},shapes:{...cfg.shapes,...(patch.shapes||{})}};saveCfg()};
 window.TenmaWisps={send,demo,state,set,poll,get:()=>JSON.parse(JSON.stringify(cfg)),defaults:CFG0,server:()=>server,shapes:Object.keys(SHAPES),
  get agents(){return wisps.map(w=>({id:w.id,name:w.name,role:w.role,page:w.page,shape:w.shape,custom:!!w.custom,rgb:w.base,hex:rgbHex(w.base)}))}};
 if(new URLSearchParams(location.search).has('wisps'))setTimeout(demo,800);
})();
