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
const TITLES={home:'Добро пожаловать',planner:'Планер',settings:'Настройки проекта',facts:'Факты памяти'};
function render(){
 root.replaceChildren(element('h2',TITLES[page]));
 ({home:renderHome,planner:renderPlanner,facts:renderFacts,settings:renderSettings}[page]||renderHome)();
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
const pv=(()=>{const d={view:'list',list:'today',cat:'all',date:today(),month:null,sel:null,query:''};try{const s=JSON.parse(localStorage.getItem(PV_KEY));if(s&&typeof s==='object'){for(const k of ['view','list','cat'])if(typeof s[k]==='string')d[k]=s[k]}}catch{}return d})();
const savePv=()=>{try{localStorage.setItem(PV_KEY,JSON.stringify({view:pv.view,list:pv.list,cat:pv.cat}))}catch{}};
const VIEWS=[['list','Список'],['day','День'],['week','Неделя'],['month','Месяц'],['notes','Заметки']];
const LISTS=[['today','Сегодня'],['upcoming','Ближайшие 7 дней'],['overdue','Просрочено'],['nodate','Без срока'],['all','Все дела'],['done','Выполнено']];
const inCat=x=>pv.cat==='all'||catOf(x)===pv.cat;
function listFilter(key){
 const t=today(),week=ymd(addDays(new Date(),7));
 return {today:x=>!x.done&&x.due&&x.due<=t,upcoming:x=>!x.done&&x.due>t&&x.due<=week,overdue:x=>!x.done&&x.due&&x.due<t,nodate:x=>!x.done&&!x.due,all:x=>!x.done,done:x=>x.done}[key]||(()=>true);
}
function setPv(changes){Object.assign(pv,changes);savePv();render()}
function selectItem(type,id){pv.sel=pv.sel&&pv.sel.type===type&&pv.sel.id===id?null:{type,id};render()}

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

function taskRow(task,{compact=false,showDate=true}={}){
 const t=today(),late=!task.done&&task.due&&task.due<t,c=catOf(task),sel=pv.sel?.type==='task'&&pv.sel.id===task.id;
 const check=h('button',{type:'button',class:'check'+(task.done?' on':''),'aria-label':task.done?'Вернуть в работу':'Отметить выполненным',title:task.done?'Вернуть':'Готово',onclick:e=>{e.stopPropagation();toggleDone(task,e)}},task.done?'✓':'');
 const meta=h('div',{class:'task-meta'},chip(CAT[c].icon+' '+CAT[c].label,'cat-'+c),
  showDate&&task.due?chip((late?'⚠ ':'')+dayLabel(task.due)+(task.time?' · '+task.time:''),late?'late':task.due===t?'today':''):(!showDate&&task.time?chip(task.time,'today'):null),
  task.priority==='high'?chip('❗ Важное','high'):task.priority==='low'?chip('Не срочно','low'):null,
  task.content&&!compact?chip('✎ заметка'):null);
 const row=h('div',{class:'task-row'+(task.done?' done':'')+(late?' late':'')+(task.priority==='high'?' high':'')+(sel?' selected':'')+' cat-'+c,tabindex:'0',role:'button','aria-label':task.title,
  onclick:()=>selectItem('task',task.id),onkeydown:e=>{if(e.key==='Enter'&&e.target===row)selectItem('task',task.id)}},check,h('div',{class:'task-body'},h('div',{class:'task-title',text:task.title}),meta));
 return draggable(row,task);
}

function renderPlanner(){
 root.querySelector('h2')?.remove();
 const shell=h('div',{class:'planner view-'+pv.view});
 shell.append(plannerTop(),plannerSide(),plannerMain(),plannerDetail());
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

// Левая колонка: мини-календарь, умные списки, категория.
function plannerSide(){
 const sel=fromYmd(pv.date);pv.month??=new Date(sel.getFullYear(),sel.getMonth(),1);
 const m=pv.month,first=new Date(m.getFullYear(),m.getMonth(),1),start=addDays(first,-((first.getDay()+6)%7)),t=today();
 const counts=new Map();for(const x of workspace.tasks)if(!x.done&&x.due&&inCat(x))counts.set(x.due,(counts.get(x.due)||0)+1);
 const grid=h('div',{class:'mini-grid'},...['пн','вт','ср','чт','пт','сб','вс'].map(d=>h('span',{class:'mini-wd',text:d})));
 for(let i=0;i<42;i++){const d=addDays(start,i),key=ymd(d);if(i>=35&&d.getMonth()!==m.getMonth())break;
  grid.append(dropTarget(h('button',{type:'button',class:'mini-day'+(d.getMonth()!==m.getMonth()?' other':'')+(key===t?' today':'')+(key===pv.date?' selected':'')+(counts.get(key)?' has':''),'aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(counts.get(key)?', дел: '+counts.get(key):''),
   onclick:()=>setPv({date:key,view:pv.view==='list'||pv.view==='notes'?'day':pv.view,month:new Date(d.getFullYear(),d.getMonth(),1),sel:null})},String(d.getDate())),()=>({due:key})))}
 const nav=h('div',{class:'mini-head'},
  h('button',{type:'button',class:'icon-btn','aria-label':'Предыдущий месяц',onclick:()=>setPv({month:new Date(m.getFullYear(),m.getMonth()-1,1)})},'‹'),
  h('strong',{text:MONTHS[m.getMonth()]+' '+m.getFullYear()}),
  h('button',{type:'button',class:'icon-btn','aria-label':'Следующий месяц',onclick:()=>setPv({month:new Date(m.getFullYear(),m.getMonth()+1,1)})},'›'));
 const lists=h('nav',{class:'smart-lists','aria-label':'Списки'},...LISTS.map(([k,label])=>{
  const n=workspace.tasks.filter(x=>inCat(x)&&listFilter(k)(x)).length,on=pv.view==='list'&&pv.list===k;
  return h('button',{type:'button',class:'smart'+(on?' on':'')+(k==='overdue'&&n?' warn':''),'aria-current':on?'true':null,onclick:()=>setPv({view:'list',list:k,sel:null})},h('span',{text:label}),h('span',{class:'seg-count',text:String(n)}));
 }),h('button',{type:'button',class:'smart'+(pv.view==='notes'?' on':''),onclick:()=>setPv({view:'notes',sel:null})},h('span',{text:'Заметки'}),h('span',{class:'seg-count',text:String(workspace.notes.filter(inCat).length)})));
 const cats=segmented([{value:'all',label:'Все'},{value:'personal',label:'🏠 Личные'},{value:'work',label:'💼 Работа'}],pv.cat,v=>setPv({cat:v}),'Категория');
 return h('aside',{class:'pl-side panel'},cats,h('div',{class:'mini'},nav,grid),lists,
  h('p',{class:'hint keys',text:'Клавиши: N — новое, 1–5 — вид, T — сегодня, ← → — листать, Esc — снять выбор'}));
}

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
function pager(title,step){
 return h('div',{class:'main-head'},h('div',{class:'cal-nav'},
  h('button',{type:'button',class:'icon-btn','aria-label':'Назад',onclick:()=>step(-1)},'‹'),
  h('strong',{class:'cal-title',text:title}),
  h('button',{type:'button',class:'icon-btn','aria-label':'Вперёд',onclick:()=>step(1)},'›'),
  h('button',{type:'button',text:'Сегодня',onclick:()=>{const d=new Date();setPv({date:today(),month:new Date(d.getFullYear(),d.getMonth(),1)})}})));
}
function shiftDate(days){const d=addDays(fromYmd(pv.date),days);setPv({date:ymd(d),month:new Date(d.getFullYear(),d.getMonth(),1),sel:null})}
function mainDay(box){
 const date=pv.date,d=fromYmd(date),tasks=workspace.tasks.filter(x=>x.due===date&&inCat(x)).sort(byAgenda);
 const title=dayLabel(date)+(['Сегодня','Завтра','Вчера'].includes(dayLabel(date))?', '+d.getDate()+' '+MONTHS_GEN[d.getMonth()]:'');
 box.append(pager(title,n=>shiftDate(n)));
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
 box.append(pager(title,n=>shiftDate(7*n)));
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
 box.append(pager(cap(MONTHS[m.getMonth()])+' '+m.getFullYear(),n=>setPv({month:new Date(m.getFullYear(),m.getMonth()+n,1)})));
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

// Правая панель: выбранное дело или заметка; иначе — выбранный день с «Заметкой дня».
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
function dayPanel(box){
 const date=pv.date,d=fromYmd(date),tasks=workspace.tasks.filter(x=>x.due===date&&inCat(x)).sort(byAgenda);
 const journal=workspace.notes.find(n=>n.day===date&&n.title.startsWith('Дневник')),dayNotes=workspace.notes.filter(n=>n.day===date&&n!==journal);
 box.append(h('div',{class:'detail-head'},h('h3',{text:dayLabel(date)+(dayLabel(date).length<10?' · '+d.getDate()+' '+MONTHS_GEN[d.getMonth()]:'')}),h('span',{class:'muted',text:WD[d.getDay()]})));
 box.append(tasks.length?h('div',{class:'task-list'},...tasks.map(x=>taskRow(x,{compact:true,showDate:false}))):h('p',{class:'muted',text:'Дел на этот день нет.'}));
 // «Заметка дня» сохраняется сама через секунду после ввода.
 const area=h('textarea',{class:'journal',rows:5,placeholder:'Мысли, итоги, что получилось сегодня…',value:journal?journal.content||'':'','aria-label':'Заметка дня'});
 const state=h('span',{class:'hint',text:journal?'Сохранено':''});
 let timer,saving=Promise.resolve(),id=journal?.id;
 area.addEventListener('input',()=>{state.textContent='…';clearTimeout(timer);timer=setTimeout(()=>{saving=saving.then(async()=>{
  try{if(id)await items('PATCH',{collection:'notes',id,content:area.value});else if(area.value.trim()){const made=await items('POST',{collection:'notes',title:journalTitle(date),content:area.value,day:date});id=made.id}
   state.textContent='Сохранено';const w=await request('/api/workspace');workspace=w;workspace.notes??=[];workspace.tasks??=[]}catch(e){state.textContent='Ошибка: '+e.message}})},900)});
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
function factRow(fact){const row=element('div','','item'),detail=element('div');const subject=element('button',fact.subject,'link');subject.onclick=()=>loadFacts('/api/facts/relations?subject='+encodeURIComponent(fact.subject),'Связи: '+fact.subject);detail.append(subject,element('span',' — '+fact.predicate+' → '+fact.object),element('p','Источник: '+fact.source_id+' · уверенность '+fact.confidence+' · '+new Date(fact.observed_at).toLocaleString(),'muted'));row.append(detail);return row}
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
window.TenmaApp={refresh,go,get workspace(){return workspace}};refresh();
