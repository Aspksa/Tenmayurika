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
// Списки планера: встроенные «Личное» и «Дела» (их можно переименовать и перекрасить) и свои из workspace.lists.
const LIST_COLORS=['#e8c25a','#7fb6ff','#ee8a3c','#7fd6a0','#b59cff','#ff8fa8','#5fd0d0','#a79c8a'];
const BUILTIN_LISTS=[{id:'personal',title:'Личное',color:'#e8c25a'},{id:'work',title:'Дела',color:'#7fb6ff'}];
let listsMemo=null,listsFor=null;
function allLists(){
 if(listsFor===workspace&&listsMemo)return listsMemo;
 const saved=Array.isArray(workspace.lists)?workspace.lists:[];
 listsFor=workspace;listsMemo=[...BUILTIN_LISTS.map(d=>({...d,...saved.find(l=>l.id===d.id),builtin:true})),...saved.filter(l=>l&&l.id&&!BUILTIN_LISTS.some(d=>d.id===l.id))];
 return listsMemo;
}
const listById=id=>allLists().find(l=>l.id===id)||null;
const catOf=x=>listById(x.category)?x.category:'personal';
const listOf=x=>listById(catOf(x));
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

/* ---------- Планер: списки слева, день/неделя/месяц на одной оси времени, карточка справа ---------- */
const PV_KEY='tenmayurika.planner.v1';
const pv=(()=>{const d={view:'week',list:'today',cat:'all',date:today(),month:null,sel:null,query:'',mini:false};try{const s=JSON.parse(localStorage.getItem(PV_KEY));if(s&&typeof s==='object'){for(const k of ['view','list','cat'])if(typeof s[k]==='string')d[k]=s[k]}}catch{}return d})();
const savePv=()=>{try{localStorage.setItem(PV_KEY,JSON.stringify({view:pv.view,list:pv.list,cat:pv.cat}))}catch{}};
const VIEWS=[['list','Список'],['day','День'],['week','Неделя'],['month','Месяц'],['notes','Заметки']];
const TIME_VIEWS=['day','week','month'];
// Масштаб: месяц → неделя → день. Переход к большему масштабу «приближает», к меньшему — «отдаляет».
const ZOOM={month:0,week:1,day:2};
const LISTS=[['today','Сегодня'],['upcoming','Ближайшие 7 дней'],['overdue','Просрочено'],['nodate','Без срока'],['all','Все дела'],['done','Выполнено']];
const inCat=x=>pv.cat==='all'||!listById(pv.cat)||catOf(x)===pv.cat;
function listFilter(key){
 const t=today(),week=ymd(addDays(new Date(),7));
 return {today:x=>!x.done&&x.due&&x.due<=t,upcoming:x=>!x.done&&x.due>t&&x.due<=week,overdue:x=>!x.done&&x.due&&x.due<t,nodate:x=>!x.done&&!x.due,all:x=>!x.done,done:x=>x.done}[key]||(()=>true);
}
function setPv(changes){Object.assign(pv,changes);savePv();render()}
const weekStartOf=d=>addDays(d,-((d.getDay()+6)%7));
const monthOf=d=>new Date(d.getFullYear(),d.getMonth(),1);
// Номер недели по ISO: неделя с четвергом.
function isoWeek(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+3-((d.getDay()+6)%7));const y1=new Date(x.getFullYear(),0,4);return 1+Math.round(((x-y1)/86400000-3+((y1.getDay()+6)%7))/7)}

// Анимация следующей перерисовки: приближение, отдаление или листание.
let anim=null;
function goView(view,date,e){
 const from=ZOOM[pv.view],to=ZOOM[view];
 anim=from!=null&&to!=null&&from!==to?{kind:to>from?'in':'out',origin:originOf(e)}:{kind:'fade'};
 const d=fromYmd(date||pv.date);
 setPv({view,date:date||pv.date,month:monthOf(d),sel:null,mini:false});
}
function originOf(e){
 const host=document.querySelector('.pn-view'),el=e?.currentTarget;
 if(!host||!el?.getBoundingClientRect)return null;
 const a=host.getBoundingClientRect(),b=el.getBoundingClientRect();
 return Math.round(b.left+b.width/2-a.left)+'px '+Math.round(b.top+b.height/2-a.top)+'px';
}
function step(n){
 anim={kind:n>0?'next':'prev'};
 if(pv.view==='month'){const m=pv.month||monthOf(fromYmd(pv.date)),next=new Date(m.getFullYear(),m.getMonth()+n,1);const keep=Math.min(fromYmd(pv.date).getDate(),new Date(next.getFullYear(),next.getMonth()+1,0).getDate());setPv({month:next,date:ymd(new Date(next.getFullYear(),next.getMonth(),keep)),sel:null})}
 else{const d=addDays(fromYmd(pv.date),pv.view==='week'?7*n:n);setPv({date:ymd(d),month:monthOf(d),sel:null})}
}
function goToday(){const t=today();if(t===pv.date&&pv.month&&ymd(pv.month).slice(0,7)===t.slice(0,7))return;anim={kind:t<pv.date?'prev':'next'};setPv({date:t,month:monthOf(new Date()),sel:null})}
// Выбор дня: в виде «Список»/«Заметки» открывается «День», иначе вид остаётся, меняется дата.
function openDay(key,e){
 const d=fromYmd(key);
 if(!TIME_VIEWS.includes(pv.view))return goView('day',key,e);
 if(pv.view==='month'&&ymd(pv.month||monthOf(d)).slice(0,7)!==key.slice(0,7))anim={kind:key<pv.date?'prev':'next'};
 if(pv.view==='week'&&ymd(weekStartOf(d))!==ymd(weekStartOf(fromYmd(pv.date))))anim={kind:key<pv.date?'prev':'next'};
 if(pv.view==='day'&&key!==pv.date)anim={kind:key<pv.date?'prev':'next'};
 setPv({date:key,month:monthOf(d),sel:null,mini:false});
}

// На узком экране карточка открывается выезжающей панелью справа.
function selectItem(type,id){
 // С «Обзора» дело открывается в планере на своём дне.
 if(page!=='planner'){const x=workspace[type==='task'?'tasks':'notes'].find(i=>i.id===id),d=x?.due||x?.day;pv.sel={type,id};if(d){pv.date=d;pv.month=monthOf(fromYmd(d))}go('planner');return}
 pv.sel=pv.sel&&pv.sel.type===type&&pv.sel.id===id?null:{type,id};render();
 if(pv.sel)setTimeout(()=>document.querySelector('.pn-detail [name="title"]')?.focus({preventScroll:true}),0);
}

