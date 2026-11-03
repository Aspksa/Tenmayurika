'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-chat-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
delete process.env.CHAT_URL;
const {server}=require('../server');
test('avatar chat answers locally from facts and UI assets are served',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const json={'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/facts',{method:'POST',headers:json,body:JSON.stringify({subject:'Юрика',predicate:'любит',object:'чай матча'})})).status,201);
  const chat=await fetch(base+'/api/chat',{method:'POST',headers:json,body:JSON.stringify({message:'Что любит Юрика?',avatar:'Юрика'})});
  assert.equal(chat.status,200);
  const data=await chat.json();
  assert.equal(data.source,'local');
  assert.match(data.reply,/чай матча/);
  assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:json,body:JSON.stringify({message:'  '})})).status,400);
  const avatar=await fetch(base+'/assets/avatars/kitsune-stand.webp');
  assert.equal(avatar.status,200);
  assert.equal(avatar.headers.get('content-type'),'image/webp');
  assert.ok((await avatar.arrayBuffer()).byteLength>1000);
  assert.equal((await fetch(base+'/assets/avatars/missing.webp')).status,404);
  assert.equal((await fetch(base+'/assets/avatars/..%2F..%2Fserver.js')).status,404);
  assert.equal((await fetch(base+'/avatar.js')).status,200);
  assert.equal((await fetch(base+'/favicon.svg')).headers.get('content-type'),'image/svg+xml');
 }finally{await new Promise(resolve=>server.close(resolve))}
});
