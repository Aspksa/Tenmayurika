'use strict';
const fs=require('node:fs/promises');
const library=require('./library'),collections=require('./library-collections'),queue=require('./library-queue');
const LIMIT=5000;
async function check(){
 let files=0,folders=0,bytes=0,scanned=0,truncated=false;const errors=[],pending=[''];
 while(pending.length&&scanned<LIMIT){const dir=pending.pop();let items;try{items=await library.list(dir)}catch(e){errors.push({path:dir,error:String(e.message||'Ошибка').slice(0,200)});continue}
  for(const item of items){if(++scanned>LIMIT){truncated=true;break}if(item.type==='folder'){folders++;pending.push(item.path)}else{files++;bytes+=item.size}}
 }
 truncated=truncated||pending.length>0;
 const missing=[];for(const collection of await collections.list())for(const file of collection.files){try{await library.filePath(file)}catch{if(missing.length<100)missing.push({collection:collection.name,path:file})}}
 const missingLinks=[];for(const link of await collections.links())for(const file of [link.a,link.b]){try{await library.filePath(file)}catch{if(missingLinks.length<100)missingLinks.push({id:link.id,path:file})}}
 let freeBytes=null;try{const d=await fs.statfs(library.ROOT,{bigint:true});freeBytes=(d.bavail*d.bsize).toString()}catch{}
 const status=await queue.status();return {files,folders,bytes,freeBytes,scanned:Math.min(scanned,LIMIT),truncated,errors:errors.slice(0,100),missing,missingLinks,queue:status.counts};
}
module.exports={check};
