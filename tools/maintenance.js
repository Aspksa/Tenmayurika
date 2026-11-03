'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const MIN_FREE=512n*1024n*1024n;
function checkDisk(folder=path.join(root,'data')){
 fs.mkdirSync(folder,{recursive:true});
 const stats=fs.statfsSync(folder,{bigint:true});
 const free=stats.bavail*stats.bsize;
 if(free<MIN_FREE)throw Object.assign(Error('Недостаточно свободного места на диске'),{code:'ENOSPC'});
 const probe=path.join(folder,'.disk-probe-'+process.pid);
 try{fs.writeFileSync(probe,'ok',{flag:'wx'});if(fs.readFileSync(probe,'utf8')!=='ok')throw Error('Ошибка чтения диска')}
 finally{try{fs.unlinkSync(probe)}catch{}}
 return {ok:true,freeBytes:free.toString()};
}
function maintenance(options={}){
 const now=options.now??Date.now(),maxAge=options.maxAge??7*86400000;
 const removed=[];
 for(const folder of [path.join(root,'logs'),path.join(root,'data')]){
  if(!fs.existsSync(folder))continue;
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   if(!entry.isFile())continue;
   const name=entry.name;
   const eligible=folder.endsWith('logs')?name.endsWith('.log'):(name.startsWith('.write-')||name.startsWith('.disk-probe-'));
   if(!eligible)continue;
   const file=path.join(folder,name);
   const st=fs.statSync(file);
   if(now-st.mtimeMs<maxAge)continue;
   if(folder.endsWith('logs')&&st.size<1024*1024)continue;
   fs.unlinkSync(file);removed.push(file);
  }
 }
 return {removed:removed.length};
}
module.exports={checkDisk,maintenance};
