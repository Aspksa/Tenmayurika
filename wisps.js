'use strict';
// Агенты-огоньки: волшебные огоньки кружат вокруг хвостов Юрики. Когда у агента появляется дело,
// его огонёк улетает к нужному разделу, колдует там и возвращается к хвостам.
// Рисуется на отдельном прозрачном холсте поверх страницы, клики не перехватывает.
(()=>{
 const AGENTS=[
  {id:'guardian',name:'Хранитель',role:'библиотека',rgb:[120,210,255],page:'library'},
  {id:'reviewer',name:'Разборщик',role:'разбор разговора',rgb:[200,150,255],page:'brain'},
  {id:'secretary',name:'Секретарь',role:'дела и календарь',rgb:[255,178,92],page:'planner'},
  {id:'researcher',name:'Исследователь',role:'факты и поиск',rgb:[125,255,176],page:'facts'}
 ];
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
  gr.addColorStop(0,`rgba(255,255,255,1)`);gr.addColorStop(.18,`rgba(${key},.9)`);gr.addColorStop(.5,`rgba(${key},.25)`);gr.addColorStop(1,`rgba(${key},0)`);g.fillStyle=gr;g.fillRect(0,0,64,64);sprites.set(key,c);return c}
 const rnd=(a,b)=>a+Math.random()*(b-a);
 const wisps=AGENTS.map((a,i)=>({...a,phase:i/AGENTS.length*Math.PI*2,x:W/2,y:H/2,state:'idle',t:0,from:null,task:'',trail:[],sparks:[],bob:rnd(0,6)}));
 let lastAvatar=null;
 function avatarBox(){const el=document.querySelector('.avatar');if(!el||el.hidden||getComputedStyle(el).display==='none')return null;const r=el.getBoundingClientRect();if(!r.width)return null;return lastAvatar=r}
 function targetPoint(page){const el=document.querySelector(`.rail [data-page="${page}"]`);if(!el)return null;const r=el.getBoundingClientRect();if(!r.width)return null;return {x:r.left+r.width/2,y:r.top+r.height/2,r:Math.max(r.width,r.height)*.55}}
 // Точка на кончиках хвостов: эллипс вокруг фигуры, сзади огонёк тусклее.
 function tailPoint(w,box,time){const a=w.phase+time*.42,cx=box.left+box.width*.5,cy=box.top+box.height*.47;
  return {x:cx+Math.cos(a)*box.width*.47,y:cy+Math.sin(a)*box.height*.36+Math.sin(time*1.7+w.bob)*4,depth:(Math.sin(a)+1)/2}}
 const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
 function bezier(p0,p1,t){const mx=(p0.x+p1.x)/2,my=Math.min(p0.y,p1.y)-Math.abs(p1.x-p0.x)*.35-60,u=1-t;return {x:u*u*p0.x+2*u*t*mx+t*t*p1.x,y:u*u*p0.y+2*u*t*my+t*t*p1.y}}
 function send(id,task='',ms=0){const w=wisps.find(x=>x.id===id);if(!w)return;w.task=task||w.role;if(w.state==='work'||w.state==='go'){w.until=ms?performance.now()+ms:0;return}w.state='go';w.t=0;w.from={x:w.x,y:w.y};w.until=ms?performance.now()+ms:0}
 function done(id){const w=wisps.find(x=>x.id===id);if(!w||w.state==='idle'||w.state==='back')return;w.state='back';w.t=0;w.from={x:w.x,y:w.y}}
 let prev=performance.now(),hover=null;
 function frame(now){
  const dt=Math.min(.05,(now-prev)/1000);prev=now;const time=now/1000*(reduce.matches?.3:1),box=avatarBox();
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  if(!box&&!lastAvatar){requestAnimationFrame(frame);return}
  const b=box||lastAvatar;ctx.globalCompositeOperation='lighter';
  let shown=null;
  for(const w of wisps){
   const home=tailPoint(w,b,time),tgt=targetPoint(w.page);let depth=1;
   if(w.until&&now>w.until&&w.state==='work')done(w.id);
   if(w.state==='idle'||!tgt&&w.state!=='back'){w.x=home.x;w.y=home.y;depth=.35+.65*home.depth;if(!tgt&&w.state!=='idle')w.state='idle'}
   else if(w.state==='go'){w.t=Math.min(1,w.t+dt/1.3);const p=bezier(w.from,{x:tgt.x,y:tgt.y},ease(w.t));w.x=p.x;w.y=p.y;if(w.t>=1){w.state='work';w.t=0;burst(w,tgt.x,tgt.y,18)}}
   else if(w.state==='work'){w.t+=dt;const a=w.t*3.2;w.x=tgt.x+Math.cos(a)*tgt.r;w.y=tgt.y+Math.sin(a)*tgt.r*.8;if(Math.random()<dt*14)burst(w,w.x,w.y,1);
    // Кольцо-заклинание вокруг иконки раздела.
    const pulse=(w.t*.9)%1;ctx.strokeStyle=`rgba(${w.rgb},${.55*(1-pulse)})`;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(tgt.x,tgt.y,tgt.r*(1+pulse*.9),0,Math.PI*2);ctx.stroke();shown=shown||{w,tgt}}
   else if(w.state==='back'){w.t=Math.min(1,w.t+dt/1.5);const p=bezier(w.from,home,ease(w.t));w.x=p.x;w.y=p.y;if(w.t>=1){w.state='idle';burst(w,w.x,w.y,8)}}
   w.trail.unshift({x:w.x,y:w.y});w.trail.length=Math.min(w.trail.length,w.state==='idle'?10:26);
   // След: тающая цепочка светящихся точек.
   const spr=sprite(w.rgb);
   for(let i=w.trail.length-1;i>0;i--){const p=w.trail[i],k=1-i/w.trail.length,s=(w.state==='idle'?7:11)*k;ctx.globalAlpha=.35*k*depth;ctx.drawImage(spr,p.x-s,p.y-s,s*2,s*2)}
   const flick=1+Math.sin(time*9+w.bob*3)*.12,s=(w.state==='idle'?16:20)*flick;
   ctx.globalAlpha=depth;ctx.drawImage(spr,w.x-s*1.8,w.y-s*1.8,s*3.6,s*3.6);ctx.drawImage(spr,w.x-s*.6,w.y-s*.6,s*1.2,s*1.2);
   for(let i=w.sparks.length-1;i>=0;i--){const p=w.sparks[i];p.life+=dt;if(p.life>p.max){w.sparks.splice(i,1);continue}p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=20*dt;const k=1-p.life/p.max;ctx.globalAlpha=k;ctx.drawImage(spr,p.x-3,p.y-3,6,6)}
   if(w.state==='idle'&&Math.random()<dt*2)burst(w,w.x,w.y,1);
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  const show=hover?{w:hover,tgt:null}:shown;
  if(show){const w=show.w;label.hidden=false;label.style.setProperty('--wisp',`rgb(${w.rgb})`);const text=w.name+' · '+(w.state==='idle'?'отдыхает у хвостов':w.state==='back'?'возвращается':w.task);if(label.textContent!==text)label.textContent=text;
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
 // Настоящий агент: Хранитель библиотеки. Пока он занят, его огонёк у раздела «Библиотека».
 const kinds={scan:'проверяет библиотеку',read:'читает документ',ocr:'распознаёт скан',search:'ищет'};
 async function pollGuardian(){if(document.hidden)return;try{const r=await fetch('/api/brain/guardian',{cache:'no-store'});if(!r.ok)return;const d=await r.json(),a=d.active?.[0];
  if(a)send('guardian',(a.phase||kinds[a.kind]||'работает')+(a.file?' · '+a.file.split('/').pop():''));else{const w=wisps.find(x=>x.id==='guardian');if(w.state==='work'&&!w.until)done('guardian')}}catch{}}
 setInterval(pollGuardian,4000);pollGuardian();
 function demo(){send('guardian','читает «Договор аренды.pdf»',7000);setTimeout(()=>send('secretary','собирает утреннюю сводку',6000),900);setTimeout(()=>send('reviewer','разбирает разговор',5000),1800)}
 window.TenmaWisps={send,done,demo,agents:AGENTS};
 if(new URLSearchParams(location.search).has('wisps'))setTimeout(demo,800);
})();
