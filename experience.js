'use strict';
// Опыт аватара: журнал её собственного понимания и действий.
// На каждый вопрос записывается «эпизод»: как она поняла вопрос (ключевые слова или команда),
// какие факты и заметки вспомнила, какие инструменты вызвала, что ответила и чем всё кончилось.
// Пользователь может подтвердить ответ или поправить его («нет, я имела в виду …», кнопки 👍/👎).
// На похожий вопрос потом поднимаются прошлые эпизоды: найденное тогда вспоминается снова,
// а поправки пользователя идут модели как опыт, чтобы понимание накапливалось.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const DB=process.env.TENMAYURIKA_MEMORY_DB?path.resolve(process.env.TENMAYURIKA_MEMORY_DB):path.join(__dirname,'data','tenmayurika.sqlite');
const KEEP=5000,FEEDBACK_WINDOW_MS=30*60*1000;
// Служебные слова не говорят о смысле вопроса.
const STOP=new Set('что как где когда кто чем чего это эти эта этот мне меня мой моя мои твой твоя тебя тебе ты вы вас нас для про при над под без или если уже ещё еще так там тут вот надо нужно можно есть был была были будет очень просто пожалуйста скажи расскажи покажи какой какая какие который'.split(' '));

function open(){
 fs.mkdirSync(path.dirname(DB),{recursive:true});
 const db=new DatabaseSync(DB);
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS memory_experience(
 id TEXT PRIMARY KEY, at TEXT NOT NULL, question TEXT NOT NULL, stems TEXT NOT NULL,
 understood TEXT NOT NULL DEFAULT '', recalled TEXT NOT NULL DEFAULT '{}', tools TEXT NOT NULL DEFAULT '[]',
 answer TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 1,
 feedback TEXT, correction TEXT
 );
 CREATE INDEX IF NOT EXISTS memory_experience_at ON memory_experience(at);`);
 return db;
}
// Грубая основа слова (первые 5 букв): «Анны», «Анне», «Анна» совпадут без морфологии.
function stems(text){
 return [...new Set(String(text||'').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3&&!STOP.has(w)).map(w=>w.slice(0,5)))].slice(0,12);
}
const parse=(s,d)=>{try{return JSON.parse(s)}catch{return d}};
function row(r){return {id:r.id,at:r.at,question:r.question,understood:r.understood,recalled:parse(r.recalled,{facts:[],notes:[]}),tools:parse(r.tools,[]),answer:r.answer,source:r.source,ok:!!r.ok,feedback:r.feedback||null,correction:r.correction||null}}

function record(e){
 const question=String(e.question||'').trim().slice(0,2000);if(!question)return null;
 const id=crypto.randomUUID(),db=open();
 try{
  const recalled={facts:(e.recalled?.facts||[]).slice(0,20),notes:(e.recalled?.notes||[]).slice(0,20)};
  db.prepare('INSERT INTO memory_experience(id,at,question,stems,understood,recalled,tools,answer,source,ok) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(id,new Date().toISOString(),question,stems(question).join(' '),String(e.understood||'').slice(0,300),JSON.stringify(recalled),JSON.stringify([...new Set(e.tools||[])].slice(0,12)),String(e.answer||'').slice(0,400),String(e.source||''),e.ok===false?0:1);
  db.prepare('DELETE FROM memory_experience WHERE id IN (SELECT id FROM memory_experience ORDER BY at DESC LIMIT -1 OFFSET ?)').run(KEEP);
  return id;
 }finally{db.close()}
}
// Похожие прошлые вопросы: доля общих основ слов. Поправки пользователя важнее, затем свежесть.
function similar(question,limit=3){
 const mine=stems(question);if(!mine.length)return [];
 const db=open();
 try{
  const rows=db.prepare('SELECT * FROM memory_experience ORDER BY at DESC LIMIT 800').all();
  return rows.map(r=>{const theirs=r.stems?r.stems.split(' '):[];const common=mine.filter(s=>theirs.includes(s)).length;return {r,common,size:theirs.length,score:common/Math.max(1,Math.min(mine.length,theirs.length))}})
   // Одного общего слова хватает, только если один из вопросов из одного слова.
   .filter(x=>x.common>=1&&x.score>=.5&&(x.common>=2||mine.length===1||x.size===1))
   .sort((a,b)=>b.score-a.score||(b.r.feedback==='fix')-(a.r.feedback==='fix')||String(b.r.at).localeCompare(String(a.r.at)))
   .slice(0,limit).map(x=>row(x.r));
 }finally{db.close()}
}
function feedback(id,kind,correction){
 if(typeof id!=='string'||!id||id.length>100)throw new TypeError('Invalid id');
 if(!['ok','fix'].includes(kind))throw new TypeError('Invalid feedback');
 const db=open();
 try{
  const text=typeof correction==='string'&&correction.trim()?correction.trim().slice(0,1000):null;
  const r=db.prepare('UPDATE memory_experience SET feedback=?,correction=COALESCE(?,correction) WHERE id=?').run(kind,kind==='fix'?text:null,id);
  return r.changes?{id,feedback:kind}:null;
 }finally{db.close()}
}
// Поправка или подтверждение словами в следующем сообщении относится к последнему ответу (не старше 30 минут).
const FIX=/^(?:нет|не так|не то|не совсем|неправильно|неверно|ошиблась|ошибка|я (?:имела?|хотела?) в виду|имелось в виду|я про|я о другом)(?=[\s,.!:;—–-]|$)/i;
const OK=/^(?:да|верно|правильно|точно|именно|спасибо|благодарю|отлично|супер|то что нужно)(?=[\s,.!)]|$)/i;
function detect(message){const t=String(message||'').trim();if(FIX.test(t))return 'fix';if(OK.test(t)&&t.length<=60)return 'ok';return null}
function last(){
 const db=open();
 try{const r=db.prepare('SELECT * FROM memory_experience ORDER BY at DESC LIMIT 1').get();if(!r||Date.now()-Date.parse(r.at)>FEEDBACK_WINDOW_MS)return null;return row(r)}finally{db.close()}
}
function list(limit=50){
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid limit');
 const db=open();
 try{return db.prepare('SELECT * FROM memory_experience ORDER BY at DESC LIMIT ?').all(limit).map(row)}finally{db.close()}
}
function stats(){
 const db=open();
 try{return db.prepare("SELECT COUNT(*) AS total,SUM(feedback='ok') AS confirmed,SUM(feedback='fix') AS corrected FROM memory_experience").get()}finally{db.close()}
}
// Строка опыта для модели: как поняла, что нашла, что сделала, что сказал пользователь.
function describe(e){
 const found=[e.recalled.facts.length?e.recalled.facts.length+' факт.':'',e.recalled.notes.length?e.recalled.notes.length+' замет.':''].filter(Boolean).join(', ');
 return '• «'+e.question.slice(0,120)+'»'+(e.understood?' → поняла как: '+e.understood:'')+(found?'; нашла: '+found:'; ничего не нашла')+(e.tools.length?'; сделала: '+e.tools.join(', '):'')+(e.ok?'':'; ответить не вышло')
  +(e.feedback==='fix'?'; пользователь ПОПРАВИЛ'+(e.correction?': «'+e.correction.slice(0,200)+'»':''):e.feedback==='ok'?'; пользователь подтвердил':'');
}
module.exports={record,similar,feedback,detect,last,list,stats,describe,stems};
