'use strict';
// Чат аватара с инструментами.
// Явные команды («заметка: …», «дело: …», «запомни …», «найди …» и т.д.) выполняются локально всегда.
// Остальные сообщения: если в .env задан CHAT_URL (OpenAI-совместимый /chat/completions), отвечает модель
// и может сама вызывать включённые инструменты; иначе аватар ищет ответ в фактах и заметках.
// Какие инструменты разрешены, решает пользователь в настройках аватара (список приходит в запросе).
const memory=require('./memory-core');
const storage=require('./storage');

const MAX_MESSAGE=2000,MAX_HISTORY=12,MAX_TOOL_ROUNDS=4;
const PAGES={home:'Обзор',notes:'Знания',tasks:'Дела',facts:'Факты памяти',settings:'Настройки проекта'};

// Описание инструментов: id совпадает с переключателями в настройках аватара.
const TOOLS={
 notes:{label:'Создавать заметки'},
 tasks:{label:'Вести дела'},
 facts:{label:'Запоминать факты'},
 search:{label:'Искать в памяти'},
 navigate:{label:'Открывать разделы'},
 backup:{label:'Делать резервную копию'},
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
   return {ok:true,text:'SQLite '+mark(s.sqlite.ok)+' · LanceDB '+mark(s.lancedb.ok)+(s.lancedb.configured?' (эмбеддинги настроены)':' (эмбеддинги не настроены)')+' · граф '+mark(s.graph.ok)+'\nФактов в памяти: '+(d.facts??d.count??'—')+', целостность: '+(d.integrity||'—')+'.'+(process.env.CHAT_URL?'\nЯзыковая модель подключена.':'\nЯзыковая модель не подключена (CHAT_URL).')};
  },
  async current_time(){const now=new Date();return {ok:true,text:'Сейчас '+now.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+', '+now.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'.'}}
 };
}
// Какому переключателю принадлежит функция.
const OWNER={add_note:'notes',add_task:'tasks',complete_task:'tasks',list_tasks:'tasks',remember_fact:'facts',search_memory:'search',open_page:'navigate',create_backup:'backup',system_status:'status',current_time:'clock'};
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
 current_time:{description:'Узнать текущие дату и время',parameters:{type:'object',properties:{}}}
};

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
 return null;
}
function helpText(enabled){
 const lines={notes:'«заметка: Заголовок — текст»',tasks:'«дело: купить чай», «готово: купить чай», «мои дела»',facts:'«запомни Анна | живёт в | Казань»',search:'«найди Анна»',navigate:'«открой дела»',backup:'«сделай резервную копию»',status:'«статус»',clock:'«который час»'};
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
 lines.push('\n(Отвечаю локально. Напишите «помощь», чтобы увидеть мои инструменты. Языковая модель подключается через CHAT_URL в .env.)');
 return lines.join('\n');
}

async function callModel(messages,tools){
 const response=await fetch(process.env.CHAT_URL,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.CHAT_API_KEY?{Authorization:'Bearer '+process.env.CHAT_API_KEY}:{})},
  body:JSON.stringify({model:process.env.CHAT_MODEL||'gpt-4o-mini',messages,...(tools.length?{tools}:{})}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('Chat API HTTP '+response.status);
 const data=await response.json(),msg=data.choices?.[0]?.message;
 if(!msg)throw Error('Empty chat reply');
 return msg;
}
async function modelReply(name,message,history,facts,notes,enabled,impl,result){
 const context=[...facts.map(f=>'ФАКТ: '+f.subject+' | '+f.predicate+' | '+f.object),...notes.map(n=>'ЗАМЕТКА: '+n.title+' — '+(n.content||'').slice(0,500))].join('\n');
 const allowed=Object.keys(SCHEMAS).filter(fn=>enabled.has(OWNER[fn]));
 const tools=allowed.map(fn=>({type:'function',function:{name:fn,...SCHEMAS[fn]}}));
 const system='Ты '+name+' — девятихвостая лиса-кицунэ, хранительница личной памяти Tenmayurika. Отвечай по-русски, тепло и кратко. Сегодня '+new Date().toLocaleDateString('ru-RU')+'.'+(allowed.length?' Используй инструменты, когда пользователь просит что-то сделать.':'')+(context?'\nИзвестно из памяти пользователя:\n'+context:'');
 const messages=[{role:'system',content:system},...history,{role:'user',content:message}];
 for(let round=0;round<MAX_TOOL_ROUNDS;round++){
  const msg=await callModel(messages,tools);
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
 return result.tools.length?'Готово.':'Не удалось завершить ответ.';
}
function track(result,fn,out){result.tools.push(fn);if(out.changed)result.changed=true;if(out.action)result.actions.push(out.action)}

async function reply(input,ctx={}){
 if(!input||typeof input!=='object'||typeof input.message!=='string'||!input.message.trim())throw new TypeError('Invalid message');
 const message=input.message.trim().slice(0,MAX_MESSAGE);
 const name=typeof input.avatar==='string'&&input.avatar.trim()?input.avatar.trim().slice(0,40):'Юрика';
 // Без списка — все инструменты включены; с пустым списком — все выключены.
 const enabled=new Set(Array.isArray(input.tools)?input.tools.filter(id=>TOOL_IDS.includes(id)):TOOL_IDS);
 const impl=makeTools(ctx),result={tools:[],actions:[],changed:false};
 const command=parseCommand(message);
 if(command){
  if(command.help)return {reply:helpText(enabled),source:'tool',...result};
  if(command.error)return {reply:command.error,source:'tool',...result};
  if(!enabled.has(OWNER[command.fn]))return {reply:'Инструмент «'+TOOLS[OWNER[command.fn]].label+'» выключен в моих настройках (правый клик по мне → «Инструменты»).',source:'tool',...result};
  let out;try{out=await impl[command.fn](command.args)}catch(e){if(e instanceof TypeError)out={ok:false,text:'Не получилось: '+e.message};else throw e}
  track(result,command.fn,out);
  return {reply:out.text,source:'tool',...result};
 }
 const facts=findFacts(message),notes=await findNotes(message);
 if(process.env.CHAT_URL){
  try{return {reply:await modelReply(name,message,cleanHistory(input.history),facts,notes,enabled,impl,result),source:'model',...result}}
  catch(e){console.error('Chat model failed:',e.name);return {reply:localReply(name,facts,notes,enabled),source:'local',fallback:true,...result}}
 }
 return {reply:localReply(name,facts,notes,enabled),source:'local',...result};
}
module.exports={reply,parseCommand,TOOLS};
