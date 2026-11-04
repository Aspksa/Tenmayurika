'use strict';
require('dotenv').config();
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const storage=require('./storage');
const services=require('./services');
const vectorStore=require('./vector-store');
const syncWorker=require('./sync-worker');
const maintenance=require('./tools/maintenance');
const memory=require('./memory-core');
const chat=require('./chat');
const learn=require('./learn');
const experience=require('./experience');
const chatlog=require('./chatlog');
const llm=require('./llm');
const reflect=require('./reflect');
const preferences=require('./preferences');
const skills=require('./skills');
const links=require('./links');
const usefulness=require('./usefulness');
const working=require('./working');
const growth=require('./growth');
const aliases=require('./aliases');
const memskills=require('./memskills');
const selfstudy=require('./selfstudy');
const core=require('./core');
const soul=require('./soul');
const onboarding=require('./onboarding');
const review=require('./review');
const atlas=require('./atlas');
const thoughts=require('./thoughts');
const strength=require('./strength');
const meta=require('./meta');
const guesses=require('./guesses');
const curiosity=require('./curiosity');
const initiative=require('./initiative');
const library=require('./library');
let diskHealthy=true;
function ensureDisk(){try{maintenance.checkDisk();diskHealthy=true}catch(e){diskHealthy=false;throw e}}
const HOST='127.0.0.1',PORT=Number(process.env.PORT)||5173;
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw Error('Invalid server port');
const ROOT=__dirname;
const BACKUP_INTERVAL_MS=5*60*60*1000;
let backupTimer;
async function scheduledBackup(){try{ensureDisk();const result=await storage.backup();console.log('Резервная копия SQLite создана:',result.file);if(result.retentionWarnings?.length)console.warn('Не все старые копии удалось удалить')}catch(e){console.error('Автоматическое резервное копирование не выполнено:',e.code||e.name)}}
function startBackupSchedule(){backupTimer=setInterval(()=>{void scheduledBackup()},BACKUP_INTERVAL_MS);backupTimer.unref()}