// Перетаскивание: дело можно бросить на час (день/неделя), на день (месяц, мини-календарь) или на список слева.
// После переноса — всплывашка «Вернуть» с прежними датой, временем и списком.
let dragId=null;
function draggable(node,task){
 if(task.done)return node;
 node.draggable=true;
 node.addEventListener('dragstart',e=>{dragId=task.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',task.title);node.classList.add('dragging');document.body.classList.add('pn-dragging')});
 node.addEventListener('dragend',()=>{dragId=null;node.classList.remove('dragging');document.body.classList.remove('pn-dragging')});
 return node;
}
function dropTarget(node,patchFor,onOver){
 node.addEventListener('dragover',e=>{if(!dragId)return;e.preventDefault();e.stopPropagation();node.classList.add('drop');onOver?.(e)});
 node.addEventListener('dragleave',e=>{if(!node.contains(e.relatedTarget))node.classList.remove('drop')});
 node.addEventListener('drop',e=>{
  e.preventDefault();e.stopPropagation();node.classList.remove('drop');const id=dragId;dragId=null;document.body.classList.remove('pn-dragging');if(!id)return;
  const task=workspace.tasks.find(x=>x.id===id),patch=patchFor(e);if(!task||!patch)return;
  const prev={due:task.due||null,time:task.time||null,category:task.category||'personal'};
  if(Object.keys(patch).every(k=>(patch[k]??null)===(prev[k]??null)))return;
  act(async()=>{await items('PATCH',{collection:'tasks',id,...patch});
   const where='category' in patch?'в «'+(listById(patch.category)?.title||'список')+'»':(patch.due?dayLabel(patch.due):'без срока')+(patch.time?' · '+patch.time:'');
   toast('«'+task.title+'» → '+where,['Вернуть',()=>act(()=>items('PATCH',{collection:'tasks',id,...prev}))])});
 });
 return node;
}

// Отмена удаления: запись восстанавливается теми же полями.
function removeWithUndo(collection,item){
 act(async()=>{
  await items('DELETE',{collection,id:item.id});
  if(pv.sel?.id===item.id)pv.sel=null;
  toast((collection==='tasks'?'Дело':'Заметка')+' «'+item.title+'» удалено',[ 'Вернуть',async()=>{
   const {id,createdAt,updatedAt,doneAt,...fields}=item;
   if(!listById(fields.category))fields.category='personal';
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
// Медные искры при выполнении дела.
function sparkle(x,y){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 for(let i=0;i<10;i++){const s=h('span',{class:'spark'});const a=Math.PI*2*i/10,r=26+Math.random()*16;s.style.cssText=`left:${x}px;top:${y}px;--dx:${Math.cos(a)*r}px;--dy:${Math.sin(a)*r}px`;document.body.append(s);setTimeout(()=>s.remove(),700)}
}
function toggleDone(task,e){
 if(!task.done&&e)sparkle(e.clientX,e.clientY);
 act(()=>items('PATCH',{collection:'tasks',id:task.id,done:!task.done}));
}
const listChip=l=>h('span',{class:'tag lc',style:'--lc:'+l.color},h('i',{class:'lc-dot'}),l.title);

function taskRow(task,{compact=false,showDate=true,time=true,showList=true}={}){
 const t=today(),late=!task.done&&task.due&&task.due<t,l=listOf(task),sel=pv.sel?.type==='task'&&pv.sel.id===task.id;
 const check=h('button',{type:'button',class:'check'+(task.done?' on':''),'aria-label':task.done?'Вернуть в работу':'Отметить выполненным',title:task.done?'Вернуть':'Готово',onclick:e=>{e.stopPropagation();toggleDone(task,e)}},task.done?'✓':'');
 const meta=h('div',{class:'task-meta'},showList&&(page!=='planner'||pv.cat==='all')?listChip(l):null,
  showDate&&task.due?chip((late?'⚠ ':'')+dayLabel(task.due)+(task.time?' · '+task.time:''),late?'late':task.due===t?'today':''):(!showDate&&time&&task.time?chip(task.time,'today'):null),
  task.priority==='high'?chip('! важное','high'):task.priority==='low'?chip('не срочно','low'):null,
  task.content&&!compact?chip('✎ заметка'):null);
 const row=h('div',{class:'task-row'+(task.done?' done':'')+(late?' late':'')+(task.priority==='high'?' high':'')+(sel?' selected':''),style:'--lc:'+l.color,tabindex:'0',role:'button','aria-label':task.title,
  onclick:()=>selectItem('task',task.id),onkeydown:e=>{if(e.key==='Enter'&&e.target===row)selectItem('task',task.id)}},check,h('div',{class:'task-body'},h('div',{class:'task-title',text:task.title}),meta.childNodes.length?meta:null));
 return draggable(row,task);
}
// Короткая плашка дела для сетки: «весь день», месяц.
function evChip(task){
 const l=listOf(task),sel=pv.sel?.type==='task'&&pv.sel.id===task.id,late=!task.done&&task.due&&task.due<today();
 const node=h('div',{class:'pn-chip'+(task.done?' done':'')+(task.priority==='high'?' high':'')+(late?' late':'')+(sel?' selected':''),style:'--lc:'+l.color,tabindex:'0',role:'button',title:(task.time?task.time+' · ':'')+task.title+' — '+l.title,
  onclick:e=>{e.stopPropagation();selectItem('task',task.id)},onkeydown:e=>{if(e.key==='Enter'){e.stopPropagation();selectItem('task',task.id)}}},
  h('i',{class:'lc-dot'}),task.time?h('time',{text:task.time}):null,h('span',{text:task.title}));
 return draggable(node,task);
}

function renderPlanner(){
 root.querySelector('h2')?.remove();
 const shell=h('div',{class:'pn view-'+pv.view+(pv.sel?' has-sel':'')+(pv.mini?' mini-open':'')});
 shell.append(plannerSide(),plannerMain(),plannerDetail(),h('div',{class:'pn-scrim','aria-hidden':'true',onclick:()=>{pv.sel=null;render()}}));
 root.append(shell);
 restoreGridScroll();
}

/* ----- Левая колонка: мини-месяц, фокус, списки ----- */
let listEdit=null;// 'new' | id списка, который сейчас правится
function plannerSide(){
 const side=h('aside',{class:'pn-side panel','aria-label':'Навигация планера'});
 side.append(miniMonth());
 // Фокус: умные подборки дел.
 const focus=h('nav',{class:'pn-focus','aria-label':'Подборки'},
  ...LISTS.map(([k,label])=>{const n=workspace.tasks.filter(x=>inCat(x)&&listFilter(k)(x)).length,on=pv.view==='list'&&pv.list===k;
   return h('button',{type:'button',class:'pn-item'+(on?' on':'')+(k==='overdue'&&n?' warn':''),'aria-current':on?'true':null,onclick:()=>{anim={kind:'fade'};setPv({view:'list',list:k,sel:null,mini:false})}},h('span',{class:'pn-item-label',text:label}),h('span',{class:'seg-count',text:String(n)}))}),
  h('button',{type:'button',class:'pn-item'+(pv.view==='notes'?' on':''),onclick:()=>{anim={kind:'fade'};setPv({view:'notes',sel:null,mini:false})}},h('span',{class:'pn-item-label',text:'Заметки'}),h('span',{class:'seg-count',text:String(workspace.notes.filter(inCat).length)})));
 side.append(h('h4',{class:'pn-sub',text:'Фокус'}),focus);
 // Списки: «Личное», «Дела» и свои. Выбранный список фильтрует все виды. На список можно бросить дело.
 const open=id=>workspace.tasks.filter(x=>!x.done&&(id==='all'||catOf(x)===id)).length;
 const lists=h('nav',{class:'pn-lists','aria-label':'Списки'},
  h('button',{type:'button',class:'pn-item'+(pv.cat==='all'||!listById(pv.cat)?' on':''),onclick:()=>setPv({cat:'all'})},h('i',{class:'lc-dot all'}),h('span',{class:'pn-item-label',text:'Все списки'}),h('span',{class:'seg-count',text:String(open('all'))})));
 for(const l of allLists()){
  if(listEdit===l.id){lists.append(listForm(l));continue}
  const on=pv.cat===l.id;
  lists.append(dropTarget(h('div',{class:'pn-item pn-list'+(on?' on':''),style:'--lc:'+l.color},
   h('button',{type:'button',class:'pn-list-main','aria-pressed':String(on),onclick:()=>setPv({cat:on?'all':l.id})},h('i',{class:'lc-dot'}),h('span',{class:'pn-item-label',text:l.title}),h('span',{class:'seg-count',text:String(open(l.id))})),
   h('button',{type:'button',class:'pn-list-edit','aria-label':'Изменить список «'+l.title+'»',title:'Изменить',onclick:()=>{listEdit=l.id;render()}},'⋯')),()=>({category:l.id})));
 }
 lists.append(listEdit==='new'?listForm(null):h('button',{type:'button',class:'pn-item pn-add',onclick:()=>{listEdit='new';render();setTimeout(()=>document.querySelector('.pn-list-form input')?.focus(),0)}},h('span',{class:'pn-plus',text:'+'}),h('span',{class:'pn-item-label',text:'Новый список'})));
 side.append(h('h4',{class:'pn-sub',text:'Списки'}),lists,
  h('p',{class:'hint keys',text:'N — новое · 1–5 — вид · T — сегодня · ← → — листать · Esc — закрыть'}));
 return side;
}
// Создание и правка списка: название и цвет. Встроенные можно переименовать, свои — ещё и удалить.
function listForm(l){
 const title=h('input',{name:'list-title',maxLength:40,required:true,value:l?l.title:'',placeholder:'Название списка','aria-label':'Название списка'});
 let color=l?l.color:LIST_COLORS[(allLists().length)%LIST_COLORS.length];
 const sw=h('div',{class:'pn-swatches',role:'radiogroup','aria-label':'Цвет'},...LIST_COLORS.map(c=>h('button',{type:'button',class:'pn-swatch'+(c===color?' on':''),style:'--lc:'+c,role:'radio','aria-checked':String(c===color),'aria-label':'Цвет '+c,onclick:e=>{color=c;sw.querySelectorAll('.pn-swatch').forEach(b=>{const on=b===e.currentTarget;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on))})}})));
 const form=h('form',{class:'pn-list-form'},title,sw,h('div',{class:'row'},h('button',{class:'primary',text:l?'Сохранить':'Создать'}),h('button',{type:'button',text:'Отмена',onclick:()=>{listEdit=null;render()}}),
  l&&!l.builtin?h('button',{type:'button',class:'danger-btn',text:'Удалить',onclick:()=>removeList(l)}):null));
 form.onsubmit=e=>{e.preventDefault();const v=title.value.trim();if(!v)return;
  act(async()=>{if(l)await request('/api/items',{method:'PATCH',headers:json,body:JSON.stringify({collection:'lists',id:l.id,title:v,color})});
   else{const made=await request('/api/items',{method:'POST',headers:json,body:JSON.stringify({collection:'lists',title:v,color})});pv.cat=made.id;savePv()}
   listEdit=null})};
 title.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();listEdit=null;render()}});
 return form;
}
function removeList(l){
 const n=workspace.tasks.filter(x=>x.category===l.id).length+workspace.notes.filter(x=>x.category===l.id).length;
 if(!confirm('Удалить список «'+l.title+'»?'+(n?' Его записи ('+n+') перейдут в «Личное».':'')))return;
 act(async()=>{await request('/api/items',{method:'DELETE',headers:json,body:JSON.stringify({collection:'lists',id:l.id})});if(pv.cat===l.id){pv.cat='all';savePv()}listEdit=null;
  toast('Список «'+l.title+'» удалён'+(n?' · записи в «Личном»':''))});
}
// Мини-месяц: навигация по датам, нагрузка дней и подсветка того, что сейчас открыто.
function miniMonth(){
 const t=today(),sel=fromYmd(pv.date);pv.month??=monthOf(sel);
 const m=pv.mini_m&&pv.view!=='month'?pv.mini_m:pv.month;
 let [a,b]=[pv.date,pv.date];
 if(pv.view==='week'){const s=weekStartOf(sel);a=ymd(s);b=ymd(addDays(s,6))}
 if(pv.view==='month'){a=ymd(m);b=ymd(new Date(m.getFullYear(),m.getMonth()+1,0))}
 const load=new Map(),late=new Set();
 for(const x of workspace.tasks)if(x.due&&!x.done&&inCat(x)){load.set(x.due,(load.get(x.due)||0)+1);if(x.due<t)late.add(x.due)}
 const first=monthOf(m),start=weekStartOf(first);
 const grid=h('div',{class:'pn-mini-grid'},h('span',{class:'pn-mini-wd'}),...['пн','вт','ср','чт','пт','сб','вс'].map((d,i)=>h('span',{class:'pn-mini-wd'+(i>4?' we':''),text:d})));
 for(let w=0;w<6;w++){
  const ws=addDays(start,w*7);if(w>=5&&ws.getMonth()!==m.getMonth())break;
  const inWeek=pv.view==='week'&&ymd(ws)===a;
  grid.append(h('button',{type:'button',class:'pn-mini-wk'+(inWeek?' on':''),title:'Неделя '+isoWeek(ws),'aria-label':'Открыть неделю '+isoWeek(ws),onclick:e=>goView('week',ymd(ws),e)},String(isoWeek(ws))));
  for(let i=0;i<7;i++){
   const d=addDays(ws,i),key=ymd(d),n=load.get(key)||0;
   grid.append(dropTarget(h('button',{type:'button',class:'pn-mini-day'+(d.getMonth()!==m.getMonth()?' other':'')+(key===t?' today':'')+(key===pv.date?' selected':'')+(key>=a&&key<=b?' in-range':'')+(key===a?' r-start':'')+(key===b?' r-end':'')+(i>4?' we':''),
    'aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(n?', открытых дел: '+n:''),'aria-pressed':String(key===pv.date),onclick:e=>openDay(key,e),ondblclick:e=>goView('day',key,e)},
    h('span',{text:String(d.getDate())}),n?h('i',{class:'pn-load l'+(n>=4?3:n>=2?2:1)+(late.has(key)?' late':'')}):null),()=>({due:key})));
  }
 }
 const shift=n=>{const base=pv.mini_m||m;pv.mini_m=new Date(base.getFullYear(),base.getMonth()+n,1);if(pv.view==='month'){pv.mini_m=null;step(n)}else render()};
 return h('section',{class:'pn-mini','aria-label':'Мини-календарь'},
  h('div',{class:'pn-mini-head'},h('strong',{text:cap(MONTHS[m.getMonth()])+' '+m.getFullYear()}),
   h('button',{type:'button',class:'icon-btn','aria-label':'Предыдущий месяц',onclick:()=>shift(-1)},'‹'),
   h('button',{type:'button',class:'icon-btn','aria-label':'Следующий месяц',onclick:()=>shift(1)},'›')),grid);
}

const plural=(n,[one,few,many])=>{const a=n%10,b=n%100;return a===1&&b!==11?one:a>=2&&a<=4&&(b<10||b>=20)?few:many};
const WD_FULL=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const cap=w=>w?w[0].toUpperCase()+w.slice(1):w;
const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const hhmm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');

/* ----- Центр: шапка (листание, вид), быстрый ввод и сам вид ----- */
function rangeTitle(){
 const d=fromYmd(pv.date);
 if(pv.view==='day'){const rel=dayLabel(pv.date);return ['Сегодня','Завтра','Вчера'].includes(rel)?rel+', '+d.getDate()+' '+MONTHS_GEN[d.getMonth()]:cap(WD_FULL[d.getDay()])+', '+d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?' '+d.getFullYear():'')}
 if(pv.view==='week'){const s=weekStartOf(d),e=addDays(s,6);return s.getDate()+(s.getMonth()!==e.getMonth()?' '+MONTHS_GEN[s.getMonth()]:'')+' – '+e.getDate()+' '+MONTHS_GEN[e.getMonth()]+' '+e.getFullYear()}
 if(pv.view==='month'){const m=pv.month||monthOf(d);return cap(MONTHS[m.getMonth()])+' '+m.getFullYear()}
 if(pv.view==='notes')return 'Заметки';
 return Object.fromEntries(LISTS)[pv.list]||'Дела';
}
function isCurrentRange(){
 const t=today(),d=fromYmd(pv.date);
 if(pv.view==='day')return pv.date===t;
 if(pv.view==='week')return ymd(weekStartOf(d))===ymd(weekStartOf(new Date()));
 if(pv.view==='month')return ymd(pv.month||monthOf(d)).slice(0,7)===t.slice(0,7);
 return true;
}
function plannerMain(){
 const box=h('section',{class:'pn-main panel'});
 const timeView=TIME_VIEWS.includes(pv.view),list=listById(pv.cat);
 const title=h('button',{type:'button',class:'pn-title','aria-expanded':String(!!pv.mini),title:'Показать мини-календарь',onclick:()=>{pv.mini=!pv.mini;pv.mini_m=null;render()}},h('span',{text:rangeTitle()}),h('i',{class:'pn-caret','aria-hidden':'true'}));
 const nav=h('div',{class:'pn-nav'},
  timeView?h('button',{type:'button',class:'icon-btn','aria-label':'Назад',title:'Назад (←)',onclick:()=>step(-1)},'‹'):null,
  timeView?h('button',{type:'button',class:'icon-btn','aria-label':'Вперёд',title:'Вперёд (→)',onclick:()=>step(1)},'›'):null,
  title,
  timeView&&!isCurrentRange()?h('button',{type:'button',class:'chip-btn',text:'Сегодня',title:'Вернуться к сегодняшнему дню (T)',onclick:goToday}):null,
  list?h('button',{type:'button',class:'tag lc pn-filter',style:'--lc:'+list.color,title:'Показан только этот список — нажмите, чтобы показать все',onclick:()=>setPv({cat:'all'})},h('i',{class:'lc-dot'}),list.title,' ×'):null);
 const views=segmented(VIEWS.map(([v,l])=>({value:v,label:l})),pv.view,v=>v===pv.view?null:goView(v,pv.date),'Вид');
 views.classList.add('pn-views');
 views.querySelectorAll('button').forEach((b,i)=>b.title=VIEWS[i][1]+' — клавиша '+(i+1));
 box.append(h('div',{class:'pn-head'},h('div',{class:'pn-head-row'},nav,h('div',{class:'pn-head-tools'},views))),quickForm());
 const view=h('div',{class:'pn-view'});
 ({list:mainList,day:mainDay,week:mainWeek,month:mainMonth,notes:mainNotes}[pv.view]||mainList)(view);
 if(anim){view.classList.add('pn-anim-'+anim.kind);if(anim.origin)view.style.transformOrigin=anim.origin;anim=null}
 box.append(view);
 return box;
}
// Быстрый ввод: «созвон завтра в 10 #дела !». Тег «#название» кладёт дело в свой список.
let quickFocus=false;
function tagList(text){
 let category=null;
 const rest=text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu,(all,sp,tag)=>{const norm=tag.toLocaleLowerCase().replace(/_/g,' ');const l=allLists().find(x=>x.title.toLocaleLowerCase()===norm||x.title.toLocaleLowerCase().replace(/\s+/g,'')===norm.replace(/\s+/g,''));if(l&&!category){category=l.id;return sp}return all}).replace(/\s+/g,' ').trim();
 return {category,rest};
}
// Подсказки под строкой: нажатие дописывает слово в ввод, фокус остаётся в поле.
const QUICK_HINTS=[['сегодня','сегодня'],['завтра','завтра'],['в пятницу','в пятницу'],['в 10:00','в 10:00'],['! важное','!']];
function quickForm(){
 const input=h('input',{class:'quick-input',name:'quick',maxLength:500,autocomplete:'off',enterkeyhint:'done',placeholder:'Что нужно сделать?','aria-label':'Новое дело или заметка','aria-describedby':'quick-help'});
 const preview=h('div',{class:'quick-preview','aria-live':'polite'});
 let timer;
 const parse=async v=>{const tg=tagList(v);let p;try{p=await request('/api/parse',{method:'POST',headers:json,body:JSON.stringify({text:tg.rest||v})})}catch{p={title:tg.rest||v}}if(tg.category)p.category=tg.category;return p};
 const add=h('button',{class:'quick-add','aria-label':'Добавить',title:'Добавить (Enter)',disabled:true},h('span',{class:'quick-add-plus','aria-hidden':'true',text:'+'}),h('span',{class:'quick-add-text',text:'Добавить'}),h('kbd',{text:'↵'}));
 const update=()=>{clearTimeout(timer);const v=input.value.trim();add.disabled=!v;form.classList.toggle('has-text',!!v);if(!v||/^заметк/i.test(v)){preview.replaceChildren(v?chip('✎ заметка'):'');return}
  timer=setTimeout(async()=>{const d=defaultsFor(await parse(v));if(!input.value.trim())return;preview.replaceChildren(listChip(listById(d.category)||allLists()[0]),d.due?chip(dayLabel(d.due)+(d.time?' · '+d.time:''),'today'):chip('без срока'),d.priority==='high'?chip('! важное','high'):'')},220)};
 input.addEventListener('input',update);
 const insert=word=>{const v=input.value.replace(/\s+$/,'');input.value=(v?v+' ':'')+word+' ';input.focus();update()};
 const hints=h('div',{class:'quick-help',id:'quick-help'},
  ...QUICK_HINTS.map(([label,word])=>h('button',{type:'button',class:'quick-hint',text:label,onmousedown:e=>e.preventDefault(),onclick:()=>insert(word)})),
  ...allLists().slice(0,6).map(l=>h('button',{type:'button',class:'quick-hint lc',style:'--lc:'+l.color,onmousedown:e=>e.preventDefault(),onclick:()=>insert('#'+l.title.replace(/\s+/g,'_'))},h('i',{class:'lc-dot'}),'#'+l.title)),
  h('span',{class:'quick-tip',text:'«заметка: …» — заметка'}));
 const form=h('form',{class:'quick'},h('div',{class:'quick-row'},h('span',{class:'quick-plus','aria-hidden':'true',text:'+'}),input,preview,add),hints);
 form.onsubmit=async e=>{
  e.preventDefault();const v=input.value.trim();if(!v)return;
  const note=v.match(/^(?:новая\s+)?(?:(рабоч\S*|личн\S*)\s+)?заметк[аиу]\s*[:—–-]?\s*([\s\S]+)$/i);
  quickFocus=true;
  if(note){const m=note[2].match(/^(.+?)(?:\s+[—–-]\s+|:\s+)([\s\S]+)$/);await act(()=>items('POST',{collection:'notes',title:(m?m[1]:note[2]).slice(0,200),content:m?m[2]:'',category:note[1]?(/^рабоч/i.test(note[1])?'work':'personal'):currentList(),day:TIME_VIEWS.includes(pv.view)?pv.date:null}));return}
  const d=defaultsFor(await parse(v));
  await act(async()=>{await items('POST',{collection:'tasks',...d});toast('Добавлено: «'+d.title+'» · '+(d.due?dayLabel(d.due)+(d.time?' '+d.time:''):'без срока'))});
 };
 if(quickFocus){quickFocus=false;setTimeout(()=>input.focus(),0)}
 return form;
}
const currentList=()=>listById(pv.cat)?pv.cat:'personal';
// Дата и список по умолчанию: открытый день или «Сегодня», выбранный слева список.
function defaultsFor(p){
 let due=p.due||null;
 if(!due&&TIME_VIEWS.includes(pv.view))due=pv.date;
 if(!due&&pv.view==='list'&&pv.list==='today')due=today();
 if(!due&&p.time)due=today();
 return {title:(p.title||'').slice(0,200)||'Без названия',category:listById(p.category)?p.category:currentList(),due,time:p.time||null,priority:p.priority||'normal'};
}

function mainList(box){
 const search=h('input',{type:'search',class:'search',name:'search',placeholder:'Поиск по делам  /','aria-label':'Поиск по делам',value:pv.query});
 const body=h('div',{class:'task-groups'});
 const draw=()=>{
  const q=pv.query.trim().toLocaleLowerCase();
  const list=workspace.tasks.filter(x=>inCat(x)&&listFilter(pv.list)(x)&&(!q||(x.title+' '+(x.content||'')).toLocaleLowerCase().includes(q)));
  if(pv.list==='done')list.sort((a,b)=>String(b.doneAt||'').localeCompare(String(a.doneAt||'')));else list.sort(byAgenda);
  if(!list.length){body.replaceChildren(h('div',{class:'empty-state'},h('div',{class:'empty-mark',text:'◇'}),h('p',{text:q?'Ничего не найдено.':pv.list==='today'?'На сегодня всё свободно. Добавьте дело строкой сверху.':'Здесь пусто.'})));return}
  if(pv.list==='all'||pv.list==='upcoming'){
   const groups=new Map();for(const x of list){const k=x.due?(x.due<today()?'Просрочено':dayLabel(x.due)):'Без срока';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(x)}
   body.replaceChildren(...[...groups].map(([k,rows])=>h('section',{class:'task-group'+(k==='Просрочено'?' g-late':k==='Сегодня'?' g-today':'')},h('h3',{},k,h('span',{class:'seg-count',text:String(rows.length)})),...rows.map(x=>taskRow(x,{showDate:k==='Просрочено'})))));
  }else body.replaceChildren(h('section',{class:'task-group'},...list.map(x=>taskRow(x))));
 };
 search.addEventListener('input',()=>{pv.query=search.value;draw()});
 draw();
 box.append(h('div',{class:'pn-tools'},search),body);
}

// Одна ось времени для «Дня» и «Недели»: часы слева, дни колонками, дела без времени — в полосе «весь день».
// Дело занимает час; пересекающиеся дела встают рядом. Бросок на колонку назначает время с шагом 15 минут.
const gridScroll={key:null,top:null};
function restoreGridScroll(){
 const body=document.querySelector('.pn-tg-body');if(!body)return;
 const key=body.dataset.key;
 if(gridScroll.key===key&&gridScroll.top!=null)body.scrollTop=gridScroll.top;
 else{body.scrollTop=Number(body.dataset.auto||0);gridScroll.key=key}
 body.addEventListener('scroll',()=>{gridScroll.key=key;gridScroll.top=body.scrollTop},{passive:true});
 // Неделя на телефоне листается вбок: сразу показываем выбранный день.
 const wrap=body.closest('.pn-tg'),col=wrap?.querySelector('.pn-tg-day.selected,.pn-tg-day.today');
 if(wrap&&col&&wrap.scrollWidth>wrap.clientWidth+4&&gridScroll.left!==key){wrap.scrollLeft=Math.max(0,col.offsetLeft-wrap.querySelector('.pn-tg-corner').offsetWidth);gridScroll.left=key}
}
function layoutDay(tasks){
 const evs=tasks.map(x=>({x,s:mins(x.time),e:Math.min(1440,mins(x.time)+60)})).sort((a,b)=>a.s-b.s||String(a.x.title).localeCompare(String(b.x.title)));
 const out=[];let cluster=[],end=-1;
 const flush=()=>{const cols=[];for(const ev of cluster){let c=cols.findIndex(t=>t<=ev.s);if(c<0){c=cols.length;cols.push(0)}cols[c]=ev.e;ev.col=c}for(const ev of cluster)ev.n=cols.length;out.push(...cluster);cluster=[]};
 for(const ev of evs){if(cluster.length&&ev.s>=end)flush();cluster.push(ev);end=Math.max(end,ev.e)}
 if(cluster.length)flush();
 return out;
}
function timeGrid(keys){
 const t=today(),now=new Date(),nowMin=now.getHours()*60+now.getMinutes();
 const byDay=new Map(keys.map(k=>[k,workspace.tasks.filter(x=>x.due===k&&inCat(x)).sort(byAgenda)]));
 const wrap=h('div',{class:'pn-tg'+(keys.length===1?' is-day':''),style:'--cols:'+keys.length});
 // Шапка дней: номер, день недели, сколько дел. Клик по дню в неделе — приближение к этому дню.
 const head=h('div',{class:'pn-tg-head'},h('span',{class:'pn-tg-corner',text:'GMT'+(now.getTimezoneOffset()<=0?'+':'-')+Math.abs(now.getTimezoneOffset()/60)}));
 const allday=h('div',{class:'pn-tg-allday'},h('span',{class:'pn-tg-label',text:'весь день'}));
 for(const k of keys){
  const d=fromYmd(k),list=byDay.get(k),open=list.filter(x=>!x.done).length;
  head.append(h('button',{type:'button',class:'pn-tg-day'+(k===t?' today':'')+(k===pv.date&&keys.length>1?' selected':'')+(d.getDay()%6===0?' we':''),'aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(keys.length>1?' — открыть день':''),
   onclick:e=>keys.length>1?goView('day',k,e):null},h('span',{class:'pn-tg-wd',text:WD[d.getDay()]}),h('strong',{text:String(d.getDate())}),open?h('span',{class:'pn-tg-n',text:String(open)}):null));
  allday.append(dropTarget(h('div',{class:'pn-tg-cell'+(k===t?' today':''),onclick:e=>{if(e.target===e.currentTarget&&k!==pv.date)openDay(k)}},...list.filter(x=>!x.time).map(evChip)),()=>({due:k,time:null})));
 }
 const body=h('div',{class:'pn-tg-body',tabindex:'-1','data-key':pv.view+':'+keys[0]});
 const hours=h('div',{class:'pn-tg-hours','aria-hidden':'true'},...Array.from({length:24},(_,i)=>h('span',{text:i?String(i).padStart(2,'0')+':00':''})));
 const cols=h('div',{class:'pn-tg-cols'});
 let first=24;
 for(const k of keys){
  const timed=byDay.get(k).filter(x=>x.time);
  const col=h('div',{class:'pn-tg-col'+(k===t?' today':'')+(fromYmd(k).getDay()%6===0?' we':''),'aria-label':'Часы, '+dayLabel(k)});
  // Позиция курсора → время с шагом 15 минут.
  const at=e=>{const r=col.getBoundingClientRect();return Math.max(0,Math.min(1425,Math.round((e.clientY-r.top)/r.height*1440/15)*15))};
  dropTarget(col,e=>({due:k,time:hhmm(at(e))}),e=>{const m=at(e);col.style.setProperty('--dy',(m/1440*100)+'%');col.dataset.drop=hhmm(m)});
  col.addEventListener('dragleave',e=>{if(!col.contains(e.relatedTarget))delete col.dataset.drop});
  col.addEventListener('drop',()=>{delete col.dataset.drop});
  for(const ev of layoutDay(timed)){
   const x=ev.x,l=listOf(x),sel=pv.sel?.type==='task'&&pv.sel.id===x.id;
   first=Math.min(first,Math.floor(ev.s/60));
   const node=h('div',{class:'pn-ev'+(x.done?' done':'')+(x.priority==='high'?' high':'')+(sel?' selected':'')+(k===t&&ev.e<=nowMin?' past':'')+(k===t&&ev.s<=nowMin&&nowMin<ev.e?' current':''),
    style:`--lc:${l.color};--top:${ev.s/1440*100}%;--h:${(ev.e-ev.s)/1440*100}%;--left:${ev.col/ev.n*100}%;--w:${100/ev.n}%`,tabindex:'0',role:'button','aria-label':x.time+' '+x.title,title:x.time+' · '+x.title+' — '+l.title,
    onclick:e=>{e.stopPropagation();selectItem('task',x.id)},onkeydown:e=>{if(e.key==='Enter'){e.stopPropagation();selectItem('task',x.id)}}},
    h('button',{type:'button',class:'pn-ev-check'+(x.done?' on':''),'aria-label':x.done?'Вернуть в работу':'Отметить выполненным',onclick:e=>{e.stopPropagation();toggleDone(x,e)}},x.done?'✓':''),
    h('span',{class:'pn-ev-text'},h('time',{text:x.time}),h('span',{class:'pn-ev-title',text:x.title})));
   col.append(draggable(node,x));
  }
  if(k===t)col.append(h('div',{class:'pn-now',style:'--top:'+(nowMin/1440*100)+'%',title:'Сейчас '+hhmm(nowMin)},h('span',{text:hhmm(nowMin)})));
  cols.append(col);
 }
 // Прокрутка при открытии: к «сейчас» (сегодня), иначе к первому делу или к 7:00.
 const startHour=keys.includes(t)?Math.max(0,Math.min(first,now.getHours()-1)):Math.min(first,7);
 body.dataset.auto=String(Math.max(0,startHour-.25)*hourPx());
 body.append(h('div',{class:'pn-tg-grid'},hours,cols));
 wrap.append(head,allday,body);
 return wrap;
}
// Высота часа в пикселях (из CSS-переменной --hr) — для начальной прокрутки сетки.
function hourPx(){const probe=h('div',{style:'position:absolute;visibility:hidden;height:var(--hr)'});(document.querySelector('.pn')||document.body).append(probe);const px=probe.getBoundingClientRect().height||48;probe.remove();return px}
function mainDay(box){
 // Полоска недели над сеткой: быстрый переход по дням, видно загрузку.
 const d=fromYmd(pv.date),s=weekStartOf(d),t=today();
 const strip=h('div',{class:'pn-strip',role:'group','aria-label':'Дни недели'},...Array.from({length:7},(_,i)=>{const day=addDays(s,i),k=ymd(day),n=workspace.tasks.filter(x=>x.due===k&&!x.done&&inCat(x)).length;
  return dropTarget(h('button',{type:'button',class:'pn-strip-day'+(k===pv.date?' on':'')+(k===t?' today':'')+(i>4?' we':''),'aria-pressed':String(k===pv.date),onclick:()=>openDay(k)},h('span',{text:WD[day.getDay()]}),h('strong',{text:String(day.getDate())}),h('i',{class:'pn-strip-load',style:'--n:'+Math.min(n,5)})),()=>({due:k}))}),
  h('button',{type:'button',class:'chip-btn pn-zoom-out',text:'↑ неделя',title:'Отдалить до недели',onclick:e=>goView('week',pv.date,e)}));
 box.append(strip,timeGrid([pv.date]));
}
function mainWeek(box){
 const s=weekStartOf(fromYmd(pv.date));
 box.append(timeGrid(Array.from({length:7},(_,i)=>ymd(addDays(s,i)))));
}
// Месяц: номер недели слева приближает к неделе, число дня — к дню. Плашки дел можно таскать между днями.
function mainMonth(box){
 const sel=fromYmd(pv.date);pv.month??=monthOf(sel);
 const m=pv.month,start=weekStartOf(m),t=today();
 const byDay=new Map();for(const x of workspace.tasks)if(x.due&&inCat(x)){if(!byDay.has(x.due))byDay.set(x.due,[]);byDay.get(x.due).push(x)}
 const notesByDay=new Set(workspace.notes.filter(n=>n.day&&inCat(n)).map(n=>n.day));
 const grid=h('div',{class:'pn-month'},h('span',{class:'pn-month-wd'}),...['пн','вт','ср','чт','пт','сб','вс'].map((d,i)=>h('span',{class:'pn-month-wd'+(i>4?' we':''),text:d})));
 const max=innerWidth<640?0:innerWidth<1100?2:3;
 for(let w=0;w<6;w++){
  const ws=addDays(start,w*7);if(w>=4&&ws.getMonth()!==m.getMonth()&&ws>m)break;
  grid.append(h('button',{type:'button',class:'pn-month-wk','aria-label':'Открыть неделю '+isoWeek(ws),title:'Неделя '+isoWeek(ws),onclick:e=>goView('week',ymd(ws),e)},String(isoWeek(ws))));
  for(let i=0;i<7;i++){
   const d=addDays(ws,i),key=ymd(d),list=(byDay.get(key)||[]).sort(byAgenda),open=list.filter(x=>!x.done);
   const late=open.some(()=>key<t);
   grid.append(dropTarget(h('div',{class:'pn-month-day'+(d.getMonth()!==m.getMonth()?' other':'')+(key===t?' today':'')+(key===pv.date?' selected':'')+(i>4?' we':'')+(late?' late':''),
    tabindex:'0',role:'button','aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(list.length?', дел: '+list.length:''),
    onclick:()=>openDay(key),ondblclick:e=>goView('day',key,e),onkeydown:e=>{if(e.key==='Enter'&&e.target===e.currentTarget)goView('day',key,e)}},
    h('div',{class:'pn-month-top'},h('button',{type:'button',class:'pn-month-num','aria-label':'Открыть день '+d.getDate()+' '+MONTHS_GEN[d.getMonth()],title:'Открыть день',onclick:e=>{e.stopPropagation();goView('day',key,e)}},String(d.getDate())),notesByDay.has(key)?h('i',{class:'note-dot',title:'Есть заметка'}):null,open.length&&!max?h('span',{class:'pn-month-n',text:String(open.length)}):null),
    max?h('div',{class:'pn-month-items'},...list.slice(0,max).map(evChip),list.length>max?h('span',{class:'pn-more',text:'+ ещё '+(list.length-max)}):null)
     :list.length?h('div',{class:'pn-month-dots'},...list.slice(0,4).map(x=>h('i',{class:x.done?'done':'',style:'--lc:'+listOf(x).color}))):null),()=>({due:key})));
  }
 }
 box.append(grid);
}
function mainNotes(box){
 const search=h('input',{type:'search',class:'search',name:'search',placeholder:'Поиск по заметкам  /',value:pv.query,'aria-label':'Поиск по заметкам'});
 const grid=h('div',{class:'note-grid'});
 const draw=()=>{
  const q=pv.query.trim().toLocaleLowerCase();
  const list=workspace.notes.filter(x=>inCat(x)&&(!q||(x.title+' '+(x.content||'')).toLocaleLowerCase().includes(q)))
   .sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  grid.replaceChildren(...(list.length?list.map(noteCard):[h('div',{class:'empty-state'},h('div',{class:'empty-mark',text:'◇'}),h('p',{text:q?'Ничего не найдено.':'Заметок пока нет. Напишите сверху «заметка: Идея — текст».'}))]));
 };
 search.addEventListener('input',()=>{pv.query=search.value;draw()});
 draw();
 box.append(h('div',{class:'pn-tools'},search,h('button',{type:'button',class:'primary',text:'+ Заметка',onclick:()=>{pv.sel={type:'note',id:'new'};render()}})),grid);
}
function noteCard(note){
 const l=listOf(note),sel=pv.sel?.type==='note'&&pv.sel.id===note.id;
 return h('article',{class:'note-card'+(note.pinned?' pinned':'')+(sel?' selected':''),style:'--lc:'+l.color,tabindex:'0',onclick:()=>selectItem('note',note.id),onkeydown:e=>{if(e.key==='Enter')selectItem('note',note.id)}},
  h('header',{},listChip(l),
   h('button',{type:'button',class:'icon-btn pin'+(note.pinned?' on':''),'aria-label':note.pinned?'Открепить':'Закрепить',title:note.pinned?'Открепить':'Закрепить',onclick:e=>{e.stopPropagation();act(()=>items('PATCH',{collection:'notes',id:note.id,pinned:!note.pinned}))}},'📌')),
  h('h4',{text:note.title}),note.content?h('p',{class:'note-text',text:note.content}):null,
  h('footer',{},h('span',{class:'muted',text:(note.day?dayLabel(note.day)+' · ':'')+new Date(note.updatedAt||note.createdAt||Date.now()).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})})));
}

