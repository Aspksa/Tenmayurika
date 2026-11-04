'use strict';
// Journal stores local operation metadata, never file contents or search terms.
const fs=require('node:fs/promises'),path=require('node:path');
const FILE=process.env.TENMAYURIKA_LIBRARY_JOURNAL||path.join(__dirname,'data','library-journal.jsonl');
const ALLOWED=new Set(['folder_created','file_uploaded','file_replaced','file_renamed','file_moved','ocr_completed','collection_created','collection_added','collection_removed','collection_deleted']);
let chain=Promise.resolve();
function record(action,detail={}){
 if(!ALLOWED.has(action))throw new TypeError('Неизвестное действие');
 const event={at:new Date().toISOString(),action,...(typeof detail.path==='string'?{path:detail.path.slice(0,2000)}:{}),...(typeof detail.target==='string'?{target:detail.target.slice(0,2000)}:{}),...(typeof detail.collection==='string'?{collection:detail.collection.slice(0,100)}:{})};
 const next=chain.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(FILE),{recursive:true});await fs.appendFile(FILE,JSON.stringify(event)+'\n',{mode:0o600})});chain=next;return next;
}
async function recent(limit=50){
 await chain.catch(()=>{});limit=Math.max(1,Math.min(100,Number(limit)||50));let handle;
 try{handle=await fs.open(FILE,'r');const stat=await handle.stat(),length=Math.min(stat.size,512*1024),buf=Buffer.alloc(length);await handle.read(buf,0,length,stat.size-length);const lines=buf.toString('utf8').split('\n');if(stat.size>length)lines.shift();return lines.filter(Boolean).slice(-limit).reverse().map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean)}catch(e){if(e.code==='ENOENT')return [];throw e}finally{await handle?.close()}
}
module.exports={record,recent};