const allowed=new Map([['/', 'index.html'],['/index.html','index.html'],['/styles.css','styles.css'],['/app.js','app.js'],['/avatar.js','avatar.js'],['/brain.js','brain.js'],['/favicon.svg','favicon.svg']]);
// Аватары: только файлы с безопасными именами из assets/avatars.
const AVATAR_PATH=/^\/assets\/avatars\/[a-z0-9-]{1,40}\.webp$/;
const TYPES={'.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'};
function respond(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body))}
async function body(req){const chunks=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>100000)throw Error('Request too large');chunks.push(part)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
// Слои «Мозга» из опыта MemOS: дневник размышлений, выводы, навыки, предпочтения, сводки тем,
// причинные связи, рабочая память темы и польза записей.
// Навыки запоминания для «Мозга»: банк, история, промахи, самоэкзамен, просьба о подсказке.
function mskillView(){
 const evo=memskills.evoState();
 return {skills:memskills.list({all:true}).map(({purpose,when,how,avoid,...s})=>({...s,purpose})),history:selfstudy.learnedLog(20),misses:memskills.queue({limit:8}),missStats:memskills.missStats(),score:selfstudy.score(),help:evo.help,failed:(evo.failed||[]).slice(-5),version:memskills.bankVersion()};
}
async function handleBrain(req,res,p,url){
 try{
  if(req.method==='GET'&&p==='/api/brain/mind'){
   const ws=await storage.load(),title=new Map([...(ws.notes||[]).map(n=>['note:'+n.id,n.title]),...(ws.tasks||[]).map(t=>['task:'+t.id,t.title])]);
   const recent=links.list(30),fids=recent.flatMap(l=>[l.a_kind==='fact'?l.a_ref:null,l.b_kind==='fact'?l.b_ref:null]).filter(Boolean);
   for(const f of memory.factsById(fids))title.set('fact:'+f.id,f.subject+' — '+f.predicate+' → '+f.object);
   const end=(k,r)=>({kind:k,id:r,title:title.get(k+':'+r)||null});
   return respond(res,200,{diary:reflect.diary(limitParam(url,20,200)),insights:reflect.insightList(20),skills:skills.list(),preferences:preferences.list(),summaries:reflect.summaries().slice(0,30).map(({factIds,...t})=>({...t,size:factIds.length})),
    links:{count:links.count(),recent:recent.map(l=>({type:l.type,a:end(l.a_kind,l.a_ref),b:end(l.b_kind,l.b_ref),evidence:l.evidence,source:l.source}))},working:working.snapshot(),reflect:reflect.status(),growth:{...growth.stats(),cards:growth.cards(8)},memskills:mskillView(),core:core.list(),soul:soul.view(),onboarding:onboarding.status(),review:review.status()});
  }
  if(req.method==='GET'&&p==='/api/brain/memskills/organs')return respond(res,200,memskills.list({all:true}).map(s=>({name:s.name,title:s.title,status:s.status,uses:s.uses,value:s.value,version:s.version,action:s.action})));
  if(req.method==='GET'&&p==='/api/brain/memskills')return respond(res,200,{...mskillView(),misses:memskills.queue({limit:50}),selftests:selfstudy.selftests(50),windows:selfstudy.watchInfo().windows});
  // Ответ на просьбу о подсказке: подсказка становится навыком запоминания, самоучёба продолжается.
  if(req.method==='POST'&&p==='/api/brain/memskills/hint'){const input=await body(req);if(typeof input?.text!=='string')return respond(res,400,{error:'Invalid text'});try{return respond(res,201,{skill:memskills.addHint(input.text)})}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
  if(req.method==='POST'&&p==='/api/brain/memskills/help/dismiss'){memskills.clearHelp();return respond(res,200,{ok:true})}
  if(req.method==='GET'&&p==='/api/brain/strength')return respond(res,200,usefulness.strength());
  // Рост: крепнущие связи, карточки сущностей, псевдонимы и свои типы (growth.js).
  if(req.method==='GET'&&p==='/api/brain/bonds')return respond(res,200,growth.bonds({limit:limitParam(url,2000,5000)}));
  if(req.method==='GET'&&p==='/api/brain/card'){const c=growth.card(url.searchParams.get('name')||'');return c?respond(res,200,c):respond(res,404,{error:'Not found'})}
  if(req.method==='GET'&&p==='/api/brain/growth')return respond(res,200,{...growth.stats(),cards:growth.cards(limitParam(url,50,500))});
  if(req.method==='POST'&&p==='/api/brain/aliases'){const input=await body(req);const r=aliases.add(input?.alias,input?.canonical,{evidence:'указано вручную',source:'user'});return respond(res,r?201:200,r||{ok:true,unchanged:true})}
  if(req.method==='POST'&&p==='/api/brain/aliases/remove'){const input=await body(req);return aliases.remove(input?.alias)?respond(res,200,{ok:true}):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/brain/types'){const input=await body(req);return respond(res,200,growth.setType(input?.name,input?.type))}
  // Сердцевина: блоки «Кто я», «Кто ты», «Как мы общаемся», их версии и возврат (core.js).
  if(req.method==='GET'&&p==='/api/brain/core')return respond(res,200,core.list().map(b=>({...b,history:core.history(b.name,10)})));
  if(req.method==='POST'&&p==='/api/brain/core'){const input=await body(req);if(typeof input?.body!=='string')return respond(res,400,{error:'Invalid body'});return respond(res,200,core.write(input.name,input.body,{source:'user',reason:'поправлено вручную'}))}
  // Душа: ступень, черты, настроение и дорогие моменты (soul.js); можно начать рост заново.
  if(req.method==='GET'&&p==='/api/brain/soul')return respond(res,200,soul.view());
  if(req.method==='POST'&&p==='/api/brain/soul/reset')return respond(res,200,soul.reset());
  if(req.method==='POST'&&p==='/api/brain/core/restore'){const input=await body(req);const r=core.restore(input?.name,input?.version);return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  // Знакомство: пропустить пункт, закончить или начать заново.
  if(req.method==='POST'&&p==='/api/brain/onboarding'){const input=await body(req),a=input?.action;
   if(a==='skip')return respond(res,200,onboarding.mark(String(input.item||''),{skipped:true}));
   if(a==='finish')return respond(res,200,onboarding.finish());
   if(a==='restart')return respond(res,200,onboarding.restart());
   return respond(res,400,{error:'Invalid action'})}
  // Разбор разговора вручную и оглавление памяти.
  // Мышление: поток мыслей, настройки, догадки, вопросы, забытое, предложения, рост по дням.
  if(req.method==='GET'&&p==='/api/brain/thoughts')return respond(res,200,{items:thoughts.since(Number(url.searchParams.get('since'))||0,limitParam(url,60,200)),settings:thoughts.settings(),labels:thoughts.LABELS});
  if(req.method==='POST'&&p==='/api/brain/settings'){const input=await body(req);return respond(res,200,thoughts.setSetting(input?.key,input?.value))}
  if(req.method==='GET'&&p==='/api/brain/thinking')return respond(res,200,{guesses:guesses.list(null,30),guessStats:guesses.stats(),questions:curiosity.list(null,30),questionStats:curiosity.stats(),forgotten:strength.forgotten({limit:20}),strength:strength.stats(),suggestions:initiative.list(null,20),suggestionStats:initiative.stats(),settings:thoughts.settings(),labels:thoughts.LABELS});
  if(req.method==='POST'&&p==='/api/brain/guesses/answer'){const input=await body(req);if(typeof input?.yes!=='boolean')return respond(res,400,{error:'Invalid value'});const r=guesses.answer(input.id,input.yes);return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/brain/questions/dismiss'){const input=await body(req);return curiosity.dismiss(input?.id)?respond(res,200,{ok:true}):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/brain/forgotten/restore'){const input=await body(req);const ids=Array.isArray(input?.ids)?input.ids.filter(x=>typeof x==='string').slice(0,50):[];const r=strength.remember(ids);if(r.length)thoughts.add('wake','Вы вернули забытое: '+r.map(f=>f.subject+' — '+f.predicate+' '+f.object).slice(0,3).join('; '));return respond(res,200,{restored:r.length})}
  if(req.method==='GET'&&p==='/api/brain/initiative'){const ws=await storage.load();if(thoughts.on('initiative'))initiative.scan(ws);return respond(res,200,{items:thoughts.on('initiative')?initiative.fresh(3):[],on:thoughts.on('initiative')})}
  if(req.method==='POST'&&p==='/api/brain/initiative/shown'){const input=await body(req);return respond(res,200,{ok:initiative.shown(input?.id)})}
  if(req.method==='POST'&&p==='/api/brain/initiative/accept'){const input=await body(req);const r=await initiative.accept(input?.id,chatContext);return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/brain/initiative/dismiss'){const input=await body(req);const r=initiative.dismiss(input?.id);return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/brain/review')return respond(res,200,await review.run({complete:llm.config()?llm.complete:null,reason:'manual'}));
  if(req.method==='GET'&&p==='/api/brain/atlas')return respond(res,200,atlas.index(limitParam(url,30,200)));
  if(req.method==='POST'&&p==='/api/brain/reflect'){const r=await reflect.run({ws:await storage.load(),complete:llm.config()?llm.complete:null,reason:'manual'});return respond(res,200,r)}
  if(req.method==='POST'&&p==='/api/brain/preferences'){const input=await body(req);return respond(res,201,preferences.addText(input?.text))}
  if(req.method==='POST'&&p==='/api/brain/preferences/remove'){const input=await body(req);return preferences.remove(input?.id)?respond(res,200,{ok:true}):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/brain/skills/remove'){const input=await body(req);return skills.remove(input?.id)?respond(res,200,{ok:true}):respond(res,404,{error:'Not found'})}
  return respond(res,404,{error:'Not found'});
 }catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}
}
// Факты памяти (memory-core.js). Ошибки валидации memory-core — TypeError, отдаются как 400.
function limitParam(url,fallback,max){const raw=url.searchParams.get('limit');if(raw===null)return fallback;const n=Number(raw);if(!Number.isInteger(n)||n<1||n>max)throw new TypeError('Invalid limit');return n}
async function handleFacts(req,res,p,url){
 try{
  if(req.method==='GET'&&p==='/api/facts'){
   const q=url.searchParams.get('q'),subject=url.searchParams.get('subject');
   if(q&&q.trim())return respond(res,200,memory.searchFacts(q,limitParam(url,30,100)));
   const list=memory.queryFacts({subject:subject&&subject.trim()?subject:undefined,limit:limitParam(url,50,5000)});
   // Время, вид, источник и сила — «Мозг» показывает их у нейрона, спящие тусклее.
   try{const live=list.filter(f=>!f.valid_to),m=meta.ensure(live),st=strength.get(live.map(f=>f.id));return respond(res,200,list.map(f=>{const x=m.get(f.id),s=st.get(f.id);return x||s?{...f,...(x?{meta:{...x,...meta.label(x)}}:{}),...(s?{stage:s.stage}:{})}:f}))}catch(e){console.error('Fact meta failed:',e.name)}
   return respond(res,200,list);
  }
  if(req.method==='POST'&&p==='/api/facts'){
   const input=await body(req);
   if(!input||typeof input!=='object'||Array.isArray(input))return respond(res,400,{error:'Invalid fact'});
   const result=memory.addFact({subject:input.subject,predicate:input.predicate,object:input.object,sourceId:typeof input.sourceId==='string'&&input.sourceId.trim()?input.sourceId:'manual',confidence:input.confidence});
   return respond(res,result.duplicate?200:201,result);
  }
  if(req.method==='GET'&&p==='/api/facts/relations'){const subject=url.searchParams.get('subject')||'';return respond(res,200,memory.relations(subject,limitParam(url,100,500)))}
  if(req.method==='POST'&&p==='/api/facts/conflicts/resolve'){const input=await body(req);if(!input||typeof input!=='object')return respond(res,400,{error:'Invalid input'});const r=memory.resolveConflict(input.id,input.keep);return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  if(req.method==='GET'&&p==='/api/facts/conflicts')return respond(res,200,memory.conflicts(limitParam(url,100,500)));
  if(req.method==='GET'&&p==='/api/facts/diagnostics')return respond(res,200,memory.diagnostics());
  // Граф памяти: связи на несколько шагов, путь между сущностями, темы (сообщества), почти-дубли, обзор, влияние.
  const q=k=>url.searchParams.get(k)||'',depth=(k,d,max)=>{const raw=url.searchParams.get(k);if(raw===null)return d;const n=Number(raw);if(!Number.isInteger(n)||n<1||n>max)throw new TypeError('Invalid depth');return n};
  if(req.method==='GET'&&p==='/api/facts/neighborhood')return respond(res,200,memory.neighborhood(q('subject'),depth('depth',2,3),limitParam(url,60,300)));
  if(req.method==='GET'&&p==='/api/facts/path')return respond(res,200,memory.findPath(q('from'),q('to'),depth('depth',3,4)));
  if(req.method==='GET'&&p==='/api/facts/communities')return respond(res,200,memory.communities());
  if(req.method==='GET'&&p==='/api/facts/duplicates')return respond(res,200,memory.duplicates({limit:limitParam(url,50,200)}));
  if(req.method==='POST'&&p==='/api/facts/duplicates/merge'){const input=await body(req);if(!input||typeof input!=='object')return respond(res,400,{error:'Invalid input'});const r=memory.mergeDuplicate(input.keep,input.drop);return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  if(req.method==='POST'&&p==='/api/facts/duplicates/dismiss'){const input=await body(req);if(!input||typeof input!=='object')return respond(res,400,{error:'Invalid input'});return respond(res,200,memory.dismissDuplicate(input.a,input.b))}
  if(req.method==='GET'&&p==='/api/facts/overview'){const ws=await storage.load();return respond(res,200,{...memory.overview(),notes:(ws.notes||[]).length,openTasks:(ws.tasks||[]).filter(t=>!t.done).length})}
  if(req.method==='GET'&&p==='/api/facts/impact'){await indexWorkspace();const r=memory.impact(q('id'));return r?respond(res,200,r):respond(res,404,{error:'Not found'})}
  return respond(res,404,{error:'Not found'});
 }catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}
}
// Заметки и дела в полнотекстовом индексе памяти (обновляются только изменённые).
async function indexWorkspace(){const ws=await storage.load();memory.syncRecords('note',ws.notes||[]);memory.syncRecords('task',ws.tasks||[]);return ws}
// Строки вида «FACT: субъект | связь | объект» в тексте заметки сохраняются как факты.
function ingestNoteFacts(item){if(!item.content||!item.content.includes('FACT:'))return;try{memory.extractFacts(item.content,'note:'+item.id)}catch(e){console.error('Fact ingestion failed:',e.name)}}
// Общие операции с записями: используются API и инструментами аватара.
// Дела: category (personal|work), due (ГГГГ-ММ-ДД), time (ЧЧ:ММ), priority (low|normal|high). Заметки: category и pinned.
const CATEGORIES=['personal','work'],PRIORITIES=['low','normal','high'];
function validDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v}
// Проверяет и возвращает только разрешённые поля; бросает TypeError с понятным текстом.
function itemFields(collection,input){
 const out={};
 if('title' in input){if(typeof input.title!=='string'||!input.title.trim()||input.title.length>200)throw new TypeError('Название: от 1 до 200 символов');out.title=input.title.trim()}
 if('content' in input){if(input.content!=null&&typeof input.content!=='string')throw new TypeError('Invalid content');out.content=String(input.content||'').slice(0,20000)}
 if('category' in input){if(!CATEGORIES.includes(input.category))throw new TypeError('Категория: personal или work');out.category=input.category}
 if(collection==='tasks'){
  if('done' in input){if(typeof input.done!=='boolean')throw new TypeError('Invalid done');out.done=input.done}
  if('due' in input){if(input.due===null||input.due==='')out.due=null;else if(typeof input.due==='string'&&validDate(input.due))out.due=input.due;else throw new TypeError('Дата: ГГГГ-ММ-ДД')}
  if('time' in input){if(input.time===null||input.time==='')out.time=null;else if(typeof input.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))out.time=input.time;else throw new TypeError('Время: ЧЧ:ММ')}
  if('priority' in input){if(!PRIORITIES.includes(input.priority))throw new TypeError('Приоритет: low, normal или high');out.priority=input.priority}
 }
 if(collection==='notes'&&'pinned' in input){if(typeof input.pinned!=='boolean')throw new TypeError('Invalid pinned');out.pinned=input.pinned}
 // day: заметка привязана к дню планера («Заметка дня» и заметки дня).
 if(collection==='notes'&&'day' in input){if(input.day===null||input.day==='')out.day=null;else if(typeof input.day==='string'&&validDate(input.day))out.day=input.day;else throw new TypeError('Дата: ГГГГ-ММ-ДД')}
 return out;
}
function addItem(collection,title,content,extra={}){
 if(!['notes','tasks'].includes(collection))throw new TypeError('Invalid item');
 const fields=itemFields(collection,{...extra,title,content:typeof content==='string'?content:''});
 const base=collection==='tasks'?{category:'personal',due:null,time:null,priority:'normal',done:false}:{category:'personal',pinned:false};
 const item={id:require('node:crypto').randomUUID(),...base,...fields,createdAt:new Date().toISOString()};
 if(collection==='tasks'&&item.time&&!item.due)item.due=localDate();
 storage.mutate(data=>{data[collection]??=[];data[collection].unshift(item)});
 if(collection==='notes')indexNote(item);
 return item;
}
function localDate(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function indexNote(item){storage.syncNode(item);ingestNoteFacts(item);syncWorker.run().catch(e=>console.error('LanceDB indexing failed:',e.message))}
// patch: допустимые поля itemFields; boolean вместо объекта — старый вызов «отметить выполненным».
function updateItem(collection,id,patch){
 if(typeof patch==='boolean'||patch===undefined)patch=typeof patch==='boolean'?{done:patch}:{};
 const fields=itemFields(collection,patch);
 const item=storage.mutate(data=>{const found=(data[collection]||[]).find(x=>x.id===id);if(!found)return null;Object.assign(found,fields);if(collection==='tasks'){if(fields.done===true)found.doneAt=new Date().toISOString();if(fields.done===false)delete found.doneAt}found.updatedAt=new Date().toISOString();return {...found}});
 if(item&&collection==='notes'&&('title' in fields||'content' in fields))indexNote(item);
 return item;
}
// Удаление доступно только из интерфейса (кнопка с подтверждением), не инструментам аватара.
function removeItem(collection,id){
 const removed=storage.mutate(data=>{const list=data[collection]||[],i=list.findIndex(x=>x.id===id);if(i<0)return null;return list.splice(i,1)[0]});
 if(removed&&collection==='notes'){storage.removeNode(id);vectorStore.removeNote(id).catch(e=>console.error('LanceDB delete failed:',e.message))}
 return removed;
}
// Настройки языковой модели аватара. Ключ API сохраняется только на диске и в ответах не возвращается.
async function handleLlm(req,res,p){
 try{
  if(req.method==='GET'&&p==='/api/llm')return respond(res,200,llm.view());
  if(req.method==='POST'&&p==='/api/llm')return respond(res,200,llm.save(await body(req)));
  if(req.method==='POST'&&p==='/api/llm/models')return respond(res,200,{models:await llm.listModels()});
  if(req.method==='POST'&&p==='/api/llm/test')return respond(res,200,await llm.test());
  return respond(res,404,{error:'Not found'});
 }catch(e){
  if(e instanceof SyntaxError)throw e;
  if(e.name==='TimeoutError'||e.name==='AbortError')return respond(res,504,{error:'Сервис модели не ответил вовремя'});
  if(e instanceof TypeError&&e.message!=='fetch failed')return respond(res,400,{error:e.message});
  if(e instanceof TypeError)return respond(res,502,{error:'Не удалось подключиться к сервису модели'});
  if(/^Chat API HTTP (\d+)/.test(e.message))return respond(res,502,{error:'Сервис модели ответил ошибкой: '+e.message.replace('Chat API ','')});
  throw e;
 }
}
// Размышления в простое: раз в минуту проверяется, давно ли было тихо и есть ли о чём подумать.
function idleReflect(){storage.load().then(ws=>{try{if(thoughts.on('initiative'))initiative.scan(ws)}catch(e){console.error('Initiative scan failed:',e.name)}return ws}).then(ws=>reflect.maybeRun({ws,complete:llm.config()?llm.complete:null})).then(r=>{if(r)console.log('Мозг поразмышлял:',r.text.slice(0,120))}).catch(e=>console.error('Idle reflection failed:',e.name))}
const chatContext={addItem,setTaskDone:(id,done)=>updateItem('tasks',id,{done}),updateTask:(id,patch)=>updateItem('tasks',id,patch)};
const server=http.createServer(async(req,res)=>{try{
const host=req.headers.host||'';if(host!=='127.0.0.1:'+String(server.address()?.port||PORT)&&host!=='localhost:'+String(server.address()?.port||PORT))return respond(res,403,{error:'Forbidden host'});
const url=new URL(req.url,'http://localhost');const p=url.pathname;
if(req.method==='OPTIONS')return respond(res,204,'');
if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.headers.origin;if(origin){let parsed;try{parsed=new URL(origin)}catch{return respond(res,403,{error:'Forbidden origin'})}if(parsed.protocol!=='http:'||!['127.0.0.1','localhost'].includes(parsed.hostname)||Number(parsed.port||80)!==Number(server.address()?.port||PORT))return respond(res,403,{error:'Forbidden origin'})}}
if(req.method==='GET'&&p==='/api/health'){try{ensureDisk()}catch{}return respond(res,diskHealthy?200:503,{ok:diskHealthy,version:'0.3.0',database:'connected',disk:diskHealthy?'ok':'unavailable'});}
if(!['GET','HEAD','OPTIONS'].includes(req.method)){ensureDisk();if(p!=='/api/brain/reflect')reflect.touch()}
if(p.startsWith('/api/library/')){
 try{
  if(req.method==='GET'&&p==='/api/library/list')return respond(res,200,{items:await library.list(url.searchParams.get('path')||'')});
  if(req.method==='GET'&&p==='/api/library/search')return respond(res,200,await library.search(url.searchParams.get('q')||''));
  if(req.method==='POST'&&p==='/api/library/folder'){const input=await body(req);await library.mkdir(input?.path);return respond(res,201,{ok:true})}
  if(req.method==='PUT'&&p==='/api/library/upload')return respond(res,201,await library.upload(url.searchParams.get('path')||'',req));
  if(req.method==='GET'&&p==='/api/library/download'){
   const rel=url.searchParams.get('path')||'',file=await library.filePath(rel);
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename=\"download\"; filename*=UTF-8''"+encodeURIComponent(rel.split('/').pop()),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
   return fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }
  return respond(res,404,{error:'Not found'});
 }catch(e){if(res.headersSent){res.destroy();return}const message=e.code==='EEXIST'?'Файл или папка с таким именем уже существует':e.code==='ENOENT'?'Файл или папка не найдены':e.message;return respond(res,e.code==='EEXIST'?409:e.code==='ENOENT'?404:e instanceof TypeError?400:500,{error:message})}
}
if(p.startsWith('/api/brain/'))return await handleBrain(req,res,p,url);
if(req.method==='GET'&&p==='/api/services')return respond(res,200,await services.status());
if(req.method==='POST'&&p==='/api/backup')return respond(res,200,await storage.backup());
if(req.method==='POST'&&p==='/api/sync')return respond(res,200,await syncWorker.run());
if(req.method==='GET'&&p==='/api/graph')return respond(res,200,storage.graph());
if(req.method==='GET'&&p==='/api/search'){const query=url.searchParams.get('q')||'';if(!query.trim())return respond(res,400,{error:'Missing query'});return respond(res,200,await vectorStore.search(query));}
if(p==='/api/facts'||p.startsWith('/api/facts/'))return await handleFacts(req,res,p,url);
// Гибридное вспоминание (слова + смысл + связи) — им «Мозг» подсвечивает найденное.
if(req.method==='GET'&&p==='/api/recall'){const query=url.searchParams.get('q')||'';if(!query.trim())return respond(res,400,{error:'Missing query'});const r=await require('./recall').recall(query.slice(0,300),{factLimit:30,noteLimit:20,diversify:false,topic:false});return respond(res,200,{facts:r.facts.map(f=>({id:f.id,score:f.score,why:f.why})),notes:r.notes.map(n=>({id:n.id,score:n.score,why:n.why}))})}
if(p==='/api/llm'||p.startsWith('/api/llm/'))return await handleLlm(req,res,p);
if(req.method==='POST'&&p==='/api/chat'){try{return respond(res,200,await chat.reply(await body(req),chatContext))}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
// Опыт аватара: как она понимала вопросы, что нашла и сделала; подтверждение или поправка ответа.
if(req.method==='GET'&&p==='/api/experience'){try{return respond(res,200,{items:experience.list(limitParam(url,50,500)),stats:experience.stats()})}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
if(req.method==='POST'&&p==='/api/experience/feedback'){try{const input=await body(req);const r=experience.feedback(input?.id,input?.kind,input?.correction);return r?respond(res,200,{id:r.id,feedback:r.feedback}):respond(res,404,{error:'Not found'})}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
// Весь чат на сервере и фоновое обучение из него: счётчики и переключатель «учиться фоном».
if(req.method==='GET'&&p==='/api/chatlog')return respond(res,200,{...chatlog.stats(),recent:chatlog.recent(limitParam(url,20,200))});
if(req.method==='POST'&&p==='/api/chatlog/auto'){const input=await body(req);if(typeof input?.on!=='boolean')return respond(res,400,{error:'Invalid value'});chatlog.setAutoLearn(input.on);if(input.on)setImmediate(()=>chatlog.learnPending().catch(console.error));return respond(res,200,chatlog.stats())}
// Самообучение: кандидаты в факты из текста заметки или чата (подтверждает пользователь в «Мозге»).
if(req.method==='POST'&&p==='/api/learn'){try{return respond(res,200,await learn.extract(await body(req)))}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
// Быстрый ввод планера: «созвон завтра в 10 #работа !» → поля дела (тот же разбор, что у аватара).
if(req.method==='POST'&&p==='/api/parse'){const input=await body(req);if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>500)return respond(res,400,{error:'Invalid text'});return respond(res,200,chat.parseTask(input.text))}
if(req.method==='GET'&&p==='/api/workspace')return respond(res,200,await storage.load());
if(p==='/api/items'&&['POST','PATCH','DELETE'].includes(req.method)){
const input=await body(req);
if(!input||typeof input!=='object'||Array.isArray(input)||!['notes','tasks'].includes(input.collection))return respond(res,400,{error:'Invalid collection'});
try{
 if(req.method==='POST'){const {collection,title,content,id:_id,createdAt:_c,...extra}=input;if(typeof title!=='string')return respond(res,400,{error:'Invalid item'});return respond(res,201,addItem(collection,title,content,extra))}
 if(typeof input.id!=='string')return respond(res,400,{error:'Invalid id'});
 if(req.method==='DELETE'){const removed=removeItem(input.collection,input.id);return removed?respond(res,200,{ok:true,id:input.id}):respond(res,404,{error:'Not found'})}
 const {collection,id,...patch}=input;const item=updateItem(collection,id,patch);if(!item)return respond(res,404,{error:'Not found'});return respond(res,200,item);
}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
if(req.method==='GET'&&allowed.has(p)){const name=allowed.get(p);return respond(res,200,fs.readFileSync(path.join(ROOT,name),'utf8'),TYPES[path.extname(name)])}
if(req.method==='GET'&&AVATAR_PATH.test(p)){const file=path.join(ROOT,p.slice(1));if(!fs.existsSync(file))return respond(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'});return res.end(fs.readFileSync(file))}
return respond(res,404,{error:'Not found'})
}catch(e){console.error('Request failed:',e.name,e.code||'',e instanceof SyntaxError?'invalid JSON':'request processing error');respond(res,e.message==='Request too large'?413:e instanceof SyntaxError?400:500,{error:e.message==='Request too large'?'Request too large':e instanceof SyntaxError?'Invalid JSON':'Internal server error'})}});
server.on('error',e=>{console.error('Server error:',e.code||e.name);process.exitCode=1});
if(require.main===module)Promise.resolve().then(()=>ensureDisk()).then(()=>storage.connect()).then(()=>server.listen(PORT,HOST,()=>{console.log('Tenmayurika: http://'+HOST+':'+PORT);syncWorker.run().catch(console.error);const timer=setInterval(()=>{syncWorker.run().catch(console.error);chatlog.learnPending().catch(console.error);idleReflect()},60000);timer.unref();chatlog.learnPending().catch(console.error);startBackupSchedule();const maintenanceTimer=setInterval(()=>{try{ensureDisk();maintenance.maintenance()}catch(e){console.error('Disk maintenance failed:',e.code||e.name)}},3600000);maintenanceTimer.unref()})).catch(e=>{console.error('Database connection failed:',e.message);process.exitCode=1});
module.exports={server};