/* ----- Справа: выбранное дело/заметка, иначе повестка выбранного дня и «Заметка дня» ----- */
function plannerDetail(){
 const box=h('aside',{class:'pn-detail panel','aria-label':'Подробности'});
 const sel=pv.sel;
 if(sel?.type==='task'){const task=workspace.tasks.find(x=>x.id===sel.id);if(task){box.classList.add('is-task');box.style.setProperty('--lc',listOf(task).color);box.append(taskCard(task));return box}}
 if(sel?.type==='note'){const note=sel.id==='new'?null:workspace.notes.find(x=>x.id===sel.id);if(note||sel.id==='new'){box.append(detailHead(note?'Заметка':'Новая заметка'),noteForm(note,{day:sel.day||null}));if(note)box.append(h('div',{class:'row detail-actions'},h('button',{type:'button',class:'danger-btn',text:'Удалить',onclick:()=>removeWithUndo('notes',note)})));return box}}
 if(sel)pv.sel=null;
 return dayPanel(box);
}
function detailHead(title){return h('div',{class:'detail-head'},h('h3',{text:title}),h('button',{type:'button',class:'icon-btn','aria-label':'Закрыть',title:'Закрыть (Esc)',onclick:()=>{pv.sel=null;render()}},svg('i-close')))}
// Выбор списка в формах: все списки цветными кнопками.
function listPicker(name,value='personal'){
 return h('div',{class:'seg list-pick',role:'radiogroup','aria-label':'Список'},...allLists().map(l=>h('label',{style:'--lc:'+l.color},h('input',{type:'radio',name,value:l.id,checked:l.id===value}),h('i',{class:'lc-dot'}),h('span',{text:l.title}))));
}
// Карточка дела: крупный заголовок с галочкой, «когда» одним рядом быстрых дат, список и важность кнопками.
// Ctrl/⌘+Enter — сохранить. Состояние «есть несохранённые правки» видно на кнопке.
function taskCard(task){
 const t=today(),l=listOf(task),late=!task.done&&task.due&&task.due<t,name='cat-'+task.id;
 const title=h('textarea',{name:'title',class:'tc-title',required:true,maxLength:200,rows:1,value:task.title,'aria-label':'Название дела'});
 const fit=()=>{title.style.height='auto';title.style.height=title.scrollHeight+'px'};
 const date=h('input',{type:'date',name:'due',value:task.due||'','aria-label':'Дата'});
 const time=h('input',{type:'time',name:'time',value:task.time||'',step:900,'aria-label':'Время'});
 const notes=h('textarea',{name:'content',class:'tc-notes',placeholder:'Подробности, ссылки, шаги…',value:task.content||'',rows:4,'aria-label':'Подробности'});
 const QD=[['Сегодня',0],['Завтра',1],['Через неделю',7]];
 const quick=h('div',{class:'tc-dates',role:'group','aria-label':'Быстрая дата'},...QD.map(([lb,n])=>h('button',{type:'button',class:'tc-pill','data-d':ymd(addDays(new Date(),n)),text:lb,onclick:()=>{date.value=ymd(addDays(new Date(),n));sync()}})),
  h('button',{type:'button',class:'tc-pill','data-d':'',text:'Без срока',onclick:()=>{date.value='';time.value='';sync()}}));
 const prio=h('div',{class:'tc-prio',role:'radiogroup','aria-label':'Важность'},...[['low','Не срочно'],['normal','Обычное'],['high','Важное']].map(([k,v])=>h('label',{class:'p-'+k},h('input',{type:'radio',name:'prio-'+task.id,value:k,checked:(task.priority||'normal')===k}),h('span',{text:(k==='high'?'! ':'')+v}))));
 const save=h('button',{class:'primary tc-save',text:'Сохранить'});
 const form=h('form',{class:'task-form tc'},
  h('div',{class:'tc-head'},
   h('button',{type:'button',class:'check tc-check'+(task.done?' on':''),'aria-label':task.done?'Вернуть в работу':'Отметить выполненным',title:task.done?'Вернуть в работу':'Готово',onclick:e=>toggleDone(task,e)},task.done?'✓':''),
   title,
   h('button',{type:'button',class:'icon-btn tc-close','aria-label':'Закрыть',title:'Закрыть (Esc)',onclick:()=>{pv.sel=null;render()}},svg('i-close'))),
  h('div',{class:'tc-status'},listChip(l),task.due?chip((late?'⚠ ':'')+dayLabel(task.due)+(task.time?' · '+task.time:''),late?'late':task.due===t?'today':''):chip('без срока'),task.done?chip('✓ выполнено','today'):null),
  h('section',{class:'tc-sec'},h('h4',{class:'pn-sub',text:'Когда'}),quick,h('div',{class:'tc-when'},date,time)),
  h('section',{class:'tc-sec'},h('h4',{class:'pn-sub',text:'Список'}),listPicker(name,catOf(task))),
  h('section',{class:'tc-sec'},h('h4',{class:'pn-sub',text:'Важность'}),prio),
  h('section',{class:'tc-sec'},h('h4',{class:'pn-sub',text:'Подробности'}),notes),
  h('div',{class:'tc-foot'},save,
   h('button',{type:'button',class:'tc-act',title:'Перенести на завтра',onclick:()=>act(()=>items('PATCH',{collection:'tasks',id:task.id,due:ymd(addDays(new Date(),1))}))},'→ завтра'),
   h('button',{type:'button',class:'tc-act danger-btn','aria-label':'Удалить дело',title:'Удалить (можно вернуть)',onclick:()=>removeWithUndo('tasks',task)},'Удалить')),
  h('p',{class:'hint tc-meta',text:'Создано '+new Date(task.createdAt||Date.now()).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+(task.doneAt?' · выполнено '+new Date(task.doneAt).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'')+' · Ctrl+Enter — сохранить'}));
 const initial=()=>JSON.stringify([task.title,task.due||'',task.time||'',task.priority||'normal',task.content||'',catOf(task)]);
 const current=()=>JSON.stringify([title.value,date.value,time.value,form.querySelector('input[name="prio-'+task.id+'"]:checked')?.value,notes.value,form.querySelector('input[name="'+name+'"]:checked')?.value]);
 function sync(){quick.querySelectorAll('.tc-pill').forEach(b=>b.classList.toggle('on',b.dataset.d===date.value));const dirty=current()!==initial();save.classList.toggle('dirty',dirty);save.textContent=dirty?'Сохранить ●':'Сохранено'}
 form.addEventListener('input',sync);form.addEventListener('change',sync);title.addEventListener('input',fit);
 title.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
 form.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();form.requestSubmit()}});
 form.onsubmit=e=>{e.preventDefault();if(!title.value.trim())return;const f={title:title.value.replace(/\s+/g,' ').trim(),category:form.querySelector('input[name="'+name+'"]:checked')?.value||'personal',due:date.value||null,time:time.value||null,priority:form.querySelector('input[name="prio-'+task.id+'"]:checked')?.value||'normal',content:notes.value};if(f.time&&!f.due)f.due=today();act(()=>items('PATCH',{collection:'tasks',id:task.id,...f}))};
 sync();requestAnimationFrame(fit);
 return form;
}
function noteForm(note,{day=null}={}){
 const name='ncat-'+(note?note.id:'new');
 const title=h('input',{name:'title',required:true,maxLength:200,placeholder:'Заголовок',value:note?note.title:'','aria-label':'Заголовок'});
 const content=h('textarea',{placeholder:'Текст заметки. Строки «FACT: субъект | связь | объект» попадут в память.',value:note?note.content||'':'',rows:10,'aria-label':'Текст'});
 const dayInput=h('input',{type:'date',value:note?note.day||'':day||'','aria-label':'День заметки',title:'Привязать к дню'});
 const form=h('form',{class:'note-form'},title,listPicker(name,note?catOf(note):currentList()),content,h('label',{class:'inline-field'},h('span',{text:'День'}),dayInput),h('button',{class:'primary',text:note?'Сохранить':'Создать заметку'}));
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
 if(!tasks.length){wrap.append(h('div',{class:'agenda-empty'},h('span',{class:'empty-mark',text:'◇'}),h('p',{text:'Свободный день. Перетащите сюда дело или напишите его в строке сверху.'})));return wrap}
 if(allDay.length)wrap.append(h('div',{class:'agenda-allday'},h('span',{class:'agenda-label',text:'Весь день'}),...allDay.map(x=>taskRow(x,{compact:true,showDate:false,showList:false}))));
 if(!timed.length)return wrap;
 const isToday=date===today(),now=new Date(),cur=now.getHours()*60+now.getMinutes(),nowText=hhmm(cur);
 const nowMark=()=>h('li',{class:'agenda-now'},h('time',{text:nowText}),h('span',{text:'сейчас'}));
 const rail=h('ol',{class:'agenda-rail'});
 let prev=null,nowShown=!isToday;
 for(const x of timed){
  const at=mins(x.time);
  if(prev!==null){const gap=at-prev-60;if(gap>=60)rail.append(h('li',{class:'agenda-gap',text:'свободно '+(gap>=120?Math.floor(gap/60)+' ч'+(gap%60?' '+gap%60+' мин':''):gap+' мин')}))}
  if(!nowShown&&at>cur){rail.append(nowMark());nowShown=true}
  rail.append(h('li',{class:'agenda-slot'+(isToday&&at+60<=cur?' past':'')+(isToday&&at<=cur&&cur<at+60?' current':'')},h('time',{text:x.time}),taskRow(x,{compact:true,showDate:false,time:false,showList:false})));
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
// Панель дня: по центру дата в кольце прогресса, коротко — сколько дел и что дальше; ниже повестка и «Заметка дня».
function dayPanel(box){
 const date=pv.date,d=fromYmd(date),t=today(),tasks=workspace.tasks.filter(x=>x.due===date&&inCat(x));
 const journal=workspace.notes.find(n=>n.day===date&&n.title.startsWith('Дневник')),dayNotes=workspace.notes.filter(n=>n.day===date&&n!==journal);
 const done=tasks.filter(x=>x.done).length,open=tasks.length-done,rel=dayLabel(date),isRel=['Сегодня','Завтра','Вчера'].includes(rel);
 const pct=tasks.length?Math.round(done/tasks.length*100):0;
 const timed=tasks.filter(x=>!x.done&&x.time).sort((a,b)=>a.time.localeCompare(b.time));
 let next=null;
 if(date===t&&timed.length){const now=new Date(),cur=now.getHours()*60+now.getMinutes(),x=timed.find(y=>mins(y.time)>=cur);if(x){const left=mins(x.time)-cur;next={task:x,text:left<60?'через '+left+' мин':'в '+x.time}}}
 const shift=n=>{anim={kind:n>0?'next':'prev'};const nd=addDays(d,n);setPv({date:ymd(nd),month:monthOf(nd),sel:null})};
 box.classList.add('is-day');
 box.append(h('section',{class:'pn-today'+(date===t?' is-today':''),'aria-label':'Выбранный день'},
  h('button',{type:'button',class:'icon-btn pn-today-step','aria-label':'Предыдущий день',onclick:()=>shift(-1)},'‹'),
  h('div',{class:'pn-today-core'},
   h('div',{class:'pn-today-ring',style:'--p:'+pct,role:'img','aria-label':'Выполнено '+done+' из '+tasks.length},h('strong',{text:String(d.getDate())}),h('span',{text:MONTHS_GEN[d.getMonth()].slice(0,3)})),
   h('div',{class:'pn-today-when'},h('strong',{text:isRel?rel:cap(WD_FULL[d.getDay()])}),h('span',{text:(isRel?WD_FULL[d.getDay()]+' · ':'')+d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?' '+d.getFullYear():'')}))),
  h('button',{type:'button',class:'icon-btn pn-today-step','aria-label':'Следующий день',onclick:()=>shift(1)},'›'),
  h('div',{class:'pn-today-stats'},
   h('span',{},h('b',{text:String(open)}),' '+plural(open,['открыто','открыто','открыто'])),
   h('span',{},h('b',{text:String(done)}),' готово'),
   h('span',{},h('b',{text:pct+'%'}),' дня')),
  next?h('button',{type:'button',class:'pn-today-next',style:'--lc:'+listOf(next.task).color,onclick:()=>selectItem('task',next.task.id)},h('span',{class:'pn-today-next-k',text:'дальше '+next.text}),h('span',{class:'pn-today-next-t',text:next.task.title})):null,
  h('div',{class:'pn-today-actions'},
   date!==t?h('button',{type:'button',class:'chip-btn',text:'К сегодня',onclick:()=>openDay(t)}):null,
   pv.view!=='day'?h('button',{type:'button',class:'chip-btn',text:'Открыть день →',onclick:e=>goView('day',date,e)}):null)));
 box.append(h('h4',{class:'pn-sub',text:'Повестка'}),dayAgenda(date));
 // «Заметка дня» сохраняется сама через секунду после ввода.
 const j=journalFor(date);
 const area=h('textarea',{class:'journal',rows:3,placeholder:'Мысли, итоги, что получилось…',value:j.draft??(journal?journal.content||'':''),'aria-label':'Заметка дня'});
 const state=h('span',{class:'hint',text:j.draft!=null?'…':journal?'Сохранено':''});
 area.addEventListener('input',()=>saveJournal(date,area.value,t=>{if(state.isConnected)state.textContent=t;else if(pv.date===date)document.querySelector('.journal-head .hint')?.replaceChildren(t)}));
 box.append(h('div',{class:'journal-head'},h('h4',{class:'pn-sub',text:'Заметка дня'}),state),area);
 if(dayNotes.length)box.append(h('h4',{class:'pn-sub',text:'Заметки этого дня'}),...dayNotes.map(n=>h('button',{type:'button',class:'note-link',onclick:()=>selectItem('note',n.id)},'✎ '+n.title)));
 box.append(h('button',{type:'button',class:'chip-btn add-note',text:'+ заметка к этому дню',onclick:()=>{pv.sel={type:'note',id:'new',day:date};render()}}));
 return box;
}
// Горячие клавиши планера.
document.addEventListener('keydown',e=>{
 if(page!=='planner'||e.ctrlKey||e.metaKey||e.altKey)return;
 const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable;
 if(e.key==='Escape'){if(typing){document.activeElement.blur();return}if(pv.sel||pv.mini||listEdit){pv.sel=null;pv.mini=false;listEdit=null;render()}return}
 if(typing)return;
 const k=e.key.toLowerCase();
 if(k==='n'||k==='т'){e.preventDefault();document.querySelector('.quick-input')?.focus()}
 else if(/^[1-5]$/.test(k)){const v=VIEWS[Number(k)-1][0];if(v!==pv.view)goView(v,pv.date)}
 else if(k==='t'||k==='е')goToday();
 else if(k==='/'){e.preventDefault();document.querySelector('.pn-main .search')?.focus()}
 else if((k==='arrowleft'||k==='arrowright')&&TIME_VIEWS.includes(pv.view))step(k==='arrowleft'?-1:1);
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
let libraryPath='',libraryTab='files';
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
   row.append(h('div',{},title,detail),action);if(item.type==='file'){if(/\.xlsx$/i.test(item.name))row.append(h('button',{type:'button',text:'Добавить в обзор таблиц',onclick:()=>{const files=tablePaths.value.split('\n').map(x=>x.trim()).filter(Boolean);if(!files.includes(item.path))files.push(item.path);tablePaths.value=files.join('\n');activateLibraryTab('search');state.textContent='Книга добавлена в обзор. Откройте раздел «Обзор таблиц».'}}));row.append(h('button',{type:'button',text:'Создать запись',onclick:async()=>{memoSource.value=item.path;memoText.value='';if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name)){try{const d=await request('/api/library/summary?path='+encodeURIComponent(item.path));memoText.value=d.summary[0]||''}catch{}}activateLibraryTab('knowledge');state.textContent='Источник выбран. Проверьте текст в разделе «Заметки и дела библиотеки» и сохраните запись.';memoText.focus()}}));row.append(h('button',{type:'button',text:'Выбрать для связи',onclick:()=>{if(!linkA.value||linkB.value){linkA.value=item.path;linkB.value=''}else linkB.value=item.path;if(linkB.value)activateLibraryTab('knowledge');state.textContent='Выбрано для связи: '+linkA.value+(linkB.value?' и '+linkB.value:'; выберите второй файл.')}}));row.append(h('button',{type:'button',text:'В подборку',onclick:async()=>{if(!collectionChoice.value){state.textContent='Сначала создайте подборку.';return}try{await request('/api/library/collections/add',{method:'POST',headers:json,body:JSON.stringify({id:collectionChoice.value,path:item.path})});await updateCollections()}catch(e){state.textContent=e.message}}}));if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name)){
    row.append(h('button',{type:'button',text:'Карточка',onclick:async()=>{activateLibraryTab('search');try{const [d,s]=await Promise.all([request('/api/library/document?path='+encodeURIComponent(item.path)),request('/api/library/summary?path='+encodeURIComponent(item.path))]);documentInfo.replaceChildren(h('h3',{text:d.path}),h('p',{text:'Строк: '+d.lineCount+' · размер: '+d.bytes+' байт'}),h('p',{class:'muted',text:'Выдержка из документа:'}),...(s.summary.length?s.summary:d.excerpt).map(line=>h('p',{text:line})))}catch(e){documentInfo.textContent=e.message}}}));
    row.append(h('button',{type:'button',text:'Спросить по файлу',onclick:()=>{answerSource.value=item.path;activateLibraryTab('search');state.textContent='Выбран файл для ответа: '+item.path+'. Введите вопрос в поиске.';searchInput.focus()}}));
    row.append(h('button',{type:'button',text:'Предложить факты',onclick:async()=>{factProposals.textContent='Ищу факты…';try{const d=await request('/api/library/propose-facts?path='+encodeURIComponent(item.path));factSource.value=item.path;factProposals.replaceChildren(...(d.items.length?d.items.map(f=>h('div',{class:'item'},h('div',{},h('p',{text:f.subject+' — '+f.predicate+' → '+f.object}),h('p',{class:'muted',text:'Строка '+f.line+': '+f.quote})),h('button',{type:'button',text:'Проверить',onclick:()=>{factSubject.value=f.subject;factPredicate.value=f.predicate;factObject.value=f.object;factQuote.value=f.quote;factSubject.focus()}}))):[h('p',{text:'Фактов по простым правилам не найдено. Можно добавить вручную.'})]));if(d.truncated)factProposals.append(h('p',{class:'muted',text:'Проверена только часть текста.'}));activateLibraryTab('knowledge');state.textContent='Проверьте предложения в разделе «Факты библиотеки».'}catch(e){factProposals.textContent=e.message}}}));
    row.append(h('button',{type:'button',text:'Похожие',onclick:async()=>{activateLibraryTab('search');documentInfo.textContent='Ищу похожие документы…';try{const d=await request('/api/library/similar?path='+encodeURIComponent(item.path));documentInfo.replaceChildren(h('h3',{text:'Похожие на '+item.name}),h('p',{class:'muted',text:'Сравнение по общим словам; не означает, что документы одинаковые.'}),...(d.items.length?d.items.map(x=>h('p',{text:x.path+' · совпадение слов: '+x.score+'%'})):[h('p',{text:'Похожие документы не найдены.'})]),h('p',{class:'muted',text:'Проверено: '+d.scanned+(d.truncated?' · показаны не все':'')+(d.unreadable?' · не удалось прочитать: '+d.unreadable:'')}))}catch(e){documentInfo.textContent=e.message}}}));
   }row.append(h('button',{type:'button',text:'Предложить папку',onclick:async()=>{try{const d=await request('/api/library/suggest-file-folder?path='+encodeURIComponent(item.path));if(!confirm('Предлагаю папку «'+d.folder+'» ('+d.reason+'). Создать её при необходимости и переместить файл?'))return;const result=await request('/api/library/move',{method:'POST',headers:json,body:JSON.stringify({path:item.path,folder:d.folder,create:true})});await load();await updateCollections();await updateLinks();await updateMemos();await updateLibraryFacts();await updateJournal();state.textContent=result.unchanged?'Файл уже находится в этой папке.':result.originalRetained?'Файл скопирован в '+result.path+'; исходный файл сохранён.':'Файл перемещён: '+result.path}catch(e){state.textContent=e.message}}}));row.append(h('button',{type:'button',text:'Переименовать',onclick:async()=>{let suggested=item.name;if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name)){try{suggested=(await request('/api/library/suggest-name?path='+encodeURIComponent(item.path))).name}catch{}}const newName=prompt('Новое имя файла (предложение по первой строке, проверьте его):',suggested);if(newName===null||newName===item.name)return;try{const result=await request('/api/library/rename',{method:'POST',headers:json,body:JSON.stringify({path:item.path,name:newName})});await load();await updateCollections();await updateLinks();await updateMemos();await updateLibraryFacts();await updateJournal();state.textContent=result.originalRetained?'Новое имя создано, старый файл сохранить пришлось. Проверьте обе копии.':'Файл переименован: '+result.path}catch(e){state.textContent=e.message}}}));if(/\.(png|jpe?g|webp|pdf)$/i.test(item.name))row.append(h('button',{type:'button',text:'Распознать текст',onclick:async e=>{const button=e.currentTarget;button.disabled=true;activateLibraryTab('search');documentInfo.textContent='Распознавание на этом компьютере…';try{const d=await request('/api/library/ocr',{method:'POST',headers:json,body:JSON.stringify({path:item.path})});const save=h('button',{type:'button',text:'Сохранить текст рядом с файлом',onclick:async()=>{save.disabled=true;try{const file=item.path+'.ocr.txt',content='Источник: '+item.path+'\n\n'+d.pages.map(p=>'[Страница '+p.page+']\n'+p.text).join('\n\n');const response=await fetch('/api/library/upload?path='+encodeURIComponent(file),{method:'PUT',headers:{'Content-Type':'text/plain;charset=utf-8'},body:content});const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось сохранить');save.textContent='Сохранено: '+file;await load()}catch(err){save.disabled=false;documentInfo.append(h('p',{text:err.message}))}}});documentInfo.replaceChildren(h('h3',{text:'Распознанный текст · '+d.path}),h('p',{class:'muted',text:'Результат может содержать ошибки. Сохранённый текст будет доступен для поиска.'}),save,...d.pages.map(p=>h('div',{},h('h4',{text:'Страница '+p.page}),h('pre',{text:p.text||'Текст не найден.'}))))}catch(err){documentInfo.textContent=err.message}finally{button.disabled=false}}}));const actions=[...row.children].filter(node=>node.tagName==='BUTTON');if(actions.length)row.append(h('details',{class:'library-actions'},h('summary',{text:'Действия'}),h('div',{class:'library-action-list'},...actions)));}return row;
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
 answerSearch.onclick=async()=>{answerSearch.disabled=true;searchResults.textContent='Хранитель ищет подтверждения…';try{const d=await request('/api/library/answer?q='+encodeURIComponent(searchInput.value)+'&path='+encodeURIComponent(answerSource.value.trim()));searchResults.replaceChildren(h('p',{class:'muted',text:'Фрагменты источников, подобранные по словам вопроса. Проверьте контекст документа.'}),...(d.items.length?d.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.path+' · '+(x.kind==='fact'?'подтверждённый факт':x.page?'страница '+x.page:x.sheet||'строка '+x.line)}),h('p',{text:x.excerpt})),h('a',{href:'/api/library/download?path='+encodeURIComponent(x.path),text:'Скачать источник'}))):[h('p',{text:'Подходящих фрагментов не найдено.'})]),h('p',{class:'muted',text:'Проверено файлов: '+d.scanned+(d.unreadable?' · не удалось прочитать: '+d.unreadable:'')+(d.outdatedFacts?' · фактов требуют перепроверки: '+d.outdatedFacts:'')+(d.truncated?' · проверена только часть библиотеки':'')}))}catch(err){searchResults.textContent=err.message}finally{answerSearch.disabled=false}};
 duplicateSearch.onclick=async()=>{searchResults.textContent='Хранитель сравнивает файлы…';duplicateSearch.disabled=true;try{const data=await request('/api/library/duplicates');searchResults.replaceChildren(...(data.groups.length?data.groups.map(group=>h('div',{class:'item'},h('div',{},h('strong',{text:'Одинаковые файлы · '+Math.ceil(group[0].size/1024)+' КБ'}),...group.map(x=>h('p',{text:x.path}))))):[h('p',{class:'muted',text:'Одинаковые файлы не найдены.'})]));if(data.truncated||data.errors.length)searchResults.append(h('p',{class:'muted',text:'Проверка неполная. Ошибок чтения: '+data.errors.length}))}catch(err){searchResults.textContent=err.message}finally{duplicateSearch.disabled=false}};
 compareForm.onsubmit=async e=>{e.preventDefault();documentInfo.textContent='Сравнение…';try{const d=await request('/api/library/compare',{method:'POST',headers:json,body:JSON.stringify({left:compareLeft.value,right:compareRight.value})});documentInfo.replaceChildren(h('p',{text:d.identical?'Файлы одинаковые':'Различающихся строк: '+d.changedLines+' (сравнение по номерам строк)'}),...d.changes.map(c=>h('div',{class:'item'},h('div',{},h('strong',{text:'Строка '+c.line}),h('p',{text:'Первый: '+c.left}),h('p',{text:'Второй: '+c.right})))));if(d.truncated)documentInfo.append(h('p',{text:'Показаны первые 100 различий.'}))}catch(err){documentInfo.textContent=err.message}};
 async function updateQueue(){try{const d=await request('/api/library/queue');queueEnabled=d.enabled;queueToggle.textContent=d.enabled?'Остановить фоновую обработку':'Включить фоновую обработку';queueInfo.replaceChildren(h('p',{text:'Ожидают: '+d.counts.queued+' · обработаны: '+d.counts.ready+' · ошибки: '+d.counts.error}),...d.items.map(item=>h('div',{class:'item'},h('div',{},h('strong',{text:item.path}),h('p',{text:item.status==='error'?'Ошибка: '+item.error:'Ожидает обработки'})),item.status==='error'?h('button',{type:'button',text:'Повторить',onclick:async()=>{try{await request('/api/library/queue/retry',{method:'POST',headers:json,body:JSON.stringify({path:item.path})});await updateQueue()}catch(e){queueInfo.textContent=e.message}}}):null)))}catch(e){queueInfo.textContent=e.message}}
 queueRefresh.onclick=async()=>{try{await request('/api/library/queue/scan',{method:'POST',headers:json,body:'{}'});await updateQueue()}catch(e){queueInfo.textContent=e.message}};
 queueToggle.onclick=async()=>{try{await request('/api/library/queue/enabled',{method:'POST',headers:json,body:JSON.stringify({enabled:!queueEnabled})});await updateQueue()}catch(e){queueInfo.textContent=e.message}};
 async function updateCollections(){try{const d=await request('/api/library/collections'),selected=collectionChoice.value;collectionChoice.replaceChildren(...d.items.map(c=>h('option',{value:c.id,text:c.name})));if(d.items.some(c=>c.id===selected))collectionChoice.value=selected;collectionList.replaceChildren(...d.items.map(c=>h('div',{class:'item'},h('div',{},h('strong',{text:c.name}),...c.files.map(file=>h('p',{},h('span',{text:file+' '}),h('a',{href:'/api/library/download?path='+encodeURIComponent(file),text:'Скачать'}),' ',h('button',{type:'button',text:'Убрать из подборки',onclick:async()=>{try{await request('/api/library/collections/remove',{method:'POST',headers:json,body:JSON.stringify({id:c.id,path:file})});await updateCollections()}catch(e){collectionList.textContent=e.message}}})))),h('button',{type:'button',text:'Удалить подборку',onclick:async()=>{if(!confirm('Удалить подборку «'+c.name+'»? Файлы останутся на месте.'))return;try{await request('/api/library/collections/delete',{method:'POST',headers:json,body:JSON.stringify({id:c.id})});await updateCollections()}catch(e){collectionList.textContent=e.message}}}))))}catch(e){collectionList.textContent=e.message}}
 collectionForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/collections',{method:'POST',headers:json,body:JSON.stringify({name:collectionName.value})});collectionName.value='';await updateCollections()}catch(err){collectionList.textContent=err.message}};
 async function updateMemos(){try{const data=await request('/api/library/memos');memoList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:(x.kind==='task'?(x.done?'Выполнено · ':'Дело · '):'Заметка · ')+x.text}),h('p',{class:'muted',text:'Источник: '+x.source+(x.due?' · срок: '+x.due:'')+(x.time?' в '+x.time:'')}),h('a',{href:'/api/library/download?path='+encodeURIComponent(x.source),text:'Скачать источник'})),x.kind==='task'?h('button',{type:'button',text:x.done?'Вернуть в работу':'Выполнено',onclick:async()=>{try{await request('/api/library/memos/change',{method:'POST',headers:json,body:JSON.stringify({id:x.id,action:'toggle'})});await updateMemos()}catch(e){memoList.textContent=e.message}}}):null,h('button',{type:'button',text:'Удалить запись',onclick:async()=>{if(!confirm('Удалить запись? Файл-источник останется на месте.'))return;try{await request('/api/library/memos/change',{method:'POST',headers:json,body:JSON.stringify({id:x.id,action:'delete'})});await updateMemos()}catch(e){memoList.textContent=e.message}}}))):[h('p',{class:'muted',text:'Записей пока нет.'})]))}catch(e){memoList.textContent=e.message}}
 memoForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/memos',{method:'POST',headers:json,body:JSON.stringify({source:memoSource.value,kind:memoKind.value,text:memoText.value,due:memoDue.value,time:memoTime.value})});memoText.value='';memoDue.value='';memoTime.value='';await updateMemos()}catch(err){memoList.textContent=err.message}};
 organizePlan.onclick=async()=>{organizePlan.disabled=true;organizeList.textContent='Изучаю файлы…';try{const data=await request('/api/library/organization-plan');organizationChoices=data.items.map(item=>({item,checked:h('input',{type:'checkbox','aria-label':'Выбрать '+item.path})}));organizeList.replaceChildren(h('p',{class:'muted',text:'Проверено: '+data.visited+(data.truncated?' · показана часть библиотеки':'')+(data.unreadable?' · не удалось прочитать: '+data.unreadable:'')+'. Отметьте нужные предложения.'}),...organizationChoices.map(x=>h('label',{class:'item'},x.checked,h('span',{text:x.item.path+' → '+x.item.target+' · '+x.item.reason}))));if(!organizationChoices.length)organizeList.append(h('p',{text:'Предложений нет.'}))}catch(e){organizeList.textContent=e.message}finally{organizePlan.disabled=false}};
 organizeApply.onclick=async()=>{const chosen=organizationChoices.filter(x=>x.checked.checked);if(!chosen.length){organizeList.append(h('p',{text:'Сначала отметьте файлы.'}));return}if(!confirm('Переместить выбранные файлы: '+chosen.length+'? Существующие файлы не будут перезаписаны.'))return;organizeApply.disabled=true;let moved=0;const errors=[];try{for(const x of chosen){try{const r=await request('/api/library/move',{method:'POST',headers:json,body:JSON.stringify({path:x.item.path,folder:x.item.folder,create:true})});moved++;x.checked.checked=false;x.checked.disabled=true;if(r.originalRetained)errors.push(x.item.path+': исходный файл сохранён')}catch(e){errors.push(x.item.path+': '+e.message)}}await load();await updateCollections();await updateLinks();await updateMemos();await updateLibraryFacts();await updateJournal();organizeList.prepend(h('p',{text:'Обработано: '+moved+' из '+chosen.length+(errors.length?' · подробности ниже':'')}),...errors.map(e=>h('p',{text:e})))}finally{organizeApply.disabled=false}};
 tableForm.onsubmit=async e=>{e.preventDefault();tableResult.textContent='Читаю книги…';try{const data=await request('/api/library/tables',{method:'POST',headers:json,body:JSON.stringify({files:tablePaths.value.split('\n').map(x=>x.trim()).filter(Boolean)})});tableResult.replaceChildren(h('p',{class:'muted',text:'Строк найдено: '+data.totalRows+'. Показаны первые '+data.limitPerSheet+' строк каждого листа. Формулы не пересчитываются.'}),...data.books.flatMap(book=>[h('h4',{text:book.path}),...book.sheets.map(sheet=>h('div',{class:'item'},h('div',{},h('strong',{text:'Лист: '+sheet.name+' · строк: '+sheet.rows}),...sheet.preview.map(row=>h('p',{text:row})))))]))}catch(err){tableResult.textContent=err.message}};
 async function updateLibraryFacts(){try{const data=await request('/api/library/facts');factList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.subject+' — '+x.predicate+' → '+x.object}),h('p',{class:'muted',text:'Источник: '+x.source+(x.sourceState==='current'?' · подтверждён':x.sourceState==='changed'?' · документ изменился, проверьте факт':' · файл не найден')}),x.quote?h('p',{text:'Фрагмент: '+x.quote}):null,h('a',{href:'/api/library/download?path='+encodeURIComponent(x.source),text:'Скачать источник'})),x.sourceState==='changed'?h('button',{type:'button',text:'Перепроверить',onclick:()=>{factSource.value=x.source;factSubject.value=x.subject;factPredicate.value=x.predicate;factObject.value=x.object;factQuote.value=x.quote;factSubject.focus()}}):null,h('button',{type:'button',text:'Удалить факт',onclick:async()=>{if(!confirm('Удалить факт из библиотеки? Файл останется на месте.'))return;try{await request('/api/library/facts/delete',{method:'POST',headers:json,body:JSON.stringify({id:x.id})});await updateLibraryFacts();await updateLinks()}catch(e){factList.textContent=e.message}}}))):[h('p',{class:'muted',text:'Подтверждённых фактов пока нет.'})]))}catch(e){factList.textContent=e.message}}
 factForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/facts',{method:'POST',headers:json,body:JSON.stringify({source:factSource.value,subject:factSubject.value,predicate:factPredicate.value,object:factObject.value,quote:factQuote.value})});factSubject.value='';factPredicate.value='';factObject.value='';factQuote.value='';await updateLibraryFacts();await updateLinks()}catch(err){factList.textContent=err.message}};
 function drawLinks(links){
  const names=[...new Set(links.flatMap(x=>[x.a,x.b]))].slice(0,30);linkGraph.replaceChildren();if(!names.length)return;
  const ns='http://www.w3.org/2000/svg',make=(tag,props={})=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(props))n.setAttribute(k,String(v));return n};
  const rows=Math.ceil(names.length/3),svg=make('svg',{viewBox:'0 0 720 '+(rows*95+30),role:'img','aria-label':'Карта связей документов и фактов'}),pos=new Map(names.map((name,i)=>[name,{x:120+(i%3)*240,y:50+Math.floor(i/3)*95}]));svg.style.width='100%';svg.style.maxHeight='600px';
  for(const edge of links){const a=pos.get(edge.a),b=pos.get(edge.b);if(a&&b)svg.append(make('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#a78038','stroke-width':2}))}
  for(const name of names){const p=pos.get(name),g=make('g'),box=make('rect',{x:p.x-100,y:p.y-18,width:200,height:36,rx:12,fill:'#211b11',stroke:'#bb954b'}),label=make('text',{x:p.x,y:p.y+5,fill:'#f5e7bf','text-anchor':'middle','font-size':12}),title=make('title');label.textContent=name.split('/').pop().slice(0,25);title.textContent=name;g.append(box,label,title);svg.append(g)}
  linkGraph.append(svg);if(new Set(links.flatMap(x=>[x.a,x.b])).size>names.length)linkGraph.append(h('p',{class:'muted',text:'Показаны первые 30 файлов. Все связи доступны ниже.'}));
 }
 async function updateLinks(){try{const [data,facts]=await Promise.all([request('/api/library/links'),request('/api/library/facts')]);drawLinks([...data.items,...facts.items.map(f=>({a:f.source,b:(f.sourceState==='current'?'Факт: ':'Нужна проверка: ')+f.subject+' — '+f.predicate+' → '+f.object}))]);linkList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('p',{text:x.a+' ↔ '+x.b}),x.label?h('p',{class:'muted',text:x.label}):null),h('button',{type:'button',text:'Убрать связь',onclick:async()=>{if(!confirm('Убрать связь? Файлы останутся на месте.'))return;try{await request('/api/library/links/delete',{method:'POST',headers:json,body:JSON.stringify({id:x.id})});await updateLinks()}catch(e){linkList.textContent=e.message}}}))):[h('p',{class:'muted',text:'Связей пока нет.'})]))}catch(e){linkList.textContent=e.message}}
 linkForm.onsubmit=async e=>{e.preventDefault();try{await request('/api/library/links',{method:'POST',headers:json,body:JSON.stringify({a:linkA.value,b:linkB.value,label:linkLabel.value})});linkA.value='';linkB.value='';linkLabel.value='';await updateLinks()}catch(err){linkList.textContent=err.message}};
 async function updateJournal(){const labels={folder_created:'Создана папка',file_uploaded:'Загружен файл',file_replaced:'Файл заменён, прежняя версия сохранена',file_renamed:'Файл переименован',file_moved:'Файл перемещён',ocr_completed:'Распознан документ',collection_created:'Создана подборка',collection_added:'Файл добавлен в подборку',collection_removed:'Файл убран из подборки',collection_deleted:'Удалена подборка'};try{const d=await request('/api/library/journal');journalList.replaceChildren(...(d.items.length?d.items.map(x=>h('p',{text:new Date(x.at).toLocaleString('ru-RU')+' · '+(labels[x.action]||x.action)+(x.path?' · '+x.path:'')+(x.target?' → '+x.target:'')+(x.collection?' · '+x.collection:'')})):[h('p',{class:'muted',text:'Действий пока нет.'})]))}catch(e){journalList.textContent=e.message}}
 journalRefresh.onclick=updateJournal;
 async function updateVersions(){try{const data=await request('/api/library/versions');versionsList.replaceChildren(...(data.items.length?data.items.map(x=>h('div',{class:'item'},h('div',{},h('strong',{text:x.path}),h('p',{class:'muted',text:'До замены: '+new Date(x.createdAt).toLocaleString('ru-RU')+' · '+Math.ceil(x.size/1024)+' КБ'})),h('a',{href:'/api/library/version?id='+encodeURIComponent(x.id),text:'Скачать предыдущую версию'}))):[h('p',{class:'muted',text:'Сохранённых версий пока нет.'})]))}catch(e){versionsList.textContent=e.message}}
 versionsRefresh.onclick=updateVersions;
 healthButton.onclick=async()=>{healthButton.disabled=true;healthInfo.textContent='Проверяю библиотеку…';try{const d=await request('/api/library/health');healthInfo.replaceChildren(h('p',{text:'Файлов: '+d.files+' · папок: '+d.folders+' · размер: '+(d.bytes/1048576).toFixed(1)+' МБ'}),h('p',{text:'Свободно на диске: '+(d.freeBytes===null?'не удалось определить':(Number(d.freeBytes)/1073741824).toFixed(1)+' ГБ')}),h('p',{text:'Ошибки обработки: '+d.queue.error+' · ожидают: '+d.queue.queued}),h('p',{text:'Недоступных ссылок в подборках: '+d.missing.length+' · в связях: '+d.missingLinks.length+' · у записей: '+d.missingSources.length}),...d.missingSources.map(x=>h('p',{text:'Недоступный источник записи: '+x.path})),...d.missingLinks.map(x=>h('p',{text:'Недоступный документ в связи: '+x.path})),...d.missing.map(x=>h('p',{text:x.collection+' · '+x.path})),...d.errors.map(x=>h('p',{text:'Ошибка папки '+x.path+': '+x.error})));if(d.truncated)healthInfo.append(h('p',{text:'Проверена только часть библиотеки.'}))}catch(e){healthInfo.textContent=e.message}finally{healthButton.disabled=false}};
 const back=h('button',{type:'button',text:'На уровень выше',onclick:()=>{libraryPath=libraryPath.split('/').slice(0,-1).join('/');void load()}});
 root.append(h('div',{class:'panel','data-library-tab':'files'},h('h3',{text:'Мои файлы'}),h('p',{class:'muted',text:'Файлы хранятся в папке data/library на диске проекта. Для поиска подключение к интернету не требуется.'}),location,back,folderForm,h('div',{},uploadInput,uploadButton),state,listing),h('div',{class:'panel','data-library-tab':'search'},h('h3',{text:'Хранитель библиотеки'}),h('p',{class:'muted',text:'Поиск и карточки TXT, Markdown, CSV, JSON, DOCX, XLSX и PDF с текстом. Для таблиц показываются извлечённые значения ячеек.'}),searchForm,textSearch,indexedSearch,answerSource,answerSearch,duplicateSearch,searchResults,compareForm,documentInfo),h('div',{class:'panel','data-library-tab':'knowledge'},h('h3',{text:'Подборки'}),h('p',{class:'muted',text:'Выберите подборку и нажмите «В подборку» у файла. Оригинал останется на месте.'}),collectionForm,collectionChoice,collectionList),h('div',{class:'panel','data-library-tab':'system'},h('h3',{text:'Очередь обработки'}),h('p',{class:'muted',text:'Проверяет документы на этом диске. Работает, пока открыт проект.'}),queueRefresh,queueToggle,queueInfo),h('div',{class:'panel','data-library-tab':'system'},h('h3',{text:'Журнал действий'}),journalRefresh,journalList));
 const sections=[['files','Файлы'],['search','Поиск и документы'],['knowledge','Знания'],['system','Состояние']];
 const tabs=h('div',{class:'seg library-tabs',role:'group','aria-label':'Разделы библиотеки'},...sections.map(([key,label])=>h('button',{type:'button','data-library-choice':key,text:label,onclick:()=>activateLibraryTab(key)})));
 root.insertBefore(tabs,root.querySelector('[data-library-tab]'));
 function activateLibraryTab(key){libraryTab=key;root.querySelectorAll('[data-library-tab]').forEach(el=>{el.hidden=el.dataset.libraryTab!==key});tabs.querySelectorAll('button').forEach(el=>{const on=el.dataset.libraryChoice===key;el.classList.toggle('on',on);el.setAttribute('aria-pressed',String(on))})}
 // Remaining panels are appended below; activate once all sections have been created.
 void updateJournal();
 root.append(h('div',{class:'panel','data-library-tab':'system'},h('h3',{text:'Предыдущие версии'}),h('p',{class:'muted',text:'Старые версии сохраняются при подтверждённой замене. Их можно скачать и загрузить обратно под нужным именем.'}),versionsRefresh,versionsList));
 void updateVersions();
 root.append(h('div',{class:'panel','data-library-tab':'files'},h('h3',{text:'Порядок в библиотеке'}),h('p',{class:'muted',text:'Хранитель предложит папки. Ничего не перемещается до выбора и подтверждения.'}),organizePlan,organizeApply,organizeList));
 root.append(h('div',{class:'panel','data-library-tab':'search'},h('h3',{text:'Обзор таблиц'}),h('p',{class:'muted',text:'До пяти книг XLSX. Каждая строка показана с листом и адресами ячеек; исходные файлы не изменяются.'}),tableForm,tableResult));
 root.append(h('div',{class:'panel','data-library-tab':'knowledge'},h('h3',{text:'Заметки и дела библиотеки'}),h('p',{class:'muted',text:'Личные записи хранятся в библиотеке отдельно от общего планера. Для напоминания укажите дату и время; оно появится при открытом проекте.'}),memoForm,memoNotify,memoList));
 void updateMemos();
 root.append(h('div',{class:'panel','data-library-tab':'knowledge'},h('h3',{text:'Факты библиотеки'}),h('p',{class:'muted',text:'Предложения нужно проверить и подтвердить. Факты остаются в библиотеке и не добавляются в общую память или контекст облачной модели.'}),factProposals,factForm,factList));
 void updateLibraryFacts();
 root.append(h('div',{class:'panel','data-library-tab':'knowledge'},h('h3',{text:'Карта документов и фактов'}),h('p',{class:'muted',text:'Показаны связи документов и подтверждённые факты библиотеки. Выберите два файла, чтобы связать их.'}),linkForm,linkGraph,linkList));
 void updateLinks();
 root.append(h('div',{class:'panel','data-library-tab':'system'},h('h3',{text:'Состояние библиотеки'}),healthButton,healthInfo));
 void updateCollections();
 void updateQueue();
 activateLibraryTab(libraryTab);
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

