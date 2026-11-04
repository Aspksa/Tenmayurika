'use strict';
const root=document.querySelector('#content'),status=document.querySelector('#status');
let workspace={notes:[],tasks:[]},page='home';
async function request(url,options){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw Error(data.error||'Ошибка запроса');return data}
function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node}
// h('div',{class:'x',onclick:fn},child1,child2…) — короткий конструктор разметки.
function h(tag,props={},...children){
 const node=document.createElement(tag);
 for(const [k,v] of Object.entries(props||{})){
  if(v==null||v===false)continue;
  if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k==='value'&&tag==='textarea')node.textContent=v;else if(k.startsWith('on'))node[k]=v;
  else if(k in node&&typeof v!=='string')node[k]=v;else node.setAttribute(k,v===true?'':v);
 }
 for(const c of children.flat())if(c!=null&&c!==false)node.append(c);
 return node;
}
function svg(id){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','icon');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href','#'+id);s.append(u);return s}
const json={'Content-Type':'application/json'};
const items=(method,body)=>request('/api/items',{method,headers:json,body:JSON.stringify(body)});

/* ---------- Даты ---------- */
const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_GEN=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WD=['вс','пн','вт','ср','чт','пт','сб'];
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fromYmd=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(d,n)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x};
const today=()=>ymd(new Date());
function dayLabel(due){
 if(!due)return 'Без срока';
 const d=fromYmd(due),diff=Math.round((d-fromYmd(today()))/86400000);
 if(diff===0)return 'Сегодня';if(diff===1)return 'Завтра';if(diff===-1)return 'Вчера';
 return WD[d.getDay()]+', '+d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?' '+d.getFullYear():'');
}
const CAT={personal:{label:'Личное',plural:'Личные',icon:'🏠'},work:{label:'Рабочее',plural:'Рабочие',icon:'💼'}};
const PRIO={high:'Важное',normal:'Обычное',low:'Не срочно'};
const catOf=x=>x.category==='work'?'work':'personal';
const PR={high:0,normal:1,low:2};
const byAgenda=(a,b)=>(a.done-b.done)||String(a.due||'9999').localeCompare(String(b.due||'9999'))||String(a.time||'99').localeCompare(String(b.time||'99'))||(PR[a.priority]??1)-(PR[b.priority]??1);

// keepDrafts: фоновое обновление (например, из чата аватара) не стирает недописанные поля форм.
async function refresh(options={}){
 try{
  workspace=await request('/api/workspace');workspace.notes??=[];workspace.tasks??=[];
  status.textContent='● Локальный сервер подключён';status.className='status ok';
  if(options.keepDrafts){
   const fields=()=>[...root.querySelectorAll('form input:not([type=radio]):not([type=checkbox]),form textarea,form select')];
   const drafts=fields().map(e=>e.value),shown=page,focused=document.activeElement;
   const focusIndex=fields().indexOf(focused);
   render();
   if(page===shown){const now=fields();now.forEach((e,i)=>{if(drafts[i]&&drafts[i]!==e.defaultValue)e.value=drafts[i]});if(focusIndex>=0)now[focusIndex]?.focus()}
  }else render();
  updateBadge();
  window.dispatchEvent(new CustomEvent('tenma:workspace',{detail:workspace}));
 }catch(error){status.textContent='Ошибка: '+error.message;status.className='status err'}
}
// Значок на «Делах»: сколько открытых дел на сегодня и просрочено.
function updateBadge(){const b=document.querySelector('[data-badge="planner"]');if(!b)return;const t=today(),n=workspace.tasks.filter(x=>!x.done&&x.due&&x.due<=t).length;b.hidden=!n;b.textContent=n>99?'99+':String(n)}
const TITLES={home:'Добро пожаловать',planner:'Планер',brain:'Мозг',settings:'Настройки проекта',facts:'Факты памяти',library:'Личная библиотека'};
function render(){
 const brainAlive=page==='brain'&&!!brainHost&&brainHost.isConnected;
 root.replaceChildren(element('h2',TITLES[page]));
 if(page==='brain')return renderBrain(brainAlive);
 ({home:renderHome,planner:renderPlanner,facts:renderFacts,settings:renderSettings,library:renderLibrary}[page]||renderHome)();
}

/* ---------- Общие элементы ---------- */
// Переключатель-сегменты: [{value,label,count}] → кнопки; onChange(value).
function segmented(options,value,onChange,label){
 return h('div',{class:'seg',role:'group','aria-label':label},...options.map(o=>h('button',{type:'button',class:o.value===value?'on':'','aria-pressed':String(o.value===value),onclick:()=>onChange(o.value)},o.label,o.count!=null?h('span',{class:'seg-count',text:String(o.count)}):null)));
}
// Радио-переключатель категории для форм.
function categoryPicker(name,value='personal'){
 return h('div',{class:'seg cat-pick',role:'radiogroup','aria-label':'Категория'},...Object.entries(CAT).map(([k,c])=>h('label',{class:'cat-'+k},h('input',{type:'radio',name,value:k,checked:k===value}),h('span',{text:c.icon+' '+c.label}))));
}
const chip=(text,cls='')=>h('span',{class:'tag '+cls,text});
async function act(fn){try{await fn();await refresh()}catch(e){alert(e.message)}}
function confirmDelete(kind,item){return confirm('Удалить '+kind+' «'+item.title+'»? Это действие нельзя отменить.')}

/* ---------- Обзор ---------- */
function renderHome(){
 const t=today(),open=workspace.tasks.filter(x=>!x.done);
 const dueToday=open.filter(x=>x.due===t),overdue=open.filter(x=>x.due&&x.due<t);
 const cards=h('div',{class:'cards'});
 for(const [label,count,view,list] of [['На сегодня',dueToday.length,'list','today'],['Открытых дел',open.length,'list','all'],['Просрочено',overdue.length,'list','overdue'],['Заметки',workspace.notes.length,'notes']]){
  cards.append(h('button',{type:'button',class:'panel metric-card'+(label==='Просрочено'&&count?' warn':''),onclick:()=>{pv.view=view;if(list)pv.list=list;go('planner')}},h('div',{class:'metric',text:String(count)}),h('p',{text:label})));
 }
 const agenda=h('div',{class:'panel'},h('div',{class:'panel-head'},h('h3',{text:'Сегодня · '+new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}),h('button',{type:'button',class:'link',text:'Открыть планер →',onclick:()=>{pv.view='day';pv.date=today();go('planner')}})));
 const list=[...overdue,...dueToday].sort(byAgenda);
 agenda.append(list.length?h('div',{class:'task-list'},...list.map(x=>taskRow(x,{compact:true}))):h('p',{class:'muted',text:'На сегодня дел нет. Напишите в планере «созвон завтра в 10 #работа» или скажите это кицунэ.'}));
 const hint=h('div',{class:'panel'},h('h3',{text:'Ваша кицунэ-хранительница'}),h('p',{class:'muted',text:'Аватар можно перетаскивать по всему окну. Левый клик открывает чат, правый клик (или долгое нажатие) — её меню. Спросите «что на сегодня», «рабочие дела», «перенеси отчёт на пятницу».'}));
 root.append(cards,h('div',{class:'grid-2'},agenda,hint),h('p',{class:'muted',text:'Ваши записи сохраняются в папке data на переносном SSD.'}));
}

/* ---------- Планер: дела, календарь и заметки на одном экране ---------- */
const PV_KEY='tenmayurika.planner.v1';
const pv=(()=>{const d={view:'list',list:'today',cat:'all',calMode:null,date:today(),month:null,sel:null,query:''};try{const s=JSON.parse(localStorage.getItem(PV_KEY));if(s&&typeof s==='object'){for(const k of ['view','list','cat','calMode'])if(typeof s[k]==='string')d[k]=s[k]}}catch{}return d})();
const savePv=()=>{try{localStorage.setItem(PV_KEY,JSON.stringify({view:pv.view,list:pv.list,cat:pv.cat,calMode:pv.calMode}))}catch{}};
const VIEWS=[['list','Список'],['day','День'],['week','Неделя'],['month','Месяц'],['notes','Заметки']];
const LISTS=[['today','Сегодня'],['upcoming','Ближайшие 7 дней'],['overdue','Просрочено'],['nodate','Без срока'],['all','Все дела'],['done','Выполнено']];
const inCat=x=>pv.cat==='all'||catOf(x)===pv.cat;
function listFilter(key){
 const t=today(),week=ymd(addDays(new Date(),7));
 return {today:x=>!x.done&&x.due&&x.due<=t,upcoming:x=>!x.done&&x.due>t&&x.due<=week,overdue:x=>!x.done&&x.due&&x.due<t,nodate:x=>!x.done&&!x.due,all:x=>!x.done,done:x=>x.done}[key]||(()=>true);
}
function setPv(changes){Object.assign(pv,changes);savePv();render()}
// На узком экране карточка открывается под списком — прокручиваем к ней.
function selectItem(type,id){
 // С «Обзора» дело открывается в планере на своём дне.
 if(page!=='planner'){const x=workspace[type==='task'?'tasks':'notes'].find(i=>i.id===id),d=x?.due||x?.day;pv.sel={type,id};if(d){pv.date=d;pv.month=new Date(fromYmd(d).getFullYear(),fromYmd(d).getMonth(),1)}go('planner');return}
 pv.sel=pv.sel&&pv.sel.type===type&&pv.sel.id===id?null:{type,id};render();if(pv.sel&&innerWidth<900)document.querySelector('.pl-detail')?.scrollIntoView({behavior:'smooth',block:'start'})}

