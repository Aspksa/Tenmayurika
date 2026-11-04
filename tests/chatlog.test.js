'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-chatlog-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
const chatlog=require('../chatlog'),memory=require('../memory-core');

test('whole chat is stored and learned in the background',async()=>{
 const {server}=require('../server');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const say=async message=>(await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})})).json();
  const first=await say('Кстати, моя сестра Оля живёт в Казани.');
  assert.equal(first.autoLearn,true);
  await say('дело: позвонить Оле');
  // Фоновый проход мог уже начаться сам: ждём, пока очередь опустеет.
  for(let i=0;i<50&&chatlog.stats().pending;i++){await chatlog.learnPending();await new Promise(r=>setTimeout(r,20))}
  const facts=memory.queryFacts({limit:50});
  assert.ok(facts.some(f=>/Оля/.test(f.subject)&&f.object==='Казани'&&f.source_id.startsWith('chat:')),'факт из чата запомнен сам');
  // Команда не разбирается как факт.
  assert.ok(!facts.some(f=>/позвонить/i.test(f.subject+f.object)));
  const st=await (await fetch(base+'/api/chatlog')).json();
  assert.ok(st.messages>=4);assert.equal(st.pending,0);assert.ok(st.facts>=1);
  // Сказанное раньше находится в прошлых разговорах.
  const ans=await say('в каком городе сестра Оля?');
  assert.match(ans.reply,/Вы говорили мне раньше/);
  assert.match(ans.reply,/сестра Оля живёт в Казани/);
  // Выключили — новые сообщения ждут, пока не включат снова.
  assert.equal((await (await fetch(base+'/api/chatlog/auto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:false})})).json()).auto,false);
  const off=await say('Мой брат Петя работает в Сбере.');
  assert.equal(off.autoLearn,false);
  assert.equal((await chatlog.learnPending()).processed,0);
  assert.ok(chatlog.stats().pending>=1);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
