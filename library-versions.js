'use strict';
// User-confirmed replacement: write a new file first and keep a separate copy of the old one.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const library=require('./library');
const ROOT=process.env.TENMAYURIKA_LIBRARY_VERSIONS?path.resolve(process.env.TENMAYURIKA_LIBRARY_VERSIONS):path.join(__dirname,'data','library-versions');
const MAX=1024*1024*1024,ID=/^[0-9a-f-]{36}$/;
const busy=new Set();
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function replace(file,stream){
 if(busy.has(file))throw new TypeError('Замена этого файла уже выполняется');busy.add(file);let temp,handle,backupReady=false,id;
 try{
  const original=await library.filePath(file),folder=path.dirname(original);temp=path.join(folder,'.tenma-'+crypto.randomUUID()+'.tmp');id=crypto.randomUUID();
  let bytes=0;const limiter=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;cb(bytes>MAX?Error('Файл больше 1 ГБ'):null,chunk)}});
  handle=await fsp.open(temp,'wx',0o600);await pipeline(stream,limiter,handle.createWriteStream());handle=null;
  await fsp.mkdir(ROOT,{recursive:true});const before=await fsp.stat(original),backup=path.join(ROOT,id+'.backup');await fsp.copyFile(original,backup,fs.constants.COPYFILE_EXCL);backupReady=true;
  const after=await fsp.stat(original);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||await digest(original)!==await digest(backup))throw Error('Исходный файл изменился во время копирования. Повторите замену.');
  const meta={id,path:file,createdAt:new Date().toISOString(),size:before.size};await fsp.writeFile(path.join(ROOT,id+'.json'),JSON.stringify(meta),{flag:'wx',mode:0o600});
  const last=await fsp.stat(original);if(last.size!==after.size||last.mtimeMs!==after.mtimeMs)throw Error('Исходный файл изменился. Замена отменена.');
  await fsp.rename(temp,original);return {ok:true,backup:id,size:bytes};
 }catch(e){if(handle)await handle.close().catch(()=>{});if(temp)await fsp.unlink(temp).catch(()=>{});if(backupReady){try{await fsp.access(path.join(ROOT,id+'.json'))}catch{await fsp.unlink(path.join(ROOT,id+'.backup')).catch(()=>{})}}throw e}finally{busy.delete(file)}
}
async function list(file=''){if(file)library.segments(file);let entries;try{entries=await fsp.readdir(ROOT)}catch(e){if(e.code==='ENOENT')return [];throw e}const items=[];for(const name of entries){if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;try{const x=JSON.parse(await fsp.readFile(path.join(ROOT,name),'utf8'));if((!file||x.path===file)&&ID.test(x.id)&&name===x.id+'.json')items.push(x)}catch{}}return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)}
async function file(id){if(typeof id!=='string'||!ID.test(id))throw new TypeError('Неверный номер версии');const meta=JSON.parse(await fsp.readFile(path.join(ROOT,id+'.json'),'utf8'));if(meta.id!==id)throw new TypeError('Неверная версия');const full=path.join(ROOT,id+'.backup'),stat=await fsp.lstat(full);if(stat.isSymbolicLink()||!stat.isFile())throw new TypeError('Копия недоступна');return {full,meta}}
module.exports={replace,list,file};
