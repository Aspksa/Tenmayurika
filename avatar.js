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
 const PARTICLES={sparks:['Золотые искры','✨'],petals:['Сакура','🌸'],foxfire:['Кицунэ-би','🔥'],fireflies:['Светлячки','🪲'],stars:['Звёзды','⭐'],snow:['Снег','❄️'],butterflies:['Бабочки','🦋'],runes:['Руны','ᚱ']};
 // Инструменты: id совпадают с сервером (chat.js). Каждый включается в меню → «Инструменты».
 const TOOLS={
  notes:{label:'Заметки',emoji:'📜',desc:'Личные и рабочие заметки',example:'рабочая заметка: План — пункты'},
  tasks:{label:'Дела',emoji:'✅',desc:'Личные и рабочие дела со сроком и важностью',example:'рабочее дело: отчёт в пятницу в 10:00'},
  calendar:{label:'Календарь',emoji:'📅',desc:'Повестка дня и недели, перенос дел, дни до даты',example:'что на сегодня'},
  facts:{label:'Факты',emoji:'🧠',desc:'Запоминает факты о мире и людях',example:'запомни Анна | живёт в | Казань'},
  search:{label:'Поиск',emoji:'🔎',desc:'Ищет в фактах и заметках',example:'найди Анна'},
  insights:{label:'Анализ памяти',emoji:'🪷',desc:'Итоги дня, противоречия, связи',example:'итоги дня'},
  reminders:{label:'Напоминания',emoji:'⏰',desc:'Таймеры, напоминания, помодоро',example:'напомни через 10 минут чай'},
  calc:{label:'Калькулятор',emoji:'🧮',desc:'Считает выражения',example:'посчитай (2+3)*4'},
  fun:{label:'Случайный выбор',emoji:'🎲',desc:'Кубик, монетка, выбор из вариантов',example:'выбери чай, кофе или какао'},
  avatar:{label:'Свой облик',emoji:'🦊',desc:'Меняет позу, эффект, цвет, размер',example:'эффект сакура'},
  navigate:{label:'Разделы',emoji:'🧭',desc:'Открывает страницы интерфейса',example:'открой дела'},
  backup:{label:'Резервная копия',emoji:'💾',desc:'Сохраняет копию SQLite',example:'сделай резервную копию'},
  sync:{label:'Переиндексация',emoji:'🔄',desc:'Обновляет векторную память',example:'переиндексируй'},
  status:{label:'Состояние системы',emoji:'🩺',desc:'Проверяет SQLite, LanceDB, модель',example:'статус'},
  clock:{label:'Дата и время',emoji:'🕰',desc:'Подскажет время и дату',example:'который час'},
  convert:{label:'Конвертер',emoji:'📐',desc:'Длина, вес, объём, время, скорость, °C/°F, ГБ',example:'переведи 5 км в мили'},
  password:{label:'Пароли',emoji:'🔐',desc:'Надёжный пароль прямо на компьютере',example:'придумай пароль на 20'}
 };
 const DEFAULTS={
  name:'Юрика',pose:'stand',size:200,opacity:100,brightness:100,saturation:100,hue:0,tilt:0,flip:false,
  glow:true,glowPower:60,glowColor:'#e8c25a',pulse:true,pulseSpeed:3.2,shadow:true,
  float:true,floatHeight:6,floatSpeed:5.5,breathe:true,
  particles:true,particleType:'sparks',particleCount:28,particleSpeed:1,particleSize:1,clickBurst:true,
  livePoses:true,idleCycle:false,idleInterval:40,wander:false,wanderInterval:45,faceCursor:false,phrases:true,
  magicCircle:false,circleSpeed:20,shine:false,outline:false,trail:true,hoverReact:true,
  chatScale:100,chatFont:100,chatHotkey:true,sounds:true,notify:false,taskAlerts:true,taskLead:10,dailyBrief:true,
  tools:Object.fromEntries(Object.keys(TOOLS).map(k=>[k,true])),
  visible:true,x:.92,y:.9
 };
 const KEY='tenmayurika.avatar.v1',CHAT_KEY='tenmayurika.avatar.chat.v1',TAB_KEY='tenmayurika.avatar.menu',REM_KEY='tenmayurika.avatar.reminders';
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
 const circle=document.createElementNS('http://www.w3.org/2000/svg','svg');circle.setAttribute('class','avatar-circle');circle.setAttribute('viewBox','0 0 200 200');circle.setAttribute('aria-hidden','true');
 circle.innerHTML='<g fill="none" stroke="currentColor"><circle cx="100" cy="100" r="96" stroke-width="1.2"/><circle cx="100" cy="100" r="86" stroke-width=".6" stroke-dasharray="2 5"/><circle cx="100" cy="100" r="60" stroke-width=".8"/><path d="M100 14 174 143H26z M100 186 26 57h148z" stroke-width=".8"/></g><g fill="currentColor" font-size="9" font-family="serif" text-anchor="middle">'+'天狐九尾金光守護記憶'.split('').map((c,i)=>{const a=i/10*Math.PI*2;return '<text x="'+(100+Math.sin(a)*73).toFixed(1)+'" y="'+(103-Math.cos(a)*73).toFixed(1)+'">'+c+'</text>'}).join('')+'</g>';
 const shine=h('div',{class:'avatar-shine','aria-hidden':'true'});
 const body=h('div',{class:'avatar-body'},h('div',{class:'avatar-aura'}),circle,h('div',{class:'avatar-figure'},img,shine));
 const avatar=h('div',{class:'avatar',role:'button',tabindex:'0','aria-haspopup':'dialog'},canvas,body,badge,speech);
 document.body.append(avatar);
 function showPoseImage(p){img.srcset=srcsetOf(p);img.src=p.base+'-768.webp';shine.style.setProperty('--mask','url("'+p.base+'-768.webp")')}
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
  st.setProperty('--circle-dur',cfg.circleSpeed+'s');
  for(const [cls,on] of [['glow',cfg.glow],['pulse',cfg.glow&&cfg.pulse],['float',cfg.float],['breathe',cfg.breathe],['shadow',cfg.shadow],['hidden',!cfg.visible],['circle',cfg.magicCircle],['shine',cfg.shine],['outline',cfg.outline],['hover-react',cfg.hoverReact]])avatar.classList.toggle(cls,on);
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
  {tool:'calendar',label:'📅 Сегодня',send:'что на сегодня'},
  {tool:'calendar',label:'Неделя',send:'что на неделе'},
  {tool:'tasks',label:'Мои дела',send:'мои дела'},
  {tool:'tasks',label:'+ Дело',insert:'дело: '},
  {tool:'tasks',label:'+ 💼 Рабочее',insert:'рабочее дело: '},
  {tool:'notes',label:'+ Заметка',insert:'заметка: '},
  {tool:'facts',label:'Запомнить',insert:'запомни  |  | '},
  {tool:'search',label:'Найти',insert:'найди '},
  {tool:'status',label:'Статус',send:'статус'},
  {tool:'backup',label:'Бэкап',send:'сделай резервную копию'},
  {tool:'clock',label:'Время',send:'который час'},
  {tool:'reminders',label:'⏰ Напомнить',insert:'напомни через 10 минут '},
  {tool:'insights',label:'Итоги дня',send:'итоги дня'},
  {tool:'calc',label:'Посчитать',insert:'посчитай '},
  {tool:'fun',label:'🎲',send:'брось кубик'},
  {tool:'convert',label:'📐 Перевести',insert:'переведи '},
  {tool:'password',label:'🔐 Пароль',send:'придумай пароль'}
 ];
 function renderQuick(){
  quick.replaceChildren(...QUICK.filter(q=>!q.tool||cfg.tools[q.tool]).map(q=>h('button',{type:'button',class:'chip',text:q.label,onclick:()=>{
   if(q.send){input.value=q.send;form.requestSubmit()}else{input.value=q.insert;input.focus();const at=q.insert.indexOf(' ')+1||q.insert.length;input.setSelectionRange(q.tool==='facts'?8:q.insert.length,q.tool==='facts'?8:q.insert.length);void at;autoGrow()}
  }})));
 }
 function bubble(role,text,tag){const el=h('div',{class:'msg '+role},tag?h('span',{class:'msg-tag',text:tag}):null,document.createTextNode(text));log.append(el);log.scrollTop=log.scrollHeight;return el}
 function renderHistory(){
  log.replaceChildren();
  if(!history.length)bubble('assistant','Здравствуйте! Я '+cfg.name+'. Веду личные и рабочие дела с календарём, заметки, запоминаю факты, ищу в памяти и делаю резервные копии. Напишите «помощь» или нажмите кнопку ниже.\nПеретащите меня куда удобно; правый клик — мои настройки.');
  for(const m of history)bubble(m.role,m.text,m.tag);
 }
 const TOOL_TAG={agenda:'повестка',move_task:'перенос',days_until:'дни',convert_units:'конвертер',generate_password:'пароль',pick_random:'выбор',list_notes:'заметки',day_summary:'итоги',fact_conflicts:'противоречия',fact_relations:'связи',set_reminder:'напоминание',calculate:'калькулятор',roll_dice:'кубик',flip_coin:'монетка',change_look:'облик',reindex_memory:'индекс',add_note:'заметка',add_task:'дело',complete_task:'дело',list_tasks:'дела',remember_fact:'факт',search_memory:'поиск',open_page:'переход',create_backup:'бэкап',system_status:'статус',current_time:'время'};
 let busy=false,conversation=0;
 form.addEventListener('submit',async e=>{
  e.preventDefault();const text=input.value.trim();if(!text||busy)return;
  busy=true;send.disabled=true;input.value='';autoGrow();
  // Контекст для модели ограничен по объёму, чтобы запрос не превысил лимит сервера (100 КБ).
  const prior=[];let budget=20000;
  for(const m of history.filter(m=>!m.private).slice(-12).reverse()){const t=m.text.slice(0,1500);if(t.length>budget)break;budget-=t.length;prior.unshift({role:m.role,text:t})}
  const gen=conversation;
  history.push({role:'user',text});bubble('user',text);
  const typing=h('div',{class:'msg assistant typing','aria-label':cfg.name+' думает'},h('span',{text:'•'}),h('span',{text:'•'}),h('span',{text:'•'}));
  log.append(typing);log.scrollTop=log.scrollHeight;state('think');
  // Секундомер «думает 12 с»: видно, что ответ идёт, а не потерялся. Через 5 минут запрос прерывается.
  const started=Date.now(),clock=h('span',{class:'typing-sec'});typing.append(clock);
  const tick=setInterval(()=>{const s=Math.round((Date.now()-started)/1000);clock.textContent=s>=3?' думает '+s+' с':''},1000);
  const ctrl=new AbortController(),limit=setTimeout(()=>ctrl.abort(),300000);
  let answer,tag,data={};
  try{
   const r=await fetch('/api/chat',{method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,avatar:cfg.name,history:prior,tools:Object.keys(TOOLS).filter(k=>cfg.tools[k])})});
   data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка');answer=data.reply;
   if(data.tools?.length)tag='⚙ '+[...new Set(data.tools.map(t=>TOOL_TAG[t]||t))].join(', ');
  }catch(err){answer=err.name==='AbortError'?'Не получилось ответить: сервер не ответил за 5 минут. Проверьте, что окно Tenmayurika открыто.':'Не получилось ответить: '+(err.message==='Failed to fetch'?'нет связи с сервером Tenmayurika (окно сервера закрыто?)':err.message)}
  clearInterval(tick);clearTimeout(limit);
  if(!answer||!String(answer).trim())answer='Модель прислала пустой ответ. Нажмите «Проверить связь» в меню «Модель ИИ».';
  typing.remove();busy=false;send.disabled=false;
  if(gen!==conversation)return; // чат очистили, пока шёл ответ
  history.push({role:'assistant',text:answer,tag,...(data&&data.secret?{private:true}:{})});history=history.slice(-100);store(CHAT_KEY,history);
  bubble('assistant',answer,tag);state('answer',2600);
  if(data.changed)window.TenmaApp?.refresh({keepDrafts:true});
  // Новый факт из чата — «Мозг» сразу показывает вспышку нейрона.
  if((data.tools||[]).includes('remember_fact'))window.dispatchEvent(new CustomEvent('tenma:memory'));
  for(const a of data.actions||[])runAction(a);
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

 /* ---------- Действия от инструментов: переходы, облик, напоминания ---------- */
 function runAction(a){
  if(a.type==='navigate')window.TenmaApp?.go(a.page);
  else if(a.type==='reminder')addReminder(a.at,a.text);
  else if(a.type==='avatar'&&a.look){
   const L=a.look;
   if(L.pose&&POSES.some(p=>p.id===L.pose)){clearTimeout(stateTimer);stateTimer=0;cfg.pose=L.pose;setTimeout(()=>setPose(L.pose),2700);chatImg.src=thumbOf(poseOf(L.pose))}
   if(L.particleType&&PARTICLES[L.particleType]){cfg.particleType=L.particleType;cfg.particles=true}
   if(L.glowColor)cfg.glowColor=L.glowColor,cfg.glow=true;
   if(L.sizeDelta)cfg.size=Math.max(80,Math.min(720,cfg.size+L.sizeDelta));
   refreshAll();if(cfg.clickBurst)burst();
  }
 }
 let reminders=load(REM_KEY,[]);if(!Array.isArray(reminders))reminders=[];
 const remTimers=new Map();
 function chime(){if(!cfg.sounds)return;try{const C=window.AudioContext||window.webkitAudioContext,ac=new C();[880,1320,1760].forEach((f,i)=>{const o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,ac.currentTime+i*.18);g.gain.linearRampToValueAtTime(.12,ac.currentTime+i*.18+.02);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+i*.18+.9);o.connect(g).connect(ac.destination);o.start(ac.currentTime+i*.18);o.stop(ac.currentTime+i*.18+1)});setTimeout(()=>ac.close(),2500)}catch{}}
 function fireReminder(r){
  reminders=reminders.filter(x=>x.id!==r.id);store(REM_KEY,reminders);remTimers.delete(r.id);
  const text='⏰ '+r.text;
  history.push({role:'assistant',text,tag:'⚙ напоминание'});history=history.slice(-100);store(CHAT_KEY,history);
  if(!chat.hidden)bubble('assistant',text,'⚙ напоминание');else{avatar.classList.add('has-unread');if(cfg.visible)say(text,15000)}
  chime();if(cfg.clickBurst)burst();state('greet',2200);
  if(cfg.notify&&'Notification' in window&&Notification.permission==='granted'&&document.hidden){try{new Notification(cfg.name,{body:r.text,icon:thumbOf(poseOf(cfg.pose))})}catch{}}
 }
 function armReminder(r){const ms=r.at-Date.now();if(ms<=0){setTimeout(()=>fireReminder(r),1200);return}remTimers.set(r.id,setTimeout(()=>fireReminder(r),Math.min(ms,2147000000)))}
 function addReminder(at,text){const r={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),at:Number(at),text:String(text).slice(0,200)};reminders.push(r);store(REM_KEY,reminders);armReminder(r);if(cfg.notify&&'Notification' in window&&Notification.permission==='default')Notification.requestPermission()}
 function reminderItems(){
  if(!reminders.length)return [h('small',{class:'hint',text:'Активных напоминаний нет. Скажите: «напомни через 15 минут выпить чай».'})];
  return reminders.slice().sort((a,b)=>a.at-b.at).map(r=>h('div',{class:'reminder'},h('span',{text:new Date(r.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+' — '+r.text}),h('button',{type:'button',class:'icon-btn','aria-label':'Отменить напоминание',onclick:e=>{clearTimeout(remTimers.get(r.id));remTimers.delete(r.id);reminders=reminders.filter(x=>x.id!==r.id);store(REM_KEY,reminders);e.currentTarget.parentElement.remove()}},icon('i-close'))));
 }
 reminders.forEach(armReminder);

 /* ---------- Дела со временем и утренняя сводка (данные из раздела «Дела») ---------- */
 const ALERT_KEY='tenmayurika.avatar.taskalerts',BRIEF_KEY='tenmayurika.avatar.brief';
 const taskTimers=new Map();
 const localDay=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 function scheduleTaskAlerts(tasks){
  for(const t of taskTimers.values())clearTimeout(t);taskTimers.clear();
  if(!cfg.taskAlerts||!cfg.tools.tasks)return;
  const fired=load(ALERT_KEY,{}),now=Date.now(),lead=(Number(cfg.taskLead)||0)*60000;
  for(const t of tasks){
   if(t.done||!t.due||!t.time)continue;
   const [y,m,d]=t.due.split('-').map(Number),[hh,mm]=t.time.split(':').map(Number);
   const at=new Date(y,m-1,d,hh,mm).getTime()-lead,key=t.id+'@'+t.due+'T'+t.time;
   // Только ближайшие сутки; уже показанные не повторяем. Пропущенные за последние 30 минут покажем сразу.
   if(fired[key]||at-now>86400000||now-at>1800000)continue;
   taskTimers.set(key,setTimeout(()=>{
    if(!cfg.taskAlerts||!cfg.tools.tasks)return;
    const f=load(ALERT_KEY,{});f[key]=Date.now();for(const k of Object.keys(f))if(Date.now()-f[k]>7*86400000)delete f[k];store(ALERT_KEY,f);
    fireReminder({id:'task-'+key,text:(lead&&at>now-60000?'Через '+cfg.taskLead+' мин: ':'Пора: ')+t.title+' ('+t.time+(t.category==='work'?', 💼 работа':'')+')'});
   },Math.max(1000,at-now)));
  }
 }
 function dailyBrief(tasks){
  if(!cfg.dailyBrief||!cfg.tools.calendar)return;
  const today=localDay(new Date());if(load(BRIEF_KEY,'')===today)return;
  const open=tasks.filter(t=>!t.done),due=open.filter(t=>t.due===today),late=open.filter(t=>t.due&&t.due<today);
  store(BRIEF_KEY,today);
  if(!due.length&&!late.length)return;
  const work=due.filter(t=>t.category==='work').length;
  setTimeout(()=>say('📅 Сегодня '+due.length+' '+(due.length%10===1&&due.length%100!==11?'дело':due.length%10>=2&&due.length%10<=4&&(due.length%100<10||due.length%100>=20)?'дела':'дел')+(work?' (рабочих: '+work+')':'')+(late.length?', просрочено: '+late.length:'')+'. Спросите «что на сегодня».',12000),2500);
 }
 window.addEventListener('tenma:workspace',e=>{const tasks=e.detail?.tasks||[];scheduleTaskAlerts(tasks);dailyBrief(tasks)});
 // Раз в 10 минут пересчитываем таймеры (смена суток, дела из другой вкладки).
 setInterval(()=>{const w=window.TenmaApp?.workspace;if(w)scheduleTaskAlerts(w.tasks||[])},600000);
 if(window.TenmaApp?.workspace?.tasks)scheduleTaskAlerts(window.TenmaApp.workspace.tasks);

 /* ---------- Реплики (облачко над аватаром) ---------- */
 let speechTimer,phraseTimer;
 function say(text,ms=6000){
  if(!cfg.visible||!chat.hidden||!settings.hidden)return;
  speech.textContent=text;speech.hidden=false;requestAnimationFrame(()=>speech.classList.add('open'));
  clearTimeout(speechTimer);speechTimer=setTimeout(hideSpeech,ms);
 }
 function hideSpeech(){speech.classList.remove('open');clearTimeout(speechTimer);setTimeout(()=>{if(!speech.classList.contains('open'))speech.hidden=true},200)}
 speech.addEventListener('click',e=>{e.stopPropagation();hideSpeech();openChat()});
 function phrase(){
  const hr=new Date().getHours();
  const greet=hr<5?'Глубокая ночь… не забудьте отдохнуть.':hr<12?'Доброе утро! Чем займёмся?':hr<18?'Добрый день! Я рядом, если что.':'Добрый вечер. Подвести итоги дня?';
  const tips=[greet,'Нажмите на меня — открою чат.','Правый клик — мои настройки и эффекты.','Скажите «дело: … завтра в 10:00», и я запишу.','Спросите «что на сегодня» — расскажу план.','«Рабочее дело: …» попадёт в рабочие дела.','«Перенеси отчёт на пятницу» — и я сдвину срок.','Могу запомнить факт: «запомни Анна | живёт в | Казань».','Alt+Y — быстро открыть чат.','Можно перетащить меня куда угодно.'];
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

 /* ---------- Большое меню аватара (правый клик) ---------- */
 const backdrop=h('div',{class:'menu-backdrop',hidden:true,onclick:()=>closeSettings()});
 const settings=h('section',{class:'avatar-menu',role:'dialog','aria-modal':'false','aria-label':'Меню аватара',hidden:true});
 document.body.append(backdrop,settings);
 let anchor=null,tab=load(TAB_KEY,'look');
 // Таймеры дел пересчитываются сразу: выключение напоминаний или смена «заранее» действуют немедленно.
 const refreshAll=()=>{save();applyLook();spawnParticles();scheduleBehaviour();renderQuick();scheduleTaskAlerts(window.TenmaApp?.workspace?.tasks||[])};
 function range(label,key,min,max,step,fmt,hint){
  const out=h('output',{text:fmt(cfg[key])});
  const r=h('input',{type:'range',min,max,step,value:cfg[key],'aria-label':label});
  const fill=()=>r.style.setProperty('--fill',((r.value-min)/(max-min)*100)+'%');fill();
  r.addEventListener('input',()=>{cfg[key]=Number(r.value);out.textContent=fmt(cfg[key]);fill();save();applyLook();if(/^particle/.test(key))spawnParticles()});
  r.addEventListener('change',()=>{if(/Interval$/.test(key))scheduleBehaviour();if(key==='taskLead')scheduleTaskAlerts(window.TenmaApp?.workspace?.tasks||[])});
  return h('label',{class:'field'},h('span',{text:label}),out,r,hint?h('small',{class:'hint',text:hint}):null);
 }
 // Переключатель в виде золотого «тумблера».
 function sw(label,key,obj=cfg,desc){
  const c=h('input',{type:'checkbox',role:'switch'});c.checked=!!obj[key];
  c.addEventListener('change',()=>{obj[key]=c.checked;if(key==='livePoses'&&!c.checked)setPose(cfg.pose);if(key==='wander'&&!c.checked)stopWander();if(key==='notify'&&c.checked&&'Notification' in window&&Notification.permission==='default')Notification.requestPermission();refreshAll()});
  return h('label',{class:'switch-row'},h('span',{class:'switch-text'},h('span',{text:label}),desc?h('small',{text:desc}):null),c,h('span',{class:'switch','aria-hidden':'true'}));
 }
 function select(label,key,options){
  const s=h('select',{'aria-label':label},...Object.entries(options).map(([v,t])=>h('option',{value:v,text:t,selected:cfg[key]===v})));
  s.addEventListener('change',()=>{cfg[key]=s.value;refreshAll()});
  return h('label',{class:'field'},h('span',{text:label}),h('span'),s);
 }
 const card=(title,...kids)=>h('section',{class:'menu-card'},title?h('h4',{text:title}):null,...kids);
 const grid=(...kids)=>h('div',{class:'menu-grid'},...kids);
 const pct=v=>v+'%',sec=v=>v+' с',deg=v=>v+'°',mult=v=>'×'+Number(v).toFixed(1);

 /* Раздел «Модель ИИ»: Cloud.ru и другие OpenAI-совместимые сервисы. Ключ хранится на сервере. */
 async function api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('HTTP '+r.status));return d}
 function modelSection(){
  const wrap=h('div',{class:'menu-stack'},h('p',{class:'muted',text:'Загрузка настроек модели…'}));
  api('/api/llm').then(v=>{
   const status=h('div',{class:'model-status'+(v.active?' on':'')},h('span',{class:'dot'}),h('span',{text:v.active?'Подключено · '+v.activeModel+(v.source==='env'?' (из .env)':''):'Модель не подключена — отвечаю локально'}));
   const provider=h('select',{'aria-label':'Сервис'},...Object.entries(v.presets).map(([k,p])=>h('option',{value:k,text:p.label,selected:k===v.provider})));
   const baseUrl=h('input',{type:'url',value:v.baseUrl||'',placeholder:'https://…/v1',spellcheck:'false','aria-label':'Адрес API'});
   provider.addEventListener('change',()=>{const p=v.presets[provider.value];if(p.baseUrl)baseUrl.value=p.baseUrl;keyLink.hidden=!p.keyUrl;if(p.keyUrl)keyLink.href=p.keyUrl});
   const key=h('input',{type:'password',autocomplete:'off',spellcheck:'false',placeholder:v.hasKey?'Ключ сохранён '+v.keyHint+' — введите новый, чтобы заменить':'Вставьте ключ API','aria-label':'Ключ API'});
   const eye=h('button',{type:'button',class:'icon-btn',title:'Показать ключ','aria-label':'Показать ключ',onclick:()=>{key.type=key.type==='password'?'text':'password'}},icon('i-eye'));
   const keyLink=h('a',{class:'link-small',href:v.presets[v.provider]?.keyUrl||'#',target:'_blank',rel:'noopener noreferrer',text:'Где взять ключ Cloud.ru?',hidden:!v.presets[v.provider]?.keyUrl});
   const models=h('datalist',{id:'tenma-models'});
   const model=h('input',{type:'text',list:'tenma-models',value:v.model||'',placeholder:'Например: GigaChat/GigaChat-2-Max','aria-label':'Модель',spellcheck:'false'});
   const modelSelect=h('select',{'aria-label':'Список моделей',hidden:true});
   modelSelect.addEventListener('change',()=>{model.value=modelSelect.value});
   const msg=h('p',{class:'model-msg',role:'status'});
   const say_=(t,ok)=>{msg.textContent=t;msg.className='model-msg '+(ok?'ok':'err')};
   const temp=h('input',{type:'range',min:0,max:2,step:.1,value:v.temperature,'aria-label':'Креативность'}),tempOut=h('output',{text:String(v.temperature)});
   temp.addEventListener('input',()=>{tempOut.textContent=temp.value;temp.style.setProperty('--fill',(temp.value/2*100)+'%')});temp.style.setProperty('--fill',(v.temperature/2*100)+'%');
   const maxT=h('input',{type:'range',min:128,max:8192,step:128,value:v.maxTokens,'aria-label':'Длина ответа'}),maxOut=h('output',{text:String(v.maxTokens)});
   maxT.addEventListener('input',()=>{maxOut.textContent=maxT.value;maxT.style.setProperty('--fill',((maxT.value-128)/(8192-128)*100)+'%')});maxT.style.setProperty('--fill',((v.maxTokens-128)/(8192-128)*100)+'%');
   const enabled=h('input',{type:'checkbox',role:'switch'});enabled.checked=v.enabled;
   const useTools=h('input',{type:'checkbox',role:'switch'});useTools.checked=v.useTools;
   const persona=h('textarea',{rows:'4',maxlength:'4000',placeholder:'Характер и стиль ответов. Например: «Ты Юрика — мудрая и игривая кицунэ. Отвечай кратко, с японскими словечками».','aria-label':'Характер'});persona.value=v.systemPrompt||'';
   const collect=()=>({provider:provider.value,baseUrl:baseUrl.value,model:model.value,temperature:Number(temp.value),maxTokens:Number(maxT.value),enabled:enabled.checked,useTools:useTools.checked,systemPrompt:persona.value,...(key.value.trim()?{apiKey:key.value.trim()}:{})});
   const saveBtn=h('button',{type:'button',class:'primary',text:'Сохранить',onclick:async()=>{try{const nv=await api('/api/llm',collect());key.value='';key.placeholder=nv.hasKey?'Ключ сохранён '+nv.keyHint+' — введите новый, чтобы заменить':'Вставьте ключ API';say_('Сохранено ✓',true);status.className='model-status'+(nv.active?' on':'');status.lastChild.textContent=nv.active?'Подключено · '+nv.activeModel:'Модель не подключена — отвечаю локально'}catch(e){say_(e.message,false)}}});
   const loadBtn=h('button',{type:'button',text:'Загрузить список моделей',onclick:async()=>{loadBtn.disabled=true;say_('Запрашиваю список…',true);try{await api('/api/llm',collect());key.value='';const {models:list}=await api('/api/llm/models',{});models.replaceChildren(...list.map(id=>h('option',{value:id})));modelSelect.replaceChildren(h('option',{value:'',text:'— выберите модель ('+list.length+') —'}),...list.map(id=>h('option',{value:id,text:id,selected:id===model.value})));modelSelect.hidden=!list.length;say_(list.length?'Найдено моделей: '+list.length:'Сервис не вернул список — впишите имя модели вручную',!!list.length)}catch(e){say_(e.message,false)}loadBtn.disabled=false}});
   const testBtn=h('button',{type:'button',text:'Проверить связь',onclick:async()=>{testBtn.disabled=true;say_('Проверяю…',true);try{await api('/api/llm',collect());key.value='';const t=await api('/api/llm/test',{});say_('✓ '+t.model+' ответила за '+t.ms+' мс: «'+t.reply+'»',true)}catch(e){say_(e.message,false)}testBtn.disabled=false}});
   const clearBtn=h('button',{type:'button',class:'ghost',text:'Удалить ключ',onclick:async()=>{if(!confirm('Удалить сохранённый ключ API?'))return;try{const nv=await api('/api/llm',{clearKey:true});key.placeholder='Вставьте ключ API';say_('Ключ удалён',true);status.className='model-status'+(nv.active?' on':'')}catch(e){say_(e.message,false)}}});
   const swRow=(label,input,desc)=>h('label',{class:'switch-row'},h('span',{class:'switch-text'},h('span',{text:label}),desc?h('small',{text:desc}):null),input,h('span',{class:'switch','aria-hidden':'true'}));
   wrap.replaceChildren(status,
    grid(
     card('Подключение',
      h('label',{class:'field'},h('span',{text:'Сервис'}),keyLink,provider),
      h('label',{class:'field'},h('span',{text:'Адрес API'}),h('span'),baseUrl),
      h('label',{class:'field'},h('span',{text:'Ключ API'}),h('span'),h('div',{class:'input-with-btn'},key,eye)),
      h('small',{class:'hint',text:'Ключ хранится только на вашем SSD (data/llm-settings.json) и не отправляется в браузер.'})),
     card('Модель',
      h('label',{class:'field'},h('span',{text:'Модель'}),h('span'),model,models),modelSelect,
      h('div',{class:'row'},loadBtn),
      h('label',{class:'field'},h('span',{text:'Креативность'}),tempOut,temp),
      h('label',{class:'field'},h('span',{text:'Длина ответа (токенов)'}),maxOut,maxT),
      swRow('Использовать модель',enabled,'Выключите, чтобы отвечать только локально'),
      swRow('Разрешить инструменты',useTools,'Модель сама создаёт заметки, дела, напоминания'))),
    card('Характер',persona),
    h('div',{class:'menu-actions'},saveBtn,testBtn,clearBtn),msg);
  }).catch(e=>wrap.replaceChildren(h('p',{class:'model-msg err',text:'Не удалось загрузить настройки: '+e.message})));
  return [wrap];
 }

 const SECTIONS={
  look:{label:'Образ',icon:'i-image',sub:'Поза, имя, размер и цвет',build:()=>{
   const poses=h('div',{class:'poses',role:'radiogroup','aria-label':'Образ аватара'});
   for(const p of POSES){
    const b=h('button',{type:'button',class:'pose',role:'radio','aria-checked':String(p.id===cfg.pose),title:p.label},h('img',{src:thumbOf(p),alt:''}),h('span',{text:p.label}));
    b.addEventListener('click',()=>{clearTimeout(stateTimer);stateTimer=0;setPose(p.id,{remember:true});chatImg.src=thumbOf(p);heroImg.src=thumbOf(p);poses.querySelectorAll('.pose').forEach(x=>x.setAttribute('aria-checked',String(x===b)))});
    poses.append(b);
   }
   const name=h('input',{type:'text',maxlength:'40',value:cfg.name,'aria-label':'Имя аватара'});
   name.addEventListener('input',()=>{cfg.name=name.value.trim()||DEFAULTS.name;chatName.textContent=cfg.name;heroName.textContent=cfg.name;save();applyLook()});
   return [card('Поза',poses),
    grid(card('Имя и размер',h('label',{class:'field'},h('span',{text:'Имя'}),h('span'),name),range('Размер','size',80,720,5,v=>v+' px','Масштабируется вместе с экраном'),range('Непрозрачность','opacity',10,100,5,pct),range('Наклон','tilt',-20,20,1,deg)),
     card('Цвет',range('Яркость','brightness',50,150,5,pct),range('Насыщенность','saturation',0,200,5,pct),range('Оттенок','hue',0,360,5,deg),sw('Отразить по горизонтали','flip')))];
  }},
  glow:{label:'Свечение и магия',icon:'i-sparkle',sub:'Сияние, аура, магический круг',build:()=>{
   const swatches=h('div',{class:'swatches',role:'radiogroup','aria-label':'Цвет свечения'});
   const custom=h('input',{type:'color',value:cfg.glowColor,'aria-label':'Свой цвет',title:'Свой цвет'});
   const mark=()=>swatches.querySelectorAll('.swatch').forEach(x=>x.setAttribute('aria-checked',String(x.dataset.color===cfg.glowColor)));
   for(const [,[label,color]] of Object.entries(GLOW_PRESETS)){const b=h('button',{type:'button',class:'swatch',role:'radio',title:label,'aria-label':label,'data-color':color,style:'--c:'+color});b.addEventListener('click',()=>{cfg.glowColor=color;custom.value=color;mark();refreshAll()});swatches.append(b)}
   custom.addEventListener('input',()=>{cfg.glowColor=custom.value;mark();save();applyLook();spawnParticles()});swatches.append(custom);mark();
   return [card('Цвет магии',swatches,h('small',{class:'hint',text:'Цвет свечения, ауры, круга, искр и звёзд.'})),
    grid(card('Сияние',sw('Свечение','glow'),sw('Пульсация','pulse'),range('Сила свечения','glowPower',5,100,5,pct),range('Скорость пульсации','pulseSpeed',1,8,.2,sec)),
     card('Магия',sw('Магический круг','magicCircle',cfg,'Вращающаяся печать под ногами'),range('Скорость круга','circleSpeed',4,60,1,sec),sw('Блик света','shine',cfg,'Сияющая волна пробегает по фигуре'),sw('Золотой контур','outline'),sw('Тень у ног','shadow')))];
  }},
  particles:{label:'Частицы',icon:'i-particles',sub:'Искры, сакура, огоньки и другое',build:()=>{
   const types=h('div',{class:'ptypes',role:'radiogroup','aria-label':'Вид частиц'});
   for(const [k,[label,emoji]] of Object.entries(PARTICLES)){const b=h('button',{type:'button',class:'ptype',role:'radio','aria-checked':String(k===cfg.particleType)},h('span',{class:'ptype-emoji',text:emoji}),h('span',{text:label}));b.addEventListener('click',()=>{cfg.particleType=k;if(!cfg.particles)cfg.particles=true;types.querySelectorAll('.ptype').forEach(x=>x.setAttribute('aria-checked',String(x===b)));refreshAll()});types.append(b)}
   return [card('Вид',types),grid(card('Настройка',sw('Показывать частицы','particles'),range('Количество','particleCount',4,160,2,String),range('Скорость','particleSpeed',.2,3,.1,mult),range('Размер','particleSize',.4,3,.1,mult)),
    card('Эффекты движения',sw('Искры при клике','clickBurst'),sw('След из искр','trail',cfg,'Когда её тащат или она гуляет')))];
  }},
  motion:{label:'Движение и характер',icon:'i-motion',sub:'Парение, прогулки, реплики',build:()=>[
   grid(card('Движение',sw('Парение','float'),range('Высота парения','floatHeight',1,20,1,pct),range('Период парения','floatSpeed',2,14,.5,sec),sw('Дыхание','breathe'),sw('Реакция на наведение','hoverReact')),
    card('Характер',sw('Живые позы','livePoses',cfg,'Поклон при чате, задумчивость при ответе'),sw('Смена поз','idleCycle'),range('Каждые','idleInterval',10,180,5,sec),sw('Гуляет сама','wander'),range('Прогулка каждые','wanderInterval',10,180,5,sec),sw('Смотрит на курсор','faceCursor'),sw('Реплики-подсказки','phrases')))
  ]},
  tools:{label:'Инструменты',icon:'i-tools',sub:'Что она умеет делать',build:()=>{
   const list=h('div',{class:'tool-grid'});
   const draw=()=>list.replaceChildren(...Object.entries(TOOLS).map(([k,t])=>{
    const c=h('input',{type:'checkbox',role:'switch','aria-label':t.label});c.checked=!!cfg.tools[k];
    c.addEventListener('change',()=>{cfg.tools[k]=c.checked;el.classList.toggle('off',!c.checked);refreshAll()});
    const el=h('label',{class:'tool-card'+(cfg.tools[k]?'':' off')},h('span',{class:'tool-emoji',text:t.emoji}),h('span',{class:'tool-text'},h('strong',{text:t.label}),h('small',{text:t.desc}),h('code',{text:t.example})),c,h('span',{class:'switch','aria-hidden':'true'}));
    return el;
   }));
   draw();
   const all=v=>{for(const k of Object.keys(TOOLS))cfg.tools[k]=v;refreshAll();draw()};
   return [h('div',{class:'menu-actions'},h('button',{type:'button',text:'Включить все',onclick:()=>all(true)}),h('button',{type:'button',class:'ghost',text:'Выключить все',onclick:()=>all(false)})),list,
    h('small',{class:'hint',text:'Команды работают и без модели. С подключённой моделью она вызывает включённые инструменты сама. Выключенный инструмент сервер не выполнит.'})];
  }},
  model:{label:'Модель ИИ',icon:'i-cloud',sub:'Cloud.ru и другие — ключ и выбор модели',build:modelSection},
  chat:{label:'Чат и уведомления',icon:'i-chat',sub:'Окно чата, звуки, напоминания',build:()=>[
   grid(card('Окно чата',range('Размер окна','chatScale',70,160,5,pct),range('Размер текста','chatFont',80,150,5,pct),sw('Alt+Y — открыть чат','chatHotkey')),
    card('Уведомления',sw('Звук напоминаний','sounds'),sw('Системные уведомления','notify',cfg,'Покажет напоминание, даже если вкладка свёрнута'),
     sw('Напоминать о делах со временем','taskAlerts',cfg,'Дела с датой и временем из раздела «Дела» и календаря'),range('Заранее','taskLead',0,60,5,v=>v?v+' мин':'в срок'),
     sw('Утренняя сводка','dailyBrief',cfg,'Раз в день расскажу, что запланировано и что просрочено'),h('div',{class:'reminder-list'},...reminderItems()))),
   card('Данные',h('div',{class:'menu-actions'},
    h('button',{type:'button',text:'Очистить чат',onclick:()=>{conversation++;history=[];store(CHAT_KEY,history);renderHistory()}}),
    h('button',{type:'button',text:'Экспорт настроек',onclick:()=>{const a=h('a',{href:URL.createObjectURL(new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'})),download:'tenmayurika-avatar.json'});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}}),
    h('label',{class:'button-like'},h('span',{text:'Импорт…'}),h('input',{type:'file',accept:'application/json',hidden:true,onchange:async e=>{try{const f=e.target.files[0];if(!f)return;cfg=merge(JSON.parse(await f.text()));setPose(cfg.pose);chatName.textContent=cfg.name;chatImg.src=thumbOf(poseOf(cfg.pose));refreshAll();buildSettings()}catch{alert('Не удалось прочитать файл настроек')}}}))))
  ]}
 };
 const heroImg=h('img',{alt:''}),heroName=h('strong',{text:cfg.name});
 function buildSettings(){
  if(!SECTIONS[tab])tab='look';
  heroImg.src=thumbOf(poseOf(cfg.pose));heroName.textContent=cfg.name;
  const nav=h('nav',{class:'menu-nav',role:'tablist','aria-label':'Разделы меню'},...Object.entries(SECTIONS).map(([id,s])=>h('button',{type:'button',role:'tab',class:'menu-tab','aria-selected':String(id===tab),onclick:()=>{tab=id;store(TAB_KEY,tab);buildSettings()}},icon(s.icon),h('span',{text:s.label}))));
  const S=SECTIONS[tab];
  settings.replaceChildren(
   h('aside',{class:'menu-side'},
    h('div',{class:'menu-hero'},h('div',{class:'hero-ring','aria-hidden':'true'}),heroImg,h('div',{class:'hero-text'},heroName,h('small',{text:'Девятихвостая хранительница'}))),
    nav,
    h('div',{class:'menu-side-foot'},
     h('button',{type:'button',class:'ghost',text:'Вернуть на место',onclick:()=>resetPosition()}),
     h('button',{type:'button',class:'ghost',text:'Сбросить облик',onclick:()=>{if(!confirm('Сбросить все настройки облика и эффектов?'))return;const keep={x:cfg.x,y:cfg.y,tools:cfg.tools};cfg=merge(keep);save();setPose(cfg.pose);chatImg.src=thumbOf(poseOf(cfg.pose));chatName.textContent=cfg.name;refreshAll();buildSettings()}}),
     h('button',{type:'button',class:'ghost',text:'Скрыть аватар',onclick:()=>{closeSettings();toggleVisible(false)}}))),
   h('div',{class:'menu-main'},
    h('header',{class:'menu-head'},h('div',{},h('h3',{text:S.label}),h('small',{text:S.sub})),h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть меню',title:'Закрыть (Esc)',onclick:()=>closeSettings()},icon('i-close'))),
    h('div',{class:'menu-body',role:'tabpanel'},...S.build())));
 }
 function openSettings(x,y){
  if(!cfg.visible)toggleVisible(true);
  stopWander();hideSpeech();closeChat();
  anchor={x:x??vw()/2,y:y??vh()/2};buildSettings();settings.hidden=false;backdrop.hidden=false;positionPanels();
  requestAnimationFrame(()=>{settings.classList.add('open');backdrop.classList.add('open')});
  setTimeout(()=>settings.querySelector('.menu-tab[aria-selected="true"]')?.focus({preventScroll:true}),60);
 }
 function closeSettings(){if(settings.hidden)return;settings.classList.remove('open');backdrop.classList.remove('open');setTimeout(()=>{if(!settings.classList.contains('open')){settings.hidden=true;backdrop.hidden=true}},220)}
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
  // Большое меню встаёт со стороны, противоположной аватару, чтобы эффекты было видно вживую.
  if(!settings.hidden){
   settings.classList.toggle('sheet',narrow.matches);
   if(!narrow.matches){
    const w=settings.offsetWidth,ht=settings.offsetHeight,rail=document.querySelector('.rail')?.offsetWidth||0;
    const onRight=cx>vw()/2,free=onRight?[rail+m,pos.x-m]:[pos.x+s+m,vw()-m];
    let left=free[1]-free[0]>=w?free[0]+(free[1]-free[0]-w)/2:(vw()-w)/2;
    left=Math.min(vw()-w-m,Math.max(m,left));
    settings.style.left=left+'px';settings.style.top=Math.max(m,(vh()-ht)/2)+'px';
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
  if(type==='butterflies'){p.vx=rnd(-.4,.4)*v;p.vy=-rnd(.1,.35)*v;p.r=rnd(2.2,3.6)*k;p.hue=rnd(0,1)}
  if(type==='runes'){p.vy=-rnd(.12,.3)*v;p.vx=rnd(-.06,.06)*v;p.r=rnd(3,5)*k;p.ch='ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ'[Math.floor(Math.random()*24)]}
  return p;
 }
 function spawnParticles(){
  parts=cfg.particles&&cfg.visible&&!reduceMotion.matches?Array.from({length:cfg.particleCount},()=>particle(true)):[];
  kick();
 }
 let lastTrail=null;
 function trail(){
  if(!cfg.trail||reduceMotion.matches||!cfg.visible)return;
  const now={x:pos.x,y:pos.y};if(walking){const r=avatar.getBoundingClientRect();now.x=r.left;now.y=r.top}
  if(lastTrail&&Math.hypot(now.x-lastTrail.x,now.y-lastTrail.y)>6){const W=canvas.width,H=canvas.height,dx=(lastTrail.x-now.x)*dpr,dy=(lastTrail.y-now.y)*dpr;for(let i=0;i<3;i++)bursts.push({x:W/2+dx*.5+rnd(-W*.08,W*.08),y:H*.78+dy*.5+rnd(-6,6),vx:dx*.02+rnd(-.4,.4),vy:rnd(-.6,.2),r:rnd(.8,1.8)*dpr,life:0,max:rnd(30,55)});kick()}
  lastTrail=now;
 }
 setInterval(()=>{if(drag?.moved||walking)trail();else lastTrail=null},50);
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
   case 'butterflies':{ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(p.vy,p.vx)+Math.PI/2);const flap=Math.abs(Math.sin(t/5+p.tw)),w=p.r*1.6*(.25+.75*flap);ctx.globalCompositeOperation='source-over';ctx.fillStyle=p.hue<.5?`rgba(${rgb},${Math.min(1,a+.3)})`:`rgba(255,236,190,${Math.min(1,a+.3)})`;ctx.beginPath();ctx.ellipse(-w*.6,-p.r*.3,w*.6,p.r*.9,-.4,0,6.283);ctx.ellipse(w*.6,-p.r*.3,w*.6,p.r*.9,.4,0,6.283);ctx.ellipse(-w*.45,p.r*.6,w*.4,p.r*.55,-.6,0,6.283);ctx.ellipse(w*.45,p.r*.6,w*.4,p.r*.55,.6,0,6.283);ctx.fill();ctx.restore();ctx.globalCompositeOperation='lighter';glowDot(p.x,p.y,p.r*.35,rgb,a*.5);break}
   case 'runes':{ctx.save();ctx.font=`${Math.round(p.r*3)}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor=`rgba(${rgb},${a})`;ctx.shadowBlur=p.r*3;ctx.fillStyle=`rgba(${rgb},${Math.min(1,a+.15)})`;ctx.fillText(p.ch,p.x,p.y);ctx.restore();break}
   default:glowDot(p.x,p.y,p.r,rgb,a);
  }
 }
 function tick(){
  raf=0;if((!parts.length&&!bursts.length)||document.hidden)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.globalCompositeOperation='lighter';
  const rgb=hexRgb(cfg.glowColor).join(','),W=canvas.width,H=canvas.height,type=cfg.particleType;
  for(let i=0;i<parts.length;i++){
   const p=parts[i];p.life++;p.rot+=p.vr;
   if(type==='butterflies'){p.vx+=rnd(-.05,.05)*dpr;p.vx*=.99}
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
 window.TenmaAvatar={openSettings:(t)=>{if(t&&SECTIONS[t])tab=t;if(!cfg.visible)toggleVisible(true);const r=avatar.getBoundingClientRect();openSettings(r.left+r.width/2,r.top+r.height/2)},openChat,closeChat,toggleVisible,resetPosition,say,setPose:id=>setPose(id,{remember:true})};
 applyLook();spawnParticles();scheduleBehaviour();
 if(cfg.phrases&&cfg.visible)setTimeout(()=>say(phrase()),2500);
})();
