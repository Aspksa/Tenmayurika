'use strict';
const storage=require('./storage'),vectors=require('./vector-store');
let busy=false,again=false;
let lastReconcile=0;
const RECONCILE_MS=60*60*1000;
const MAX_ATTEMPTS=5;
async function run(){
 if(!process.env.EMBEDDING_URL)return {processed:0};
 // Запрос во время работы не теряется: после текущего прохода будет ещё один.
 if(busy){again=true;return {processed:0,queued:true}}
 busy=true;let processed=0,failed=0;
 try{
  const data=await storage.load(),notes=new Map((data.notes||[]).map(n=>[n.id,n]));
  if(Date.now()-lastReconcile>=RECONCILE_MS){try{const indexed=await vectors.indexedIds();storage.enqueueMissing([...notes.keys()].filter(id=>!indexed.has(String(id))));for(const id of indexed)if(!notes.has(id))await vectors.removeNote(id);lastReconcile=Date.now()}catch(e){console.error('Vector reconciliation failed:',e.code||e.name)}}
  for(const job of storage.pending()){
   if(job.attempts>=MAX_ATTEMPTS)continue;
   const note=notes.get(job.id);
   if(!note){storage.indexed(job.id);continue}
   try{const result=await vectors.syncNote(note);
    // Заметку удалили, пока шёл запрос эмбеддинга: убираем только что записанный вектор.
    if(storage.wasDeleted(job.id)){await vectors.removeNote(job.id);storage.indexed(job.id);continue}
    if(result.enabled){storage.indexed(job.id,job.version);processed++}}
   catch(error){failed++;storage.failed(job.id,error.code||error.name||'EMBEDDING_ERROR');console.error('Vector retry failed:',error.code||error.name||'EMBEDDING_ERROR')}
  }
  return {processed,failed}
 }finally{busy=false;if(again){again=false;setImmediate(()=>run().catch(e=>console.error('LanceDB indexing failed:',e.message)))}}
}
module.exports={run};
