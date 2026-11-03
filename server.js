'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const storage=require('./storage');
const services=require('./services');
const HOST='127.0.0.1',PORT=Number(process.env.PORT)||5173;
const ROOT=__dirname,DATA=path.join(ROOT,'data','workspace.json');
const allowed=new Map([['/', 'index.html'],['/index.html','index.html'],['/styles.css','styles.css'],['/app.js','app.js']]);
function respond(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(typeof body==='string'?body:JSON.stringify(body))}
function load(){try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch(e){if(e.code==='ENOENT')return {notes:[],tasks:[]};throw e}}
function save(data){fs.mkdirSync(path.dirname(DATA),{recursive:true});const temp=DATA+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2),'utf8');fs.renameSync(temp,DATA)}
async function body(req){let data='';for await(const part of req){data+=part;if(data.length>100000)throw Error('Request too large')}return JSON.parse(data||'{}')}
const server=http.createServer(async(req,res)=>{try{
const url=new URL(req.url,'http://localhost');const p=url.pathname;
if(req.method==='GET'&&p==='/api/health')return respond(res,200,{ok:true,version:'0.2.0'});
if(req.method==='GET'&&p==='/api/services')return respond(res,200,await services.status());
if(req.method==='GET'&&p==='/api/workspace')return respond(res,200,await storage.load());
if(req.method==='POST'&&p==='/api/items'){
const input=await body(req),collection=input.collection;
if(!['notes','tasks'].includes(collection)||typeof input.title!=='string'||!input.title.trim()||input.title.length>200)return respond(res,400,{error:'Invalid item'});
const data=await storage.load();data[collection]??=[];const item={id:require('node:crypto').randomUUID(),title:input.title.trim(),content:String(input.content||'').slice(0,20000),done:false,createdAt:new Date().toISOString()};data[collection].unshift(item);await storage.save(data);return respond(res,201,item)}
if(req.method==='PATCH'&&p==='/api/items'){
const input=await body(req);if(!['notes','tasks'].includes(input.collection))return respond(res,400,{error:'Invalid collection'});
const data=await storage.load(),item=(data[input.collection]||[]).find(x=>x.id===input.id);if(!item)return respond(res,404,{error:'Not found'});
if(typeof input.done==='boolean'&&input.collection==='tasks')item.done=input.done;
await storage.save(data);return respond(res,200,item)}
if(req.method==='GET'&&allowed.has(p)){const name=allowed.get(p),type=name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8';return respond(res,200,fs.readFileSync(path.join(ROOT,name),'utf8'),type)}
return respond(res,404,{error:'Not found'})
}catch(e){respond(res,e.message==='Request too large'?413:400,{error:e.message})}});
if(require.main===module)storage.connect().then(()=>server.listen(PORT,HOST,()=>console.log('Tenmayurika: http://'+HOST+':'+PORT))).catch(e=>{console.error('Database connection failed:',e.message);process.exitCode=1});
module.exports={server};
