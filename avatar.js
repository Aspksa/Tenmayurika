'use strict';
// Аватар-кицунэ: живёт поверх всего интерфейса, перетаскивается мышью/пальцем.
// Левый клик — чат (привязан к аватару и следует за ним), правый клик / долгое нажатие — настройки.
// Настройки, позиция и история чата сохраняются в localStorage между запусками.
(()=>{
 const POSES=[
  {id:'stand',label:'Стоит',file:'/assets/avatars/kitsune-stand.webp'},
  {id:'sit-greet',label:'Улыбка',file:'/assets/avatars/kitsune-sit-greet.webp'},
  {id:'seiza',label:'Сэйдза',file:'/assets/avatars/kitsune-seiza.webp'},
  {id:'sit-dream',label:'Мечтает',file:'/assets/avatars/kitsune-sit-dream.webp'},
  {id:'bow',label:'Поклон',file:'/assets/avatars/kitsune-bow.webp'}
 ];
 // Состояния аватара → позы (используются, если включены «живые позы»).
 const STATE_POSE={greet:'bow',think:'sit-dream',answer:'sit-greet'};
 const DEFAULTS={name:'Юрика',pose:'stand',size:200,opacity:100,glow:true,glowPower:60,pulse:true,float:true,particles:true,particleCount:28,flip:false,livePoses:true,visible:true,x:.92,y:.9};
 const KEY='tenmayurika.avatar.v1',CHAT_KEY='tenmayurika.avatar.chat.v1';
 const load=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem(key));return v??fallback}catch{return fallback}};
 const store=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}};
 let cfg={...DEFAULTS,...load(KEY,{})};
 if(!POSES.some(p=>p.id===cfg.pose))cfg.pose=DEFAULTS.pose;
 let history=load(CHAT_KEY,[]);if(!Array.isArray(history))history=[];
 const save=()=>store(KEY,cfg);
 const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const poseOf=id=>POSES.find(p=>p.id===id)||POSES[0];
 const h=(tag,attrs={},...kids)=>{const el=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')el.className=v;else if(k==='text')el.textContent=v;else if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)el.setAttribute(k,v===true?'':v)}el.append(...kids.filter(Boolean));return el};
 const icon=id=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','icon');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#'+id);s.append(u);return s};
 POSES.forEach(p=>{const i=new Image();i.src=p.file});

 /* ---------- Аватар ---------- */
 const img=h('img',{alt:'',draggable:'false',src:poseOf(cfg.pose).file});
 const canvas=h('canvas',{'aria-hidden':'true'});
 const badge=h('span',{class:'avatar-badge','aria-hidden':'true',text:'1'});
 const body=h('div',{class:'avatar-body'},h('div',{class:'avatar-aura'}),img);
 const avatar=h('div',{class:'avatar',role:'button',tabindex:'0','aria-haspopup':'dialog','aria-label':'Аватар '+cfg.name+'. Enter — чат, Shift+F10 — настройки'},canvas,body,badge);
 document.body.append(avatar);

 let pos={x:0,y:0},currentPose=cfg.pose,stateTimer;
 const vw=()=>document.documentElement.clientWidth,vh=()=>window.innerHeight;
 const sizePx=()=>Math.round(Math.min(cfg.size*scale(),vw()*.6,vh()*.6));
 // Размер аватара масштабируется вместе с экраном (больше на 4K, меньше на телефоне).
 const scale=()=>Math.min(1.8,Math.max(.6,Math.min(vw()/1600,vh()/900)**.6));
 function applyLook(){
  const s=sizePx();
  avatar.style.setProperty('--avatar-size',s+'px');
  avatar.style.setProperty('--avatar-opacity',cfg.opacity/100);
  avatar.style.setProperty('--glow',cfg.glowPower/100);
  avatar.classList.toggle('glow',cfg.glow);avatar.classList.toggle('pulse',cfg.glow&&cfg.pulse);
  avatar.classList.toggle('float',cfg.float);avatar.classList.toggle('flip',cfg.flip);
  avatar.classList.toggle('hidden',!cfg.visible);
  avatar.setAttribute('aria-label','Аватар '+cfg.name+'. Enter — чат, Shift+F10 — настройки');
  const toggle=document.getElementById('avatar-toggle');if(toggle)toggle.setAttribute('aria-pressed',String(cfg.visible));
  resizeCanvas();place();
 }
 function place(){
  const s=sizePx(),maxX=Math.max(0,vw()-s),maxY=Math.max(0,vh()-s);
  pos.x=Math.round(Math.min(1,Math.max(0,cfg.x))*maxX);pos.y=Math.round(Math.min(1,Math.max(0,cfg.y))*maxY);
  avatar.style.transform=`translate3d(${pos.x}px,${pos.y}px,0)`;
  positionPanels();
 }
 function setPose(id,{remember=false}={}){
  if(remember){cfg.pose=id;save()}
  if(id===currentPose)return;currentPose=id;
  img.classList.add('leaving');
  setTimeout(()=>{img.src=poseOf(id).file;img.classList.remove('leaving')},180);
 }
 // Временное состояние (приветствие, размышление, ответ) с возвратом к выбранной позе.
 function state(name,ms){
  if(!cfg.livePoses)return;clearTimeout(stateTimer);
  setPose(STATE_POSE[name]||cfg.pose);
  if(ms)stateTimer=setTimeout(()=>setPose(cfg.pose),ms);
 }

 /* ---------- Перетаскивание и клики ---------- */
 let drag=null,longPress;
 avatar.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  avatar.setPointerCapture(e.pointerId);
  drag={id:e.pointerId,sx:e.clientX,sy:e.clientY,ox:pos.x,oy:pos.y,moved:false};
  if(e.pointerType!=='mouse')longPress=setTimeout(()=>{if(drag&&!drag.moved){drag=null;openSettings(e.clientX,e.clientY)}},600);
 });
 avatar.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;
  if(!drag.moved&&Math.hypot(dx,dy)<5)return;
  if(!drag.moved){drag.moved=true;clearTimeout(longPress);avatar.classList.add('dragging');closeSettings()}
  const s=sizePx();
  pos.x=Math.min(vw()-s,Math.max(0,drag.ox+dx));pos.y=Math.min(vh()-s,Math.max(0,drag.oy+dy));
  avatar.style.transform=`translate3d(${pos.x}px,${pos.y}px,0)`;positionPanels();
 });
 const endDrag=e=>{
  clearTimeout(longPress);if(!drag||e.pointerId!==drag.id)return;
  const wasMoved=drag.moved;drag=null;avatar.classList.remove('dragging');
  if(wasMoved){const s=sizePx();cfg.x=vw()>s?pos.x/(vw()-s):0;cfg.y=vh()>s?pos.y/(vh()-s):0;save()}
  else if(e.type==='pointerup')toggleChat();
 };
 avatar.addEventListener('pointerup',endDrag);avatar.addEventListener('pointercancel',endDrag);
 avatar.addEventListener('contextmenu',e=>{e.preventDefault();clearTimeout(longPress);drag=null;openSettings(e.clientX,e.clientY)});
 avatar.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleChat()}
  else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top+r.height/2)}
  else if(e.key.startsWith('Arrow')){e.preventDefault();const step=e.shiftKey?.1:.02;if(e.key==='ArrowLeft')cfg.x-=step;if(e.key==='ArrowRight')cfg.x+=step;if(e.key==='ArrowUp')cfg.y-=step;if(e.key==='ArrowDown')cfg.y+=step;cfg.x=Math.min(1,Math.max(0,cfg.x));cfg.y=Math.min(1,Math.max(0,cfg.y));save();place()}
 });

 /* ---------- Чат, привязанный к аватару ---------- */
 const chatImg=h('img',{alt:'',src:poseOf(cfg.pose).file});
 const chatName=h('strong',{text:cfg.name});
 const chatSub=h('small',{text:'Хранительница памяти'});
 const log=h('div',{class:'chat-log',role:'log','aria-live':'polite'});
 const input=h('textarea',{rows:'1',placeholder:'Спросите о своих заметках и фактах…','aria-label':'Сообщение'});
 const send=h('button',{type:'submit',class:'primary','aria-label':'Отправить'},icon('i-send'));
 const form=h('form',{class:'chat-form'},input,send);
 const chat=h('section',{class:'floating chat',role:'dialog','aria-label':'Чат с аватаром',hidden:true},
  h('header',{class:'floating-head'},chatImg,h('div',{class:'title'},chatName,chatSub),
   h('button',{type:'button',class:'icon-btn','aria-label':'Настройки аватара',onclick:()=>{const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top)}},icon('i-sliders')),
   h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть чат',onclick:()=>closeChat()},icon('i-close'))),
  log,form);
 document.body.append(chat);

 function bubble(role,text){const el=h('div',{class:'msg '+role,text});log.append(el);log.scrollTop=log.scrollHeight;return el}
 function renderHistory(){
  log.replaceChildren();
  if(!history.length)bubble('assistant','Здравствуйте! Я '+cfg.name+'. Спросите меня о ваших заметках или фактах — я поищу в памяти.\nПеретащите меня куда удобно; правый клик — мои настройки.');
  for(const m of history)bubble(m.role,m.text);
 }
 let busy=false;
 form.addEventListener('submit',async e=>{
  e.preventDefault();const text=input.value.trim();if(!text||busy)return;
  busy=true;send.disabled=true;input.value='';autoGrow();
  const prior=history.slice(-12);
  history.push({role:'user',text});bubble('user',text);
  const typing=h('div',{class:'msg assistant typing','aria-label':cfg.name+' думает'},h('span',{text:'•'}),h('span',{text:'•'}),h('span',{text:'•'}));
  log.append(typing);log.scrollTop=log.scrollHeight;state('think');
  let answer;
  try{
   const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,avatar:cfg.name,history:prior})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка');answer=data.reply;
  }catch(err){answer='Не получилось ответить: '+err.message}
  typing.remove();history.push({role:'assistant',text:answer});history=history.slice(-100);store(CHAT_KEY,history);
  bubble('assistant',answer);state('answer',2600);busy=false;send.disabled=false;
  if(chat.hidden)avatar.classList.add('has-unread');else input.focus();
 });
 const autoGrow=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,160)+'px'};
 input.addEventListener('input',autoGrow);
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit()}else if(e.key==='Escape')closeChat()});

 function openChat(){
  if(!chat.hidden)return;closeSettings();renderHistory();chat.hidden=false;positionPanels();
  requestAnimationFrame(()=>chat.classList.add('open'));avatar.classList.remove('has-unread');avatar.setAttribute('aria-expanded','true');
  state('greet',1800);setTimeout(()=>input.focus({preventScroll:true}),60);
 }
 function closeChat(){if(chat.hidden)return;chat.classList.remove('open');avatar.setAttribute('aria-expanded','false');setTimeout(()=>{if(!chat.classList.contains('open'))chat.hidden=true},180);avatar.focus({preventScroll:true})}
 const toggleChat=()=>chat.hidden?openChat():closeChat();

 /* ---------- Настройки аватара (правый клик) ---------- */
 const settings=h('section',{class:'floating avatar-settings',role:'dialog','aria-label':'Настройки аватара',hidden:true});
 document.body.append(settings);
 let anchor=null;
 function range(label,key,min,max,step,fmt){
  const out=h('output',{text:fmt(cfg[key])});
  const r=h('input',{type:'range',min,max,step,value:cfg[key],'aria-label':label});
  const fill=()=>r.style.setProperty('--fill',((r.value-min)/(max-min)*100)+'%');fill();
  r.addEventListener('input',()=>{cfg[key]=Number(r.value);out.textContent=fmt(cfg[key]);fill();save();applyLook();if(key==='particleCount')spawnParticles()});
  return h('label',{class:'field'},h('span',{text:label}),out,r);
 }
 function toggle(label,key){
  const c=h('input',{type:'checkbox'});c.checked=cfg[key];
  c.addEventListener('change',()=>{cfg[key]=c.checked;save();applyLook();if(key==='particles')spawnParticles();if(key==='livePoses'&&!c.checked)setPose(cfg.pose)});
  return h('label',{class:'toggle'},c,h('span',{text:label}));
 }
 function buildSettings(){
  const poses=h('div',{class:'poses',role:'radiogroup','aria-label':'Образ аватара'});
  for(const p of POSES){
   const b=h('button',{type:'button',class:'pose',role:'radio','aria-checked':String(p.id===cfg.pose),title:p.label},h('img',{src:p.file,alt:''}),h('span',{text:p.label}));
   b.addEventListener('click',()=>{clearTimeout(stateTimer);setPose(p.id,{remember:true});chatImg.src=p.file;poses.querySelectorAll('.pose').forEach(x=>x.setAttribute('aria-checked',String(x===b)))});
   poses.append(b);
  }
  const name=h('input',{type:'text',maxlength:'40',value:cfg.name,'aria-label':'Имя аватара'});
  name.addEventListener('input',()=>{cfg.name=name.value.trim()||DEFAULTS.name;chatName.textContent=cfg.name;save();applyLook()});
  const pct=v=>v+'%';
  settings.replaceChildren(
   h('header',{class:'floating-head'},h('img',{alt:'',src:poseOf(cfg.pose).file}),h('div',{class:'title'},h('strong',{text:'Настройки аватара'}),h('small',{text:'Сохраняются автоматически'})),
    h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть настройки',onclick:()=>closeSettings()},icon('i-close'))),
   h('div',{class:'settings-body'},
    h('fieldset',{},h('legend',{text:'Образ'}),poses,h('label',{class:'field'},h('span',{text:'Имя'}),h('span'),name)),
    h('fieldset',{},h('legend',{text:'Вид'}),range('Размер','size',100,420,5,v=>v+' px'),range('Непрозрачность','opacity',20,100,5,pct)),
    h('fieldset',{},h('legend',{text:'Эффекты'}),
     h('div',{class:'toggles'},toggle('Свечение','glow'),toggle('Пульсация','pulse'),toggle('Парение','float'),toggle('Частицы','particles'),toggle('Отразить','flip'),toggle('Живые позы','livePoses')),
     range('Сила свечения','glowPower',10,100,5,pct),range('Частиц','particleCount',6,80,2,v=>String(v))),
    h('div',{class:'settings-actions'},
     h('button',{type:'button',text:'Вернуть на место',onclick:()=>resetPosition()}),
     h('button',{type:'button',text:'Очистить чат',onclick:()=>{history=[];store(CHAT_KEY,history);renderHistory()}}),
     h('button',{type:'button',text:'Сбросить всё',onclick:()=>{const keep={x:cfg.x,y:cfg.y};cfg={...DEFAULTS,...keep};save();setPose(cfg.pose);chatImg.src=poseOf(cfg.pose).file;chatName.textContent=cfg.name;applyLook();spawnParticles();buildSettings();positionPanels()}}),
     h('button',{type:'button',text:'Скрыть аватар',onclick:()=>{closeSettings();toggleVisible(false)}}))));
 }
 function openSettings(x,y){
  if(!cfg.visible)toggleVisible(true);
  anchor={x:x??vw()/2,y:y??vh()/2};buildSettings();settings.hidden=false;positionPanels();
  requestAnimationFrame(()=>settings.classList.add('open'));
  setTimeout(()=>settings.querySelector('.pose[aria-checked="true"]')?.focus({preventScroll:true}),60);
 }
 function closeSettings(){if(settings.hidden)return;settings.classList.remove('open');setTimeout(()=>{if(!settings.classList.contains('open'))settings.hidden=true},180)}
 document.addEventListener('pointerdown',e=>{if(!settings.hidden&&!settings.contains(e.target)&&!avatar.contains(e.target))closeSettings()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!settings.hidden)closeSettings();else if(!chat.hidden)closeChat()}});

 // Окна держатся рядом с аватаром, не выходя за экран. На узких экранах — нижняя «шторка».
 const narrow=matchMedia('(max-width: 640px)');
 function positionPanels(){
  const s=sizePx(),m=12,cx=pos.x+s/2;
  if(!chat.hidden){
   chat.classList.toggle('sheet',narrow.matches);
   if(!narrow.matches){
    const w=chat.offsetWidth,ht=chat.offsetHeight;
    let left=cx<vw()/2?pos.x+s*.85:pos.x+s*.15-w;
    if(left<m||left+w>vw()-m)left=Math.min(vw()-w-m,Math.max(m,cx-w/2));
    let top=Math.min(vh()-ht-m,Math.max(m,pos.y+s-ht));
    chat.style.left=left+'px';chat.style.top=top+'px';
    chat.style.setProperty('--origin',(cx<vw()/2?'0%':'100%')+' 100%');
   }else{chat.style.left=chat.style.top=''}
  }
  if(!settings.hidden&&anchor){
   settings.classList.toggle('sheet',narrow.matches);
   if(!narrow.matches){
    const w=settings.offsetWidth,ht=settings.offsetHeight;
    const left=Math.min(vw()-w-m,Math.max(m,anchor.x<vw()/2?anchor.x+8:anchor.x-w-8));
    const top=Math.min(vh()-ht-m,Math.max(m,anchor.y-ht/2));
    settings.style.left=left+'px';settings.style.top=top+'px';
   }else{settings.style.left=settings.style.top=''}
  }
 }

 /* ---------- Золотые частицы ---------- */
 const ctx=canvas.getContext('2d');let parts=[],raf=0,dpr=1;
 function resizeCanvas(){dpr=Math.min(2,window.devicePixelRatio||1);const s=sizePx()*1.5;canvas.width=Math.round(s*dpr);canvas.height=Math.round(s*dpr)}
 function particle(fresh){const W=canvas.width,H=canvas.height;return {x:W*(.25+Math.random()*.5),y:fresh?H*(.3+Math.random()*.55):H*(.72+Math.random()*.1),r:(.6+Math.random()*1.8)*dpr*Math.max(.7,sizePx()/220),vy:-(.15+Math.random()*.45)*dpr,vx:(Math.random()-.5)*.25*dpr,life:0,max:180+Math.random()*220,tw:Math.random()*6.28}}
 function spawnParticles(){parts=cfg.particles&&cfg.visible&&!reduceMotion.matches?Array.from({length:cfg.particleCount},()=>particle(true)):[];if(!parts.length){ctx.clearRect(0,0,canvas.width,canvas.height);cancelAnimationFrame(raf);raf=0}else if(!raf)raf=requestAnimationFrame(tick)}
 function tick(){
  raf=0;if(!parts.length||document.hidden)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='lighter';
  for(let i=0;i<parts.length;i++){
   const p=parts[i];p.life++;p.x+=p.vx+Math.sin((p.life+p.tw*30)/40)*.15*dpr;p.y+=p.vy;
   const a=Math.sin(Math.PI*p.life/p.max)*(.55+.45*Math.sin(p.life/9+p.tw));
   if(p.life>=p.max){parts[i]=particle(false);continue}
   const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*4);
   g.addColorStop(0,`rgba(255,236,170,${a})`);g.addColorStop(.35,`rgba(232,190,80,${a*.55})`);g.addColorStop(1,'rgba(212,175,55,0)');
   ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,p.r*4,0,6.283);ctx.fill();
  }
  raf=requestAnimationFrame(tick);
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&parts.length&&!raf)raf=requestAnimationFrame(tick)});
 reduceMotion.addEventListener?.('change',spawnParticles);

 /* ---------- Публичное API и запуск ---------- */
 function toggleVisible(force){cfg.visible=typeof force==='boolean'?force:!cfg.visible;save();if(!cfg.visible){closeChat();closeSettings()}applyLook();spawnParticles()}
 function resetPosition(){cfg.x=DEFAULTS.x;cfg.y=DEFAULTS.y;save();if(!cfg.visible)toggleVisible(true);place()}
 document.getElementById('avatar-toggle')?.addEventListener('click',()=>toggleVisible());
 let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{applyLook();spawnParticles()})});
 window.TenmaAvatar={openSettings:()=>{const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top+r.height/2)},openChat,closeChat,toggleVisible,resetPosition,setPose:id=>setPose(id,{remember:true})};
 applyLook();spawnParticles();
})();
