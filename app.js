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
function updateBadge(){const b=document.querySelector('[data-badge="tasks"]');if(!b)return;const t=today(),n=workspace.tasks.filter(x=>!x.done&&x.due&&x.due<=t).length;b.hidden=!n;b.textContent=n>99?'99+':String(n)}
const TITLES={home:'Добро пожаловать',tasks:'Мои дела',notes:'Заметки',calendar:'Календарь',settings:'Настройки проекта',facts:'Факты памяти'};
function render(){
 root.replaceChildren(element('h2',TITLES[page]));
 ({home:renderHome,tasks:renderTasks,notes:renderNotes,calendar:renderCalendar,facts:renderFacts,settings:renderSettings}[page]||renderHome)();
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
 for(const [label,count,go_] of [['На сегодня',dueToday.length,'calendar'],['Открытых дел',open.length,'tasks'],['Просрочено',overdue.length,'tasks'],['Заметки',workspace.notes.length,'notes']]){
  cards.append(h('button',{type:'button',class:'panel metric-card'+(label==='Просрочено'&&count?' warn':''),onclick:()=>go(go_)},h('div',{class:'metric',text:String(count)}),h('p',{text:label})));
 }
 const agenda=h('div',{class:'panel'},h('div',{class:'panel-head'},h('h3',{text:'Сегодня · '+new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}),h('button',{type:'button',class:'link',text:'Календарь →',onclick:()=>go('calendar')})));
 const list=[...overdue,...dueToday].sort(byAgenda);
 agenda.append(list.length?h('div',{class:'task-list'},...list.map(x=>taskRow(x,{compact:true}))):h('p',{class:'muted',text:'На сегодня дел нет. Скажите аватару «дело: … завтра в 10:00» или добавьте в разделе «Дела».'}));
 const hint=h('div',{class:'panel'},h('h3',{text:'Ваша кицунэ-хранительница'}),h('p',{class:'muted',text:'Аватар можно перетаскивать по всему окну. Левый клик открывает чат, правый клик (или долгое нажатие) — её меню. Спросите «что на сегодня», «рабочие дела», «перенеси отчёт на пятницу».'}));
 root.append(cards,h('div',{class:'grid-2'},agenda,hint),h('p',{class:'muted',text:'Ваши записи сохраняются в папке data на переносном SSD.'}));
}

