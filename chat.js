'use strict';
// Чат аватара с инструментами.
// Явные команды («заметка: …», «дело: …», «запомни …», «найди …» и т.д.) выполняются локально всегда.
// Остальные сообщения: если подключена модель (меню аватара → «Модель ИИ», например Cloud.ru, или CHAT_URL в .env), отвечает модель
// и может сама вызывать включённые инструменты; иначе аватар ищет ответ в фактах и заметках.
// Какие инструменты разрешены, решает пользователь в настройках аватара (список приходит в запросе).
const memory=require('./memory-core');
const storage=require('./storage');
const llm=require('./llm');

const MAX_MESSAGE=2000,MAX_HISTORY=12,MAX_TOOL_ROUNDS=4;
const PAGES={home:'Обзор',notes:'Знания',tasks:'Дела',facts:'Факты памяти',settings:'Настройки проекта'};

// Описание инструментов: id совпадает с переключателями в настройках аватара.
const TOOLS={
 notes:{label:'Создавать заметки'},
 tasks:{label:'Вести дела'},
 facts:{label:'Запоминать факты'},
 search:{label:'Искать в памяти'},
 insights:{label:'Анализ памяти'},
 navigate:{label:'Открывать разделы'},
 reminders:{label:'Напоминания и таймеры'},
 calc:{label:'Калькулятор'},
 fun:{label:'Кубик и монетка'},
 avatar:{label:'Менять свой облик'},
 backup:{label:'Делать резервную копию'},
 sync:{label:'Переиндексация памяти'},
 status:{label:'Проверять систему'},
 clock:{label:'Дата и время'}
};
const TOOL_IDS=Object.keys(TOOLS);

function words(text){return [...new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3))].slice(0,8)}
// Ищем по всей фразе и по каждому слову, затем ранжируем по числу совпавших слов, и только потом берём 8 лучших.
function findFacts(text){
 const terms=words(text),found=new Map();
 for(const term of [text,...terms]){
  try{for(const fact of memory.searchFacts(term.slice(0,300),50))if(!found.has(fact.id))found.set(fact.id,fact)}catch(e){if(!(e instanceof TypeError))throw e}
 }
 const full=text.trim().toLocaleLowerCase();
 const score=f=>{const hay=(f.subject+' '+f.predicate+' '+f.object).toLocaleLowerCase();return terms.filter(t=>hay.includes(t)).length+(hay.includes(full)?terms.length+1:0)};
 return [...found.values()].map(f=>({f,s:score(f)})).sort((a,b)=>b.s-a.s||String(b.f.observed_at).localeCompare(String(a.f.observed_at))).slice(0,8).map(x=>x.f);
}
async function findNotes(text){
 const terms=words(text);if(!terms.length)return [];
 const data=await storage.load();
 return (data.notes||[]).map(note=>{const hay=(note.title+' '+(note.content||'')).toLocaleLowerCase();return {note,score:terms.filter(t=>hay.includes(t)).length}})
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.note);
}
const factLine=f=>'• '+f.subject+' — '+f.predicate+' → '+f.object;
const noteLine=n=>'• '+n.title+(n.content?': '+n.content.slice(0,140):'');
function pageFrom(text){
 const t=String(text||'').toLocaleLowerCase();
 if(PAGES[t])return t;
 if(/обзор|главн|домой|начал/.test(t))return 'home';
 if(/знани|заметк|база/.test(t))return 'notes';
 if(/дел|задач/.test(t))return 'tasks';
 if(/факт|памят/.test(t))return 'facts';
 if(/настро/.test(t))return 'settings';
 return null;
}
function splitTitle(text){
 const m=text.match(/^(.+?)(?:\s+[—–-]\s+|\n|:\s+)([\s\S]+)$/);
 return m?{title:m[1].trim(),content:m[2].trim()}:{title:text.trim(),content:''};
}

