'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenma-private-library-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');process.env.TENMAYURIKA_DATA_DIR=dir;process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');
const {reply}=require('../chat'),chatlog=require('../chatlog');
for(const key of ['innerVoice','verify'])require('../thoughts').setSetting(key,false);
test('library chat results never enter chat history sent to model',async()=>{
 fs.mkdirSync(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'договор.txt'),'уникальный секретный текст');
 const user='найди в библиотеке уникальный секретный текст';let payload='';
 const server=http.createServer((req,res)=>{req.setEncoding('utf8');req.on('data',s=>payload+=s);req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Привет!'}}]}))})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.CHAT_URL='http://127.0.0.1:'+server.address().port+'/v1/chat/completions';
 try{
  const first=await reply({message:user});assert.equal(first.secret,true);assert.match(first.reply,/договор\.txt/);assert.equal(payload,'');assert.equal(chatlog.recent(30).some(x=>x.text.includes('секретный текст')),false);
  await reply({message:'Расскажи про погоду',history:[{role:'user',text:user},{role:'assistant',text:first.reply}]});assert.ok(payload);assert.doesNotMatch(payload,/секретный текст|договор\.txt/);
 }finally{delete process.env.CHAT_URL;await new Promise(r=>server.close(r))}
});
