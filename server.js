'use strict';
require('dotenv').config();
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const storage=require('./storage');
const services=require('./services');
const vectorStore=require('./vector-store');
const syncWorker=require('./sync-worker');
const maintenance=require('./tools/maintenance');
const memory=require('./memory-core');
const chat=require('./chat');
const llm=require('./llm');
let diskHealthy=true;
function ensureDisk(){try{maintenance.checkDisk();diskHealthy=true}catch(e){diskHealthy=false;throw e}}
const HOST='127.0.0.1',PORT=Number(process.env.PORT)||5173;
if(!Number.isInteger(PORT)||PORT<1024||PORT>65535)throw Error('Invalid server port');
const ROOT=__dirname;
const BACKUP_INTERVAL_MS=5*60*60*1000;
let backupTimer;
async function scheduledBackup(){try{ensureDisk();const result=await storage.backup();console.log('Резервная копия SQLite создана:',result.file);if(result.retentionWarnings?.length)console.warn('Не все старые копии удалось удалить')}catch(e){console.error('Автоматическое резервное копирование не выполнено:',e.code||e.name)}}
function startBackupSchedule(){backupTimer=setInterval(()=>{void scheduledBackup()},BACKUP_INTERVAL_MS);backupTimer.unref()}

const allowed=new Map([['/', 'index.html'],['/index.html','index.html'],['/styles.css','styles.css'],['/app.js','app.js'],['/avatar.js','avatar.js'],['/favicon.svg','favicon.svg']]);
// Аватары: только файлы с безопасными именами из assets/avatars.
const AVATAR_PATH=/^\/assets\/avatars\/[a-z0-9-]{1,40}\.webp$/;
const TYPES={'.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'};
function respond(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body))}
async function body(req){const chunks=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>100000)throw Error('Request too large');chunks.push(part)}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}
// Факты памяти (memory-core.js). Ошибки валидации memory-core — TypeError, отдаются как 400.
function limitParam(url,fallback,max){const raw=url.searchParams.get('limit');if(raw===null)return fallback;const n=Number(raw);if(!Number.isInteger(n)||n<1||n>max)throw new TypeError('Invalid limit');return n}
async function handleFacts(req,res,p,url){
 try{
  if(req.method==='GET'&&p==='/api/facts'){
   const q=url.searchParams.get('q'),subject=url.searchParams.get('subject');
   if(q&&q.trim())return respond(res,200,memory.searchFacts(q,limitParam(url,30,100)));
   return respond(res,200,memory.queryFacts({subject:subject&&subject.trim()?subject:undefined,limit:limitParam(url,50,500)}));
  }
  if(req.method==='POST'&&p==='/api/facts'){
   const input=await body(req);
   if(!input||typeof input!=='object'||Array.isArray(input))return respond(res,400,{error:'Invalid fact'});
   const result=memory.addFact({subject:input.subject,predicate:input.predicate,object:input.object,sourceId:typeof input.sourceId==='string'&&input.sourceId.trim()?input.sourceId:'manual',confidence:input.confidence});
   return respond(res,result.duplicate?200:201,result);
  }
  if(req.method==='GET'&&p==='/api/facts/relations'){const subject=url.searchParams.get('subject')||'';return respond(res,200,memory.relations(subject,limitParam(url,100,500)))}
  if(req.method==='GET'&&p==='/api/facts/conflicts')return respond(res,200,memory.conflicts(limitParam(url,100,500)));
  if(req.method==='GET'&&p==='/api/facts/diagnostics')return respond(res,200,memory.diagnostics());
  return respond(res,404,{error:'Not found'});
 }catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}
}
// Строки вида «FACT: субъект | связь | объект» в тексте заметки сохраняются как факты.
function ingestNoteFacts(item){if(!item.content||!item.content.includes('FACT:'))return;try{memory.extractFacts(item.content,'note:'+item.id)}catch(e){console.error('Fact ingestion failed:',e.name)}}
// Общие операции с записями: используются API и инструментами аватара.
function addItem(collection,title,content){
 if(!['notes','tasks'].includes(collection)||typeof title!=='string'||!title.trim()||title.length>200)throw new TypeError('Invalid item');
 const item={id:require('node:crypto').randomUUID(),title:title.trim(),content:typeof content==='string'?content.slice(0,20000):'',done:false,createdAt:new Date().toISOString()};
 storage.mutate(data=>{data[collection]??=[];data[collection].unshift(item)});
 if(collection==='notes'){storage.syncNode(item);ingestNoteFacts(item);syncWorker.run().catch(e=>console.error('LanceDB indexing failed:',e.message))}
 return item;
}
function updateItem(collection,id,done){return storage.mutate(data=>{const found=(data[collection]||[]).find(x=>x.id===id);if(!found)return null;if(typeof done==='boolean'&&collection==='tasks')found.done=done;return {...found}})}
// Настройки языковой модели аватара. Ключ API сохраняется только на диске и в ответах не возвращается.
async function handleLlm(req,res,p){
 try{
  if(req.method==='GET'&&p==='/api/llm')return respond(res,200,llm.view());
  if(req.method==='POST'&&p==='/api/llm')return respond(res,200,llm.save(await body(req)));
  if(req.method==='POST'&&p==='/api/llm/models')return respond(res,200,{models:await llm.listModels()});
  if(req.method==='POST'&&p==='/api/llm/test')return respond(res,200,await llm.test());
  return respond(res,404,{error:'Not found'});
 }catch(e){
  if(e instanceof SyntaxError)throw e;
  if(e.name==='TimeoutError'||e.name==='AbortError')return respond(res,504,{error:'Сервис модели не ответил вовремя'});
  if(e instanceof TypeError&&e.message!=='fetch failed')return respond(res,400,{error:e.message});
  if(e instanceof TypeError)return respond(res,502,{error:'Не удалось подключиться к сервису модели'});
  if(/^Chat API HTTP (\d+)/.test(e.message))return respond(res,502,{error:'Сервис модели ответил ошибкой: '+e.message.replace('Chat API ','')});
  throw e;
 }
}
const chatContext={addItem,setTaskDone:(id,done)=>updateItem('tasks',id,done)};
const server=http.createServer(async(req,res)=>{try{
const host=req.headers.host||'';if(host!=='127.0.0.1:'+String(server.address()?.port||PORT)&&host!=='localhost:'+String(server.address()?.port||PORT))return respond(res,403,{error:'Forbidden host'});
const url=new URL(req.url,'http://localhost');const p=url.pathname;
if(req.method==='OPTIONS')return respond(res,204,'');
if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.headers.origin;if(origin){let parsed;try{parsed=new URL(origin)}catch{return respond(res,403,{error:'Forbidden origin'})}if(parsed.protocol!=='http:'||!['127.0.0.1','localhost'].includes(parsed.hostname)||Number(parsed.port||80)!==Number(server.address()?.port||PORT))return respond(res,403,{error:'Forbidden origin'})}}
if(req.method==='GET'&&p==='/api/health'){try{ensureDisk()}catch{}return respond(res,diskHealthy?200:503,{ok:diskHealthy,version:'0.3.0',database:'connected',disk:diskHealthy?'ok':'unavailable'});}
if(!['GET','HEAD','OPTIONS'].includes(req.method))ensureDisk();
if(req.method==='GET'&&p==='/api/services')return respond(res,200,await services.status());
if(req.method==='POST'&&p==='/api/backup')return respond(res,200,await storage.backup());
if(req.method==='POST'&&p==='/api/sync')return respond(res,200,await syncWorker.run());
if(req.method==='GET'&&p==='/api/graph')return respond(res,200,storage.graph());
if(req.method==='GET'&&p==='/api/search'){const query=url.searchParams.get('q')||'';if(!query.trim())return respond(res,400,{error:'Missing query'});return respond(res,200,await vectorStore.search(query));}
if(p==='/api/facts'||p.startsWith('/api/facts/'))return handleFacts(req,res,p,url);
if(p==='/api/llm'||p.startsWith('/api/llm/'))return handleLlm(req,res,p);
if(req.method==='POST'&&p==='/api/chat'){try{return respond(res,200,await chat.reply(await body(req),chatContext))}catch(e){if(e instanceof TypeError)return respond(res,400,{error:e.message});throw e}}
if(req.method==='GET'&&p==='/api/workspace')return respond(res,200,await storage.load());
if(req.method==='POST'&&p==='/api/items'){
const input=await body(req),collection=input.collection;
if(!['notes','tasks'].includes(collection)||typeof input.title!=='string'||!input.title.trim()||input.title.length>200)return respond(res,400,{error:'Invalid item'});
return respond(res,201,addItem(collection,input.title,input.content))}
if(req.method==='PATCH'&&p==='/api/items'){
const input=await body(req);if(!['notes','tasks'].includes(input.collection))return respond(res,400,{error:'Invalid collection'});
const item=updateItem(input.collection,input.id,input.done);if(!item)return respond(res,404,{error:'Not found'});return respond(res,200,item)}
if(req.method==='GET'&&allowed.has(p)){const name=allowed.get(p);return respond(res,200,fs.readFileSync(path.join(ROOT,name),'utf8'),TYPES[path.extname(name)])}
if(req.method==='GET'&&AVATAR_PATH.test(p)){const file=path.join(ROOT,p.slice(1));if(!fs.existsSync(file))return respond(res,404,{error:'Not found'});res.writeHead(200,{'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=86400'});return res.end(fs.readFileSync(file))}
return respond(res,404,{error:'Not found'})
}catch(e){console.error('Request failed:',e.name,e.code||'',e instanceof SyntaxError?'invalid JSON':'request processing error');respond(res,e.message==='Request too large'?413:e instanceof SyntaxError?400:500,{error:e.message==='Request too large'?'Request too large':e instanceof SyntaxError?'Invalid JSON':'Internal server error'})}});
server.on('error',e=>{console.error('Server error:',e.code||e.name);process.exitCode=1});
if(require.main===module)Promise.resolve().then(()=>ensureDisk()).then(()=>storage.connect()).then(()=>server.listen(PORT,HOST,()=>{console.log('Tenmayurika: http://'+HOST+':'+PORT);syncWorker.run().catch(console.error);const timer=setInterval(()=>syncWorker.run().catch(console.error),60000);timer.unref();startBackupSchedule();const maintenanceTimer=setInterval(()=>{try{ensureDisk();maintenance.maintenance()}catch(e){console.error('Disk maintenance failed:',e.code||e.name)}},3600000);maintenanceTimer.unref()})).catch(e=>{console.error('Database connection failed:',e.message);process.exitCode=1});
module.exports={server};