/* ---------- Реализация инструментов ---------- */
// ctx предоставляет server.js: addItem(collection,title,content) и setTaskDone(id,done).
function makeTools(ctx){
 return {
  async add_note({title,content=''}){const item=await ctx.addItem('notes',String(title||'').slice(0,200),String(content||''));return {ok:true,text:'Заметка «'+item.title+'» сохранена.',changed:true}},
  async add_task({title}){const item=await ctx.addItem('tasks',String(title||'').slice(0,200),'');return {ok:true,text:'Дело «'+item.title+'» добавлено.',changed:true}},
  async complete_task({title}){
   const q=String(title||'').trim().toLocaleLowerCase();if(!q)return {ok:false,text:'Какое дело отметить?'};
   const tasks=(await storage.load()).tasks||[];
   const found=tasks.find(t=>!t.done&&t.title.toLocaleLowerCase()===q)||tasks.find(t=>!t.done&&t.title.toLocaleLowerCase().includes(q));
   if(!found)return {ok:false,text:'Не нашла открытого дела «'+title+'».'};
   ctx.setTaskDone(found.id,true);return {ok:true,text:'Отметила «'+found.title+'» выполненным ✓',changed:true};
  },
  async list_tasks(){
   const tasks=(await storage.load()).tasks||[],open=tasks.filter(t=>!t.done);
   if(!tasks.length)return {ok:true,text:'Дел пока нет.'};
   return {ok:true,text:(open.length?'Открытые дела ('+open.length+'):\n'+open.slice(0,15).map(t=>'• '+t.title).join('\n'):'Все дела выполнены!')+'\nВсего: '+tasks.length+', выполнено: '+(tasks.length-open.length)+'.'};
  },
  async remember_fact({subject,predicate,object}){
   const r=memory.addFact({subject,predicate,object,sourceId:'avatar-chat'});
   return {ok:true,changed:true,text:r.duplicate?'Это я уже помню.':'Запомнила: '+subject+' — '+predicate+' → '+object+(r.conflicts?'\n⚠ Противоречит прежним фактам: '+r.conflicts+'.':'')};
  },
  async search_memory({query}){
   const q=String(query||'').trim();if(!q)return {ok:false,text:'Что поискать?'};
   const facts=findFacts(q),notes=await findNotes(q);
   if(!facts.length&&!notes.length)return {ok:true,text:'По запросу «'+q+'» ничего не нашла.'};
   return {ok:true,text:[facts.length?'Факты:\n'+facts.map(factLine).join('\n'):'',notes.length?'Заметки:\n'+notes.map(noteLine).join('\n'):''].filter(Boolean).join('\n\n')};
  },
  async open_page({page}){const id=pageFrom(page);if(!id)return {ok:false,text:'Не знаю такого раздела. Есть: '+Object.values(PAGES).join(', ')+'.'};return {ok:true,text:'Открываю «'+PAGES[id]+'».',action:{type:'navigate',page:id}}},
  async create_backup(){const r=await storage.backup();return {ok:true,text:'Резервная копия SQLite создана: '+require('node:path').basename(r.file||'')+'. Векторы LanceDB в неё не входят.'}},
  async system_status(){
   const s=await require('./services').status(),d=memory.diagnostics();
   const mark=v=>v?'✓':'✗';
   return {ok:true,text:'SQLite '+mark(s.sqlite.ok)+' · LanceDB '+mark(s.lancedb.ok)+(s.lancedb.configured?' (эмбеддинги настроены)':' (эмбеддинги не настроены)')+' · граф '+mark(s.graph.ok)+'\nФактов в памяти: '+(d.facts??d.count??'—')+', целостность: '+(d.integrity||'—')+'.'+(llm.config()?'\nМодель: '+llm.config().model+'.':'\nЯзыковая модель не подключена.')};
  },
  async list_notes(){const notes=(await storage.load()).notes||[];if(!notes.length)return {ok:true,text:'Заметок пока нет.'};return {ok:true,text:'Последние заметки ('+notes.length+' всего):\n'+notes.slice(0,10).map(noteLine).join('\n')}},
  async day_summary(){
   const data=await storage.load(),today=new Date().toISOString().slice(0,10);
   const notes=(data.notes||[]).filter(n=>String(n.createdAt||'').startsWith(today)),tasks=data.tasks||[],newTasks=tasks.filter(t=>String(t.createdAt||'').startsWith(today)),open=tasks.filter(t=>!t.done);
   return {ok:true,text:'Итоги дня:\n• новых заметок: '+notes.length+'\n• новых дел: '+newTasks.length+'\n• открытых дел всего: '+open.length+(open.length?'\nБлижайшие: '+open.slice(0,3).map(t=>t.title).join(', '):'')}
  },
  async fact_conflicts(){const rows=memory.conflicts(10);if(!rows.length)return {ok:true,text:'Противоречий в памяти нет ✓'};return {ok:true,text:'Противоречия:\n'+rows.map(c=>'• '+c.subject+' — '+c.predicate+': «'+c.earlier+'» или «'+c.newer+'»').join('\n')}},
  async fact_relations({subject}){const rows=memory.relations(String(subject||''),20);if(!rows.length)return {ok:true,text:'О «'+subject+'» связей не знаю.'};return {ok:true,text:'Связи «'+subject+'»:\n'+rows.map(factLine).join('\n')}},
  async set_reminder({minutes,text}){
   const m=Number(minutes);if(!Number.isFinite(m)||m<=0||m>7*24*60)throw new TypeError('Укажите время от 1 минуты до недели');
   const t=String(text||'Время пришло!').trim().slice(0,200)||'Время пришло!',at=Date.now()+Math.round(m*60000);
   return {ok:true,text:'Напомню через '+fmtMinutes(m)+': «'+t+'» ⏰',action:{type:'reminder',at,text:t}};
  },
  async calculate({expression}){const v=calc(String(expression||''));return {ok:true,text:String(expression).trim()+' = '+(Number.isInteger(v)?v:Number(v.toFixed(10)))}},
  async roll_dice({sides=6}){const n=Math.max(2,Math.min(1000,Math.floor(Number(sides)||6)));return {ok:true,text:'🎲 Выпало '+(1+Math.floor(Math.random()*n))+(n!==6?' (d'+n+')':'')+'.'}},
  async flip_coin(){return {ok:true,text:'🪙 '+(Math.random()<.5?'Орёл':'Решка')+'!'}},
  async change_look(args){
   const look={};
   if(args.pose&&POSE_WORDS[args.pose])look.pose=args.pose;
   if(args.particles&&PARTICLE_WORDS[args.particles])look.particleType=args.particles;
   if(args.color&&/^#[0-9a-f]{6}$/i.test(args.color))look.glowColor=args.color;
   if(args.size)look.sizeDelta=Math.max(-200,Math.min(200,Number(args.size)||0));
   if(!Object.keys(look).length)return {ok:false,text:'Не поняла, что изменить. Например: «поза поклон», «эффект сакура», «цвет синий», «стань больше».'};
   return {ok:true,text:'Готово, меняюсь ✨',action:{type:'avatar',look}};
  },
  async reindex_memory(){const r=await require('./sync-worker').run();return {ok:true,text:'Переиндексация запущена'+(r&&typeof r==='object'&&'processed' in r?': обработано '+r.processed+'.':'.')+(process.env.EMBEDDING_URL?'':' (Эмбеддинги не настроены — векторный поиск выключен.)')}},
  async current_time(){const now=new Date();return {ok:true,text:'Сейчас '+now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+', '+now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'.'}}
 };
}
// Какому переключателю принадлежит функция.
const OWNER={list_notes:'notes',day_summary:'insights',fact_conflicts:'insights',fact_relations:'insights',set_reminder:'reminders',calculate:'calc',roll_dice:'fun',flip_coin:'fun',change_look:'avatar',reindex_memory:'sync',add_note:'notes',add_task:'tasks',complete_task:'tasks',list_tasks:'tasks',remember_fact:'facts',search_memory:'search',open_page:'navigate',create_backup:'backup',system_status:'status',current_time:'clock'};
const SCHEMAS={
 add_note:{description:'Создать заметку в базе знаний',parameters:{type:'object',properties:{title:{type:'string'},content:{type:'string'}},required:['title']}},
 add_task:{description:'Добавить дело в список дел',parameters:{type:'object',properties:{title:{type:'string'}},required:['title']}},
 complete_task:{description:'Отметить дело выполненным по названию',parameters:{type:'object',properties:{title:{type:'string'}},required:['title']}},
 list_tasks:{description:'Показать список дел',parameters:{type:'object',properties:{}}},
 remember_fact:{description:'Запомнить факт в виде субъект–связь–объект',parameters:{type:'object',properties:{subject:{type:'string'},predicate:{type:'string'},object:{type:'string'}},required:['subject','predicate','object']}},
 search_memory:{description:'Найти факты и заметки пользователя',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},
 open_page:{description:'Открыть раздел интерфейса: home, notes, tasks, facts, settings',parameters:{type:'object',properties:{page:{type:'string',enum:Object.keys(PAGES)}},required:['page']}},
 create_backup:{description:'Создать резервную копию базы SQLite',parameters:{type:'object',properties:{}}},
 system_status:{description:'Проверить состояние SQLite, LanceDB и памяти',parameters:{type:'object',properties:{}}},
 current_time:{description:'Узнать текущие дату и время',parameters:{type:'object',properties:{}}},
 list_notes:{description:'Показать последние заметки',parameters:{type:'object',properties:{}}},
 day_summary:{description:'Итоги дня: новые заметки и дела',parameters:{type:'object',properties:{}}},
 fact_conflicts:{description:'Показать противоречия в фактах памяти',parameters:{type:'object',properties:{}}},
 fact_relations:{description:'Показать все факты о субъекте',parameters:{type:'object',properties:{subject:{type:'string'}},required:['subject']}},
 set_reminder:{description:'Поставить напоминание или таймер через указанное число минут',parameters:{type:'object',properties:{minutes:{type:'number'},text:{type:'string'}},required:['minutes']}},
 calculate:{description:'Посчитать арифметическое выражение (+ - * / ^ % и скобки)',parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression']}},
 roll_dice:{description:'Бросить кубик',parameters:{type:'object',properties:{sides:{type:'integer'}}}},
 flip_coin:{description:'Подбросить монетку',parameters:{type:'object',properties:{}}},
 change_look:{description:'Изменить свой облик: позу (stand, sit-greet, seiza, sit-dream, bow), частицы (sparks, petals, foxfire, fireflies, stars, snow, butterflies, runes), цвет свечения (#rrggbb) или размер (+/- пикселей)',parameters:{type:'object',properties:{pose:{type:'string'},particles:{type:'string'},color:{type:'string'},size:{type:'number'}}}},
 reindex_memory:{description:'Запустить переиндексацию векторной памяти',parameters:{type:'object',properties:{}}}
};
// Безопасный калькулятор без eval: числа, + - * / % ^ и скобки.
function calc(src){
 const s=src.replace(/,/g,'.').replace(/[×х]/g,'*').replace(/[÷:]/g,'/').replace(/\s+/g,'');
 if(!s||s.length>200||!/^[\d.+\-*/%^()]+$/.test(s))throw new TypeError('Могу посчитать только числа и + - * / % ^ ( )');
 let i=0;
 const peek=()=>s[i],eat=c=>{if(s[i]===c){i++;return true}return false};
 function num(){const m=/^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));if(!m)throw new TypeError('Ошибка в выражении');i+=m[0].length;return Number(m[0])}
 function atom(){if(eat('-'))return -atom();if(eat('+'))return atom();if(eat('(')){const v=expr();if(!eat(')'))throw new TypeError('Не хватает скобки');return v}return num()}
 function power(){const b=atom();if(eat('^'))return b**unary();return b}
 function unary(){return power()}
 function term(){let v=unary();for(;;){if(eat('*'))v*=unary();else if(eat('/')){const d=unary();if(d===0)throw new TypeError('Делить на ноль нельзя');v/=d}else if(eat('%'))v%=unary();else return v}}
 function expr(){let v=term();for(;;){if(eat('+'))v+=term();else if(eat('-'))v-=term();else return v}}
 const v=expr();if(i!==s.length||!Number.isFinite(v))throw new TypeError('Ошибка в выражении');void peek;return v;
}
function fmtMinutes(m){if(m<1)return Math.round(m*60)+' с';if(m<60)return Math.round(m)+' мин';const h=Math.floor(m/60),r=Math.round(m%60);return h+' ч'+(r?' '+r+' мин':'')}
const POSE_WORDS={stand:'стоит|стой|встань',bow:'поклон|поклонись',seiza:'сэйдза|сейдза|сядь',['sit-dream']:'мечта|задумайся|мечтай',['sit-greet']:'улыбка|улыбнись'};
const PARTICLE_WORDS={sparks:'искр',petals:'сакур|лепест',foxfire:'огоньк|кицунэ-би|пламя|огонь',fireflies:'светлячк',stars:'звёзд|звезд',snow:'снег',butterflies:'бабоч',runes:'рун'};
const COLOR_WORDS={'#e8c25a':'золот|жёлт|желт','#f4f1ff':'бел|лунн|серебр','#ff9ec7':'розов','#6fd6ff':'син|голуб','#b58cff':'фиолет|аметист|сирен','#ff5a5a':'красн|багр','#6fe3a8':'зелён|зелен|нефрит'};
const pick=(map,text)=>Object.keys(map).find(k=>new RegExp(map[k]).test(text));

