'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const DB=path.join(__dirname,'data','tenmayurika.sqlite');
function open(){
 fs.mkdirSync(path.dirname(DB),{recursive:true});
 const db=new DatabaseSync(DB);
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
   const old=db.prepare('SELECT id FROM memory_facts WHERE fingerprint=?').get(fingerprint);
   if(old){db.exec('COMMIT');return {id:old.id,duplicate:true,conflicts:0}}
   const id=crypto.randomUUID();
   db.prepare('INSERT INTO memory_facts(id,subject,predicate,object,source_id,observed_at,valid_from,confidence,fingerprint) VALUES(?,?,?,?,?,?,?,?,?)').run(id,subject,predicate,object,source,now,now,confidence,fingerprint);
   const prior=db.prepare('SELECT id FROM memory_facts WHERE subject=? AND predicate=? AND object<>? AND valid_to IS NULL').all(subject,predicate,object);
   for(const row of prior){
    db.prepare('INSERT OR IGNORE INTO memory_conflicts(id,earlier_id,newer_id) VALUES(?,?,?)').run(crypto.randomUUID(),row.id,id);
   }
   db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(id,'created');
   db.exec('COMMIT');return {id,duplicate:false,conflicts:prior.length};
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
function searchFacts(query,limit=30){
 const term=normalize(query,'query',300).toLocaleLowerCase();
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Invalid limit');
 return queryFacts({limit:500}).map(f=>({...f,score:[f.subject,f.predicate,f.object].filter(x=>x.toLocaleLowerCase().includes(term)).length})).filter(f=>f.score>0).sort((a,b)=>b.score-a.score||b.observed_at.localeCompare(a.observed_at)).slice(0,limit);
}
function queryFacts({subject,limit=50}={}){
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid limit');
 const db=open();
 try{
  if(subject)return db.prepare('SELECT * FROM memory_facts WHERE subject=? ORDER BY observed_at DESC LIMIT ?').all(normalize(subject,'subject',300),limit);
  return db.prepare('SELECT * FROM memory_facts ORDER BY observed_at DESC LIMIT ?').all(limit);
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
module.exports={addFact,queryFacts,searchFacts,diagnostics};
if(require.main===module){
 try{
  const command=process.argv[2];
  if(command==='diagnostics')console.log(JSON.stringify(diagnostics(),null,2));
  else if(command==='facts')console.log(JSON.stringify(queryFacts({subject:process.argv[3]}),null,2));
  else if(command==='search')console.log(JSON.stringify(searchFacts(process.argv.slice(3).join(' ')),null,2));
  else throw Error('Usage: node memory-core.js diagnostics|facts [subject]');
 }catch(e){console.error(e.message);process.exitCode=1}
}
