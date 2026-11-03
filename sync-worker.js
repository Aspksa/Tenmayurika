'use strict';
const storage=require('./storage'),vectors=require('./vector-store');
let busy=false;
async function run(){
 if(busy||!process.env.EMBEDDING_URL)return {processed:0};
 busy=true;let processed=0;
 try{
  const data=await storage.load(),notes=new Map((data.notes||[]).map(n=>[n.id,n]));
  for(const job of storage.pending()){
   const note=notes.get(job.id);
   if(!note){storage.indexed(job.id);continue}
   try{const result=await vectors.syncNote(note);if(result.enabled){storage.indexed(job.id);processed++}}
   catch(error){storage.failed(job.id,error.code||error.name||'EMBEDDING_ERROR');console.error('Vector retry failed:',error.code||error.name||'EMBEDDING_ERROR')}
  }
  return {processed}
 }finally{busy=false}
}
module.exports={run};