/* ---------- Разбор явных команд ---------- */
function parseCommand(text){
 const t=text.trim(),low=t.toLocaleLowerCase();
 let m;
 if(/^(помощь|справка|команды|что (ты )?умеешь|инструменты)\??!?$/.test(low))return {help:true};
 if((m=t.match(/^(?:создай\s+|новая\s+|добавь\s+|запиши\s+)?заметк[уаи]\s*[:—–-]?\s+([\s\S]+)$/i)))return {fn:'add_note',args:splitTitle(m[1])};
 if((m=t.match(/^(?:добавь\s+|новое\s+|создай\s+|новая\s+)?(?:дело|задач[уа])\s*[:—–-]?\s+([\s\S]+)$/i)))return {fn:'add_task',args:{title:m[1].trim()}};
 if((m=t.match(/^(?:выполнено|готово|сделано|выполнила?|сделала?)\s*[:—–-]?\s+(.+)$/i))||(m=t.match(/^отметь\s+(.+?)(?:\s+(?:как\s+)?(?:выполненн\S*|сделанн\S*|готов\S*))?$/i)))return {fn:'complete_task',args:{title:m[1].trim()}};
 if(/^(мои дела|список дел|покажи дела|какие (у меня )?дела|что (мне )?(нужно|надо) сделать)\??$/.test(low))return {fn:'list_tasks',args:{}};
 if((m=t.match(/^запомни\s*(?:,?\s*что)?\s*[:—–-]?\s*([\s\S]+)$/i))){
  let parts=m[1].split('|').map(s=>s.trim()).filter(Boolean);
  if(parts.length!==3)parts=m[1].split(/\s+[—–-]\s+|\s*→\s*/).map(s=>s.trim()).filter(Boolean);
  if(parts.length!==3)return {error:'Чтобы запомнить факт, напишите так: «запомни Анна | живёт в | Казань».'};
  return {fn:'remember_fact',args:{subject:parts[0],predicate:parts[1],object:parts[2]}};
 }
 if((m=t.match(/^(?:найди|поищи|поиск|что ты знаешь о|что ты помнишь о|что известно о)\s*[:—–-]?\s+(.+?)\??$/i)))return {fn:'search_memory',args:{query:m[1]}};
 if((m=t.match(/^(?:открой|перейди\s+(?:в|на|к)|покажи\s+раздел)\s+(.+)$/i))&&pageFrom(m[1]))return {fn:'open_page',args:{page:pageFrom(m[1])}};
 if(/(резервн\S*\s+коп|бэкап|бекап|backup)/.test(low)&&/^(сделай|создай|запусти|нужна|сохрани|бэкап|бекап|backup|резерв)/.test(low))return {fn:'create_backup',args:{}};
 if(/^(статус|состояние|проверь систему|проверка системы|диагностика)\??$/.test(low))return {fn:'system_status',args:{}};
 if(/^(который час|сколько времени|какое (сегодня )?число|какая (сегодня )?дата|какой сегодня день|время|дата)\??$/.test(low))return {fn:'current_time',args:{}};
 if(/^(мои заметки|список заметок|покажи заметки|последние заметки)\??$/.test(low))return {fn:'list_notes',args:{}};
 if(/^(итоги( дня)?|сводка|отчёт|отчет|как прош(ёл|ел) день)\??$/.test(low))return {fn:'day_summary',args:{}};
 if(/^(противоречия|покажи противоречия|конфликты)\??$/.test(low))return {fn:'fact_conflicts',args:{}};
 if((m=t.match(/^(?:связи|всё о|все о|что связано с)\s+(.+?)\??$/i)))return {fn:'fact_relations',args:{subject:m[1]}};
 if((m=t.match(/^(?:напомни|таймер|поставь таймер|разбуди)\s+(?:мне\s+)?(?:через\s+)?(\d+(?:[.,]\d+)?)\s*(сек\S*|мин\S*|час\S*|с|м|ч)?(?=[\s:,—–-]|$)\s*[:,—–-]?\s*(.*)$/i))){
  const n=Number(m[1].replace(',','.')),u=(m[2]||'мин').toLocaleLowerCase();
  const minutes=u.startsWith('с')?n/60:u.startsWith('ч')?n*60:n;
  return {fn:'set_reminder',args:{minutes,text:m[3]||'Время пришло!'}};
 }
 if((m=t.match(/^(?:помодоро|фокус)\s*(\d+)?$/i)))return {fn:'set_reminder',args:{minutes:Number(m[1]||25),text:'Помодоро завершён — пора отдохнуть 🍵'}};
 if((m=t.match(/^(?:посчитай|сколько будет|вычисли|калькулятор|=)\s*(.+?)\??$/i)))return {fn:'calculate',args:{expression:m[1]}};
 if(/^(брось|кинь)\s+(кубик|кость)/.test(low)||low==='кубик'){const n=(low.match(/d(\d+)/)||[])[1];return {fn:'roll_dice',args:{sides:n?Number(n):6}}}
 if(/^(подбрось|брось|кинь)\s+монет/.test(low)||low==='монетка'||/орёл или решка|орел или решка/.test(low))return {fn:'flip_coin',args:{}};
 if((m=low.match(/^(?:поза|прими позу|стань в позу)\s+(.+)$/))){const p=pick(POSE_WORDS,m[1]);return p?{fn:'change_look',args:{pose:p}}:{error:'Позы: стоит, улыбка, сэйдза, мечтает, поклон.'}}
 if(/^(поклонись|улыбнись|задумайся|встань|сядь)$/.test(low))return {fn:'change_look',args:{pose:pick(POSE_WORDS,low)}};
 if((m=low.match(/^(?:эффект|частицы|включи эффект|включи частицы)\s+(.+)$/))){const p=pick(PARTICLE_WORDS,m[1]);return p?{fn:'change_look',args:{particles:p}}:{error:'Эффекты: искры, сакура, огоньки, светлячки, звёзды, снег, бабочки, руны.'}}
 if((m=low.match(/^(?:цвет|свечение|сияй|светись)\s+(.+)$/))){const c=pick(COLOR_WORDS,m[1]);return c?{fn:'change_look',args:{color:c}}:{error:'Цвета: золотой, белый, розовый, синий, фиолетовый, красный, зелёный.'}}
 if(/^(стань |будь )?(больше|побольше|крупнее)$/.test(low))return {fn:'change_look',args:{size:40}};
 if(/^(стань |будь )?(меньше|поменьше)$/.test(low))return {fn:'change_look',args:{size:-40}};
 if(/^(переиндексируй|переиндексация|обнови индекс|синхронизируй память)\??$/.test(low))return {fn:'reindex_memory',args:{}};
 return null;
}
function helpText(enabled){
 const lines={insights:'«итоги дня», «противоречия», «связи Анна»',reminders:'«напомни через 10 минут позвонить», «помодоро»',calc:'«посчитай (2+3)*4»',fun:'«брось кубик», «монетка»',avatar:'«поза поклон», «эффект сакура», «цвет синий», «стань больше»',sync:'«переиндексируй»',notes:'«заметка: Заголовок — текст», «мои заметки»',tasks:'«дело: купить чай», «готово: купить чай», «мои дела»',facts:'«запомни Анна | живёт в | Казань»',search:'«найди Анна»',navigate:'«открой дела»',backup:'«сделай резервную копию»',status:'«статус»',clock:'«который час»'};
 const on=TOOL_IDS.filter(id=>enabled.has(id));
 if(!on.length)return 'Все мои инструменты выключены. Включите их в настройках (правый клик по мне → «Инструменты»).';
 return 'Что я умею:\n'+on.map(id=>'• '+TOOLS[id].label+': '+lines[id]).join('\n');
}

