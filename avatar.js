'use strict';
// Аватар-кицунэ: живёт поверх всего интерфейса, перетаскивается мышью/пальцем.
// Левый клик — чат (привязан к аватару и следует за ним), правый клик / долгое нажатие — настройки.
// Настройки, позиция и история чата сохраняются в localStorage между запусками.
(()=>{
 const POSES=[
  {id:'stand',label:'Стоит'},{id:'sit-greet',label:'Улыбка'},{id:'seiza',label:'Сэйдза'},
  {id:'sit-dream',label:'Мечтает'},{id:'bow',label:'Поклон'}
 ].map(p=>({...p,base:'/assets/avatars/kitsune-'+p.id}));
 const thumbOf=p=>p.base+'-thumb.webp';
 const srcsetOf=p=>`${p.base}-thumb.webp 320w, ${p.base}-768.webp 768w, ${p.base}.webp 1240w`;
 // Состояния аватара → позы (используются, если включены «живые позы»).
 const STATE_POSE={greet:'bow',think:'sit-dream',answer:'sit-greet'};
 const GLOW_PRESETS={gold:['Золото','#e8c25a'],white:['Лунный','#f4f1ff'],sakura:['Сакура','#ff9ec7'],foxfire:['Кицунэ-би','#6fd6ff'],violet:['Аметист','#b58cff'],crimson:['Багрянец','#ff5a5a'],jade:['Нефрит','#6fe3a8']};
 const PARTICLES={sparks:'Золотые искры',petals:'Лепестки сакуры',foxfire:'Кицунэ-би (огоньки)',fireflies:'Светлячки',stars:'Звёзды',snow:'Снег'};
 const TOOLS={notes:'Создавать заметки',tasks:'Вести дела',facts:'Запоминать факты',search:'Искать в памяти',navigate:'Открывать разделы',backup:'Резервная копия',status:'Проверка системы',clock:'Дата и время'};
 const DEFAULTS={
  name:'Юрика',pose:'stand',size:200,opacity:100,brightness:100,saturation:100,hue:0,tilt:0,flip:false,
  glow:true,glowPower:60,glowColor:'#e8c25a',pulse:true,pulseSpeed:3.2,shadow:true,
  float:true,floatHeight:6,floatSpeed:5.5,breathe:true,
  particles:true,particleType:'sparks',particleCount:28,particleSpeed:1,particleSize:1,clickBurst:true,
  livePoses:true,idleCycle:false,idleInterval:40,wander:false,wanderInterval:45,faceCursor:false,phrases:true,
  chatScale:100,chatFont:100,chatHotkey:true,
  tools:Object.fromEntries(Object.keys(TOOLS).map(k=>[k,true])),
  visible:true,x:.92,y:.9
 };
 const KEY='tenmayurika.avatar.v1',CHAT_KEY='tenmayurika.avatar.chat.v1',TAB_KEY='tenmayurika.avatar.tab';
 const load=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem(key));return v??fallback}catch{return fallback}};
 const store=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}};
 const merge=saved=>{const c={...DEFAULTS,...(saved&&typeof saved==='object'?saved:{})};c.tools={...DEFAULTS.tools,...(saved?.tools||{})};if(!POSES.some(p=>p.id===c.pose))c.pose=DEFAULTS.pose;if(!PARTICLES[c.particleType])c.particleType=DEFAULTS.particleType;return c};
 let cfg=merge(load(KEY,{}));
 let history=load(CHAT_KEY,[]);if(!Array.isArray(history))history=[];
 const save=()=>store(KEY,cfg);
 const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const poseOf=id=>POSES.find(p=>p.id===id)||POSES[0];
 const h=(tag,attrs={},...kids)=>{const el=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')el.className=v;else if(k==='text')el.textContent=v;else if(k.startsWith('on'))el.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)el.setAttribute(k,v===true?'':v)}el.append(...kids.filter(Boolean));return el};
 const icon=id=>{const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','icon');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#'+id);s.append(u);return s};
 const hexRgb=hex=>{const m=/^#?([0-9a-f]{6})$/i.exec(hex||'');const n=parseInt(m?m[1]:'e8c25a',16);return [n>>16&255,n>>8&255,n&255]};

 /* ---------- Аватар ---------- */
 const img=h('img',{alt:'',draggable:'false',decoding:'async'});
 const canvas=h('canvas',{'aria-hidden':'true'});
 const badge=h('span',{class:'avatar-badge','aria-hidden':'true',text:'1'});
 const speech=h('div',{class:'avatar-speech',role:'status',hidden:true});
 const body=h('div',{class:'avatar-body'},h('div',{class:'avatar-aura'}),h('div',{class:'avatar-figure'},img));
 const avatar=h('div',{class:'avatar',role:'button',tabindex:'0','aria-haspopup':'dialog'},canvas,body,badge,speech);
 document.body.append(avatar);
 function showPoseImage(p){img.srcset=srcsetOf(p);img.src=p.base+'-768.webp'}
 showPoseImage(poseOf(cfg.pose));

 let pos={x:0,y:0},currentPose=cfg.pose,stateTimer,cursorFlip=false;
 const vw=()=>document.documentElement.clientWidth,vh=()=>window.innerHeight;
 // Размер аватара масштабируется вместе с экраном (больше на 4K, меньше на телефоне).
 const scale=()=>Math.min(1.8,Math.max(.6,Math.min(vw()/1600,vh()/900)**.6));
 const sizePx=()=>Math.round(Math.min(cfg.size*scale(),vw()*.7,vh()*.7));
 function applyLook(){
  const s=sizePx(),[r,g,b]=hexRgb(cfg.glowColor),st=avatar.style;
  st.setProperty('--avatar-size',s+'px');
  st.setProperty('--avatar-opacity',cfg.opacity/100);
  st.setProperty('--glow',cfg.glowPower/100);
  st.setProperty('--glow-rgb',`${r},${g},${b}`);
  st.setProperty('--pulse-dur',cfg.pulseSpeed+'s');
  st.setProperty('--float-h',-cfg.floatHeight+'%');
  st.setProperty('--float-dur',cfg.floatSpeed+'s');
  st.setProperty('--tilt',cfg.tilt+'deg');
  st.setProperty('--tone',`brightness(${cfg.brightness/100}) saturate(${cfg.saturation/100}) hue-rotate(${cfg.hue}deg)`);
  img.sizes=Math.ceil(s)+'px';
  for(const [cls,on] of [['glow',cfg.glow],['pulse',cfg.glow&&cfg.pulse],['float',cfg.float],['breathe',cfg.breathe],['shadow',cfg.shadow],['hidden',!cfg.visible]])avatar.classList.toggle(cls,on);
  avatar.classList.toggle('flip',cfg.flip!==(cfg.faceCursor&&cursorFlip));
  avatar.setAttribute('aria-label','Аватар '+cfg.name+'. Enter — чат, Shift+F10 — настройки, стрелки — перемещение');
  document.documentElement.style.setProperty('--chat-scale',cfg.chatScale/100);
  document.documentElement.style.setProperty('--chat-font',cfg.chatFont/100);
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
  setTimeout(()=>{showPoseImage(poseOf(id));img.classList.remove('leaving')},180);
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
  if(e.button!==0||speech.contains(e.target))return;
  stopWander();avatar.setPointerCapture(e.pointerId);
  drag={id:e.pointerId,sx:e.clientX,sy:e.clientY,ox:pos.x,oy:pos.y,moved:false};
  if(e.pointerType!=='mouse')longPress=setTimeout(()=>{if(drag&&!drag.moved){drag=null;openSettings(e.clientX,e.clientY)}},600);
 });
 avatar.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;
  if(!drag.moved&&Math.hypot(dx,dy)<5)return;
  if(!drag.moved){drag.moved=true;clearTimeout(longPress);avatar.classList.add('dragging');closeSettings();hideSpeech()}
  const s=sizePx();
  pos.x=Math.min(vw()-s,Math.max(0,drag.ox+dx));pos.y=Math.min(vh()-s,Math.max(0,drag.oy+dy));
  avatar.style.transform=`translate3d(${pos.x}px,${pos.y}px,0)`;positionPanels();
 });
 const savePos=()=>{const s=sizePx();cfg.x=vw()>s?pos.x/(vw()-s):0;cfg.y=vh()>s?pos.y/(vh()-s):0;save()};
 const endDrag=e=>{
  clearTimeout(longPress);if(!drag||e.pointerId!==drag.id)return;
  const wasMoved=drag.moved;drag=null;avatar.classList.remove('dragging');
  if(wasMoved)savePos();
  else if(e.type==='pointerup'){if(cfg.clickBurst)burst();toggleChat()}
 };
 avatar.addEventListener('pointerup',endDrag);avatar.addEventListener('pointercancel',endDrag);
 avatar.addEventListener('contextmenu',e=>{e.preventDefault();clearTimeout(longPress);drag=null;openSettings(e.clientX,e.clientY)});
 avatar.addEventListener('keydown',e=>{
  if(e.target!==avatar)return;
  if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleChat()}
  else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top+r.height/2)}
  else if(e.key.startsWith('Arrow')){e.preventDefault();const step=e.shiftKey?.1:.02;if(e.key==='ArrowLeft')cfg.x-=step;if(e.key==='ArrowRight')cfg.x+=step;if(e.key==='ArrowUp')cfg.y-=step;if(e.key==='ArrowDown')cfg.y+=step;cfg.x=Math.min(1,Math.max(0,cfg.x));cfg.y=Math.min(1,Math.max(0,cfg.y));save();place()}
 });
 // Смотрит в сторону курсора.
 let faceFrame;
 document.addEventListener('pointermove',e=>{
  if(!cfg.faceCursor||drag||faceFrame)return;
  faceFrame=requestAnimationFrame(()=>{faceFrame=0;const next=e.clientX>pos.x+sizePx()/2;if(next!==cursorFlip){cursorFlip=next;avatar.classList.toggle('flip',cfg.flip!==cursorFlip)}});
 },{passive:true});

 /* ---------- Чат, привязанный к аватару ---------- */
 const chatImg=h('img',{alt:'',src:thumbOf(poseOf(cfg.pose))});
 const chatName=h('strong',{text:cfg.name});
 const chatSub=h('small',{text:'Хранительница памяти'});
 const log=h('div',{class:'chat-log',role:'log','aria-live':'polite'});
 const quick=h('div',{class:'chat-quick',role:'toolbar','aria-label':'Быстрые действия'});
 const input=h('textarea',{rows:'1',maxlength:'2000',placeholder:'Спросите или попросите что-то сделать…','aria-label':'Сообщение'});
 const send=h('button',{type:'submit',class:'primary','aria-label':'Отправить'},icon('i-send'));
 const form=h('form',{class:'chat-form'},input,send);
 const chat=h('section',{class:'floating chat',role:'dialog','aria-label':'Чат с аватаром',hidden:true},
  h('header',{class:'floating-head'},chatImg,h('div',{class:'title'},chatName,chatSub),
   h('button',{type:'button',class:'icon-btn','aria-label':'Настройки аватара',title:'Настройки аватара',onclick:()=>{const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top)}},icon('i-sliders')),
   h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть чат',title:'Закрыть',onclick:()=>closeChat()},icon('i-close'))),
  log,quick,form);
 document.body.append(chat);

 // Быстрые действия: «вставить» ставит заготовку в поле ввода, «send» сразу отправляет.
 const QUICK=[
  {tool:null,label:'Что умеешь?',send:'помощь'},
  {tool:'tasks',label:'Мои дела',send:'мои дела'},
  {tool:'tasks',label:'+ Дело',insert:'дело: '},
  {tool:'notes',label:'+ Заметка',insert:'заметка: '},
  {tool:'facts',label:'Запомнить',insert:'запомни  |  | '},
  {tool:'search',label:'Найти',insert:'найди '},
  {tool:'status',label:'Статус',send:'статус'},
  {tool:'backup',label:'Бэкап',send:'сделай резервную копию'},
  {tool:'clock',label:'Время',send:'который час'}
 ];
 function renderQuick(){
  quick.replaceChildren(...QUICK.filter(q=>!q.tool||cfg.tools[q.tool]).map(q=>h('button',{type:'button',class:'chip',text:q.label,onclick:()=>{
   if(q.send){input.value=q.send;form.requestSubmit()}else{input.value=q.insert;input.focus();const at=q.insert.indexOf(' ')+1||q.insert.length;input.setSelectionRange(q.tool==='facts'?8:q.insert.length,q.tool==='facts'?8:q.insert.length);void at;autoGrow()}
  }})));
 }
 function bubble(role,text,tag){const el=h('div',{class:'msg '+role},tag?h('span',{class:'msg-tag',text:tag}):null,document.createTextNode(text));log.append(el);log.scrollTop=log.scrollHeight;return el}
 function renderHistory(){
  log.replaceChildren();
  if(!history.length)bubble('assistant','Здравствуйте! Я '+cfg.name+'. Могу вести заметки и дела, запоминать факты, искать в памяти, делать резервную копию. Напишите «помощь» или нажмите кнопку ниже.\nПеретащите меня куда удобно; правый клик — мои настройки.');
  for(const m of history)bubble(m.role,m.text,m.tag);
 }
 const TOOL_TAG={add_note:'заметка',add_task:'дело',complete_task:'дело',list_tasks:'дела',remember_fact:'факт',search_memory:'поиск',open_page:'переход',create_backup:'бэкап',system_status:'статус',current_time:'время'};
 let busy=false,conversation=0;
 form.addEventListener('submit',async e=>{
  e.preventDefault();const text=input.value.trim();if(!text||busy)return;
  busy=true;send.disabled=true;input.value='';autoGrow();
  // Контекст для модели ограничен по объёму, чтобы запрос не превысил лимит сервера (100 КБ).
  const prior=[];let budget=20000;
  for(const m of history.slice(-12).reverse()){const t=m.text.slice(0,1500);if(t.length>budget)break;budget-=t.length;prior.unshift({role:m.role,text:t})}
  const gen=conversation;
  history.push({role:'user',text});bubble('user',text);
  const typing=h('div',{class:'msg assistant typing','aria-label':cfg.name+' думает'},h('span',{text:'•'}),h('span',{text:'•'}),h('span',{text:'•'}));
  log.append(typing);log.scrollTop=log.scrollHeight;state('think');
  let answer,tag,data={};
  try{
   const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,avatar:cfg.name,history:prior,tools:Object.keys(TOOLS).filter(k=>cfg.tools[k])})});
   data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка');answer=data.reply;
   if(data.tools?.length)tag='⚙ '+[...new Set(data.tools.map(t=>TOOL_TAG[t]||t))].join(', ');
  }catch(err){answer='Не получилось ответить: '+err.message}
  typing.remove();busy=false;send.disabled=false;
  if(gen!==conversation)return; // чат очистили, пока шёл ответ
  history.push({role:'assistant',text:answer,tag});history=history.slice(-100);store(CHAT_KEY,history);
  bubble('assistant',answer,tag);state('answer',2600);
  if(data.changed)window.TenmaApp?.refresh({keepDrafts:true});
  for(const a of data.actions||[])if(a.type==='navigate')window.TenmaApp?.go(a.page);
  if(chat.hidden)avatar.classList.add('has-unread');else input.focus();
 });
 const autoGrow=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,160)+'px'};
 input.addEventListener('input',autoGrow);
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit()}else if(e.key==='Escape')closeChat()});

 function openChat(){
  if(!chat.hidden)return;if(!cfg.visible)toggleVisible(true);
  closeSettings();hideSpeech();stopWander();renderHistory();renderQuick();chat.hidden=false;positionPanels();
  requestAnimationFrame(()=>chat.classList.add('open'));avatar.classList.remove('has-unread');avatar.setAttribute('aria-expanded','true');
  state('greet',1800);setTimeout(()=>input.focus({preventScroll:true}),60);
 }
 function closeChat(){if(chat.hidden)return;chat.classList.remove('open');avatar.setAttribute('aria-expanded','false');setTimeout(()=>{if(!chat.classList.contains('open'))chat.hidden=true},180);avatar.focus({preventScroll:true})}
 const toggleChat=()=>chat.hidden?openChat():closeChat();
 document.addEventListener('keydown',e=>{if(cfg.chatHotkey&&e.altKey&&!e.ctrlKey&&(e.code==='KeyY')){e.preventDefault();toggleChat()}});

 /* ---------- Реплики (облачко над аватаром) ---------- */
 let speechTimer,phraseTimer;
 function say(text,ms=6000){
  if(!cfg.visible||!chat.hidden)return;
  speech.textContent=text;speech.hidden=false;requestAnimationFrame(()=>speech.classList.add('open'));
  clearTimeout(speechTimer);speechTimer=setTimeout(hideSpeech,ms);
 }
 function hideSpeech(){speech.classList.remove('open');clearTimeout(speechTimer);setTimeout(()=>{if(!speech.classList.contains('open'))speech.hidden=true},200)}
 speech.addEventListener('click',e=>{e.stopPropagation();hideSpeech();openChat()});
 function phrase(){
  const hr=new Date().getHours();
  const greet=hr<5?'Глубокая ночь… не забудьте отдохнуть.':hr<12?'Доброе утро! Чем займёмся?':hr<18?'Добрый день! Я рядом, если что.':'Добрый вечер. Подвести итоги дня?';
  const tips=[greet,'Нажмите на меня — открою чат.','Правый клик — мои настройки и эффекты.','Скажите «дело: …», и я запишу.','Могу запомнить факт: «запомни Анна | живёт в | Казань».','Alt+Y — быстро открыть чат.','Можно перетащить меня куда угодно.'];
  return tips[Math.floor(Math.random()*tips.length)];
 }
 function schedulePhrases(){clearInterval(phraseTimer);if(cfg.phrases)phraseTimer=setInterval(()=>{if(!document.hidden&&!drag)say(phrase())},55000)}

 /* ---------- Поведение: прогулки и смена поз ---------- */
 let wanderTimer,idleTimer,walking=false;
 function stopWander(){if(!walking)return;walking=false;const r=avatar.getBoundingClientRect();pos.x=r.left;pos.y=r.top;avatar.classList.remove('walking');avatar.style.transform=`translate3d(${pos.x}px,${pos.y}px,0)`;savePos()}
 function wanderStep(){
  if(!cfg.wander||!cfg.visible||drag||!chat.hidden||!settings.hidden||document.hidden||reduceMotion.matches)return;
  const s=sizePx(),tx=Math.random()*(vw()-s),ty=vh()*.25+Math.random()*(vh()*.75-s);
  const dist=Math.hypot(tx-pos.x,ty-pos.y),dur=Math.min(7,Math.max(1.5,dist/220));
  if(!cfg.faceCursor){avatar.classList.toggle('flip',cfg.flip!==(tx>pos.x))}
  walking=true;avatar.classList.add('walking');avatar.style.setProperty('--walk-dur',dur+'s');
  pos.x=Math.max(0,tx);pos.y=Math.max(0,ty);avatar.style.transform=`translate3d(${pos.x}px,${pos.y}px,0)`;
  setTimeout(()=>{if(walking){walking=false;avatar.classList.remove('walking');avatar.classList.toggle('flip',cfg.flip!==(cfg.faceCursor&&cursorFlip));savePos()}},dur*1000+50);
 }
 function scheduleBehaviour(){
  clearInterval(wanderTimer);clearInterval(idleTimer);
  if(cfg.wander)wanderTimer=setInterval(wanderStep,cfg.wanderInterval*1000);
  if(cfg.idleCycle)idleTimer=setInterval(()=>{if(chat.hidden&&!drag){const others=POSES.filter(p=>p.id!==currentPose);setPose(others[Math.floor(Math.random()*others.length)].id)}},cfg.idleInterval*1000);
  else if(currentPose!==cfg.pose&&!stateTimer)setPose(cfg.pose);
  schedulePhrases();
 }

 /* ---------- Настройки аватара (правый клик) ---------- */
 const settings=h('section',{class:'floating avatar-settings',role:'dialog','aria-label':'Настройки аватара',hidden:true});
 document.body.append(settings);
 let anchor=null,tab=load(TAB_KEY,'look');
 const refreshAll=()=>{save();applyLook();spawnParticles();scheduleBehaviour();renderQuick()};
 function range(label,key,min,max,step,fmt,hint){
  const out=h('output',{text:fmt(cfg[key])});
  const r=h('input',{type:'range',min,max,step,value:cfg[key],'aria-label':label});
  const fill=()=>r.style.setProperty('--fill',((r.value-min)/(max-min)*100)+'%');fill();
  r.addEventListener('input',()=>{cfg[key]=Number(r.value);out.textContent=fmt(cfg[key]);fill();save();applyLook();if(/^particle/.test(key))spawnParticles()});
  r.addEventListener('change',()=>{if(/Interval$/.test(key))scheduleBehaviour()});
  return h('label',{class:'field'},h('span',{text:label}),out,r,hint?h('small',{class:'hint',text:hint}):null);
 }
 function toggle(label,key,obj=cfg){
  const c=h('input',{type:'checkbox'});c.checked=!!obj[key];
  c.addEventListener('change',()=>{obj[key]=c.checked;if(key==='livePoses'&&!c.checked)setPose(cfg.pose);if(key==='wander'&&!c.checked)stopWander();refreshAll()});
  return h('label',{class:'toggle'},c,h('span',{text:label}));
 }
 function select(label,key,options){
  const s=h('select',{'aria-label':label},...Object.entries(options).map(([v,t])=>h('option',{value:v,text:t,selected:cfg[key]===v})));
  s.addEventListener('change',()=>{cfg[key]=s.value;refreshAll()});
  return h('label',{class:'field'},h('span',{text:label}),h('span'),s);
 }
 const pct=v=>v+'%',sec=v=>v+' с',deg=v=>v+'°',mult=v=>'×'+Number(v).toFixed(1);
 const TABS={
  look:['Образ',()=>{
   const poses=h('div',{class:'poses',role:'radiogroup','aria-label':'Образ аватара'});
   for(const p of POSES){
    const b=h('button',{type:'button',class:'pose',role:'radio','aria-checked':String(p.id===cfg.pose),title:p.label},h('img',{src:thumbOf(p),alt:''}),h('span',{text:p.label}));
    b.addEventListener('click',()=>{clearTimeout(stateTimer);stateTimer=0;setPose(p.id,{remember:true});chatImg.src=thumbOf(p);poses.querySelectorAll('.pose').forEach(x=>x.setAttribute('aria-checked',String(x===b)))});
    poses.append(b);
   }
   const name=h('input',{type:'text',maxlength:'40',value:cfg.name,'aria-label':'Имя аватара'});
   name.addEventListener('input',()=>{cfg.name=name.value.trim()||DEFAULTS.name;chatName.textContent=cfg.name;save();applyLook()});
   return [h('fieldset',{},h('legend',{text:'Поза'}),poses,h('label',{class:'field'},h('span',{text:'Имя'}),h('span'),name)),
    h('fieldset',{},h('legend',{text:'Размер и вид'}),range('Размер','size',80,720,5,v=>v+' px','Масштабируется вместе с экраном'),range('Непрозрачность','opacity',10,100,5,pct),range('Наклон','tilt',-20,20,1,deg),h('div',{class:'toggles'},toggle('Отразить','flip'),toggle('Тень у ног','shadow'))),
    h('fieldset',{},h('legend',{text:'Цвет'}),range('Яркость','brightness',50,150,5,pct),range('Насыщенность','saturation',0,200,5,pct),range('Оттенок','hue',0,360,5,deg))];
  }],
  effects:['Эффекты',()=>{
   const swatches=h('div',{class:'swatches',role:'radiogroup','aria-label':'Цвет свечения'});
   const custom=h('input',{type:'color',value:cfg.glowColor,'aria-label':'Свой цвет',title:'Свой цвет'});
   const mark=()=>swatches.querySelectorAll('.swatch').forEach(x=>x.setAttribute('aria-checked',String(x.dataset.color===cfg.glowColor)));
   for(const [,[label,color]] of Object.entries(GLOW_PRESETS)){const b=h('button',{type:'button',class:'swatch',role:'radio',title:label,'aria-label':label,'data-color':color,style:'--c:'+color});b.addEventListener('click',()=>{cfg.glowColor=color;custom.value=color;mark();refreshAll()});swatches.append(b)}
   custom.addEventListener('input',()=>{cfg.glowColor=custom.value;mark();save();applyLook();spawnParticles()});swatches.append(custom);mark();
   return [h('fieldset',{},h('legend',{text:'Свечение'}),h('div',{class:'toggles'},toggle('Свечение','glow'),toggle('Пульсация','pulse')),swatches,range('Сила свечения','glowPower',5,100,5,pct),range('Скорость пульсации','pulseSpeed',1,8,.2,sec)),
    h('fieldset',{},h('legend',{text:'Движение'}),h('div',{class:'toggles'},toggle('Парение','float'),toggle('Дыхание','breathe')),range('Высота парения','floatHeight',1,20,1,pct),range('Период парения','floatSpeed',2,14,.5,sec))];
  }],
  particles:['Частицы',()=>[
   h('fieldset',{},h('legend',{text:'Частицы'}),h('div',{class:'toggles'},toggle('Показывать','particles'),toggle('Искры при клике','clickBurst')),select('Вид','particleType',PARTICLES),
    range('Количество','particleCount',4,120,2,String),range('Скорость','particleSpeed',.2,3,.1,mult),range('Размер','particleSize',.4,3,.1,mult),h('small',{class:'hint',text:'Цвет искр и звёзд берётся из цвета свечения.'}))
  ]],
  behaviour:['Поведение',()=>[
   h('fieldset',{},h('legend',{text:'Характер'}),h('div',{class:'toggles'},toggle('Живые позы','livePoses'),toggle('Смена поз','idleCycle'),toggle('Гуляет сама','wander'),toggle('Смотрит на курсор','faceCursor'),toggle('Реплики','phrases')),
    range('Смена позы каждые','idleInterval',10,180,5,sec),range('Прогулка каждые','wanderInterval',10,180,5,sec),
    h('small',{class:'hint',text:'Живые позы: поклон при открытии чата, задумчивость во время ответа. Прогулки не мешают — во время чата и настроек она стоит на месте.'}))
  ]],
  tools:['Инструменты',()=>[
   h('fieldset',{},h('legend',{text:'Что она может делать'}),h('div',{class:'toggles tools'},...Object.entries(TOOLS).map(([k,label])=>toggle(label,k,cfg.tools))),
    h('small',{class:'hint',text:'Команды в чате: «заметка: …», «дело: …», «готово: …», «мои дела», «запомни A | связь | B», «найди …», «открой дела», «статус», «сделай резервную копию», «который час». С языковой моделью (CHAT_URL) она вызывает включённые инструменты сама.'}))
  ]],
  chat:['Чат',()=>[
   h('fieldset',{},h('legend',{text:'Окно чата'}),range('Размер окна','chatScale',70,160,5,pct),range('Размер текста','chatFont',80,150,5,pct),h('div',{class:'toggles'},toggle('Alt+Y — открыть чат','chatHotkey'))),
   h('div',{class:'settings-actions'},
    h('button',{type:'button',text:'Очистить чат',onclick:()=>{conversation++;history=[];store(CHAT_KEY,history);renderHistory()}}),
    h('button',{type:'button',text:'Экспорт настроек',onclick:()=>{const a=h('a',{href:URL.createObjectURL(new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'})),download:'tenmayurika-avatar.json'});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}}),
    h('label',{class:'button-like'},h('span',{text:'Импорт…'}),h('input',{type:'file',accept:'application/json',hidden:true,onchange:async e=>{try{const f=e.target.files[0];if(!f)return;cfg=merge(JSON.parse(await f.text()));setPose(cfg.pose);chatName.textContent=cfg.name;chatImg.src=thumbOf(poseOf(cfg.pose));refreshAll();buildSettings()}catch{alert('Не удалось прочитать файл настроек')}}})))
  ]]
 };
 function buildSettings(){
  if(!TABS[tab])tab='look';
  const tabs=h('div',{class:'tabs',role:'tablist'},...Object.entries(TABS).map(([id,[label]])=>h('button',{type:'button',role:'tab',class:'tab','aria-selected':String(id===tab),text:label,onclick:()=>{tab=id;store(TAB_KEY,tab);buildSettings();positionPanels()}})));
  settings.replaceChildren(
   h('header',{class:'floating-head'},h('img',{alt:'',src:thumbOf(poseOf(cfg.pose))}),h('div',{class:'title'},h('strong',{text:'Настройки аватара'}),h('small',{text:'Сохраняются автоматически'})),
    h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть настройки',onclick:()=>closeSettings()},icon('i-close'))),
   tabs,
   h('div',{class:'settings-body',role:'tabpanel'},...TABS[tab][1]()),
   h('footer',{class:'settings-actions settings-foot'},
    h('button',{type:'button',text:'Вернуть на место',onclick:()=>resetPosition()}),
    h('button',{type:'button',text:'Сбросить всё',onclick:()=>{const keep={x:cfg.x,y:cfg.y};cfg=merge(keep);save();setPose(cfg.pose);chatImg.src=thumbOf(poseOf(cfg.pose));chatName.textContent=cfg.name;refreshAll();buildSettings();positionPanels()}}),
    h('button',{type:'button',text:'Скрыть аватар',onclick:()=>{closeSettings();toggleVisible(false)}})));
 }
 function openSettings(x,y){
  if(!cfg.visible)toggleVisible(true);
  stopWander();hideSpeech();
  anchor={x:x??vw()/2,y:y??vh()/2};buildSettings();settings.hidden=false;positionPanels();
  requestAnimationFrame(()=>settings.classList.add('open'));
  setTimeout(()=>settings.querySelector('.tab[aria-selected="true"]')?.focus({preventScroll:true}),60);
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
    const top=Math.min(vh()-ht-m,Math.max(m,pos.y+s-ht));
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

 /* ---------- Частицы ---------- */
 const ctx=canvas.getContext('2d');let parts=[],bursts=[],raf=0,dpr=1;
 function resizeCanvas(){dpr=Math.min(2,window.devicePixelRatio||1);const s=sizePx()*1.5;canvas.width=Math.round(s*dpr);canvas.height=Math.round(s*dpr)}
 const rnd=(a,b)=>a+Math.random()*(b-a);
 function particle(fresh){
  const W=canvas.width,H=canvas.height,k=dpr*Math.max(.7,sizePx()/220)*cfg.particleSize,v=cfg.particleSpeed*dpr,type=cfg.particleType;
  const p={x:W*rnd(.22,.78),y:fresh?H*rnd(.25,.8):H*rnd(.7,.82),r:rnd(.6,1.8)*k,vx:rnd(-.12,.12)*v,vy:-rnd(.15,.6)*v,life:0,max:rnd(180,400)/Math.max(.4,cfg.particleSpeed),tw:Math.random()*6.28,rot:Math.random()*6.28,vr:rnd(-.03,.03)};
  if(type==='petals'||type==='snow'){p.y=fresh?H*rnd(.05,.8):H*rnd(0,.12);p.vy=rnd(.2,.55)*v;p.vx=rnd(-.25,.25)*v;p.r=rnd(1.4,2.6)*k*(type==='snow'?.7:1)}
  if(type==='fireflies'){p.vx=rnd(-.3,.3)*v;p.vy=rnd(-.3,.3)*v;p.r=rnd(1,1.8)*k}
  if(type==='foxfire'){p.r=rnd(2,3.6)*k;p.vy=-rnd(.2,.5)*v;p.max*=.8}
  if(type==='stars'){p.vy=-rnd(0,.15)*v;p.vx=rnd(-.05,.05)*v;p.r=rnd(1.4,3)*k}
  return p;
 }
 function spawnParticles(){
  parts=cfg.particles&&cfg.visible&&!reduceMotion.matches?Array.from({length:cfg.particleCount},()=>particle(true)):[];
  kick();
 }
 function burst(){
  if(reduceMotion.matches)return;const W=canvas.width,H=canvas.height;
  for(let i=0;i<18;i++){const a=Math.random()*6.28,s=rnd(1.5,4)*dpr;bursts.push({x:W/2,y:H*.55,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1*dpr,r:rnd(1,2.2)*dpr,life:0,max:rnd(40,70)})}
  kick();
 }
 function kick(){if(!parts.length&&!bursts.length){ctx.clearRect(0,0,canvas.width,canvas.height);cancelAnimationFrame(raf);raf=0}else if(!raf)raf=requestAnimationFrame(tick)}
 function glowDot(x,y,r,rgb,a,inner='255,244,214'){const g=ctx.createRadialGradient(x,y,0,x,y,r*4);g.addColorStop(0,`rgba(${inner},${a})`);g.addColorStop(.35,`rgba(${rgb},${a*.55})`);g.addColorStop(1,`rgba(${rgb},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r*4,0,6.283);ctx.fill()}
 function draw(p,rgb){
  const t=p.life,a=Math.sin(Math.PI*Math.min(1,t/p.max))*(.55+.45*Math.sin(t/9+p.tw));
  switch(cfg.particleType){
   case 'petals':{ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.globalCompositeOperation='source-over';ctx.fillStyle=`rgba(255,${170+Math.round(30*Math.sin(p.tw))},205,${Math.min(1,a+.2)})`;ctx.beginPath();ctx.ellipse(0,0,p.r*1.6,p.r*.9,0,0,6.283);ctx.fill();ctx.restore();ctx.globalCompositeOperation='lighter';break}
   case 'snow':glowDot(p.x,p.y,p.r*.6,'220,235,255',Math.min(1,a+.25),'255,255,255');break;
   case 'fireflies':glowDot(p.x,p.y,p.r,'190,255,120',Math.max(0,Math.sin(t/14+p.tw))*a*1.3,'250,255,210');break;
   case 'foxfire':{const fl=.75+.25*Math.sin(t/4+p.tw),aa=Math.min(1,Math.abs(a)*1.6+.15);glowDot(p.x,p.y,p.r*fl,'90,200,255',aa,'230,252,255');glowDot(p.x,p.y-p.r*1.5,p.r*.6*fl,'120,170,255',aa*.75,'210,244,255');break}
   case 'stars':{ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);const s=p.r*2.4*(.6+.4*Math.sin(t/8+p.tw));ctx.fillStyle=`rgba(${rgb},${a})`;ctx.beginPath();for(let i=0;i<8;i++){const rr=i%2?s*.22:s;const ang=i*Math.PI/4;ctx.lineTo(Math.cos(ang)*rr,Math.sin(ang)*rr)}ctx.closePath();ctx.fill();ctx.restore();glowDot(p.x,p.y,p.r*.5,rgb,a*.6);break}
   default:glowDot(p.x,p.y,p.r,rgb,a);
  }
 }
 function tick(){
  raf=0;if((!parts.length&&!bursts.length)||document.hidden)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='lighter';
  const rgb=hexRgb(cfg.glowColor).join(','),W=canvas.width,H=canvas.height,type=cfg.particleType;
  for(let i=0;i<parts.length;i++){
   const p=parts[i];p.life++;p.rot+=p.vr;
   if(type==='fireflies'){p.vx+=rnd(-.03,.03)*dpr;p.vy+=rnd(-.03,.03)*dpr;p.vx*=.98;p.vy*=.98}
   p.x+=p.vx+(type==='petals'?Math.sin((p.life+p.tw*30)/30)*.5*dpr:Math.sin((p.life+p.tw*30)/40)*.15*dpr);p.y+=p.vy;
   if(p.life>=p.max||p.y<-20||p.y>H+20||p.x<-20||p.x>W+20){parts[i]=particle(false);continue}
   draw(p,rgb);
  }
  bursts=bursts.filter(b=>{b.life++;b.x+=b.vx;b.y+=b.vy;b.vx*=.95;b.vy=b.vy*.95+.04*dpr;glowDot(b.x,b.y,b.r,rgb,1-b.life/b.max);return b.life<b.max});
  raf=requestAnimationFrame(tick);
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)kick()});
 reduceMotion.addEventListener?.('change',spawnParticles);

 /* ---------- Публичное API и запуск ---------- */
 function toggleVisible(force){cfg.visible=typeof force==='boolean'?force:!cfg.visible;save();if(!cfg.visible){closeChat();closeSettings();hideSpeech()}applyLook();spawnParticles()}
 function resetPosition(){stopWander();cfg.x=DEFAULTS.x;cfg.y=DEFAULTS.y;save();if(!cfg.visible)toggleVisible(true);place()}
 document.getElementById('avatar-toggle')?.addEventListener('click',()=>toggleVisible());
 let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{applyLook();spawnParticles()})});
 window.TenmaAvatar={openSettings:(t)=>{if(t&&TABS[t])tab=t;if(!cfg.visible)toggleVisible(true);const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top+r.height/2)},openChat,closeChat,toggleVisible,resetPosition,say,setPose:id=>setPose(id,{remember:true})};
 applyLook();spawnParticles();scheduleBehaviour();
 if(cfg.phrases&&cfg.visible)setTimeout(()=>say(phrase()),2500);
})();
