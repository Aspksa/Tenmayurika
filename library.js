'use strict';
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const ROOT=path.resolve(process.env.TENMAYURIKA_LIBRARY_DIR||path.join(__dirname,'data','library'));
const MAX_FILE=1024*1024*1024;
function segments(value){
 if(typeof value!=='string'||value.length>2000||value.includes('\\')||value.includes('\0')||value.startsWith('/'))throw new TypeError('Некорректный путь');
 const items=value?value.split('/'):[];
 for(const item of items)if(!item||item==='.'||item==='..'||item.length>180||/[<>:"|?*]/.test(item)||[...item].some(c=>c.charCodeAt(0)<32)||/[. ]$/.test(item)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item))throw new TypeError('Недопустимое имя файла или папки');
 return items;
}
async function resolvePath(value,{allowMissingLast=false}={}){
 const parts=segments(value);await fsp.mkdir(ROOT,{recursive:true});
 const base=await fsp.lstat(ROOT);if(base.isSymbolicLink()||!base.isDirectory())throw Error('Папка библиотеки недоступна');
 let current=ROOT;
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);
  try{const info=await fsp.lstat(current);if(info.isSymbolicLink())throw Error('Ссылки в библиотеке не поддерживаются');if(i<parts.length-1&&!info.isDirectory())throw Error('Папка не найдена')}
  catch(e){if(e.code==='ENOENT'&&allowMissingLast&&i===parts.length-1)continue;throw e}
 }
 return current;
}
async function list(dir=''){
 const full=await resolvePath(dir);const entries=await fsp.readdir(full,{withFileTypes:true});const rows=[];
 for(const entry of entries){if(!entry.isDirectory()&&!entry.isFile())continue;const rel=dir?dir+'/'+entry.name:entry.name;let info;try{info=await fsp.lstat(path.join(full,entry.name))}catch{continue}if(info.isSymbolicLink())continue;rows.push({name:entry.name,path:rel,type:info.isDirectory()?'folder':'file',size:info.size,modified:info.mtime.toISOString()})}
 return rows.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name,'ru'):a.type==='folder'?-1:1);
}
async function mkdir(dir){if(!dir)throw new TypeError('Укажите имя папки');await fsp.mkdir(await resolvePath(dir,{allowMissingLast:true}));}
async function upload(file,stream){
 if(!file)throw new TypeError('Укажите имя файла');const target=await resolvePath(file,{allowMissingLast:true});let written=0;const limit=new Transform({transform(chunk,encoding,cb){written+=chunk.length;cb(written>MAX_FILE?Error('Файл больше 1 ГБ'):null,chunk)}});let handle;
 try{handle=await fsp.open(target,'wx',0o600);await pipeline(stream,limit,handle.createWriteStream())}catch(e){if(handle){await handle.close().catch(()=>{});await fsp.unlink(target).catch(()=>{})}throw e}
 return {size:written};
}
async function filePath(file){const full=await resolvePath(file);if(!(await fsp.stat(full)).isFile())throw new TypeError('Это не файл');return full}
async function renameFile(file,newName,replaceReferences){
 if(typeof newName!=='string'||segments(newName).length!==1)throw new TypeError('Укажите имя файла без пути');
 const original=await filePath(file),parts=segments(file);parts.pop();const target=[...parts,newName].join('/');if(target===file)return {path:file,unchanged:true};
 const destination=await resolvePath(target,{allowMissingLast:true});
 // Hard link refuses to overwrite an existing target; both names refer to the original data.
 let copied=false;
 try{await fsp.link(original,destination)}catch(e){
  // Filesystems such as exFAT may not support hard links. Keep the original in this mode.
  if(!['EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS','EXDEV'].includes(e.code))throw e;
  await fsp.copyFile(original,destination,fs.constants.COPYFILE_EXCL);copied=true;
 }
 try{await replaceReferences(file,target)}catch(e){await fsp.unlink(destination).catch(()=>{});throw e}
 if(copied)return {path:target,originalRetained:true};
 try{await fsp.unlink(original)}catch{return {path:target,originalRetained:true}}
 return {path:target};
}
async function search(query){
 if(typeof query!=='string'||!query.trim()||query.length>200)throw new TypeError('Введите название файла');
 const needle=query.trim().toLocaleLowerCase('ru');const stack=[''],results=[];let scanned=0;let truncated=false;
 while(stack.length&&scanned<5000&&results.length<100){const dir=stack.pop();let entries;try{entries=await list(dir)}catch{continue}for(const entry of entries){if(++scanned>5000){truncated=true;break}if(entry.name.toLocaleLowerCase('ru').includes(needle))results.push(entry);if(entry.type==='folder')stack.push(entry.path);if(results.length>=100){truncated=true;break}}}
 return {results,scanned,truncated:truncated||stack.length>0};
}
module.exports={ROOT,segments,list,mkdir,upload,filePath,renameFile,search};

// Поиск по содержимому локальных текстовых документов; большие и двоичные файлы пропускаются.
async function searchText(query){
 if(typeof query!=='string'||!query.trim()||query.length>200)throw new TypeError('Введите текст для поиска');
 const needle=query.trim().toLocaleLowerCase('ru'),pending=[''],results=[];let scanned=0,unreadable=0;
 while(pending.length&&scanned<5000&&results.length<100){
  const dir=pending.pop();for(const entry of await list(dir)){
   if(++scanned>5000)break;
   if(entry.type==='folder'){pending.push(entry.path);continue}
   if(!/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(entry.name)||entry.size>16*1024*1024)continue;
   let lines;try{lines=(await require('./library-documents').read(entry.path)).text.split(/\r?\n/)}catch{unreadable++;continue}
   const index=lines.findIndex(line=>line.toLocaleLowerCase('ru').includes(needle));
   if(index!==-1){const marker=/\.pdf$/i.test(entry.path)?lines.slice(0,index+1).reverse().find(x=>/^\[Страница \d+\]$/.test(x)):null;results.push({path:entry.path,line:index+1,...(marker?{page:Number(marker.match(/\d+/)[0])}:{}),excerpt:lines[index].slice(0,300)})}
   if(results.length>=100)break;
  }
 }
 return {results,scanned,unreadable,truncated:pending.length>0||scanned>5000||results.length>=100};
}
module.exports.searchText=searchText;

// Одинаковые файлы группируются по размеру и SHA-256 без загрузки целиком в память.
async function duplicates(){
 const crypto=require('node:crypto'),pending=[''],sizes=new Map();let scanned=0,truncated=false;
 while(pending.length&&scanned<5000){const dir=pending.pop();for(const entry of await list(dir)){if(++scanned>5000){truncated=true;break}if(entry.type==='folder'){pending.push(entry.path);continue}const group=sizes.get(entry.size)||[];group.push(entry);sizes.set(entry.size,group)}}
 const hashes=new Map(),errors=[];
 for(const group of sizes.values())if(group.length>1)for(const entry of group){
  try{const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(await filePath(entry.path)))hash.update(chunk);const digest=entry.size+':'+hash.digest('hex'),matches=hashes.get(digest)||[];matches.push(entry);hashes.set(digest,matches)}catch{errors.push(entry.path)}
 }
 return {groups:[...hashes.values()].filter(g=>g.length>1),scanned,truncated:truncated||pending.length>0,errors};
}
module.exports.duplicates=duplicates;
