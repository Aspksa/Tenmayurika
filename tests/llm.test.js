'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-llm-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
const {server}=require('../server');
test('model settings: key is stored on disk only, models are listed, chat uses the chosen model',async()=>{
 const seen=[];
 const fake=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{seen.push({url:req.url,auth:req.headers.authorization,body:b?JSON.parse(b):null});res.writeHead(200,{'Content-Type':'application/json'});
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'GigaChat/GigaChat-2-Max'},{id:'Qwen/Qwen3-235B'}]}));
  res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Я на связи, хозяин.'}}]}))})});
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port,json={'Content-Type':'application/json'};
  const post=(u,b)=>fetch(base+u,{method:'POST',headers:json,body:JSON.stringify(b)});
  let v=await (await fetch(base+'/api/llm')).json();
  assert.equal(v.provider,'cloudru');assert.equal(v.baseUrl,'https://foundation-models.api.cloud.ru/v1');assert.equal(v.active,false);
  assert.equal((await post('/api/llm',{baseUrl:'http://example.com/v1'})).status,400);
  const fakeBase='http://127.0.0.1:'+fake.address().port+'/v1';
  v=await (await post('/api/llm',{provider:'custom',baseUrl:fakeBase,apiKey:'secret-key-1234'})).json();
  assert.equal(v.hasKey,true);assert.equal(v.keyHint,'…1234');assert.equal(JSON.stringify(v).includes('secret-key'),false);
  const models=await (await post('/api/llm/models',{})).json();
  assert.deepEqual(models.models,['GigaChat/GigaChat-2-Max','Qwen/Qwen3-235B']);
  assert.equal(seen[0].auth,'Bearer secret-key-1234');
  v=await (await post('/api/llm',{model:'GigaChat/GigaChat-2-Max',temperature:0.3,systemPrompt:'Ты лиса.'})).json();
  assert.equal(v.active,true);assert.equal(v.activeModel,'GigaChat/GigaChat-2-Max');
  const t=await (await post('/api/llm/test',{})).json();
  assert.equal(t.ok,true);assert.match(t.reply,/на связи/);
  const chat=await (await post('/api/chat',{message:'Расскажи сказку'})).json();
  assert.equal(chat.source,'model');assert.match(chat.reply,/на связи/);
  const last=seen.at(-1).body;
  assert.equal(last.model,'GigaChat/GigaChat-2-Max');assert.equal(last.temperature,0.3);assert.match(last.messages[0].content,/^Ты лиса\./);assert.ok(last.tools.length>10);
  assert.equal(fs.statSync(path.join(dir,'llm-settings.json')).isFile(),true);
  v=await (await post('/api/llm',{clearKey:true,enabled:false})).json();
  assert.equal(v.hasKey,false);assert.equal(v.active,false);
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>fake.close(r))}
});