/* ---------- Дела ---------- */
const taskView={cat:'all',query:'',editing:null};
function taskForm({task=null,due='',onDone}={}){
 const name='cat-'+(task?task.id:'new');
 const title=h('input',{name:'title',required:true,maxLength:200,placeholder:'Что нужно сделать?',value:task?task.title:'','aria-label':'Название дела'});
 const date=h('input',{type:'date',name:'due',value:task?task.due||'':due,'aria-label':'Дата'});
 const time=h('input',{type:'time',name:'time',value:task?task.time||'':'','aria-label':'Время'});
 const prio=h('select',{name:'priority','aria-label':'Важность'},...Object.entries(PRIO).map(([k,v])=>h('option',{value:k,text:v,selected:(task?task.priority||'normal':'normal')===k})));
 const notes=h('textarea',{name:'content',placeholder:'Подробности (необязательно)',value:task?task.content||'':'',rows:2,'aria-label':'Подробности'});
 const quick=h('div',{class:'quick-dates'},...[['Сегодня',0],['Завтра',1],['Через неделю',7]].map(([l,n])=>h('button',{type:'button',class:'chip-btn',text:l,onclick:()=>{date.value=ymd(addDays(new Date(),n))}})),h('button',{type:'button',class:'chip-btn',text:'Без срока',onclick:()=>{date.value='';time.value=''}}));
 const submit=h('button',{class:'primary',text:task?'Сохранить':'Добавить дело'});
 const form=h('form',{class:'task-form'+(task?' editing':'')},
  h('div',{class:'task-form-main'},title,categoryPicker(name,task?catOf(task):(taskView.cat==='work'?'work':'personal'))),
  h('div',{class:'task-form-when'},date,time,prio),quick,notes,
  h('div',{class:'row'},submit,task?h('button',{type:'button',text:'Отмена',onclick:()=>{taskView.editing=null;render()}}):null));
 form.onsubmit=async e=>{
  e.preventDefault();
  const fields={title:title.value,category:form.querySelector('input[name="'+name+'"]:checked')?.value||'personal',due:date.value||null,time:time.value||null,priority:prio.value,content:notes.value};
  if(fields.time&&!fields.due)fields.due=today();
  await act(async()=>{if(task)await items('PATCH',{collection:'tasks',id:task.id,...fields});else await items('POST',{collection:'tasks',...fields});taskView.editing=null;onDone?.()});
 };
 return form;
}
function taskRow(task,{compact=false}={}){
 if(taskView.editing===task.id&&!compact)return h('div',{class:'task-row editing'},taskForm({task}));
 const t=today(),late=!task.done&&task.due&&task.due<t,c=catOf(task);
 const check=h('button',{type:'button',class:'check'+(task.done?' on':''),'aria-label':task.done?'Вернуть в работу':'Отметить выполненным',title:task.done?'Вернуть':'Готово',onclick:()=>act(()=>items('PATCH',{collection:'tasks',id:task.id,done:!task.done}))},task.done?'✓':'');
 const meta=h('div',{class:'task-meta'},chip(CAT[c].icon+' '+CAT[c].label,'cat-'+c),
  task.due?chip((late?'⚠ ':'')+dayLabel(task.due)+(task.time?' · '+task.time:''),late?'late':task.due===t?'today':''):null,
  task.priority==='high'?chip('❗ Важное','high'):task.priority==='low'?chip('Не срочно','low'):null);
 const body=h('div',{class:'task-body'},h('div',{class:'task-title',text:task.title}),task.content&&!compact?h('div',{class:'muted task-note',text:task.content}):null,meta);
 const tools=compact?null:h('div',{class:'task-tools'},
  h('button',{type:'button',class:'icon-btn','aria-label':'Изменить',title:'Изменить',onclick:()=>{taskView.editing=task.id;render()}},'✎'),
  h('button',{type:'button',class:'icon-btn danger','aria-label':'Удалить',title:'Удалить',onclick:()=>{if(confirmDelete('дело',task))act(()=>items('DELETE',{collection:'tasks',id:task.id}))}},svg('i-close')));
 return h('div',{class:'task-row'+(task.done?' done':'')+(late?' late':'')+(task.priority==='high'?' high':'')+' cat-'+c},check,body,tools);
}
function renderTasks(){
 const all=workspace.tasks,open=all.filter(x=>!x.done);
 const count=k=>open.filter(x=>k==='all'||catOf(x)===k).length;
 const toolbar=h('div',{class:'toolbar'},
  segmented([{value:'all',label:'Все',count:count('all')},{value:'personal',label:'🏠 Личные',count:count('personal')},{value:'work',label:'💼 Рабочие',count:count('work')}],taskView.cat,v=>{taskView.cat=v;render()},'Категория'),
  h('input',{type:'search',class:'search',placeholder:'Поиск по делам',value:taskView.query,'aria-label':'Поиск по делам',oninput:e=>{taskView.query=e.target.value;drawGroups()}}));
 const add=h('div',{class:'panel'},h('h3',{text:'Новое дело'}),taskForm());
 const groupsBox=h('div',{class:'task-groups'});
 function drawGroups(){
  const q=taskView.query.trim().toLocaleLowerCase(),t=today(),week=ymd(addDays(new Date(),7));
  const list=all.filter(x=>(taskView.cat==='all'||catOf(x)===taskView.cat)&&(!q||(x.title+' '+(x.content||'')).toLocaleLowerCase().includes(q))).sort(byAgenda);
  const groups=[
   ['⚠ Просрочено','late',list.filter(x=>!x.done&&x.due&&x.due<t)],
   ['Сегодня','today',list.filter(x=>!x.done&&x.due===t)],
   ['Ближайшие 7 дней','soon',list.filter(x=>!x.done&&x.due>t&&x.due<=week)],
   ['Позже','later',list.filter(x=>!x.done&&x.due>week)],
   ['Без срока','nodate',list.filter(x=>!x.done&&!x.due)]
  ];
  const done=list.filter(x=>x.done).sort((a,b)=>String(b.doneAt||'').localeCompare(String(a.doneAt||'')));
  const blocks=groups.filter(g=>g[2].length).map(([label,cls,rows])=>h('section',{class:'panel task-group g-'+cls},h('h3',{},label,h('span',{class:'seg-count',text:String(rows.length)})),...rows.map(x=>taskRow(x))));
  if(!blocks.length)blocks.push(h('div',{class:'panel empty'},h('p',{class:'muted',text:q?'Ничего не найдено.':'Открытых дел нет — можно отдохнуть 🦊'})));
  if(done.length)blocks.push(h('details',{class:'panel task-group g-done'},h('summary',{},'Выполнено',h('span',{class:'seg-count',text:String(done.length)})),...done.slice(0,100).map(x=>taskRow(x))));
  groupsBox.replaceChildren(...blocks);
 }
 drawGroups();
 root.append(toolbar,h('div',{class:'split'},add,groupsBox));
}

