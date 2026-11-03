'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
// TENMAYURIKA_DATA_DIR позволяет тестам работать с изолированной копией базы.
const dir=process.env.TENMAYURIKA_DATA_DIR?path.resolve(process.env.TENMAYURIKA_DATA_DIR):path.join(__dirname,'data'),file=path.join(dir,'tenmayurika.sqlite');
let db;
let backupInProgress=null;
function empty(){return {notes:[],tasks:[]}}
function connect(){
 if(db)return;
 fs.mkdirSync(dir,{recursive:true});db=new DatabaseSync(file);
 db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS knowledge_nodes(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS vector_queue(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_retry_at INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS knowledge_edges(source TEXT NOT NULL,target TEXT NOT NULL,relation TEXT NOT NULL,PRIMARY KEY(source,target,relation));");
 const columns=db.prepare('PRAGMA table_info(vector_queue)').all();if(!columns.some(c=>c.name==='next_retry_at'))db.exec('ALTER TABLE vector_queue ADD COLUMN next_retry_at INTEGER NOT NULL DEFAULT 0');
 // version растёт при каждой правке заметки: старое завершение индексации не снимет новую задачу.
 if(!columns.some(c=>c.name==='version'))db.exec('ALTER TABLE vector_queue ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
 const prior=db.prepare('SELECT payload FROM workspace WHERE id=1').get();
 if(!prior){let data=empty();const old=path.join(dir,'workspace.json');if(fs.existsSync(old))data=JSON.parse(fs.readFileSync(old,'utf8'));db.prepare('INSERT INTO workspace(id,payload) VALUES(1,?)').run(JSON.stringify(data));}
 const snapshot=JSON.parse(db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload);
 for(const note of snapshot.notes||[]){if(!note.id||!note.title)continue;const known=db.prepare('SELECT id FROM knowledge_nodes WHERE id=?').get(note.id);if(!known){db.prepare('INSERT INTO knowledge_nodes(id,title,content) VALUES(?,?,?)').run(note.id,note.title,note.content||'');db.prepare('INSERT OR IGNORE INTO vector_queue(id) VALUES(?)').run(note.id)}}
}
function ensure(){if(!db)connect()}
async function load(){ensure();return JSON.parse(db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload)}
async function save(data){ensure();db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(data))}
function mutate(change){ensure();db.exec('BEGIN IMMEDIATE');try{const data=JSON.parse(db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload);const result=change(data);db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(data));db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}
function syncNode(note){ensure();db.exec('BEGIN IMMEDIATE');try{db.prepare("INSERT INTO knowledge_nodes(id,title,content) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content").run(note.id,note.title,note.content||'');db.prepare("INSERT INTO vector_queue(id,attempts,last_error,next_retry_at) VALUES(?,0,NULL,0) ON CONFLICT(id) DO UPDATE SET attempts=0,last_error=NULL,next_retry_at=0,version=version+1").run(note.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
// deleted: заметки, удалённые в этом процессе, — индексатор не воссоздаёт их векторы.
const deleted=new Set();
function wasDeleted(id){return deleted.has(id)}
function removeNode(id){ensure();deleted.add(id);db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM knowledge_nodes WHERE id=?').run(id);db.prepare('DELETE FROM vector_queue WHERE id=?').run(id);db.prepare('DELETE FROM knowledge_edges WHERE source=? OR target=?').run(id,id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
function graph(){ensure();return {nodes:db.prepare('SELECT * FROM knowledge_nodes').all(),edges:db.prepare('SELECT * FROM knowledge_edges').all()}}
function pending(){ensure();return db.prepare('SELECT id,attempts,version FROM vector_queue WHERE attempts<5 AND next_retry_at<=? ORDER BY attempts,id LIMIT 20').all(Date.now())}
function indexed(id,version){ensure();if(version===undefined)db.prepare('DELETE FROM vector_queue WHERE id=?').run(id);else db.prepare('DELETE FROM vector_queue WHERE id=? AND version=?').run(id,version)}
function failed(id,error){ensure();const row=db.prepare('SELECT attempts FROM vector_queue WHERE id=?').get(id);if(!row)return;const delay=Math.min(3600000,30000*2**Math.min(6,row.attempts));db.prepare('UPDATE vector_queue SET attempts=attempts+1,last_error=?,next_retry_at=? WHERE id=?').run(String(error).slice(0,200),Date.now()+delay,id)}
async function createBackup(){
 ensure();
 const folder=path.join(__dirname,'backups','automatic');
 fs.mkdirSync(folder,{recursive:true});
 const name='tenmayurika-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.sqlite';
 const destination=path.join(folder,name);
 const checksumFile=destination+'.sha256';
 try{
  await require('node:sqlite').backup(db,destination);
  const check=new DatabaseSync(destination,{readOnly:true});
  try{
   if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Backup integrity check failed');
  }finally{check.close()}
  const hash=crypto.createHash('sha256');
  const fd=fs.openSync(destination,'r');
  try{const buffer=Buffer.allocUnsafe(1024*1024);let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count))}finally{fs.closeSync(fd)}
  const sha256=hash.digest('hex');
  fs.writeFileSync(checksumFile,sha256+'  '+name+'\n',{flag:'wx'});
  const candidates=fs.readdirSync(folder).filter(x=>/^tenmayurika-\d+-[a-f0-9]{8}\.sqlite$/.test(x)&&x!==name).sort().reverse().slice(4);
  const errors=[];
  for(const old of candidates){
   try{
    fs.unlinkSync(path.join(folder,old));
    try{fs.unlinkSync(path.join(folder,old+'.sha256'))}catch(e){if(e.code!=='ENOENT')throw e}
   }catch(e){errors.push(e.code||e.name)}
  }
  return {file:name,sha256,retentionWarnings:errors,scope:'sqlite-only'};
 }catch(e){
  try{fs.unlinkSync(destination)}catch{}
  try{fs.unlinkSync(checksumFile)}catch{}
  throw e;
 }
}
function backup(){
 if(!backupInProgress)backupInProgress=createBackup().finally(()=>{backupInProgress=null});
 return backupInProgress;
}
function enqueueMissing(ids){ensure();const stmt=db.prepare('INSERT OR IGNORE INTO vector_queue(id) VALUES(?)');let added=0;db.exec('BEGIN IMMEDIATE');try{for(const id of ids){if(typeof id==='string'&&id&&stmt.run(id).changes)added++}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return added}
function reindexAll(){ensure();db.exec('BEGIN IMMEDIATE');try{db.exec('INSERT OR IGNORE INTO vector_queue(id) SELECT id FROM knowledge_nodes');db.exec('UPDATE vector_queue SET attempts=0,last_error=NULL,next_retry_at=0');const count=db.prepare('SELECT COUNT(*) AS count FROM vector_queue').get().count;db.exec('COMMIT');return count}catch(error){db.exec('ROLLBACK');throw error}}
function close(){if(db){db.close();db=undefined}}
module.exports={connect,load,save,mutate,syncNode,removeNode,wasDeleted,graph,pending,indexed,failed,backup,reindexAll,enqueueMissing,close};