// Перетаскивание: дело можно бросить на день (месяц, неделя, мини-календарь) или на час (вид «День»).
let dragId=null;
function draggable(node,task){
 if(task.done)return node;
 node.draggable=true;
 node.addEventListener('dragstart',e=>{dragId=task.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',task.title);node.classList.add('dragging')});
 node.addEventListener('dragend',()=>{dragId=null;node.classList.remove('dragging')});
 return node;
}
function dropTarget(node,patchFor){
 node.addEventListener('dragover',e=>{if(!dragId)return;e.preventDefault();node.classList.add('drop')});
 node.addEventListener('dragleave',()=>node.classList.remove('drop'));
 node.addEventListener('drop',e=>{e.preventDefault();node.classList.remove('drop');const id=dragId;dragId=null;if(id)act(()=>items('PATCH',{collection:'tasks',id,...patchFor()}))});
 return node;
}

// Отмена удаления: запись восстанавливается теми же полями.
function removeWithUndo(collection,item){
 act(async()=>{
  await items('DELETE',{collection,id:item.id});
  if(pv.sel?.id===item.id)pv.sel=null;
  toast((collection==='tasks'?'Дело':'Заметка')+' «'+item.title+'» удалено',[ 'Вернуть',async()=>{
   const {id,createdAt,updatedAt,doneAt,...fields}=item;
   await act(()=>items('POST',{collection,...fields}));
  }]);
 });
}
let toastTimer;
function toast(text,action){
 document.querySelector('.toast')?.remove();clearTimeout(toastTimer);
 const t=h('div',{class:'toast',role:'status'},h('span',{text}),action?h('button',{type:'button',class:'link',text:action[0],onclick:()=>{t.remove();action[1]()}}):null);
 document.body.append(t);toastTimer=setTimeout(()=>t.remove(),8000);
}
// Золотые искры при выполнении дела.
function sparkle(x,y){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 for(let i=0;i<10;i++){const s=h('span',{class:'spark'});const a=Math.PI*2*i/10,r=26+Math.random()*16;s.style.cssText=`left:${x}px;top:${y}px;--dx:${Math.cos(a)*r}px;--dy:${Math.sin(a)*r}px`;document.body.append(s);setTimeout(()=>s.remove(),700)}
}
function toggleDone(task,e){
 if(!task.done&&e)sparkle(e.clientX,e.clientY);
 act(()=>items('PATCH',{collection:'tasks',id:task.id,done:!task.done}));
}

function taskRow(task,{compact=false,showDate=true,time=true}={}){
 const t=today(),late=!task.done&&task.due&&task.due<t,c=catOf(task),sel=pv.sel?.type==='task'&&pv.sel.id===task.id;
 const check=h('button',{type:'button',class:'check'+(task.done?' on':''),'aria-label':task.done?'Вернуть в работу':'Отметить выполненным',title:task.done?'Вернуть':'Готово',onclick:e=>{e.stopPropagation();toggleDone(task,e)}},task.done?'✓':'');
 const meta=h('div',{class:'task-meta'},chip(CAT[c].icon+' '+CAT[c].label,'cat-'+c),
  showDate&&task.due?chip((late?'⚠ ':'')+dayLabel(task.due)+(task.time?' · '+task.time:''),late?'late':task.due===t?'today':''):(!showDate&&time&&task.time?chip(task.time,'today'):null),
  task.priority==='high'?chip('❗ Важное','high'):task.priority==='low'?chip('Не срочно','low'):null,
  task.content&&!compact?chip('✎ заметка'):null);
 const row=h('div',{class:'task-row'+(task.done?' done':'')+(late?' late':'')+(task.priority==='high'?' high':'')+(sel?' selected':'')+' cat-'+c,tabindex:'0',role:'button','aria-label':task.title,
  onclick:()=>selectItem('task',task.id),onkeydown:e=>{if(e.key==='Enter'&&e.target===row)selectItem('task',task.id)}},check,h('div',{class:'task-body'},h('div',{class:'task-title',text:task.title}),meta));
 return draggable(row,task);
}

function renderPlanner(){
 root.querySelector('h2')?.remove();
 const shell=h('div',{class:'planner view-'+pv.view});
 shell.append(plannerTop(),plannerSide(),plannerMain(),plannerRight());
 root.append(shell);
}

// Верх: быстрый ввод, прогресс дня, переключатель вида.
let quickFocus=false;
function plannerTop(){
 const t=today(),dueToday=workspace.tasks.filter(x=>x.due===t&&inCat(x)),done=dueToday.filter(x=>x.done).length,pct=dueToday.length?Math.round(done/dueToday.length*100):0;
 const ring=h('div',{class:'ring',style:'--p:'+pct,title:'Сегодня выполнено '+done+' из '+dueToday.length,'aria-label':'Сегодня выполнено '+done+' из '+dueToday.length},h('span',{text:dueToday.length?done+'/'+dueToday.length:'—'}));
 const input=h('input',{class:'quick-input',name:'quick',maxLength:500,autocomplete:'off',placeholder:'Новое дело: «созвон завтра в 10 #работа !» или «заметка: Идея — текст»','aria-label':'Быстрый ввод'});
 const preview=h('div',{class:'quick-preview','aria-live':'polite'});
 let parsed=null,timer;
 input.addEventListener('input',()=>{clearTimeout(timer);const v=input.value.trim();if(!v||/^заметк/i.test(v)){parsed=null;preview.replaceChildren(v?chip('📜 заметка'):'');return}
  timer=setTimeout(async()=>{try{parsed=await request('/api/parse',{method:'POST',headers:json,body:JSON.stringify({text:v})});const d=defaultsFor(parsed);preview.replaceChildren(chip(CAT[d.category].icon+' '+CAT[d.category].label,'cat-'+d.category),d.due?chip(dayLabel(d.due)+(d.time?' · '+d.time:''),'today'):chip('без срока'),d.priority==='high'?chip('❗ Важное','high'):'')}catch{}},220)});
 const form=h('form',{class:'quick'},h('span',{class:'quick-plus','aria-hidden':'true',text:'+'}),input,preview,h('button',{class:'primary',text:'Добавить'}));
 form.onsubmit=async e=>{
  e.preventDefault();const v=input.value.trim();if(!v)return;
  const note=v.match(/^(?:новая\s+)?(?:(рабоч\S*|личн\S*)\s+)?заметк[аиу]\s*[:—–-]?\s*([\s\S]+)$/i);
  quickFocus=true;
  if(note){const m=note[2].match(/^(.+?)(?:\s+[—–-]\s+|:\s+)([\s\S]+)$/);await act(()=>items('POST',{collection:'notes',title:(m?m[1]:note[2]).slice(0,200),content:m?m[2]:'',category:note[1]&&/^рабоч/i.test(note[1])?'work':pv.cat==='work'?'work':'personal',day:['day','week','month'].includes(pv.view)?pv.date:null}));return}
  try{parsed=await request('/api/parse',{method:'POST',headers:json,body:JSON.stringify({text:v})})}catch{parsed={title:v}}
  await act(()=>items('POST',{collection:'tasks',...defaultsFor(parsed)}));
 };
 if(quickFocus){quickFocus=false;setTimeout(()=>input.focus(),0)}
 const views=segmented(VIEWS.map(([v,l],i)=>({value:v,label:l,count:null,key:i+1})),pv.view,v=>setPv({view:v,sel:null}),'Вид');
 views.querySelectorAll('button').forEach((b,i)=>b.title=VIEWS[i][1]+' — клавиша '+(i+1));
 return h('div',{class:'pl-top'},h('div',{class:'pl-title'},h('h2',{text:'Планер'}),ring),form,views);
}
// Дата и категория по умолчанию: открытый день или «Сегодня», фильтр личное/рабочее.
function defaultsFor(p){
 let due=p.due||null;
 if(!due&&['day','week','month'].includes(pv.view))due=pv.date;
 if(!due&&pv.view==='list'&&pv.list==='today')due=today();
 if(!due&&p.time)due=today();
 return {title:(p.title||'').slice(0,200)||'Без названия',category:p.category||(pv.cat==='work'?'work':'personal'),due,time:p.time||null,priority:p.priority||'normal'};
}

// Левая колонка: категория, умные списки, ритм недели.
function plannerSide(){
 const lists=h('nav',{class:'smart-lists','aria-label':'Списки'},...LISTS.map(([k,label])=>{
  const n=workspace.tasks.filter(x=>inCat(x)&&listFilter(k)(x)).length,on=pv.view==='list'&&pv.list===k;
  return h('button',{type:'button',class:'smart'+(on?' on':'')+(k==='overdue'&&n?' warn':''),'aria-current':on?'true':null,onclick:()=>setPv({view:'list',list:k,sel:null})},h('span',{text:label}),h('span',{class:'seg-count',text:String(n)}));
 }),h('button',{type:'button',class:'smart'+(pv.view==='notes'?' on':''),onclick:()=>setPv({view:'notes',sel:null})},h('span',{text:'Заметки'}),h('span',{class:'seg-count',text:String(workspace.notes.filter(inCat).length)})));
 const cats=segmented([{value:'all',label:'Все'},{value:'personal',label:'🏠 Личные'},{value:'work',label:'💼 Работа'}],pv.cat,v=>setPv({cat:v}),'Категория');
 return h('aside',{class:'pl-side panel'},cats,lists,weekPulse(),
  h('p',{class:'hint keys',text:'Клавиши: N — новое, 1–5 — вид, T — сегодня, ← → — листать, Esc — снять выбор'}));
}
// «Ритм недели»: сколько дел на каждый день текущей недели и какая часть уже сделана.
function weekPulse(){
 const now=new Date(),start=addDays(now,-((now.getDay()+6)%7)),t=today();
 let total=0,done=0;
 const days=['пн','вт','ср','чт','пт','сб','вс'].map((wd,i)=>{const key=ymd(addDays(start,i)),list=workspace.tasks.filter(x=>x.due===key&&inCat(x)),d=list.filter(x=>x.done).length;total+=list.length;done+=d;return {key,wd,n:list.length,d}});
 const max=Math.max(1,...days.map(x=>x.n));
 return h('section',{class:'pulse','aria-label':'Ритм недели'},
  h('div',{class:'pulse-head'},h('span',{text:'Ритм недели'}),h('strong',{text:done+' из '+total})),
  h('div',{class:'pulse-bars'},...days.map(x=>h('button',{type:'button',class:'pulse-day'+(x.key===t?' today':'')+(x.key===pv.date?' selected':''),title:x.wd+': '+x.d+' из '+x.n+' сделано',onclick:()=>openDay(x.key)},
   h('span',{class:'pulse-track'},h('i',{style:'--h:'+(x.n/max*100)+'%;--d:'+(x.n?x.d/x.n*100:0)+'%'})),h('span',{class:'pulse-wd',text:x.wd})))));
}
const plural=(n,[one,few,many])=>{const a=n%10,b=n%100;return a===1&&b!==11?one:a>=2&&a<=4&&(b<10||b>=20)?few:many};
const WD_FULL=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const cap=w=>w?w[0].toUpperCase()+w.slice(1):w;
const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
function openDay(key){const d=fromYmd(key);setPv({date:key,month:new Date(d.getFullYear(),d.getMonth(),1),sel:null})}

function plannerMain(){
 const box=h('section',{class:'pl-main panel'});
 ({list:mainList,day:mainDay,week:mainWeek,month:mainMonth,notes:mainNotes}[pv.view]||mainList)(box);
 return box;
}
function mainList(box){
 const label=Object.fromEntries(LISTS)[pv.list]||'Дела';
 const search=h('input',{type:'search',class:'search',name:'search',placeholder:'Поиск по делам',value:pv.query,'aria-label':'Поиск по делам'});
 const body=h('div',{class:'task-groups'});
 const draw=()=>{
  const q=pv.query.trim().toLocaleLowerCase();
  const list=workspace.tasks.filter(x=>inCat(x)&&listFilter(pv.list)(x)&&(!q||(x.title+' '+(x.content||'')).toLocaleLowerCase().includes(q)));
  if(pv.list==='done')list.sort((a,b)=>String(b.doneAt||'').localeCompare(String(a.doneAt||'')));else list.sort(byAgenda);
  if(!list.length){body.replaceChildren(h('div',{class:'empty-state'},h('div',{class:'empty-fox',text:'🦊'}),h('p',{text:q?'Ничего не найдено.':pv.list==='today'?'На сегодня всё свободно. Добавьте дело строкой сверху.':'Здесь пусто.'})));return}
  if(pv.list==='all'||pv.list==='upcoming'){
   const groups=new Map();for(const x of list){const k=x.due?(x.due<today()?'Просрочено':dayLabel(x.due)):'Без срока';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
   body.replaceChildren(...[...groups].map(([k,rows])=>h('section',{class:'task-group'+(k==='Просрочено'?' g-late':k==='Сегодня'?' g-today':'')},h('h3',{},k,h('span',{class:'seg-count',text:String(rows.length)})),...rows.map(x=>taskRow(x,{showDate:k==='Просрочено'})))));
  }else body.replaceChildren(h('section',{class:'task-group'},...list.map(x=>taskRow(x))));
 };
 search.addEventListener('input',()=>{pv.query=search.value;draw()});
 draw();
 box.append(h('div',{class:'main-head'},h('h3',{text:label}),search),body);
}
// Шапка листания для дня, недели, месяца.
// current: открыт ли уже текущий день/неделя/месяц — тогда кнопка «Сегодня» не нужна.
function pager(title,step,current){
 return h('div',{class:'main-head'},h('div',{class:'cal-nav'},
  h('button',{type:'button',class:'icon-btn','aria-label':'Назад',onclick:()=>step(-1)},'‹'),
  h('strong',{class:'cal-title',text:title}),
  h('button',{type:'button',class:'icon-btn','aria-label':'Вперёд',onclick:()=>step(1)},'›'),
  current?null:h('button',{type:'button',class:'chip-btn',text:'Сегодня',title:'Вернуться к сегодняшнему дню (T)',onclick:()=>{const d=new Date();setPv({date:today(),month:new Date(d.getFullYear(),d.getMonth(),1)})}})));
}
function shiftDate(days){const d=addDays(fromYmd(pv.date),days);setPv({date:ymd(d),month:new Date(d.getFullYear(),d.getMonth(),1),sel:null})}
function mainDay(box){
 const date=pv.date,d=fromYmd(date),tasks=workspace.tasks.filter(x=>x.due===date&&inCat(x)).sort(byAgenda);
 const title=dayLabel(date)+(['Сегодня','Завтра','Вчера'].includes(dayLabel(date))?', '+d.getDate()+' '+MONTHS_GEN[d.getMonth()]:'');
 box.append(pager(title,n=>shiftDate(n),date===today()));
 const allDay=dropTarget(h('div',{class:'allday'},h('span',{class:'slot-label',text:'Весь день'}),h('div',{class:'slot-items'},...tasks.filter(x=>!x.time).map(x=>taskRow(x,{compact:true,showDate:false})))),()=>({due:date,time:null}));
 const hours=h('div',{class:'timeline'});
 const timed=tasks.filter(x=>x.time),firstHour=Math.min(7,...timed.map(x=>Number(x.time.slice(0,2))));
 const now=new Date(),isToday=date===today();
 for(let hr=firstHour;hr<24;hr++){
  const hh=String(hr).padStart(2,'0'),inHour=timed.filter(x=>x.time.slice(0,2)===hh);
  const slot=dropTarget(h('div',{class:'slot'+(isToday&&now.getHours()===hr?' now':'')+(isToday&&hr<now.getHours()?' past':'')},h('span',{class:'slot-label',text:hh+':00'}),h('div',{class:'slot-items'},...inHour.map(x=>taskRow(x,{compact:true,showDate:false})))),()=>({due:date,time:hh+':00'}));
  if(isToday&&now.getHours()===hr)slot.style.setProperty('--now',(now.getMinutes()/60*100)+'%');
  hours.append(slot);
 }
 box.append(allDay,hours,h('p',{class:'hint',text:'Перетащите дело на час, чтобы назначить время, или в «Весь день», чтобы убрать время.'}));
}
function mainWeek(box){
 const d=fromYmd(pv.date),start=addDays(d,-((d.getDay()+6)%7)),end=addDays(start,6),t=today();
 const title=start.getDate()+' '+(start.getMonth()!==end.getMonth()?MONTHS_GEN[start.getMonth()]+' ':'')+'– '+end.getDate()+' '+MONTHS_GEN[end.getMonth()];
 box.append(pager(title,n=>shiftDate(7*n),t>=ymd(start)&&t<=ymd(end)));
 const cols=h('div',{class:'week'});
 for(let i=0;i<7;i++){
  const day=addDays(start,i),key=ymd(day),list=workspace.tasks.filter(x=>x.due===key&&inCat(x)).sort(byAgenda);
  cols.append(dropTarget(h('div',{class:'week-col'+(key===t?' today':'')+(key===pv.date?' selected':'')},
   h('button',{type:'button',class:'week-head',onclick:()=>setPv({date:key,sel:null})},h('span',{text:WD[day.getDay()]}),h('strong',{text:String(day.getDate())})),
   h('div',{class:'week-items'},...list.map(x=>taskRow(x,{compact:true,showDate:false})))),()=>({due:key})));
 }
 box.append(cols);
}
function mainMonth(box){
 const sel=fromYmd(pv.date);pv.month??=new Date(sel.getFullYear(),sel.getMonth(),1);
 const m=pv.month,first=new Date(m.getFullYear(),m.getMonth(),1),start=addDays(first,-((first.getDay()+6)%7)),t=today();
 const byDay=new Map();for(const x of workspace.tasks)if(x.due&&inCat(x)){if(!byDay.has(x.due))byDay.set(x.due,[]);byDay.get(x.due).push(x)}
 const notesByDay=new Set(workspace.notes.filter(n=>n.day).map(n=>n.day));
 const cap=w=>w[0].toUpperCase()+w.slice(1);
 box.append(pager(cap(MONTHS[m.getMonth()])+' '+m.getFullYear(),n=>setPv({month:new Date(m.getFullYear(),m.getMonth()+n,1)}),t.slice(0,7)===ymd(m).slice(0,7)));
 const grid=h('div',{class:'cal-grid'},...['пн','вт','ср','чт','пт','сб','вс'].map(d=>h('div',{class:'cal-wd',text:d})));
 for(let i=0;i<42;i++){
  const d=addDays(start,i),key=ymd(d),list=(byDay.get(key)||[]).sort(byAgenda);
  if(i>=35&&d.getMonth()!==m.getMonth())break;
  const late=list.some(x=>!x.done&&key<t);
  grid.append(dropTarget(h('button',{type:'button',class:'cal-day'+(d.getMonth()!==m.getMonth()?' other':'')+(key===t?' today':'')+(key===pv.date?' selected':'')+(d.getDay()===0||d.getDay()===6?' weekend':'')+(late?' late':''),
   'aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(list.length?', дел: '+list.length:''),onclick:()=>setPv({date:key,sel:null})},
   h('span',{class:'cal-num'},String(d.getDate()),notesByDay.has(key)?h('i',{class:'note-dot',title:'Есть заметка'}):null),
   h('span',{class:'cal-pills'},...list.slice(0,3).map(x=>h('span',{class:'cal-pill cat-'+catOf(x)+(x.done?' done':'')+(x.priority==='high'?' high':''),text:(x.time?x.time+' ':'')+x.title}))),
   list.length>3?h('span',{class:'cal-more',text:'+'+(list.length-3)}):null,
   list.length?h('span',{class:'cal-dots'},...list.slice(0,5).map(x=>h('i',{class:'cat-'+catOf(x)+(x.done?' done':'')}))):null),()=>({due:key})));
 }
 box.append(grid);
}
function mainNotes(box){
 const search=h('input',{type:'search',class:'search',name:'search',placeholder:'Поиск по заметкам',value:pv.query,'aria-label':'Поиск по заметкам'});
 const grid=h('div',{class:'note-grid'});
 const draw=()=>{
  const q=pv.query.trim().toLocaleLowerCase();
  const list=workspace.notes.filter(x=>inCat(x)&&(!q||(x.title+' '+(x.content||'')).toLocaleLowerCase().includes(q)))
   .sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  grid.replaceChildren(...(list.length?list.map(noteCard):[h('div',{class:'empty-state'},h('div',{class:'empty-fox',text:'📜'}),h('p',{text:q?'Ничего не найдено.':'Заметок пока нет. Напишите сверху «заметка: Идея — текст».'}))]));
 };
 search.addEventListener('input',()=>{pv.query=search.value;draw()});
 draw();
 box.append(h('div',{class:'main-head'},h('h3',{text:'Заметки'}),search,h('button',{type:'button',class:'primary',text:'+ Заметка',onclick:()=>{pv.sel={type:'note',id:'new'};render()}})),grid);
}
function noteCard(note){
 const c=catOf(note),sel=pv.sel?.type==='note'&&pv.sel.id===note.id;
 return h('article',{class:'note-card cat-'+c+(note.pinned?' pinned':'')+(sel?' selected':''),tabindex:'0',onclick:()=>selectItem('note',note.id),onkeydown:e=>{if(e.key==='Enter')selectItem('note',note.id)}},
  h('header',{},chip(CAT[c].icon+' '+CAT[c].label,'cat-'+c),
   h('button',{type:'button',class:'icon-btn pin'+(note.pinned?' on':''),'aria-label':note.pinned?'Открепить':'Закрепить',title:note.pinned?'Открепить':'Закрепить',onclick:e=>{e.stopPropagation();act(()=>items('PATCH',{collection:'notes',id:note.id,pinned:!note.pinned}))}},'📌')),
  h('h4',{text:note.title}),note.content?h('p',{class:'note-text',text:note.content}):null,
  h('footer',{},h('span',{class:'muted',text:(note.day?'📅 '+dayLabel(note.day)+' · ':'')+new Date(note.updatedAt||note.createdAt||Date.now()).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})})));
}

// Правая колонка: живой календарь сверху, под ним повестка выбранного дня или карточка дела/заметки.
function plannerRight(){
 return h('div',{class:'pl-right'},calendarDock(),plannerDetail());
}
function calendarDock(){
 const t=today(),sel=fromYmd(pv.date);pv.month??=new Date(sel.getFullYear(),sel.getMonth(),1);
 const load=new Map(),cats=new Map(),high=new Set();
 for(const x of workspace.tasks)if(x.due&&inCat(x)){
  if(!x.done){load.set(x.due,(load.get(x.due)||0)+1);if(x.priority==='high')high.add(x.due)}
  if(!cats.has(x.due))cats.set(x.due,new Set());cats.get(x.due).add(catOf(x));
 }
 const noteDays=new Set(workspace.notes.filter(n=>n.day&&inCat(n)).map(n=>n.day));
 const lvl=n=>n>=4?3:n>=2?2:n?1:0;
 const day=(d,other)=>{
  const key=ymd(d),n=load.get(key)||0;
  return dropTarget(h('button',{type:'button',class:'dk-day lv'+lvl(n)+(other?' other':'')+(key===t?' today':'')+(key===pv.date?' selected':'')+(key<t&&n?' late':'')+(d.getDay()%6===0?' weekend':''),
   'aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(n?', открытых дел: '+n:''),'aria-pressed':key===pv.date?'true':'false',onclick:()=>openDay(key)},
   h('span',{class:'dk-num',text:String(d.getDate())}),
   h('span',{class:'dk-marks'},...[...(cats.get(key)||[])].map(c=>h('i',{class:'cat-'+c})),noteDays.has(key)?h('i',{class:'note'}):null,high.has(key)?h('i',{class:'hot'}):null)),()=>({due:key}));
 };
 // Месяц или неделя: переключатель запоминается (на телефоне по умолчанию — неделя).
 const mode=(pv.calMode||(innerWidth<900?'week':'month'))==='week'?'week':'month';
 const modeSwitch=()=>h('div',{class:'dk-mode',role:'group','aria-label':'Масштаб календаря'},...[['month','Месяц'],['week','Неделя']].map(([v,l])=>h('button',{type:'button',class:v===mode?'on':'','aria-pressed':v===mode?'true':'false',text:l,onclick:()=>{pv.calMode=v;savePv();if(v==='month')pv.month=new Date(sel.getFullYear(),sel.getMonth(),1);render()}})));
 // Шапка: большая дата и короткая сводка дня.
 const dayTasks=workspace.tasks.filter(x=>x.due===pv.date&&inCat(x)),open=dayTasks.filter(x=>!x.done),rel=dayLabel(pv.date);
 const timed=open.filter(x=>x.time).sort((a,b)=>a.time.localeCompare(b.time));
 let summary=open.length?open.length+' '+plural(open.length,['дело','дела','дел']):dayTasks.length?'Всё сделано ✨':'Свободный день';
 if(pv.date===t&&timed.length){const now=new Date(),cur=now.getHours()*60+now.getMinutes(),next=timed.find(x=>mins(x.time)>=cur);if(next){const left=mins(next.time)-cur;summary+=' · следующее '+(left<60?'через '+left+' мин':'в '+next.time)}}
 const isRel=['Сегодня','Завтра','Вчера'].includes(rel);
 const hero=h('div',{class:'dk-hero'+(pv.date===t?' is-today':'')},
  h('div',{class:'dk-big','aria-hidden':'true',text:String(sel.getDate())}),
  h('div',{class:'dk-when'},h('strong',{text:isRel?rel:cap(WD_FULL[sel.getDay()])}),h('span',{text:(isRel?WD_FULL[sel.getDay()]+', ':'')+sel.getDate()+' '+MONTHS_GEN[sel.getMonth()]+' '+sel.getFullYear()}),h('span',{class:'dk-sum',text:summary})),
  h('div',{class:'dk-side'},pv.date!==t?h('button',{type:'button',class:'chip-btn dk-today',text:'Сегодня',title:'Вернуться к сегодняшнему дню (T)',onclick:()=>openDay(t)}):null));
 const m=pv.month,step=n=>{if(mode==='week'){openDay(ymd(addDays(sel,7*n)))}else setPv({month:new Date(m.getFullYear(),m.getMonth()+n,1)})};
 const weekStart=addDays(sel,-((sel.getDay()+6)%7));
 const title=mode==='week'?weekStart.getDate()+' – '+addDays(weekStart,6).getDate()+' '+MONTHS_GEN[addDays(weekStart,6).getMonth()]:cap(MONTHS[m.getMonth()])+' '+m.getFullYear();
 const bar=h('div',{class:'dk-bar'},
  h('strong',{class:'dk-title',text:title}),
  h('button',{type:'button',class:'icon-btn','aria-label':mode==='week'?'Предыдущая неделя':'Предыдущий месяц',onclick:()=>step(-1)},'‹'),
  h('button',{type:'button',class:'icon-btn','aria-label':mode==='week'?'Следующая неделя':'Следующий месяц',onclick:()=>step(1)},'›'),modeSwitch());
 const grid=h('div',{class:'dk-grid'+(mode==='week'?' is-week':'')},...['пн','вт','ср','чт','пт','сб','вс'].map((d,i)=>h('span',{class:'dk-wd'+(i>4?' weekend':''),text:d})));
 if(mode==='week')for(let i=0;i<7;i++)grid.append(day(addDays(weekStart,i),false));
 else{const first=new Date(m.getFullYear(),m.getMonth(),1),start=addDays(first,-((first.getDay()+6)%7));
  for(let i=0;i<42;i++){const d=addDays(start,i);if(i>=35&&d.getMonth()!==m.getMonth())break;grid.append(day(d,d.getMonth()!==m.getMonth()))}}
 const legend=h('div',{class:'dk-legend','aria-hidden':'true'},h('span',{},h('i',{class:'cat-personal'}),'личное'),h('span',{},h('i',{class:'cat-work'}),'работа'),h('span',{},h('i',{class:'note'}),'заметка'),h('span',{},h('i',{class:'heat'}),'загрузка'));
 return h('section',{class:'pl-cal panel','aria-label':'Календарь'},hero,bar,grid,legend);
}

// Под календарём: выбранное дело или заметка; иначе — повестка выбранного дня и «Заметка дня».
function plannerDetail(){
 const box=h('aside',{class:'pl-detail panel'});
 const sel=pv.sel;
 if(sel?.type==='task'){const task=workspace.tasks.find(x=>x.id===sel.id);if(task){box.append(detailHead('Дело'),taskForm(task),h('div',{class:'row detail-actions'},
  h('button',{type:'button',text:task.done?'Вернуть в работу':'✓ Готово',onclick:e=>toggleDone(task,e)}),
  h('button',{type:'button',text:'На завтра',onclick:()=>act(()=>items('PATCH',{collection:'tasks',id:task.id,due:ymd(addDays(new Date(),1))}))}),
  h('button',{type:'button',class:'danger-btn',text:'Удалить',onclick:()=>removeWithUndo('tasks',task)})),
  h('p',{class:'hint',text:'Создано '+new Date(task.createdAt||Date.now()).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}));return box}}
 if(sel?.type==='note'){const note=sel.id==='new'?null:workspace.notes.find(x=>x.id===sel.id);if(note||sel.id==='new'){box.append(detailHead(note?'Заметка':'Новая заметка'),noteForm(note,{day:sel.day||null}));if(note)box.append(h('div',{class:'row detail-actions'},h('button',{type:'button',class:'danger-btn',text:'Удалить',onclick:()=>removeWithUndo('notes',note)})));return box}}
 return dayPanel(box);
}
function detailHead(title){return h('div',{class:'detail-head'},h('h3',{text:title}),h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть',title:'Закрыть (Esc)',onclick:()=>{pv.sel=null;render()}},svg('i-close')))}
function taskForm(task){
 const name='cat-'+task.id;
 const title=h('input',{name:'title',required:true,maxLength:200,value:task.title,'aria-label':'Название дела'});
 const date=h('input',{type:'date',name:'due',value:task.due||'','aria-label':'Дата'});
 const time=h('input',{type:'time',name:'time',value:task.time||'','aria-label':'Время'});
 const prio=h('select',{name:'priority','aria-label':'Важность'},...Object.entries(PRIO).map(([k,v])=>h('option',{value:k,text:v,selected:(task.priority||'normal')===k})));
 const notes=h('textarea',{name:'content',placeholder:'Подробности, ссылки, шаги…',value:task.content||'',rows:4,'aria-label':'Подробности'});
 const quick=h('div',{class:'quick-dates'},...[['Сегодня',0],['Завтра',1],['Через неделю',7]].map(([l,n])=>h('button',{type:'button',class:'chip-btn',text:l,onclick:()=>{date.value=ymd(addDays(new Date(),n))}})),h('button',{type:'button',class:'chip-btn',text:'Без срока',onclick:()=>{date.value='';time.value=''}}));
 const form=h('form',{class:'task-form'},title,categoryPicker(name,catOf(task)),h('div',{class:'task-form-when'},date,time,prio),quick,notes,h('button',{class:'primary',text:'Сохранить'}));
 form.onsubmit=e=>{e.preventDefault();const f={title:title.value,category:form.querySelector('input[name="'+name+'"]:checked')?.value||'personal',due:date.value||null,time:time.value||null,priority:prio.value,content:notes.value};if(f.time&&!f.due)f.due=today();act(()=>items('PATCH',{collection:'tasks',id:task.id,...f}))};
 return form;
}
function noteForm(note,{day=null}={}){
 const name='ncat-'+(note?note.id:'new');
 const title=h('input',{required:true,maxLength:200,placeholder:'Заголовок',value:note?note.title:'','aria-label':'Заголовок'});
 const content=h('textarea',{placeholder:'Текст заметки. Строки «FACT: субъект | связь | объект» попадут в память.',value:note?note.content||'':'',rows:10,'aria-label':'Текст'});
 const dayInput=h('input',{type:'date',value:note?note.day||'':day||'','aria-label':'День заметки',title:'Привязать к дню'});
 const form=h('form',{class:'note-form'},title,categoryPicker(name,note?catOf(note):(pv.cat==='work'?'work':'personal')),content,h('label',{class:'inline-field'},h('span',{text:'День'}),dayInput),h('button',{class:'primary',text:note?'Сохранить':'Создать заметку'}));
 form.onsubmit=e=>{e.preventDefault();const f={title:title.value,content:content.value,category:form.querySelector('input[name="'+name+'"]:checked')?.value||'personal',day:dayInput.value||null};
  act(async()=>{if(note)await items('PATCH',{collection:'notes',id:note.id,...f});else{const made=await items('POST',{collection:'notes',...f});pv.sel={type:'note',id:made.id}}})};
 return form;
}
const journalTitle=date=>'Дневник · '+fromYmd(date).getDate()+' '+MONTHS_GEN[fromYmd(date).getMonth()]+' '+fromYmd(date).getFullYear();
// Повестка дня: «весь день» сверху, дальше дела по времени на линии, отметка «сейчас» и свободные окна.
function dayAgenda(date){
 const tasks=workspace.tasks.filter(x=>x.due===date&&inCat(x)).sort(byAgenda);
 const allDay=tasks.filter(x=>!x.time),timed=tasks.filter(x=>x.time).sort((a,b)=>a.time.localeCompare(b.time));
 const wrap=dropTarget(h('div',{class:'agenda'}),()=>({due:date}));
 if(!tasks.length){wrap.append(h('div',{class:'agenda-empty'},h('span',{class:'empty-fox',text:'🦊'}),h('p',{text:'Свободный день. Перетащите сюда дело или напишите его в строке сверху.'})));return wrap}
 if(allDay.length)wrap.append(h('div',{class:'agenda-allday'},h('span',{class:'agenda-label',text:'Весь день'}),...allDay.map(x=>taskRow(x,{compact:true,showDate:false}))));
 if(!timed.length)return wrap;
 const isToday=date===today(),now=new Date(),cur=now.getHours()*60+now.getMinutes(),nowText=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
 const nowMark=()=>h('li',{class:'agenda-now'},h('time',{text:nowText}),h('span',{text:'сейчас'}));
 const rail=h('ol',{class:'agenda-rail'});
 let prev=null,nowShown=!isToday;
 for(const x of timed){
  const at=mins(x.time);
  if(prev!==null){const gap=at-prev-60;if(gap>=60)rail.append(h('li',{class:'agenda-gap',text:'свободно '+(gap>=120?Math.floor(gap/60)+' ч'+(gap%60?' '+gap%60+' мин':''):gap+' мин')}))}
  if(!nowShown&&at>cur){rail.append(nowMark());nowShown=true}
  rail.append(h('li',{class:'agenda-slot'+(isToday&&at+60<=cur?' past':'')+(isToday&&at<=cur&&cur<at+60?' current':'')},h('time',{text:x.time}),taskRow(x,{compact:true,showDate:false,time:false})));
  prev=at;
 }
 if(!nowShown)rail.append(nowMark());
 wrap.append(rail);
 return wrap;
}
// Сохранение «Заметки дня» живёт вне панели: перерисовка не теряет черновик и не создаёт вторую запись.
const journals=new Map();
function journalFor(date){
 if(!journals.has(date))journals.set(date,{id:null,draft:null,timer:null,saving:Promise.resolve()});
 const j=journals.get(date);j.id??=workspace.notes.find(n=>n.day===date&&n.title.startsWith('Дневник'))?.id||null;return j;
}
function saveJournal(date,text,onState){
 const j=journalFor(date);j.draft=text;clearTimeout(j.timer);onState('…');
 j.timer=setTimeout(()=>{j.saving=j.saving.then(async()=>{
  const value=j.draft;
  try{if(j.id)await items('PATCH',{collection:'notes',id:j.id,content:value});else if(value.trim()){const made=await items('POST',{collection:'notes',title:journalTitle(date),content:value,day:date});j.id=made.id}
   const w=await request('/api/workspace');workspace=w;workspace.notes??=[];workspace.tasks??=[];
   if(j.draft===value)j.draft=null;onState('Сохранено')}catch(e){onState('Ошибка: '+e.message)}})},900);
}
function dayPanel(box){
 const date=pv.date,tasks=workspace.tasks.filter(x=>x.due===date&&inCat(x));
 const journal=workspace.notes.find(n=>n.day===date&&n.title.startsWith('Дневник')),dayNotes=workspace.notes.filter(n=>n.day===date&&n!==journal);
 const done=tasks.filter(x=>x.done).length;
 box.append(h('div',{class:'detail-head'},h('h3',{text:'Повестка'}),tasks.length?h('span',{class:'agenda-count',text:done+' / '+tasks.length}):null));
 box.append(dayAgenda(date));
 // «Заметка дня» сохраняется сама через секунду после ввода.
 const j=journalFor(date);
 const area=h('textarea',{class:'journal',rows:4,placeholder:'Мысли, итоги, что получилось сегодня…',value:j.draft??(journal?journal.content||'':''),'aria-label':'Заметка дня'});
 const state=h('span',{class:'hint',text:j.draft!=null?'…':journal?'Сохранено':''});
 area.addEventListener('input',()=>saveJournal(date,area.value,t=>{if(state.isConnected)state.textContent=t;else if(pv.date===date)document.querySelector('.journal-head .hint')?.replaceChildren(t)}));
 box.append(h('div',{class:'journal-head'},h('h4',{class:'side-sub',text:'Заметка дня'}),state),area);
 if(dayNotes.length)box.append(h('h4',{class:'side-sub',text:'Заметки этого дня'}),...dayNotes.map(n=>h('button',{type:'button',class:'note-link',onclick:()=>selectItem('note',n.id)},'📜 '+n.title)));
 box.append(h('button',{type:'button',class:'chip-btn add-note',text:'+ заметка к этому дню',onclick:()=>{pv.sel={type:'note',id:'new',day:date};render()}}));
 return box;
}
// Горячие клавиши планера.
document.addEventListener('keydown',e=>{
 if(page!=='planner'||e.ctrlKey||e.metaKey||e.altKey)return;
 const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable;
 if(e.key==='Escape'){if(typing){document.activeElement.blur();return}if(pv.sel){pv.sel=null;render()}return}
 if(typing)return;
 const k=e.key.toLowerCase();
 if(k==='n'||k==='т'){e.preventDefault();document.querySelector('.quick-input')?.focus()}
 else if(/^[1-5]$/.test(k))setPv({view:VIEWS[Number(k)-1][0],sel:null});
 else if(k==='t'||k==='е'){const d=new Date();setPv({date:today(),month:new Date(d.getFullYear(),d.getMonth(),1)})}
 else if(k==='/'){e.preventDefault();document.querySelector('.pl-main .search')?.focus()}
 else if((k==='arrowleft'||k==='arrowright')&&['day','week','month'].includes(pv.view)){const s=k==='arrowleft'?-1:1;if(pv.view==='month'){const m=pv.month;setPv({month:new Date(m.getFullYear(),m.getMonth()+s,1)})}else shiftDate(pv.view==='week'?7*s:s)}
});

/* ---------- Мозг (brain.js) ---------- */
// render() вызывается и при фоновом обновлении: живой холст переносится без пересоздания
// (brain.js сам слушает tenma:workspace). После ухода со страницы холст останавливается сам.
let brainHost=null;
function renderBrain(alive){
 if(!alive){brainHost=h('div',{class:'brain'});if(window.TenmaBrain)window.TenmaBrain.mount(brainHost);else brainHost.append(element('p','Не удалось загрузить визуализацию.','muted'))}
 root.append(brainHost);
}

/* ---------- Настройки ---------- */
function renderSettings(){
 const btn=(text,fn,cls)=>h('button',{type:'button',class:cls,text,onclick:fn});
 const av=h('div',{class:'panel'},h('h3',{text:'Аватар'}),h('p',{class:'muted',text:'Поза, размер, цвет, свечение, парение, частицы, поведение и инструменты (что она умеет делать). Настройки сохраняются в этом браузере.'}),
  h('div',{class:'row'},btn('Настроить аватар',()=>window.TenmaAvatar?.openSettings(),'primary'),btn('Инструменты аватара',()=>window.TenmaAvatar?.openSettings('tools')),btn('Модель ИИ (Cloud.ru)',()=>window.TenmaAvatar?.openSettings('model')),btn('Показать / скрыть',()=>window.TenmaAvatar?.toggleVisible()),btn('Вернуть на место',()=>window.TenmaAvatar?.resetPosition())));
 const box=h('div',{class:'panel'},h('h3',{text:'Конфиденциальность'}),h('p',{text:'Данные хранятся в data/tenmayurika.sqlite на переносном SSD. Векторы — в data/vectors. Ключ модели хранится только в data/llm-settings.json на этом компьютере.'}));
 const output=h('pre',{text:'Проверка не запускалась'});
 const health=h('div',{class:'panel'},h('h3',{text:'Переносная память'}),btn('Проверить SQLite / LanceDB / граф',async()=>{try{output.textContent=JSON.stringify(await request('/api/services'),null,2)}catch(e){output.textContent=e.message}}),output);
 root.append(h('div',{class:'grid-2'},av,box),health);
}

/* ---------- Факты ---------- */
function factRow(fact){const row=element('div','','item'),detail=element('div');const subject=element('button',fact.subject,'link');subject.onclick=()=>loadFacts('/api/facts/relations?subject='+encodeURIComponent(fact.subject),'Связи: '+fact.subject);detail.append(subject,element('span',' — '+fact.predicate+' → '+fact.object),element('p',(fact.valid_to?'В истории: отставлен '+new Date(fact.valid_to).toLocaleString()+' · ':'')+'Источник: '+fact.source_id+' · уверенность '+fact.confidence+' · '+new Date(fact.observed_at).toLocaleString(),'muted'));if(fact.valid_to)row.style.opacity='.55';row.append(detail);return row}
let factList,factCaption;
async function loadFacts(url,caption){factCaption.textContent=caption;factList.replaceChildren(element('p','Загрузка...','muted'));try{const facts=await request(url);factList.replaceChildren(...(facts.length?facts.map(factRow):[element('p','Фактов не найдено.','muted')]))}catch(e){factList.replaceChildren(element('p',e.message,'muted'))}}
function renderFacts(){
 const add=element('div','','panel'),form=document.createElement('form');
 const inputs=['Субъект (например, Анна)','Связь (например, работает в)','Объект (например, Tenmayurika)'].map(text=>{const input=document.createElement('input');input.required=true;input.placeholder=text;return input});
 form.append(...inputs,element('button','Запомнить факт','primary'));
 form.onsubmit=async e=>{e.preventDefault();try{const r=await request('/api/facts',{method:'POST',headers:json,body:JSON.stringify({subject:inputs[0].value,predicate:inputs[1].value,object:inputs[2].value})});inputs.forEach(i=>i.value='');if(r.duplicate)alert('Такой факт уже есть.');else if(r.conflicts)alert('Факт сохранён, но противоречит прежним: '+r.conflicts);loadFacts('/api/facts','Последние факты')}catch(err){alert(err.message)}};
 add.append(element('p','Можно также писать в заметках строки «FACT: субъект | связь | объект».','muted'),form);
 const search=element('div','','panel'),find=document.createElement('form'),query=document.createElement('input');query.placeholder='Поиск по фактам';find.append(query);
 find.onsubmit=e=>{e.preventDefault();query.value.trim()?loadFacts('/api/facts?q='+encodeURIComponent(query.value),'Поиск: '+query.value):loadFacts('/api/facts','Последние факты')};
 const conflictsButton=element('button','Показать противоречия');conflictsButton.onclick=async()=>{factCaption.textContent='Противоречия';try{const rows=await request('/api/facts/conflicts');factList.replaceChildren(...(rows.length?rows.map(c=>{const row=element('div','','item');row.append(element('div',c.subject+' — '+c.predicate+': «'+c.earlier+'» ('+c.earlier_source+') или «'+c.newer+'» ('+c.newer_source+')'));return row}):[element('p','Противоречий нет.','muted')]))}catch(e){factList.replaceChildren(element('p',e.message,'muted'))}};
 conflictsButton.style.marginTop='12px';search.append(find,conflictsButton);
 const list=element('div','','panel');factCaption=element('h3','');factList=element('div');list.append(factCaption,factList);
 root.append(add,search,list);loadFacts('/api/facts','Последние факты');
}

// Старые адреса разделов (аватар: «открой дела», «открой календарь») ведут в нужный вид планера.
const ALIASES={tasks:{view:'list'},notes:{view:'notes'},calendar:{view:'month'}};
function go(next){if(ALIASES[next]){Object.assign(pv,ALIASES[next],{sel:null});savePv();next='planner'}if(!TITLES[next])next='home';page=next;document.querySelectorAll('.rail button[data-page]').forEach(b=>{const on=b.dataset.page===page;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});render();window.scrollTo({top:0})}
document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.page)}));
window.TenmaApp={refresh,go,select:selectItem,get workspace(){return workspace}};refresh();


/* Личная библиотека: файлы находятся на том же диске, что и проект. */
let libraryPath='';
function renderLibrary(){
 const state=h('p',{class:'muted',text:'Загрузка библиотеки…'}),listing=h('div'),searchResults=h('div');
 const location=h('p',{class:'muted'});
 const name=h('input',{type:'text',placeholder:'Название новой папки','aria-label':'Название новой папки',maxlength:180});
 const folderForm=h('form',{},name,h('button',{type:'submit',text:'Создать папку'}));
 const uploadInput=h('input',{type:'file','aria-label':'Выберите файл'});
 const uploadButton=h('button',{type:'button',text:'Загрузить файл'});
 const searchInput=h('input',{type:'search',placeholder:'Название файла или папки','aria-label':'Поиск в библиотеке'});
 const answerSource=h('input',{type:'text',placeholder:'Весь архив — или путь к выбранному файлу','aria-label':'Источник ответа'});
 const searchForm=h('form',{},searchInput,h('button',{type:'submit',text:'Найти во всей библиотеке'}));
 const textSearch=h('button',{type:'button',text:'Найти в тексте файлов'});
 const indexedSearch=h('button',{type:'button',text:'Быстрый поиск по индексу'});
 const answerSearch=h('button',{type:'button',text:'Ответить по документам'});
 const duplicateSearch=h('button',{type:'button',text:'Найти одинаковые файлы'});
 const documentInfo=h('div');
 const organizeList=h('div'),organizePlan=h('button',{type:'button',text:'Предложить порядок'}),organizeApply=h('button',{type:'button',text:'Переместить выбранные'});let organizationChoices=[];
 const tablePaths=h('textarea',{placeholder:'Пути к XLSX: по одному на строку','aria-label':'Книги Excel для обзора'}),tableResult=h('div'),tableForm=h('form',{},tablePaths,h('button',{type:'submit',text:'Показать листы и строки'}));
 const journalList=h('div'),journalRefresh=h('button',{type:'button',text:'Обновить журнал'});
 const versionsList=h('div'),versionsRefresh=h('button',{type:'button',text:'Обновить версии'});
 const healthInfo=h('div'),healthButton=h('button',{type:'button',text:'Проверить библиотеку'});
 const collectionList=h('div'),collectionChoice=h('select',{'aria-label':'Подборка'}),collectionName=h('input',{placeholder:'Название подборки','aria-label':'Название подборки'}),collectionForm=h('form',{},collectionName,h('button',{type:'submit',text:'Создать подборку'}));
 const memoList=h('div'),memoSource=h('input',{placeholder:'Источник: путь к файлу','aria-label':'Источник записи'}),memoText=h('textarea',{placeholder:'Текст заметки или дела','aria-label':'Текст заметки или дела',maxlength:2000}),memoKind=h('select',{'aria-label':'Вид записи'},h('option',{value:'note',text:'Заметка'}),h('option',{value:'task',text:'Дело'})),memoDue=h('input',{type:'date','aria-label':'Срок дела'}),memoTime=h('input',{type:'time','aria-label':'Время напоминания'}),memoForm=h('form',{},memoSource,memoKind,memoText,memoDue,memoTime,h('button',{type:'submit',text:'Сохранить запись'}));
 const memoNotify=h('button',{type:'button',text:'Разрешить системные уведомления',onclick:async()=>{if(!('Notification' in window)){memoList.textContent='Системные уведомления недоступны; напоминание появится внутри открытого проекта.';return}const permission=await Notification.requestPermission();memoList.textContent=permission==='granted'?'Системные уведомления разрешены.':'Системные уведомления не разрешены; напоминание появится внутри открытого проекта.'}});
 const factList=h('div'),factProposals=h('div'),factSource=h('input',{placeholder:'Источник: путь к документу','aria-label':'Источник факта'}),factSubject=h('input',{placeholder:'Кто или что','aria-label':'Субъект'}),factPredicate=h('input',{placeholder:'Связь','aria-label':'Связь факта'}),factObject=h('input',{placeholder:'Значение','aria-label':'Значение факта'}),factQuote=h('textarea',{placeholder:'Фрагмент документа (необязательно)','aria-label':'Фрагмент документа',maxlength:500}),factForm=h('form',{},factSource,factSubject,factPredicate,factObject,factQuote,h('button',{type:'submit',text:'Подтвердить факт'}));
 const linkList=h('div'),linkGraph=h('div'),linkA=h('input',{placeholder:'Первый файл','aria-label':'Первый файл для связи'}),linkB=h('input',{placeholder:'Второй файл','aria-label':'Второй файл для связи'}),linkLabel=h('input',{placeholder:'Как связаны (необязательно)','aria-label':'Описание связи'}),linkForm=h('form',{},linkA,linkB,linkLabel,h('button',{type:'submit',text:'Связать файлы'}));
 const queueInfo=h('div'),queueRefresh=h('button',{type:'button',text:'Обновить очередь'}),queueToggle=h('button',{type:'button',text:'Фоновая обработка'});let queueEnabled=true;
 const compareLeft=h('input',{placeholder:'Первый файл: папка/имя.txt','aria-label':'Первый файл'}),compareRight=h('input',{placeholder:'Второй файл: папка/имя.txt','aria-label':'Второй файл'});
 const compareForm=h('form',{},compareLeft,compareRight,h('button',{type:'submit',text:'Сравнить файлы'}));
 function showEntries(target,entries,search=false){
  target.replaceChildren(...(entries.length?entries.map(item=>{
   const row=h('div',{class:'item'}),title=h('strong',{text:(item.type==='folder'?'Папка: ':'Файл: ')+item.name});
   const detail=h('p',{class:'muted',text:(search?'Путь: '+item.path+' · ':'')+(item.type==='file'?Math.ceil(item.size/1024)+' КБ · ':'')+'Изменён: '+new Date(item.modified).toLocaleString('ru-RU')});
   const action=item.type==='folder'?h('button',{type:'button',text:'Открыть',onclick:()=>{libraryPath=item.path;void load()}}):h('a',{href:'/api/library/download?path='+encodeURIComponent(item.path),text:'Скачать'});
   row.append(h('div',{},title,detail),action);if(item.type==='file'){if(/\.xlsx$/i.test(item.name))row.append(h('button',{type:'button',text:'Добавить в обзор таблиц',onclick:()=>{const files=tablePaths.value.split('\n').map(x=>x.trim()).filter(Boolean);if(!files.includes(item.path))files.push(item.path);tablePaths.value=files.join('\n');state.textContent='Книга добавлена в обзор. Откройте раздел «Обзор таблиц».'}}));row.append(h('button',{type:'button',text:'Создать запись',onclick:async()=>{memoSource.value=item.path;memoText.value='';if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name)){try{const d=await request('/api/library/summary?path='+encodeURIComponent(item.path));memoText.value=d.summary[0]||''}catch{}}state.textContent='Источник выбран. Проверьте текст в разделе «Заметки и дела библиотеки» и сохраните запись.';memoText.focus()}}));row.append(h('button',{type:'button',text:'Выбрать для связи',onclick:()=>{if(!linkA.value||linkB.value){linkA.value=item.path;linkB.value=''}else linkB.value=item.path;state.textContent='Выбрано для связи: '+linkA.value+(linkB.value?' и '+linkB.value:'; выберите второй файл.')}}));row.append(h('button',{type:'button',text:'В подборку',onclick:async()=>{if(!collectionChoice.value){state.textContent='Сначала создайте подборку.';return}try{await request('/api/library/collections/add',{method:'POST',headers:json,body:JSON.stringify({id:collectionChoice.value,path:item.path})});await updateCollections()}catch(e){state.textContent=e.message}}}));if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name)){
    row.append(h('button',{type:'button',text:'Карточка',onclick:async()=>{try{const [d,s]=await Promise.all([request('/api/library/document?path='+encodeURIComponent(item.path)),request('/api/library/summary?path='+encodeURIComponent(item.path))]);documentInfo.replaceChildren(h('h3',{text:d.path}),h('p',{text:'Строк: '+d.lineCount+' · размер: '+d.bytes+' байт'}),h('p',{class:'muted',text:'Выдержка из документа:'}),...(s.summary.length?s.summary:d.excerpt).map(line=>h('p',{text:line})))}catch(e){documentInfo.textContent=e.message}}}));
    row.append(h('button',{type:'button',text:'Спросить по файлу',onclick:()=>{answerSource.value=item.path;state.textContent='Выбран файл для ответа: '+item.path+'. Введите вопрос в поиске.';searchInput.focus()}}));
    row.append(h('button',{type:'button',text:'Предложить факты',onclick:async()=>{factProposals.textContent='Ищу факты…';try{const d=await request('/api/library/propose-facts?path='+encodeURIComponent(item.path));factSource.value=item.path;factProposals.replaceChildren(...(d.items.length?d.items.map(f=>h('div',{class:'item'},h('div',{},h('p',{text:f.subject+' — '+f.predicate+' → '+f.object}),h('p',{class:'muted',text:'Строка '+f.line+': '+f.quote})),h('button',{type:'button',text:'Проверить',onclick:()=>{factSubject.value=f.subject;factPredicate.value=f.predicate;factObject.value=f.object;factQuote.value=f.quote;factSubject.focus()}}))):[h('p',{text:'Фактов по простым правилам не найдено. Можно добавить вручную.'})]));if(d.truncated)factProposals.append(h('p',{class:'muted',text:'Проверена только часть текста.'}));state.textContent='Проверьте предложения в разделе «Факты библиотеки».'}catch(e){factProposals.textContent=e.message}}}));
    row.append(h('button',{type:'button',text:'Похожие',onclick:async()=>{documentInfo.textContent='Ищу похожие документы…';try{const d=await request('/api/library/similar?path='+encodeURIComponent(item.path));documentInfo.replaceChildren(h('h3',{text:'Похожие на '+item.name}),h('p',{class:'muted',text:'Сравнение по общим словам; не означает, что документы одинаковые.'}),...(d.items.length?d.items.map(x=>h('p',{text:x.path+' · совпадение слов: '+x.score+'%'})):[h('p',{text:'Похожие документы не найдены.'})]),h('p',{class:'muted',text:'Проверено: '+d.scanned+(d.truncated?' · показаны не все':'')+(d.unreadable?' · не удалось прочитать: '+d.unreadable:'')}))}catch(e){documentInfo.textContent=e.message}}}));
   }row.append(h('button',{type:'button',text:'Предложить папку',onclick:async()=>{try{const d=await request('/api/library/suggest-file-folder?path='+encodeURIComponent(item.path));if(!confirm('Предлагаю папку «'+d.folder+'» ('+d.reason+'). Создать её при необходимости и переместить файл?'))return;const result=await request('/api/library/move',{method:'POST',headers:json,body:JSON.stringify({path:item.path,folder:d.folder,create:true})});await load();await updateCollections();await updateLinks();await updateMemos();await updateLibraryFacts();await updateJournal();state.textContent=result.unchanged?'Файл уже находится в этой папке.':result.originalRetained?'Файл скопирован в '+result.path+'; исходный файл сохранён.':'Файл перемещён: '+result.path}catch(e){state.textContent=e.message}}}));row.append(h('button',{type:'button',text:'Переименовать',onclick:async()=>{let suggested=item.name;if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name)){try{suggested=(await request('/api/library/suggest-name?path='+encodeURIComponent(item.path))).name}catch{}}const newName=prompt('Новое имя файла (предложение по первой строке, проверьте его):',suggested);if(newName===null||newName===item.name)return;try{const result=await request('/api/library/rename',{method:'POST',headers:json,body:JSON.stringify({path:item.path,name:newName})});await load();await updateCollections();await updateLinks();await updateMemos();await updateLibraryFacts();await updateJournal();state.textContent=result.originalRetained?'Новое имя создано, старый файл сохранить пришлось. Проверьте обе копии.':'Файл переименован: '+result.path}catch(e){state.textContent=e.message}}}));if(/\.(png|jpe?g|webp|pdf)$/i.test(item.name))row.append(h('button',{type:'button',text:'Распознать текст',onclick:async e=>{const button=e.currentTarget;button.disabled=true;documentInfo.textContent='Распознавание на этом компьютере…';try{const d=await request('/api/library/ocr',{method:'POST',headers:json,body:JSON.stringify({path:item.path})});const save=h('button',{type:'button',text:'Сохранить текст рядом с файлом',onclick:async()=>{save.disabled=true;try{const file=item.path+'.ocr.txt',content='Источник: '+item.path+'\n\n'+d.pages.map(p=>'[Страница '+p.page+']\n'+p.text).join('\n\n');const response=await fetch('/api/library/upload?path='+encodeURIComponent(file),{method:'PUT',headers:{'Content-Type':'text/plain;charset=utf-8'},body:content});const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось сохранить');save.textContent='Сохранено: '+file;await load()}catch(err){save.disabled=false;documentInfo.append(h('p',{text:err.message}))}}});documentInfo.replaceChildren(h('h3',{text:'Распознанный текст · '+d.path}),h('p',{class:'muted',text:'Результат может содержать ошибки. Сохранённый текст будет доступен для поиска.'}),save,...d.pages.map(p=>h('div',{},h('h4',{text:'Страница '+p.page}),h('pre',{text:p.text||'Текст не найден.'}))))}catch(err){documentInfo.textContent=err.message}finally{button.disabled=false}}}));}return row;
  }):[h('p',{class:'muted',text:search?'Ничего не найдено.':'В этой папке пока нет файлов.'})]));
 }
 async function load(){
  location.textContent='Папка: /'+libraryPath;state.textContent='Загрузка…';
  try{const result=await request('/api/library/list?path='+encodeURIComponent(libraryPath));showEntries(listing,result.items);state.textContent='Файлов и папок: '+result.items.length}catch(e){state.textContent=e.message}
 }
 folderForm.onsubmit=async e=>{e.preventDefault();const value=name.value.trim();if(!value)return;try{await request('/api/library/folder',{method:'POST',headers:json,body:JSON.stringify({path:libraryPath?libraryPath+'/'+value:value})});name.value='';await load()}catch(err){state.textContent=err.message}};
 uploadInput.onchange=async()=>{const file=uploadInput.files[0];if(!file)return;try{const d=await request('/api/library/suggest-folder?name='+encodeURIComponent(file.name));state.textContent='Возможная тема: «'+d.folder+'». Загрузка будет в текущую папку /'+libraryPath+'.'}catch(e){state.textContent=e.message}};
 uploadButton.onclick=async()=>{const file=uploadInput.files[0];if(!file){state.textContent='Сначала выберите файл.';return}let name=file.name;state.textContent='Загрузка файла…';uploadButton.disabled=true;try{for(;;){const filePath=libraryPath?libraryPath+'/'+name:name;const r=await fetch('/api/library/upload?path='+encodeURIComponent(filePath),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});const data=await r.json();if(r.status===409){if(confirm('Файл «'+name+'» уже существует. Заменить его? Предыдущая версия будет сохранена. Нажмите «Отмена», чтобы выбрать другое имя.')){const replace=await fetch('/api/library/replace?path='+encodeURIComponent(filePath),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});const outcome=await replace.json();if(!replace.ok)throw Error(outcome.error||'Замена не выполнена');uploadInput.value='';await load();await updateVersions();state.textContent='Файл заменён. Предыдущая версия сохранена в истории версий.';break}const dot=name.lastIndexOf('.'),suggestion=dot>0?name.slice(0,dot)+' (копия)'+name.slice(dot):name+' (копия)';const next=prompt('Файл с таким именем уже существует. Чтобы сохранить оба, укажите другое имя:',suggestion);if(next===null){state.textContent='Загрузка отменена. Существующий файл сохранён.';return}name=next.trim();if(!name){state.textContent='Имя файла не может быть пустым.';return}continue}if(!r.ok)throw Error(data.error||'Не удалось загрузить файл');uploadInput.value='';await load();state.textContent='Файл сохранён: '+name;break}}catch(err){state.textContent=err.message}finally{uploadButton.disabled=false}};
 searchForm.onsubmit=async e=>{e.preventDefault();searchResults.textContent='Хранитель ищет…';try{const data=await request('/api/library/search?q='+encodeURIComponent(searchInput.value));showEntries(searchResults,data.results,true);searchResults.append(h('p',{class:'muted',text:'Просмотрено записей: '+data.scanned+(data.truncated?' · показаны не все результаты':'')}))}catch(err){searchResults.textContent=err.message}};
 textSearch.onclick=async()=>{searchResults.textContent='Хранитель ищет в документах…';try{const data=await request('/api/library/search-text?q='+encodeURIComponent(searchInput.value));searchResults.replaceChildren(...(data.results.length?data.results.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.path}),h('p',{text:(x.page?'Страница '+x.page:'Строка '+x.line)+': '+x.excerpt})),h('a',{href:'/api/library/download?path='+encodeURIComponent(x.path),text:'Скачать'}))):[h('p',{class:'muted',text:'Совпадений не найдено.'})]));if(data.truncated||data.unreadable)searchResults.append(h('p',{class:'muted',text:(data.truncated?'Показаны не все результаты. ':'')+(data.unreadable?'Не удалось прочитать файлов: '+data.unreadable+'. Сведения об ошибках — в очереди.':'')}))}catch(err){searchResults.textContent=err.message}};
 indexedSearch.onclick=async()=>{searchResults.textContent='Поиск в локальном индексе…';try{const d=await request('/api/library/search-index?q='+encodeURIComponent(searchInput.value));searchResults.replaceChildren(h('p',{class:'muted',text:'Поиск охватывает документы, обработанные очередью.'}),...(d.results.length?d.results.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.path}),h('p',{text:x.excerpt})),h('a',{href:'/api/library/download?path='+encodeURIComponent(x.path),text:'Скачать'}))):[h('p',{text:'Совпадений в индексе не найдено.'})]));if(d.stale||d.limited)searchResults.append(h('p',{class:'muted',text:(d.stale?'Устаревшие записи пропущены: '+d.stale+'. ':'')+(d.limited?'Показаны не все результаты.':'')}))}catch(e){searchResults.textContent=e.message}};
 answerSearch.onclick=async()=>{answerSearch.disabled=true;searchResults.textContent='Хранитель ищет подтверждения…';try{const d=await request('/api/library/answer?q='+encodeURIComponent(searchInput.value)+'&path='+encodeURIComponent(answerSource.value.trim()));searchResults.replaceChildren(h('p',{class:'muted',text:'Фрагменты источников, подобранные по словам вопроса. Проверьте контекст документа.'}),...(d.items.length?d.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.path+' · '+(x.page?'страница '+x.page:x.sheet||'строка '+x.line)}),h('p',{text:x.excerpt})),h('a',{href:'/api/library/download?path='+encodeURIComponent(x.path),text:'Открыть файл'}))):[h('p',{text:'Подходящих фрагментов не найдено.'})]),h('p',{class:'muted',text:'Проверено файлов: '+d.scanned+(d.unreadable?' · не удалось прочитать: '+d.unreadable:'')+(d.truncated?' · проверена только часть библиотеки':'')}))}catch(err){searchResults.textContent=err.message}finally{answerSearch.disabled=false}};
 duplicateSearch.onclick=async()=>{searchResults.textContent='Хранитель сравнивает файлы…';duplicateSearch.disabled=true;try{const data=await request('/api/library/duplicates');searchResults.replaceChildren(...(data.groups.length?data.groups.map(group=>h('div',{class:'item'},h('div',{},h('strong',{text:'Одинаковые файлы · '+Math.ceil(group[0].size/1024)+' КБ'}),...group.map(x=>h('p',{text:x.path}))))):[h('p',{class:'muted',text:'Одинаковые файлы не найдены.'})]));if(data.truncated||data.errors.length)searchResults.append(h('p',{class:'muted',text:'Проверка неполная. Ошибок чтения: '+data.errors.length}))}catch(err){searchResults.textContent=err.message}finally{duplicateSearch.disabled=false}};
 compareForm.onsubmit=async e=>{e.preventDefault();documentInfo.textContent='Сравнение…';try{const d=await request('/api/library/compare',{method:'POST',headers:json,body:JSON.stringify({left:compareLeft.value,right:compareRight.value})});documentInfo.replaceChildren(h('p',{text:d.identical?'Файлы одинаковые':'Различающихся строк: '+d.changedLines+' (сравнение по номерам строк)'}),...d.changes.map(c=>h('div',{class:'item'},h('div',{},h('strong',{text:'Строка '+c.line}),h('p',{text:'Первый: '+c.left}),h('p',{text:'Второй: '+c.right})))));if(d.truncated)documentInfo.append(h('p',{text:'Показаны первые 100 различий.'}))}catch(err){documentInfo.textContent=err.message}};
 async function updateQueue(){try{const d=await request('/api/library/queue');queueEnabled=d.enabled;queueToggle.textContent=d.enabled?'Остановить фоновую обработку':'Включить фоновую обработку';queueInfo.replaceChildren(h('p',{text:'Ожидают: '+d.counts.queued+' · обработаны: '+d.counts.ready+' · ошибки: '+d.counts.error}),...d.items.map(item=>h('div',{class:'item'},h('div',{},h('strong',{text:item.path}),h('p',{text:item.status==='error'?'Ошибка: '+item.error:'Ожидает обработки'})),item.status==='error'?h('button',{type:'button',text:'Повторить',onclick:async()=>{try{await request('/api/library/queue/retry',{method:'POST',headers:json,body:JSON.stringify({path:item.path})});await updateQueue()}catch(e){queueInfo.textContent=e.message}}}):null)))}catch(e){queueInfo.textContent=e.message}}
 queueRefresh.onclick=async()=>{try{await request('/api/library/queue/scan',{method:'POST',headers:json,body:'{}'});await updateQueue()}catch(e){queueInfo.textContent=e.message}};
 queueToggle.onclick=async()=>{try{await request('/api/library/queue/enabled',{method:'POST',headers:json,body:JSON.stringify({enabled:!queueEnabled})});await updateQueue()}catch(e){queueInfo.textContent=e.message}};
 async function updateCollections(){try{const d=await request('/api/library/collections'),selected=collectionChoice.value;collectionChoice.replaceChildren(...d.items.map(c=>h('option',{value:c.id,text:c.name})));if(d.items.some(c=>c.id===selected))collectionChoice.value=selected;collectionList.replaceChildren(...d.items.map(c=>h('div',{class:'item'},h('div',{},h('strong',{text:c.name}),...c.files.map(file=>h('p',{},h('span',{text:file+' '}),h('a',{href:'/api/library/download?path='+encodeURIComponent(file),text:'Скачать'}),' ',h('button',{type:'button',text:'Убрать из подборки',onclick:async()=>{try{await request('/api/library/collections/remove',{method:'POST',headers:json,body:JSON.stringify({id:c.id,path:file})});await updateCollections()}catch(e){collectionList.textContent=e.message}}})))),h('button',{type:'button',text:'Удалить подборку',onclick:async()=>{if(!confirm('Удалить подборку «'+c.name+'»? Файлы останутся на месте.'))return;try{await request('/api/library/collections/delete',{method:'POST',headers:json,body:JSON.stringify({id:c.id})});await updateCollections()}catch(e){collectionList.textContent=e.message}}}))))}catch(e){collectionList.textContent=e.message}}
 collectionForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/collections',{method:'POST',headers:json,body:JSON.stringify({name:collectionName.value})});collectionName.value='';await updateCollections()}catch(err){collectionList.textContent=err.message}};
 async function updateMemos(){try{const data=await request('/api/library/memos');memoList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:(x.kind==='task'?(x.done?'Выполнено · ':'Дело · '):'Заметка · ')+x.text}),h('p',{class:'muted',text:'Источник: '+x.source+(x.due?' · срок: '+x.due:'')+(x.time?' в '+x.time:'')}),h('a',{href:'/api/library/download?path='+encodeURIComponent(x.source),text:'Открыть источник'})),x.kind==='task'?h('button',{type:'button',text:x.done?'Вернуть в работу':'Выполнено',onclick:async()=>{try{await request('/api/library/memos/change',{method:'POST',headers:json,body:JSON.stringify({id:x.id,action:'toggle'})});await updateMemos()}catch(e){memoList.textContent=e.message}}}):null,h('button',{type:'button',text:'Удалить запись',onclick:async()=>{if(!confirm('Удалить запись? Файл-источник останется на месте.'))return;try{await request('/api/library/memos/change',{method:'POST',headers:json,body:JSON.stringify({id:x.id,action:'delete'})});await updateMemos()}catch(e){memoList.textContent=e.message}}}))):[h('p',{class:'muted',text:'Записей пока нет.'})]))}catch(e){memoList.textContent=e.message}}
 memoForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/memos',{method:'POST',headers:json,body:JSON.stringify({source:memoSource.value,kind:memoKind.value,text:memoText.value,due:memoDue.value,time:memoTime.value})});memoText.value='';memoDue.value='';memoTime.value='';await updateMemos()}catch(err){memoList.textContent=err.message}};
 organizePlan.onclick=async()=>{organizePlan.disabled=true;organizeList.textContent='Изучаю файлы…';try{const data=await request('/api/library/organization-plan');organizationChoices=data.items.map(item=>({item,checked:h('input',{type:'checkbox','aria-label':'Выбрать '+item.path})}));organizeList.replaceChildren(h('p',{class:'muted',text:'Проверено: '+data.visited+(data.truncated?' · показана часть библиотеки':'')+(data.unreadable?' · не удалось прочитать: '+data.unreadable:'')+'. Отметьте нужные предложения.'}),...organizationChoices.map(x=>h('label',{class:'item'},x.checked,h('span',{text:x.item.path+' → '+x.item.target+' · '+x.item.reason}))));if(!organizationChoices.length)organizeList.append(h('p',{text:'Предложений нет.'}))}catch(e){organizeList.textContent=e.message}finally{organizePlan.disabled=false}};
 organizeApply.onclick=async()=>{const chosen=organizationChoices.filter(x=>x.checked.checked);if(!chosen.length){organizeList.append(h('p',{text:'Сначала отметьте файлы.'}));return}if(!confirm('Переместить выбранные файлы: '+chosen.length+'? Существующие файлы не будут перезаписаны.'))return;organizeApply.disabled=true;let moved=0;const errors=[];try{for(const x of chosen){try{const r=await request('/api/library/move',{method:'POST',headers:json,body:JSON.stringify({path:x.item.path,folder:x.item.folder,create:true})});moved++;x.checked.checked=false;x.checked.disabled=true;if(r.originalRetained)errors.push(x.item.path+': исходный файл сохранён')}catch(e){errors.push(x.item.path+': '+e.message)}}await load();await updateCollections();await updateLinks();await updateMemos();await updateLibraryFacts();await updateJournal();organizeList.prepend(h('p',{text:'Обработано: '+moved+' из '+chosen.length+(errors.length?' · подробности ниже':'')}),...errors.map(e=>h('p',{text:e})))}finally{organizeApply.disabled=false}};
 tableForm.onsubmit=async e=>{e.preventDefault();tableResult.textContent='Читаю книги…';try{const data=await request('/api/library/tables',{method:'POST',headers:json,body:JSON.stringify({files:tablePaths.value.split('\n').map(x=>x.trim()).filter(Boolean)})});tableResult.replaceChildren(h('p',{class:'muted',text:'Строк найдено: '+data.totalRows+'. Показаны первые '+data.limitPerSheet+' строк каждого листа. Формулы не пересчитываются.'}),...data.books.flatMap(book=>[h('h4',{text:book.path}),...book.sheets.map(sheet=>h('div',{class:'item'},h('div',{},h('strong',{text:'Лист: '+sheet.name+' · строк: '+sheet.rows}),...sheet.preview.map(row=>h('p',{text:row})))))]))}catch(err){tableResult.textContent=err.message}};
 async function updateLibraryFacts(){try{const data=await request('/api/library/facts');factList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.subject+' — '+x.predicate+' → '+x.object}),h('p',{class:'muted',text:'Источник: '+x.source}),x.quote?h('p',{text:'Фрагмент: '+x.quote}):null,h('a',{href:'/api/library/download?path='+encodeURIComponent(x.source),text:'Открыть источник'})),h('button',{type:'button',text:'Удалить факт',onclick:async()=>{if(!confirm('Удалить факт из библиотеки? Файл останется на месте.'))return;try{await request('/api/library/facts/delete',{method:'POST',headers:json,body:JSON.stringify({id:x.id})});await updateLibraryFacts();await updateLinks()}catch(e){factList.textContent=e.message}}}))):[h('p',{class:'muted',text:'Подтверждённых фактов пока нет.'})]))}catch(e){factList.textContent=e.message}}
 factForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/facts',{method:'POST',headers:json,body:JSON.stringify({source:factSource.value,subject:factSubject.value,predicate:factPredicate.value,object:factObject.value,quote:factQuote.value})});factSubject.value='';factPredicate.value='';factObject.value='';factQuote.value='';await updateLibraryFacts();await updateLinks()}catch(err){factList.textContent=err.message}};
 function drawLinks(links){
  const names=[...new Set(links.flatMap(x=>[x.a,x.b]))].slice(0,30);linkGraph.replaceChildren();if(!names.length)return;
  const ns='http://www.w3.org/2000/svg',make=(tag,props={})=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(props))n.setAttribute(k,String(v));return n};
  const rows=Math.ceil(names.length/3),svg=make('svg',{viewBox:'0 0 720 '+(rows*95+30),role:'img','aria-label':'Карта связей документов и фактов'}),pos=new Map(names.map((name,i)=>[name,{x:120+(i%3)*240,y:50+Math.floor(i/3)*95}]));svg.style.width='100%';svg.style.maxHeight='600px';
  for(const edge of links){const a=pos.get(edge.a),b=pos.get(edge.b);if(a&&b)svg.append(make('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#a78038','stroke-width':2}))}
  for(const name of names){const p=pos.get(name),g=make('g'),box=make('rect',{x:p.x-100,y:p.y-18,width:200,height:36,rx:12,fill:'#211b11',stroke:'#bb954b'}),label=make('text',{x:p.x,y:p.y+5,fill:'#f5e7bf','text-anchor':'middle','font-size':12}),title=make('title');label.textContent=name.split('/').pop().slice(0,25);title.textContent=name;g.append(box,label,title);svg.append(g)}
  linkGraph.append(svg);if(new Set(links.flatMap(x=>[x.a,x.b])).size>names.length)linkGraph.append(h('p',{class:'muted',text:'Показаны первые 30 файлов. Все связи доступны ниже.'}));
 }
 async function updateLinks(){try{const [data,facts]=await Promise.all([request('/api/library/links'),request('/api/library/facts')]);drawLinks([...data.items,...facts.items.map(f=>({a:f.source,b:'Факт: '+f.subject+' — '+f.predicate+' → '+f.object}))]);linkList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('p',{text:x.a+' ↔ '+x.b}),x.label?h('p',{class:'muted',text:x.label}):null),h('button',{type:'button',text:'Убрать связь',onclick:async()=>{if(!confirm('Убрать связь? Файлы останутся на месте.'))return;try{await request('/api/library/links/delete',{method:'POST',headers:json,body:JSON.stringify({id:x.id})});await updateLinks()}catch(e){linkList.textContent=e.message}}}))):[h('p',{class:'muted',text:'Связей пока нет.'})]))}catch(e){linkList.textContent=e.message}}
 linkForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/links',{method:'POST',headers:json,body:JSON.stringify({a:linkA.value,b:linkB.value,label:linkLabel.value})});linkA.value='';linkB.value='';linkLabel.value='';await updateLinks()}catch(err){linkList.textContent=err.message}};
 async function updateJournal(){const labels={folder_created:'Создана папка',file_uploaded:'Загружен файл',file_replaced:'Файл заменён, прежняя версия сохранена',file_renamed:'Файл переименован',file_moved:'Файл перемещён',ocr_completed:'Распознан документ',collection_created:'Создана подборка',collection_added:'Файл добавлен в подборку',collection_removed:'Файл убран из подборки',collection_deleted:'Удалена подборка'};try{const d=await request('/api/library/journal');journalList.replaceChildren(...(d.items.length?d.items.map(x=>h('p',{text:new Date(x.at).toLocaleString('ru-RU')+' · '+(labels[x.action]||x.action)+(x.path?' · '+x.path:'')+(x.target?' → '+x.target:'')+(x.collection?' · '+x.collection:'')})):[h('p',{class:'muted',text:'Действий пока нет.'})]))}catch(e){journalList.textContent=e.message}}
 journalRefresh.onclick=updateJournal;
 async function updateVersions(){try{const data=await request('/api/library/versions');versionsList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.path}),h('p',{class:'muted',text:'До замены: '+new Date(x.createdAt).toLocaleString('ru-RU')+' · '+Math.ceil(x.size/1024)+' КБ'})),h('a',{href:'/api/library/version?id='+encodeURIComponent(x.id),text:'Скачать предыдущую версию'}))):[h('p',{class:'muted',text:'Сохранённых версий пока нет.'})]))}catch(e){versionsList.textContent=e.message}}
 versionsRefresh.onclick=updateVersions;
 healthButton.onclick=async()=>{healthButton.disabled=true;healthInfo.textContent='Проверяю библиотеку…';try{const d=await request('/api/library/health');healthInfo.replaceChildren(h('p',{text:'Файлов: '+d.files+' · папок: '+d.folders+' · размер: '+(d.bytes/1048576).toFixed(1)+' МБ'}),h('p',{text:'Свободно на диске: '+(d.freeBytes===null?'не удалось определить':(Number(d.freeBytes)/1073741824).toFixed(1)+' ГБ')}),h('p',{text:'Ошибки обработки: '+d.queue.error+' · ожидают: '+d.queue.queued}),h('p',{text:'Недоступных ссылок в подборках: '+d.missing.length+' · в связях: '+d.missingLinks.length+' · у записей: '+d.missingSources.length}),...d.missingSources.map(x=>h('p',{text:'Недоступный источник записи: '+x.path})),...d.missingLinks.map(x=>h('p',{text:'Недоступный документ в связи: '+x.path})),...d.missing.map(x=>h('p',{text:x.collection+' · '+x.path})),...d.errors.map(x=>h('p',{text:'Ошибка папки '+x.path+': '+x.error})));if(d.truncated)healthInfo.append(h('p',{text:'Проверена только часть библиотеки.'}))}catch(e){healthInfo.textContent=e.message}finally{healthButton.disabled=false}};
 const back=h('button',{type:'button',text:'На уровень выше',onclick:()=>{libraryPath=libraryPath.split('/').slice(0,-1).join('/');void load()}});
 root.append(h('div',{class:'panel'},h('h3',{text:'Мои файлы'}),h('p',{class:'muted',text:'Файлы хранятся в папке data/library на диске проекта. Для поиска подключение к интернету не требуется.'}),location,back,folderForm,h('div',{},uploadInput,uploadButton),state,listing),h('div',{class:'panel'},h('h3',{text:'Хранитель библиотеки'}),h('p',{class:'muted',text:'Поиск и карточки TXT, Markdown, CSV, JSON, DOCX, XLSX и PDF с текстом. Для таблиц показываются извлечённые значения ячеек.'}),searchForm,textSearch,indexedSearch,answerSource,answerSearch,duplicateSearch,searchResults,compareForm,documentInfo),h('div',{class:'panel'},h('h3',{text:'Подборки'}),h('p',{class:'muted',text:'Выберите подборку и нажмите «В подборку» у файла. Оригинал останется на месте.'}),collectionForm,collectionChoice,collectionList),h('div',{class:'panel'},h('h3',{text:'Очередь обработки'}),h('p',{class:'muted',text:'Проверяет документы на этом диске. Работает, пока открыт проект.'}),queueRefresh,queueToggle,queueInfo),h('div',{class:'panel'},h('h3',{text:'Журнал действий'}),journalRefresh,journalList));
 void updateJournal();
 root.append(h('div',{class:'panel'},h('h3',{text:'Предыдущие версии'}),h('p',{class:'muted',text:'Старые версии сохраняются при подтверждённой замене. Их можно скачать и загрузить обратно под нужным именем.'}),versionsRefresh,versionsList));
 void updateVersions();
 root.append(h('div',{class:'panel'},h('h3',{text:'Порядок в библиотеке'}),h('p',{class:'muted',text:'Хранитель предложит папки. Ничего не перемещается до выбора и подтверждения.'}),organizePlan,organizeApply,organizeList));
 root.append(h('div',{class:'panel'},h('h3',{text:'Обзор таблиц'}),h('p',{class:'muted',text:'До пяти книг XLSX. Каждая строка показана с листом и адресами ячеек; исходные файлы не изменяются.'}),tableForm,tableResult));
 root.append(h('div',{class:'panel'},h('h3',{text:'Заметки и дела библиотеки'}),h('p',{class:'muted',text:'Личные записи хранятся в библиотеке отдельно от общего планера. Для напоминания укажите дату и время; оно появится при открытом проекте.'}),memoForm,memoNotify,memoList));
 void updateMemos();
 root.append(h('div',{class:'panel'},h('h3',{text:'Факты библиотеки'}),h('p',{class:'muted',text:'Предложения нужно проверить и подтвердить. Факты остаются в библиотеке и не добавляются в общую память или контекст облачной модели.'}),factProposals,factForm,factList));
 void updateLibraryFacts();
 root.append(h('div',{class:'panel'},h('h3',{text:'Карта документов и фактов'}),h('p',{class:'muted',text:'Показаны связи документов и подтверждённые факты библиотеки. Выберите два файла, чтобы связать их.'}),linkForm,linkGraph,linkList));
 void updateLinks();
 root.append(h('div',{class:'panel'},h('h3',{text:'Состояние библиотеки'}),healthButton,healthInfo));
 void updateCollections();
 void updateQueue();
 void load();
}

