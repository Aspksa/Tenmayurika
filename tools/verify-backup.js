'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
function verify(file){
 const target=path.resolve(file);
 if(!target.endsWith('.sqlite'))throw Error('Ожидается файл SQLite');
 const checksumFile=target+'.sha256';
 const line=fs.readFileSync(checksumFile,'utf8').trim();
 const match=/^([a-f0-9]{64})  (tenmayurika-\d+-[a-f0-9]{8}\.sqlite)$/.exec(line);
 if(!match||match[2]!==path.basename(target))throw Error('Некорректный файл SHA-256');
 const hash=crypto.createHash('sha256');
 const fd=fs.openSync(target,'r');
 try{const buffer=Buffer.allocUnsafe(1024*1024);let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,size))}
 finally{fs.closeSync(fd)}
 const actual=hash.digest('hex');
 if(actual!==match[1])throw Error('Контрольная сумма не совпадает');
 const db=new DatabaseSync(target,{readOnly:true});
 try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Нарушена целостность SQLite')}
 finally{db.close()}
 return {ok:true,file:path.basename(target),sha256:actual};
}
if(require.main===module){
 try{
  if(process.argv.length!==3)throw Error('Использование: node tools/verify-backup.js путь_к_копии.sqlite');
  console.log(JSON.stringify(verify(process.argv[2])));
 }catch(e){console.error('Ошибка проверки резервной копии:',e.message);process.exitCode=1}
}
module.exports={verify};
