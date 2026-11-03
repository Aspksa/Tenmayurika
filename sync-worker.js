'use strict';
const storage=require('./storage'),vectors=require('./vector-store');
let busy=false;
let lastReconcile=0;
const RECONCILE_MS=60*60*1000;
const MAX_ATTEMPTS=5;
async function run(){
 if(busy||!process.env.EMBEDDING_URL)return {processed:0};
 busy=true;let processed=0,failed=0;
 try{
  const data=await storage.load(),notes=new Map((data.notes||[]).map(n=>[n.id,n]));
  if(Date.now()-lastReconcile>=RECONCILE_MS){try{const indexed=await vectors.indexedIds();storage.enqueueMissing([...notes.keys()].filter(id=>!indexed.has(String(id))));lastReconcile=Date.now()}catch(e){console.error('Vector reconciliation failed:',e.code||e.name)}}
  for(const job of storage.pending()){
   if(job.attempts>=MAX_ATTEMPTS)continue;
   const note=notes.get(job.id);
   if(!note){storage.indexed(job.id);continue}
   try{const result=await vectors.syncNote(note);if(result.enabled){storage.indexed(job.id);processed++}}
   catch(error){failed++;storage.failed(job.id,error.code||error.name||'EMBEDDING_ERROR');console.error('Vector retry failed:',error.code||error.name||'EMBEDDING_ERROR')}
  }
  return {processed,failed}
 }finally{busy=false}
}
module.exports={run};
