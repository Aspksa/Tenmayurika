'use strict';
// Очередь хранится рядом с данными проекта и не содержит текста документов.
const fs=require('node:fs/promises');
const path=require('node:path');
const library=require('./library');
const documents=require('./library-documents');
const index=require('./library-index');
const activity=require('./guardian-activity');
const guardian=require('./guardian-memory');
const agents=require('./agents');
const analysis=require('./library-analysis');
const FILE=process.env.TENMAYURIKA_LIBRARY_QUEUE||path.join(__dirname,'data','library-queue.json');
const MAX_ENTRIES=5000,MAX_ATTEMPTS=3;
let state=null,busy=false,saveChain=Promise.resolve();
async function load(){if(state)return state;try{const input=JSON.parse(await fs.readFile(FILE,'utf8'));state={enabled:input.enabled!==false,items:input.items&&typeof input.items==='object'?input.items:{},lastScan:input.lastScan||null,indexVersion:2};if(input.indexVersion!==2)for(const item of Object.values(state.items))if(item.status==='ready'){item.status='queued';item.attempts=0}}catch(e){if(e.code!=='ENOENT')throw e;state={enabled:true,items:{},lastScan:null,indexVersion:2}}return state}
async function save(){const data=JSON.stringify(state);saveChain=saveChain.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(FILE),{recursive:true});const temp=FILE+'.tmp';await fs.writeFile(temp,data,{mode:0o600});await fs.rename(temp,FILE)});return saveChain}
async function scan(){
 const operation=activity.start('scan',{phase:'Проверяю библиотеку',quiet:true});try{
 const s=await load(),pending=[''],found=new Set();let seen=0,truncated=false;
 while(pending.length&&seen<MAX_ENTRIES){const dir=pending.pop();for(const item of await library.list(dir)){if(++seen>MAX_ENTRIES){truncated=true;break}if(item.type==='folder'){pending.push(item.path);continue}if(!/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name))continue;found.add(item.path);const old=s.items[item.path];if(!old||old.modified!==item.modified||old.size!==item.size)s.items[item.path]={path:item.path,modified:item.modified,size:item.size,status:'queued',attempts:0,error:null}}}
 truncated=truncated||pending.length>0;if(!truncated){for(const key of Object.keys(s.items))if(!found.has(key))delete s.items[key];index.reconcile(found)}
 s.lastScan=new Date().toISOString();await save();return {seen,truncated};
 }catch(e){activity.finish(operation,'error',e?.message||'Ошибка проверки');throw e}finally{activity.finish(operation)}
}
async function run(limit=2){
 if(busy)return {busy:true};busy=true;
 try{const s=await load();if(!s.enabled)return {disabled:true};const items=Object.values(s.items).filter(x=>x.status==='queued').slice(0,Math.max(1,Math.min(10,limit)));
  for(const item of items){const operation=activity.start('read',{file:item.path,phase:'Читаю документ'});try{const info=await documents.read(item.path);if(info.modified!==item.modified||info.bytes!==item.size){item.status='queued';item.modified=info.modified;item.size=info.bytes;item.attempts=0;await save();activity.finish(operation,'deferred');continue}activity.update(operation,{phase:'Обновляю индекс'});index.put(item.path,item.modified,item.size,info.text);activity.update(operation,{phase:'Ищу предложения знаний'});const found=analysis.extractProposals(item.path,info.text).items;await guardian.setProposals(item.path,item.modified,item.size,found,await analysis.proposeMetadata(item.path,info.text));if(found.length)agents.record('researcher','сверяет факты из «'+item.path.split('/').pop().slice(0,80)+'»','Предложений фактов: '+found.length+' — проверь их в «Памяти Хранителя»',{from:'guardian'});item.status='ready';item.lineCount=info.text.split(/\r?\n/).length;item.error=null;activity.finish(operation)}catch(e){item.attempts++;item.status=item.attempts>=MAX_ATTEMPTS?'error':'queued';item.error=String(e.message||'Ошибка').slice(0,200);activity.finish(operation,'error',item.error)}await save()}
  return {processed:items.length};
 }finally{busy=false}
}
async function status(){const s=await load(),items=Object.values(s.items);return {enabled:s.enabled,lastScan:s.lastScan,counts:{queued:items.filter(x=>x.status==='queued').length,ready:items.filter(x=>x.status==='ready').length,error:items.filter(x=>x.status==='error').length},items:items.filter(x=>x.status!=='ready').slice(0,100)}}
async function setEnabled(value){if(typeof value!=='boolean')throw new TypeError('Некорректное значение');(await load()).enabled=value;await save();return status()}
async function retry(file){const s=await load(),item=s.items[file];if(!item)throw new TypeError('Документ не найден в очереди');item.status='queued';item.attempts=0;item.error=null;await save()}
module.exports={scan,run,status,setEnabled,retry};