/* ---------- Заметки ---------- */
const noteView={cat:'all',query:'',editing:null,adding:false};
function noteForm(note){
 const name='ncat-'+(note?note.id:'new');
 const title=h('input',{required:true,maxLength:200,placeholder:'Заголовок',value:note?note.title:'','aria-label':'Заголовок'});
 const content=h('textarea',{placeholder:'Текст заметки. Строки «FACT: субъект | связь | объект» попадут в память.',value:note?note.content||'':'',rows:note?6:4,'aria-label':'Текст'});
 const form=h('form',{class:'note-form'},h('div',{class:'task-form-main'},title,categoryPicker(name,note?catOf(note):(noteView.cat==='work'?'work':'personal'))),content,
  h('div',{class:'row'},h('button',{class:'primary',text:note?'Сохранить':'Сохранить заметку'}),note?h('button',{type:'button',text:'Отмена',onclick:()=>{noteView.editing=null;render()}}):null));
 form.onsubmit=async e=>{e.preventDefault();const category=form.querySelector('input[name="'+name+'"]:checked')?.value||'personal';
  await act(async()=>{if(note)await items('PATCH',{collection:'notes',id:note.id,title:title.value,content:content.value,category});else await items('POST',{collection:'notes',title:title.value,content:content.value,category});noteView.editing=null})};
 return form;
}
function noteCard(note){
 if(noteView.editing===note.id)return h('article',{class:'note-card editing'},noteForm(note));
 const c=catOf(note);
 return h('article',{class:'note-card cat-'+c+(note.pinned?' pinned':'')},
  h('header',{},chip(CAT[c].icon+' '+CAT[c].label,'cat-'+c),
   h('button',{type:'button',class:'icon-btn pin'+(note.pinned?' on':''),'aria-label':note.pinned?'Открепить':'Закрепить',title:note.pinned?'Открепить':'Закрепить',onclick:()=>act(()=>items('PATCH',{collection:'notes',id:note.id,pinned:!note.pinned}))},'📌')),
  h('h4',{text:note.title}),note.content?h('p',{class:'note-text',text:note.content}):null,
  h('footer',{},h('span',{class:'muted',text:new Date(note.updatedAt||note.createdAt||Date.now()).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})}),
   h('span',{class:'note-tools'},
    h('button',{type:'button',class:'icon-btn','aria-label':'Изменить',title:'Изменить',onclick:()=>{noteView.editing=note.id;render()}},'✎'),
    h('button',{type:'button',class:'icon-btn danger','aria-label':'Удалить',title:'Удалить',onclick:()=>{if(confirmDelete('заметку',note))act(()=>items('DELETE',{collection:'notes',id:note.id}))}},svg('i-close')))));
}
function renderNotes(){
 const all=workspace.notes,count=k=>k==='all'?all.length:k==='pinned'?all.filter(x=>x.pinned).length:all.filter(x=>catOf(x)===k).length;
 const grid=h('div',{class:'note-grid'});
 function draw(){
  const q=noteView.query.trim().toLocaleLowerCase();
  const list=all.filter(x=>(noteView.cat==='all'||(noteView.cat==='pinned'?x.pinned:catOf(x)===noteView.cat))&&(!q||(x.title+' '+(x.content||'')).toLocaleLowerCase().includes(q)))
   .sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  grid.replaceChildren(...(list.length?list.map(noteCard):[h('p',{class:'muted',text:q?'Ничего не найдено.':'Заметок пока нет. Напишите первую выше или скажите аватару «заметка: …».'})]));
 }
 const toolbar=h('div',{class:'toolbar'},
  segmented([{value:'all',label:'Все',count:count('all')},{value:'personal',label:'🏠 Личные',count:count('personal')},{value:'work',label:'💼 Рабочие',count:count('work')},{value:'pinned',label:'📌',count:count('pinned')}],noteView.cat,v=>{noteView.cat=v;render()},'Категория'),
  h('input',{type:'search',class:'search',placeholder:'Поиск по заметкам',value:noteView.query,'aria-label':'Поиск по заметкам',oninput:e=>{noteView.query=e.target.value;draw()}}));
 const add=h('details',{class:'panel note-add',open:noteView.adding||!all.length,ontoggle:e=>{noteView.adding=e.target.open}},h('summary',{},'＋ Новая заметка'),noteForm());
 draw();root.append(toolbar,add,grid);
}