// Время трактуется в часовом поясе компьютера; при закрытом проекте напоминание ждёт следующего запуска.
let libraryReminderBusy=false;
async function checkLibraryReminders(){
 if(libraryReminderBusy)return;libraryReminderBusy=true;
 try{const data=await request('/api/library/memos');for(const item of data.items){
  if(item.kind!=='task'||item.done||item.notified||!item.due||!item.time)continue;
  const at=new Date(item.due+'T'+item.time+':00').getTime();if(!Number.isFinite(at)||at>Date.now())continue;
  const systemAllowed='Notification' in window&&Notification.permission==='granted';if(document.hidden&&!systemAllowed)continue;
  const claim=await request('/api/library/memos/change',{method:'POST',headers:json,body:JSON.stringify({id:item.id,action:'notify'})});if(!claim.claimed)continue;
  const notice=h('div',{role:'status',text:'Напоминание библиотеки: '+item.text});Object.assign(notice.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'9999',background:'#241e11',color:'#fff3d0',padding:'16px',border:'1px solid #c3a15b',borderRadius:'12px',maxWidth:'360px'});document.body.append(notice);setTimeout(()=>notice.remove(),15000);
  if(systemAllowed)try{new Notification('Напоминание библиотеки',{body:item.text})}catch{}
 }}catch{}finally{libraryReminderBusy=false}
}
setInterval(checkLibraryReminders,30000);void checkLibraryReminders();