function cleanHistory(history){
 if(!Array.isArray(history))return [];
 return history.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-MAX_HISTORY).map(m=>({role:m.role,content:m.text.slice(0,MAX_MESSAGE)}));
}
function localReply(name,facts,notes,enabled){
 const lines=[];
 if(facts.length){lines.push('Вот что я помню:');for(const f of facts)lines.push(factLine(f))}
 if(notes.length){lines.push(facts.length?'\nИ в заметках:':'Нашла в заметках:');for(const n of notes)lines.push(noteLine(n))}
 if(!lines.length)lines.push('Пока ничего об этом не знаю.'+(enabled.has('facts')?' Скажите «запомни субъект | связь | объект», и я запомню.':''));
 lines.push('\n(Отвечаю локально. Напишите «помощь», чтобы увидеть мои инструменты. Языковую модель, например Cloud.ru, можно подключить в моём меню → «Модель ИИ».)');
 return lines.join('\n');
}

async function modelReply(name,message,history,facts,notes,enabled,impl,result){
 const context=[...facts.map(f=>'ФАКТ: '+f.subject+' | '+f.predicate+' | '+f.object),...notes.map(n=>'ЗАМЕТКА: '+n.title+' — '+(n.content||'').slice(0,500))].join('\n');
 const allowed=Object.keys(SCHEMAS).filter(fn=>enabled.has(OWNER[fn]));
 const tools=allowed.map(fn=>({type:'function',function:{name:fn,...SCHEMAS[fn]}}));
 const persona=(llm.config()?.systemPrompt||'').trim();
 const system=(persona||'Ты '+name+' — девятихвостая лиса-кицунэ, хранительница личной памяти Tenmayurika. Отвечай по-русски, тепло и кратко.')+' Твоё имя: '+name+'. Сегодня '+new Date().toLocaleDateString('ru-RU')+'.'+(allowed.length?' Используй инструменты, когда пользователь просит что-то сделать.':'')+(context?'\nИзвестно из памяти пользователя:\n'+context:'');
 const messages=[{role:'system',content:system},...history,{role:'user',content:message}];
 for(let round=0;round<MAX_TOOL_ROUNDS;round++){
  const msg=await llm.complete({messages,tools});
  const calls=Array.isArray(msg.tool_calls)?msg.tool_calls:[];
  if(!calls.length){if(typeof msg.content!=='string'||!msg.content.trim())throw Error('Empty chat reply');return msg.content.trim()}
  messages.push({role:'assistant',content:msg.content||null,tool_calls:calls});
  for(const call of calls){
   const fn=call.function?.name;let out;
   if(!allowed.includes(fn))out={ok:false,text:'Инструмент недоступен'};
   else{let args={};try{args=JSON.parse(call.function.arguments||'{}')}catch{}try{out=await impl[fn](args)}catch(e){out={ok:false,text:e instanceof TypeError?e.message:'Ошибка инструмента'}}}
   track(result,fn,out);
   messages.push({role:'tool',tool_call_id:call.id,content:out.text});
  }
 }
 // Модель исчерпала лимит раундов: честно показываем, что вышло у каждого инструмента.
 return result.outcomes.length?'Не успела закончить ответ. Результаты инструментов:\n'+result.outcomes.map(o=>(o.ok?'• ':'✗ ')+o.text).join('\n'):'Не удалось завершить ответ.';
}
const pub=({done,outcomes,...rest})=>rest;
function track(result,fn,out){result.tools.push(fn);result.outcomes.push({ok:out.ok!==false,text:out.text});if(out.ok!==false)result.done.push(out.text);if(out.changed)result.changed=true;if(out.action)result.actions.push(out.action)}

