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
 try{return Number(db.prepare('INSERT INTO chat_log(at,role,text,learned) VALUES(?,?,?,?)').run(new Date().toISOString(),role,t.slice(0,MAX_TEXT),role==='user'&&!skip&&t.trim().length>=8?0:2).lastInsertRowid)}finally{db.close()}
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
function recent(limit=50){const db=open();try{return db.prepare('SELECT id,at,role,text,learned,facts FROM chat_log ORDER BY id DESC LIMIT ?').all(limit)}finally{db.close()}}

// Фоновый разбор: по несколько сообщений за проход, по одному запросу к модели на сообщение.
let busy=false;
async function learnPending(limit=BATCH){
 if(busy||!autoLearn())return {processed:0,facts:0};
 busy=true;let processed=0,added=0;
 try{
  const db=open();let rows;
  try{rows=db.prepare("SELECT id,text FROM chat_log WHERE role='user' AND learned=0 ORDER BY id LIMIT ?").all(limit)}finally{db.close()}
  for(const row of rows){
   let n=0;
   try{
    const r=await learn.extract({text:row.text});
    for(const f of r.facts){const res=memory.addFact({subject:f.subject,predicate:f.predicate,object:f.object,sourceId:'chat:'+row.id,confidence:r.source==='model'?.8:.6,restore:false});if(!res.duplicate)n++}
   }catch(e){console.error('Chat learning failed:',e.name)}
   const w=open();try{w.prepare('UPDATE chat_log SET learned=1,facts=? WHERE id=?').run(n,row.id)}finally{w.close()}
   processed++;added+=n;
  }
  return {processed,facts:added};
 }finally{busy=false}
}
module.exports={save,search,stats,recent,autoLearn,setAutoLearn,learnPending};
