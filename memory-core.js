'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const DB=process.env.TENMAYURIKA_MEMORY_DB ? path.resolve(process.env.TENMAYURIKA_MEMORY_DB) : path.join(__dirname,'data','tenmayurika.sqlite');
function open(){
 fs.mkdirSync(path.dirname(DB),{recursive:true});
 const db=new DatabaseSync(DB);
 // Встроенный lower() SQLite меняет регистр только у ASCII, поэтому для кириллицы нужен свой.
 db.function('unicode_lower',{deterministic:true},value=>typeof value==='string'?value.toLocaleLowerCase():value);
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS memory_facts(
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
 source_id TEXT NOT NULL, observed_at TEXT NOT NULL, valid_from TEXT NOT NULL,
 valid_to TEXT, confidence REAL NOT NULL DEFAULT 1 CHECK(confidence>=0 AND confidence<=1),
 fingerprint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE INDEX IF NOT EXISTS memory_facts_subject ON memory_facts(subject,predicate,valid_to);
 CREATE INDEX IF NOT EXISTS memory_facts_source ON memory_facts(source_id);
 CREATE TABLE IF NOT EXISTS memory_conflicts(
 id TEXT PRIMARY KEY, earlier_id TEXT NOT NULL, newer_id TEXT NOT NULL,
 detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(earlier_id,newer_id)
 );
 CREATE INDEX IF NOT EXISTS memory_facts_observed ON memory_facts(observed_at); 
 CREATE TABLE IF NOT EXISTS memory_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT, fact_id TEXT NOT NULL, action TEXT NOT NULL,
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );`);
 return db;
}
function normalize(value,name,max=2000){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new TypeError('Invalid '+name);
 return value.trim();
}
function addFact(input){
 const subject=normalize(input.subject,'subject',300),predicate=normalize(input.predicate,'predicate',150);
 const object=normalize(input.object,'object'),source=normalize(input.sourceId,'sourceId',300);
 const confidence=input.confidence===undefined?1:input.confidence;
 if(typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1)throw new TypeError('Invalid confidence');
 const now=new Date().toISOString();
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([subject,predicate,object,source])).digest('hex');
 const db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const old=db.prepare('SELECT id,valid_to FROM memory_facts WHERE fingerprint=?').get(fingerprint);
   // Отставленный факт возвращается только при явном добавлении (restore). Повторный разбор заметки
   // (restore:false) не отменяет решение, принятое при разборе противоречия.
   if(old&&(!old.valid_to||input.restore===false)){db.exec('COMMIT');return {id:old.id,duplicate:true,...(old.valid_to?{retired:true}:{}),conflicts:0}}
   // Факт был отставлен при разборе противоречия, а теперь добавлен снова — возвращаем его в память.
   const id=old?old.id:crypto.randomUUID();
   if(old)db.prepare('UPDATE memory_facts SET valid_to=NULL,observed_at=?,valid_from=?,confidence=? WHERE id=?').run(now,now,confidence,id);
   else db.prepare('INSERT INTO memory_facts(id,subject,predicate,object,source_id,observed_at,valid_from,confidence,fingerprint) VALUES(?,?,?,?,?,?,?,?,?)').run(id,subject,predicate,object,source,now,now,confidence,fingerprint);
   const prior=db.prepare('SELECT id FROM memory_facts WHERE subject=? AND predicate=? AND object<>? AND valid_to IS NULL AND id<>?').all(subject,predicate,object,id);
   for(const row of prior){
    db.prepare('INSERT OR IGNORE INTO memory_conflicts(id,earlier_id,newer_id) VALUES(?,?,?)').run(crypto.randomUUID(),row.id,id);
   }
   db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(id,old?'restored':'created');
   db.exec('COMMIT');return {id,duplicate:false,...(old?{restored:true}:{}),conflicts:prior.length};
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
function extractFacts(text,sourceId){
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>1048576)throw new TypeError('Invalid text');
 const source=normalize(sourceId,'sourceId',300);
 const results=[];
 for(const line of text.split(/\r?\n/)){
  // Поддерживаются «FACT: субъект | связь | объект» и «FACT: | субъект | связь | объект».
  const trimmed=line.trim();if(!trimmed.startsWith('FACT:'))continue;
  const parts=trimmed.slice(5).split('|');if(parts.length===4&&!parts[0].trim())parts.shift();
  if(parts.length!==3)continue;
  const [subject,predicate,object]=parts.map(x=>x.trim());
  if(!subject||!predicate||!object)continue;
  results.push(addFact({subject,predicate,object,sourceId:source,restore:false}));
  if(results.length>=100)break;
 }
 return results;
}
function searchFacts(query,limit=30){
 const term=normalize(query,'query',300).toLocaleLowerCase();
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Invalid limit');
 const db=open();
 try{
  // Search the complete table rather than only the newest 500 facts.
  const escaped=term.replace(/[\\%_]/g,'\\$&');
  const pattern='%'+escaped+'%';
  return db.prepare(`SELECT *, 
   (CASE WHEN instr(unicode_lower(subject),?)>0 THEN 1 ELSE 0 END +
    CASE WHEN instr(unicode_lower(predicate),?)>0 THEN 1 ELSE 0 END +
    CASE WHEN instr(unicode_lower(object),?)>0 THEN 1 ELSE 0 END) AS score
   FROM memory_facts
   WHERE valid_to IS NULL AND (unicode_lower(subject) LIKE ? ESCAPE '\\' OR unicode_lower(predicate) LIKE ? ESCAPE '\\' OR unicode_lower(object) LIKE ? ESCAPE '\\')
   ORDER BY score DESC,observed_at DESC LIMIT ?`).all(term,term,term,pattern,pattern,pattern,limit);
 }finally{db.close()}
}
function queryFacts({subject,limit=50}={}){
 if(!Number.isInteger(limit)||limit<1||limit>5000)throw new TypeError('Invalid limit');
 const db=open();
 try{
  if(subject)return db.prepare('SELECT * FROM memory_facts WHERE subject=? ORDER BY observed_at DESC LIMIT ?').all(normalize(subject,'subject',300),limit);
  return db.prepare('SELECT * FROM memory_facts ORDER BY observed_at DESC LIMIT ?').all(limit);
 }finally{db.close()}
}
function relations(subject,limit=100){
 const key=normalize(subject,'subject',300);
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid limit');
 const db=open();
 try{return db.prepare('SELECT id,subject,predicate,object,source_id,confidence,observed_at FROM memory_facts WHERE valid_to IS NULL AND (subject=? OR object=?) ORDER BY observed_at DESC LIMIT ?').all(key,key,limit)}finally{db.close()}
}
function conflicts(limit=100){
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid limit');
 const db=open();
 try{return db.prepare('SELECT c.id,c.detected_at,a.subject,a.predicate,a.object AS earlier,b.object AS newer,a.source_id AS earlier_source,b.source_id AS newer_source,a.id AS earlier_id,b.id AS newer_id,a.observed_at AS earlier_at,b.observed_at AS newer_at FROM memory_conflicts c JOIN memory_facts a ON a.id=c.earlier_id JOIN memory_facts b ON b.id=c.newer_id ORDER BY c.detected_at DESC LIMIT ?').all(limit)}finally{db.close()}
}
// Разбор противоречия: keep = 'earlier' | 'newer' | 'both'. Отвергнутый факт не удаляется,
// а получает valid_to (остаётся в истории), противоречие снимается.
function resolveConflict(id,keep){
 const cid=normalize(id,'id',100);
 if(!['earlier','newer','both'].includes(keep))throw new TypeError('Invalid keep');
 const db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const c=db.prepare('SELECT earlier_id,newer_id FROM memory_conflicts WHERE id=?').get(cid);
   if(!c){db.exec('COMMIT');return null}
   const now=new Date().toISOString(),retired=keep==='earlier'?c.newer_id:keep==='newer'?c.earlier_id:null;
   if(retired){
    db.prepare('UPDATE memory_facts SET valid_to=? WHERE id=? AND valid_to IS NULL').run(now,retired);
    db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(retired,'retired');
    // Отвергнутый факт больше ни с чем не спорит.
    db.prepare('DELETE FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').run(retired,retired);
   }
   db.prepare('DELETE FROM memory_conflicts WHERE id=?').run(cid);
   db.exec('COMMIT');return {id:cid,keep,retired};
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
function diagnostics(){
 const db=open();
 try{
  return {integrity:db.prepare('PRAGMA quick_check').get().quick_check,
   facts:db.prepare('SELECT COUNT(*) AS n FROM memory_facts').get().n,
   conflicts:db.prepare('SELECT COUNT(*) AS n FROM memory_conflicts').get().n,
   events:db.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,
   pendingVectors:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_queue'").get()?db.prepare('SELECT COUNT(*) AS n FROM vector_queue').get().n:0};
 }finally{db.close()}
}
module.exports={addFact,extractFacts,queryFacts,searchFacts,relations,conflicts,resolveConflict,diagnostics};
if(require.main===module){
 try{
  const command=process.argv[2];
  if(command==='diagnostics')console.log(JSON.stringify(diagnostics(),null,2));
  else if(command==='facts')console.log(JSON.stringify(queryFacts({subject:process.argv[3]}),null,2));
  else if(command==='search')console.log(JSON.stringify(searchFacts(process.argv.slice(3).join(' ')),null,2));
  else if(command==='relations')console.log(JSON.stringify(relations(process.argv.slice(3).join(' ')),null,2));
  else if(command==='conflicts')console.log(JSON.stringify(conflicts(),null,2));
  else if(command==='ingest'){const [source,filename]=process.argv.slice(3);if(!source||!filename)throw Error('Usage: ingest source file');console.log(JSON.stringify(extractFacts(fs.readFileSync(filename,'utf8'),source),null,2))}
  else throw Error('Usage: node memory-core.js diagnostics|facts [subject]');
 }catch(e){console.error(e.message);process.exitCode=1}
}
