'use strict';
// Весь чат с аватаром хранится на сервере (а не только в браузере) и разбирается фоном:
// из каждого сообщения пользователя извлекаются факты и сразу попадают в память
// (с пониженной уверенностью и источником chat:<номер>), если «учиться фоном» включено.
// Прошлые разговоры также служат памятью: аватар находит в них сказанное раньше.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const memory=require('./memory-core');
const learn=require('./learn');
const memskills=require('./memskills');
const evidence=require('./evidence');
const plans=require('./plans');
const thoughts=require('./thoughts');
const DB=process.env.TENMAYURIKA_MEMORY_DB?path.resolve(process.env.TENMAYURIKA_MEMORY_DB):path.join(__dirname,'data','tenmayurika.sqlite');
const MAX_TEXT=8000,BATCH=5;
const STOP=new Set('что как где когда кто чем чего это эти мне меня мой моя мои твой ты вы для про при над под без или если уже ещё еще так там тут вот надо нужно можно есть очень просто скажи расскажи покажи какой какая какие'.split(' '));

function open(){
 fs.mkdirSync(path.dirname(DB),{recursive:true});
 const db=new DatabaseSync(DB);
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS chat_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
 learned INTEGER NOT NULL DEFAULT 0, facts INTEGER NOT NULL DEFAULT 0
 );
 CREATE INDEX IF NOT EXISTS chat_log_learned ON chat_log(role,learned);
 CREATE TABLE IF NOT EXISTS brain_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
 return db;
}
// learned: 0 — ждёт разбора, 1 — разобрано, 2 — нечего разбирать (ответ аватара, команда, короткое сообщение).
function save(role,text,skip=false){
 const t=String(text||'');if(!t.trim()||!['user','assistant'].includes(role))return null;
 const db=open();
 try{
  // Короткий ответ на вопрос Юрики («Аня» на «как зовут сестру?») — тоже есть что запомнить.
  let learnable=role==='user'&&!skip&&t.trim().length>=8;
  if(role==='user'&&!skip&&!learnable&&t.trim().length>=2){const prev=db.prepare('SELECT role,text FROM chat_log ORDER BY id DESC LIMIT 1').get();learnable=!!(prev&&prev.role==='assistant'&&/\?/.test(prev.text))}
  return Number(db.prepare('INSERT INTO chat_log(at,role,text,learned) VALUES(?,?,?,?)').run(new Date().toISOString(),role,t.slice(0,MAX_TEXT),learnable?0:2).lastInsertRowid);
 }finally{db.close()}
}
function autoLearn(){const db=open();try{const r=db.prepare("SELECT value FROM brain_settings WHERE key='autolearn'").get();return r?r.value==='1':true}finally{db.close()}}
function setAutoLearn(on){const db=open();try{db.prepare("INSERT INTO brain_settings(key,value) VALUES('autolearn',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on?'1':'0');return !!on}finally{db.close()}}
function stats(){
 const db=open();
 try{const r=db.prepare("SELECT COUNT(*) AS messages,SUM(role='user') AS user,SUM(learned=0) AS pending,COALESCE(SUM(facts),0) AS facts FROM chat_log").get();return {messages:r.messages,user:r.user||0,pending:r.pending||0,facts:r.facts,auto:autoLearn()}}finally{db.close()}
}
// Поиск в прошлых разговорах по основам слов (первые 5 букв), лучшие совпадения сверху.
function search(text,limit=3,exceptId=0){
 const terms=[...new Set(String(text||'').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!STOP.has(w)).map(w=>w.slice(0,5)))].slice(0,8);
 if(!terms.length)return [];
 const db=open();
 try{
  const like=terms.map(()=>'unicode_lower(text) LIKE ?').join(' OR ');
  db.function('unicode_lower',{deterministic:true},v=>typeof v==='string'?v.toLocaleLowerCase():v);
  const rows=db.prepare("SELECT id,at,text FROM chat_log WHERE role='user' AND id<>? AND ("+like+") ORDER BY id DESC LIMIT 300").all(exceptId,...terms.map(t=>'%'+t+'%'));
  const need=Math.min(2,terms.length);
  return rows.map(r=>{const hay=r.text.toLocaleLowerCase();return {...r,score:terms.filter(t=>hay.includes(t)).length}}).filter(r=>r.score>=need).sort((a,b)=>b.score-a.score||b.id-a.id).slice(0,limit);
 }finally{db.close()}
}
// Разговоры за промежуток времени (вспоминание по датам). С запросом — только сообщения с его словами
// и по соседнему сообщению вокруг каждого (вопрос и ответ вместе).
function stemsOf(text){return [...new Set(String(text||'').toLocaleLowerCase().replace(/ё/g,'е').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!STOP.has(w)).map(w=>w.slice(0,5)))].slice(0,8)}
function between(from,to,{query='',limit=16,exceptId=0}={}){
 const a=new Date(from).toISOString(),b=new Date(to).toISOString(),terms=stemsOf(query).filter(t=>!/^(говор|обсуж|болта|разго|расск|спрос|писал|мы$|тобой)/.test(t));
 const db=open();
 try{
  const range='at>=? AND at<? AND id<>?',args=[a,b,exceptId];
  const total=db.prepare('SELECT COUNT(*) AS n FROM chat_log WHERE '+range).get(...args).n;
  // Самые свежие сообщения периода, по порядку времени.
  if(!terms.length)return {total,messages:db.prepare('SELECT id,at,role,text FROM chat_log WHERE '+range+' ORDER BY id DESC LIMIT ?').all(...args,limit).reverse()};
  db.function('norm_text',{deterministic:true},v=>typeof v==='string'?v.toLocaleLowerCase().replace(/ё/g,'е'):v);
  const like=' AND ('+terms.map(()=>'norm_text(text) LIKE ?').join(' OR ')+')',likeArgs=terms.map(t=>'%'+t+'%');
  const matched=db.prepare('SELECT COUNT(*) AS n FROM chat_log WHERE '+range+like).get(...args,...likeArgs).n;
  const hits=db.prepare('SELECT id,at,role,text FROM chat_log WHERE '+range+like+' ORDER BY id DESC LIMIT ?').all(...args,...likeArgs,limit);
  // К найденному — пара: вопрос человека и ответ на него.
  const next=db.prepare("SELECT id,at,role,text FROM chat_log WHERE id>? AND "+range+" ORDER BY id LIMIT 1"),prev=db.prepare("SELECT id,at,role,text FROM chat_log WHERE id<? AND "+range+" ORDER BY id DESC LIMIT 1");
  const out=new Map();
  for(const h of hits){out.set(h.id,h);const n=h.role==='user'?next.get(h.id,...args):prev.get(h.id,...args);if(n&&n.role!==h.role)out.set(n.id,n)}
  return {total,matched,messages:[...out.values()].sort((x,y)=>x.id-y.id).slice(-limit)};
 }finally{db.close()}
}
// Соседи найденного сообщения: n до и n после.
function around(id,n=2){const db=open();try{return db.prepare('SELECT id,at,role,text FROM chat_log WHERE id BETWEEN ? AND ? ORDER BY id').all(Number(id)-n,Number(id)+n)}finally{db.close()}}
function recent(limit=50){const db=open();try{return db.prepare('SELECT id,at,role,text,learned,facts FROM chat_log ORDER BY id DESC LIMIT ?').all(limit)}finally{db.close()}}

// Итог разбора — в память: новые факты, новые версии известных (старая уходит в историю) и явно отменённое.
// Записанное помечается навыками, которые его записали (польза факта — польза навыка).
function apply(r,sourceId){
 const conf=r.source==='model'?.8:.6,born=[];let n=0;
 for(const f of r.facts){const res=memory.addFact({subject:f.subject,predicate:f.predicate,object:f.object,sourceId,confidence:conf,restore:false});if(!res.duplicate){n++;born.push(res.id)}}
 for(const u of r.updates||[]){try{const res=memory.addFact({...u.fact,sourceId,confidence:conf,restore:false});if(!res.duplicate){n++;born.push(res.id);if(res.id!==u.id)memory.retireFact(u.id,'updated')}}catch(e){if(!(e instanceof TypeError))throw e}}
 for(const f of r.retire||[])if(memory.retireFact(f.id,'outdated'))n++;
 if(born.length&&r.skills?.length)memskills.attribute(born,r.skills);
 // Уже известное, сказанное снова, — подтверждение (уверенность растёт), а не дубль.
 for(const id of r.confirmed||[]){try{evidence.confirm(id,sourceId)}catch(e){console.error('Evidence failed:',e.name)}}
 r.born=born;
 return n;
}
// Перезапоминание: старые сообщения, где встречаются подсказки нового или уточнённого навыка, разбираются заново.
// Повторы не плодятся (addFact узнаёт тот же факт из того же сообщения).
function relearn(cues,limit=30){
 const cs=(cues||[]).map(c=>String(c).toLocaleLowerCase().replace(/ё/g,'е')).filter(c=>c.length>=3);if(!cs.length)return 0;
 const db=open();
 try{
  const rows=db.prepare("SELECT id,text FROM chat_log WHERE role='user' AND learned=1 ORDER BY id DESC LIMIT 500").all();
  const pick=rows.filter(r=>{const t=r.text.toLocaleLowerCase().replace(/ё/g,'е');return cs.some(c=>t.includes(c))}).slice(0,limit);
  const st=db.prepare('UPDATE chat_log SET learned=0 WHERE id=?');for(const r of pick)st.run(r.id);
  return pick.length;
 }finally{db.close()}
}
function message(id){const db=open();try{return db.prepare('SELECT id,at,role,text,learned,facts FROM chat_log WHERE id=?').get(id)||null}finally{db.close()}}
// До трёх реплик перед сообщением, не старше получаса: для разбора «Аня» в ответ на «как зовут сестру?».
function before(id,n=3){
 const db=open();
 try{
  const row=db.prepare('SELECT at FROM chat_log WHERE id=?').get(id);if(!row)return [];
  const from=new Date(Date.parse(row.at)-30*60*1000).toISOString();
  return db.prepare('SELECT role,text FROM chat_log WHERE id<? AND at>=? ORDER BY id DESC LIMIT ?').all(id,from,n).reverse().map(r=>({role:r.role,text:r.text.slice(0,600)}));
 }finally{db.close()}
}
// Фоновый разбор: по несколько сообщений за проход, по одному запросу к модели на сообщение.
let busy=false;
async function learnPending(limit=BATCH){
 if(busy||!autoLearn())return {processed:0,facts:0};
 busy=true;let processed=0,added=0;
 try{
  const db=open();let rows;
  try{rows=db.prepare("SELECT id,at,text FROM chat_log WHERE role='user' AND learned=0 ORDER BY id LIMIT ?").all(limit)}finally{db.close()}
  const inputs=rows.map(row=>({text:row.text,source:'chat:'+row.id,domain:'chat',context:before(row.id)}));const results=await learn.extractBatch(inputs);
  for(let i=0;i<rows.length;i++){const row=rows[i];
   let n=0;
   try{
    // Соседние реплики: на что человек отвечал и о ком шла речь (в пределах получаса).
    const r=results[i];
    n=apply(r,'chat:'+row.id);
    // Срок в будущем («в следующем месяце переезжаю») — факт становится планом, потом Юрика спросит, сбылось ли.
    if(r.born?.length){try{const made=plans.capture(row.text,memory.factsById(r.born),row.at);if(made.length)thoughts.add('future','Запомнила план: '+made.map(p=>'«'+p.fact.subject+' — '+p.fact.predicate+' '+p.fact.object+'» '+p.phrase).join('; '))}catch(e){console.error('Plan capture failed:',e.name)}}
   }catch(e){console.error('Chat learning failed:',e.name)}
   const w=open();try{w.prepare('UPDATE chat_log SET learned=1,facts=facts+? WHERE id=?').run(n,row.id)}finally{w.close()}
   processed++;added+=n;
  }
  return {processed,facts:added};
 }finally{busy=false}
}
let learningTimer=null;
function schedule(){if(learningTimer)return;learningTimer=setTimeout(()=>{learningTimer=null;learnPending().then(()=>require('./factvec').index()).catch(e=>console.error('Chat learning failed:',e.name))},15000);learningTimer.unref?.()}
module.exports={schedule,before,save,search,between,around,stats,recent,message,autoLearn,setAutoLearn,learnPending,relearn,apply};
