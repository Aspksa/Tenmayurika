'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
function hash(file){
 const digest=crypto.createHash('sha256'),fd=fs.openSync(file,'r');
 try{const buf=Buffer.allocUnsafe(1048576);let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)digest.update(buf.subarray(0,n))}
 finally{fs.closeSync(fd)}
 return digest.digest('hex');
}
function verify(folder){
 const root=path.resolve(folder),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Пустой манифест');
 const expected=new Set();
 for(const item of manifest.files){
  if(typeof item.path!=='string'||typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Некорректная запись манифеста');
  const parts=item.path.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')))throw Error('Недопустимый путь в манифесте');
  const file=path.resolve(root,...parts);
  if(!file.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw Error('Недопустимый файл');
  if(expected.has(file))throw Error('Повтор файла');
  expected.add(file);
  if(hash(file)!==item.sha256)throw Error('Контрольная сумма не совпала: '+item.path);
 }
 const sqlite=path.join(root,'tenmayurika.sqlite');
 if(!expected.has(sqlite))throw Error('SQLite отсутствует в манифесте');
 const db=new DatabaseSync(sqlite,{readOnly:true});
 try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Повреждена SQLite')}finally{db.close()}
 let count=0;
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Символическая ссылка');if(entry.isDirectory())walk(full);else if(entry.isFile()&&entry.name!=='manifest.json'){count++;if(!expected.has(full))throw Error('Незарегистрированный файл')}}}
 walk(root);
 if(count!==expected.size)throw Error('Количество файлов не совпадает');
 return {ok:true,files:count};
}
if(require.main===module){try{if(process.argv.length!==3)throw Error('Укажите каталог снимка');console.log(JSON.stringify(verify(process.argv[2])))}catch(e){console.error('Ошибка проверки:',e.message);process.exitCode=1}}
module.exports={verify};
