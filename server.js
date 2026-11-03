'use strict';
require('dotenv').config();
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const storage=require('./storage');
const services=require('./services');
const vectorStore=require('./vector-store');
const syncWorker=require('./sync-worker');
const HOST='127.0.0.1',PORT=Number(process.env.PORT)||5173;
const ROOT=__dirname;
const allowed=new Map([['/', 'index.html'],['/index.html','index.html'],['/styles.css','styles.css'],['/app.js','app.js']]);
function respond(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(typeof body==='string'?body:JSON.stringify(body))}
async function body(req){let data='';for await(const part of req){data+=part;if(data.length>100000)throw Error('Request too large')}return JSON.parse(data||'{}')}
const server=http.createServer(async(req,res)=>{try{
const host=req.headers.host||'';if(!/^127\.0\.0\.1:\d+$/.test(host)&&host!=='localhost:'+String(server.address()?.port||PORT))return respond(res,403,{error:'Forbidden host'});
const url=new URL(req.url,'http://localhost');const p=url.pathname;
if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.headers.origin;if(origin){let parsed;try{parsed=new URL(origin)}catch{return respond(res,403,{error:'Forbidden origin'})}if(parsed.hostname!=='127.0.0.1'||Number(parsed.port||80)!==Number(server.address()?.port||PORT))return respond(res,403,{error:'Forbidden origin'})}}
if(req.method==='GET'&&p==='/api/health')return respond(res,200,{ok:true,version:'0.3.0'});
if(req.method==='GET'&&p==='/api/services')return respond(res,200,await services.status());
if(req.method==='POST'&&p==='/api/backup')return respond(res,200,await storage.backup());
if(req.method==='POST'&&p==='/api/sync')return respond(res,200,await syncWorker.run());
if(req.method==='GET'&&p==='/api/graph')return respond(res,200,storage.graph());
if(req.method==='GET'&&p==='/api/search'){const query=url.searchParams.get('q')||'';if(!query.trim())return respond(res,400,{error:'Missing query'});return respond(res,200,await vectorStore.search(query));}
if(req.method==='GET'&&p==='/api/workspace')return respond(res,200,await storage.load());
if(req.method==='POST'&&p==='/api/items'){
const input=await body(req),collection=input.collection;
if(!['notes','tasks'].includes(collection)||typeof input.title!=='string'||!input.title.trim()||input.title.length>200)return respond(res,400,{error:'Invalid item'});
const item={id:require('node:crypto').randomUUID(),title:input.title.trim(),content:typeof input.content==='string'?input.content.slice(0,20000):'',done:false,createdAt:new Date().toISOString()};storage.mutate(data=>{data[collection]??=[];data[collection].unshift(item)});if(collection==='notes'){storage.syncNode(item);syncWorker.run().catch(e=>console.error('LanceDB indexing failed:',e.message))}return respond(res,201,item)}
if(req.method==='PATCH'&&p==='/api/items'){
const input=await body(req);if(!['notes','tasks'].includes(input.collection))return respond(res,400,{error:'Invalid collection'});
const item=storage.mutate(data=>{const found=(data[input.collection]||[]).find(x=>x.id===input.id);if(!found)return null;if(typeof input.done==='boolean'&&input.collection==='tasks')found.done=input.done;return {...found}});if(!item)return respond(res,404,{error:'Not found'});return respond(res,200,item)}
if(req.method==='GET'&&allowed.has(p)){const name=allowed.get(p),type=name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8';return respond(res,200,fs.readFileSync(path.join(ROOT,name),'utf8'),type)}
return respond(res,404,{error:'Not found'})
}catch(e){console.error('Request failed:',e);respond(res,e.message==='Request too large'?413:e instanceof SyntaxError?400:500,{error:e.message==='Request too large'?'Request too large':e instanceof SyntaxError?'Invalid JSON':'Internal server error'})}});
if(require.main===module)Promise.resolve().then(()=>storage.connect()).then(()=>server.listen(PORT,HOST,()=>{console.log('Tenmayurika: http://'+HOST+':'+PORT);syncWorker.run().catch(console.error);const timer=setInterval(()=>syncWorker.run().catch(console.error),60000);timer.unref()})).catch(e=>{console.error('Database connection failed:',e.message);process.exitCode=1});
module.exports={server};