async function reply(input,ctx={}){
 if(!input||typeof input!=='object'||typeof input.message!=='string'||!input.message.trim())throw new TypeError('Invalid message');
 const message=input.message.trim();
 if(message.length>MAX_MESSAGE)throw new TypeError('Сообщение длиннее '+MAX_MESSAGE+' символов. Сократите его или разбейте на части.');
 const name=typeof input.avatar==='string'&&input.avatar.trim()?input.avatar.trim().slice(0,40):'Юрика';
 // Без списка — все инструменты включены; с пустым списком — все выключены.
 const enabled=new Set(Array.isArray(input.tools)?input.tools.filter(id=>TOOL_IDS.includes(id)):TOOL_IDS);
 const impl=makeTools(ctx),result={tools:[],actions:[],changed:false,done:[],outcomes:[]};
 const command=parseCommand(message);
 if(command){
  if(command.help)return {reply:helpText(enabled),source:'tool',...pub(result)};
  if(command.error)return {reply:command.error,source:'tool',...pub(result)};
  if(!enabled.has(OWNER[command.fn]))return {reply:'Инструмент «'+TOOLS[OWNER[command.fn]].label+'» выключен в моих настройках (правый клик по мне → «Инструменты»).',source:'tool',...pub(result)};
  let out;try{out=await impl[command.fn](command.args)}catch(e){if(e instanceof TypeError)out={ok:false,text:'Не получилось: '+e.message};else throw e}
  track(result,command.fn,out);
  return {reply:out.text,source:'tool',...pub(result)};
 }
 const facts=findFacts(message),notes=await findNotes(message);
 if(llm.config()){
  try{return {reply:await modelReply(name,message,cleanHistory(input.history),facts,notes,enabled,impl,result),source:'model',...pub(result)}}
  catch(e){console.error('Chat model failed:',e.name);const done=result.done.length?'Модель не ответила до конца, но уже сделано:\n'+result.done.map(t=>'• '+t).join('\n'):null;return {reply:done||localReply(name,facts,notes,enabled),source:'local',fallback:true,...pub(result)}}
 }
 return {reply:localReply(name,facts,notes,enabled),source:'local',...pub(result)};
}
module.exports={reply,parseCommand,TOOLS};