/* ---------- Календарь ---------- */
const calView={month:null,selected:null,cat:'all'};
function renderCalendar(){
 const now=new Date();calView.selected??=today();
 if(!calView.month){const s=fromYmd(calView.selected);calView.month=new Date(s.getFullYear(),s.getMonth(),1)}
 const m=calView.month,first=new Date(m.getFullYear(),m.getMonth(),1),shift=(first.getDay()+6)%7,start=addDays(first,-shift);
 const tasks=workspace.tasks.filter(x=>x.due&&(calView.cat==='all'||catOf(x)===calView.cat));
 const byDay=new Map();for(const x of tasks){if(!byDay.has(x.due))byDay.set(x.due,[]);byDay.get(x.due).push(x)}
 const setMonth=d=>{calView.month=new Date(d.getFullYear(),d.getMonth(),1);render()};
 const head=h('div',{class:'toolbar cal-head'},
  h('div',{class:'cal-nav'},
   h('button',{type:'button',class:'icon-btn','aria-label':'Предыдущий месяц',onclick:()=>setMonth(new Date(m.getFullYear(),m.getMonth()-1,1))},'‹'),
   h('strong',{class:'cal-title',text:MONTHS[m.getMonth()]+' '+m.getFullYear()}),
   h('button',{type:'button',class:'icon-btn','aria-label':'Следующий месяц',onclick:()=>setMonth(new Date(m.getFullYear(),m.getMonth()+1,1))},'›'),
   h('button',{type:'button',text:'Сегодня',onclick:()=>{calView.selected=today();setMonth(now)}})),
  segmented([{value:'all',label:'Все'},{value:'personal',label:'🏠 Личные'},{value:'work',label:'💼 Рабочие'}],calView.cat,v=>{calView.cat=v;render()},'Категория'));
 const grid=h('div',{class:'cal-grid',role:'grid','aria-label':'Месяц'},...['пн','вт','ср','чт','пт','сб','вс'].map(d=>h('div',{class:'cal-wd',text:d})));
 const t=today();
 for(let i=0;i<42;i++){
  const d=addDays(start,i),key=ymd(d),list=(byDay.get(key)||[]).sort(byAgenda),openN=list.filter(x=>!x.done).length;
  if(i>=35&&d.getMonth()!==m.getMonth())break;
  const late=list.some(x=>!x.done&&key<t);
  const cell=h('button',{type:'button',role:'gridcell',class:'cal-day'+(d.getMonth()!==m.getMonth()?' other':'')+(key===t?' today':'')+(key===calView.selected?' selected':'')+(d.getDay()===0||d.getDay()===6?' weekend':'')+(late?' late':''),
   'aria-label':d.getDate()+' '+MONTHS_GEN[d.getMonth()]+(openN?', дел: '+openN:''),onclick:()=>{calView.selected=key;if(d.getMonth()!==m.getMonth())calView.month=new Date(d.getFullYear(),d.getMonth(),1);render()}},
   h('span',{class:'cal-num',text:String(d.getDate())}),
   h('span',{class:'cal-pills'},...list.slice(0,3).map(x=>h('span',{class:'cal-pill cat-'+catOf(x)+(x.done?' done':'')+(x.priority==='high'?' high':''),text:(x.time?x.time+' ':'')+x.title}))),
   list.length>3?h('span',{class:'cal-more',text:'+'+(list.length-3)}):null,
   list.length?h('span',{class:'cal-dots'},...list.slice(0,5).map(x=>h('i',{class:'cat-'+catOf(x)+(x.done?' done':'')}))):null);
  grid.append(cell);
 }
 const sel=calView.selected,dayTasks=(byDay.get(sel)||[]).sort(byAgenda);
 const side=h('aside',{class:'panel cal-side'},h('h3',{text:dayLabel(sel)+(dayLabel(sel).length<12?' · '+fromYmd(sel).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}):'')}),
  dayTasks.length?h('div',{class:'task-list'},...dayTasks.map(x=>taskRow(x,{compact:true}))):h('p',{class:'muted',text:'На этот день дел нет.'}),
  h('h4',{class:'side-sub',text:'Добавить на этот день'}),quickDayForm(sel));
 const undated=workspace.tasks.filter(x=>!x.done&&!x.due&&(calView.cat==='all'||catOf(x)===calView.cat));
 const legend=h('p',{class:'muted cal-legend'},h('i',{class:'dot cat-personal'}),' личные  ',h('i',{class:'dot cat-work'}),' рабочие'+(undated.length?' · без срока: '+undated.length+' (раздел «Дела»)':''));
 root.append(head,h('div',{class:'cal-layout'},h('div',{class:'panel cal-panel'},grid,legend),side));
}
function quickDayForm(day){
 const name='qcat';
 const title=h('input',{required:true,maxLength:200,placeholder:'Новое дело','aria-label':'Название дела'});
 const time=h('input',{type:'time','aria-label':'Время'});
 const form=h('form',{class:'quick-day'},title,h('div',{class:'row'},categoryPicker(name,calView.cat==='work'?'work':'personal'),time),h('button',{class:'primary',text:'Добавить'}));
 form.onsubmit=e=>{e.preventDefault();act(()=>items('POST',{collection:'tasks',title:title.value,due:day,time:time.value||null,category:form.querySelector('input[name="'+name+'"]:checked')?.value||'personal'}))};
 return form;
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

function go(next){if(!TITLES[next])next='home';page=next;taskView.editing=null;noteView.editing=null;document.querySelectorAll('.rail button[data-page]').forEach(b=>{const on=b.dataset.page===page;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});render();window.scrollTo({top:0})}
document.querySelectorAll('[data-page]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.page)}));
window.TenmaApp={refresh,go,get workspace(){return workspace}};refresh();
