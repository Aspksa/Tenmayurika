'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-tools-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
const {parseCommand}=require('../chat');
test('chat commands are parsed into tools',()=>{
 assert.deepEqual(parseCommand('заметка: Чай — матча с молоком'),{fn:'add_note',args:{title:'Чай',content:'матча с молоком'}});
 assert.deepEqual(parseCommand('дело: купить чай'),{fn:'add_task',args:{title:'купить чай'}});
 assert.deepEqual(parseCommand('готово: купить чай'),{fn:'complete_task',args:{title:'купить чай'}});
 assert.equal(parseCommand('мои дела').fn,'list_tasks');
 assert.deepEqual(parseCommand('запомни Анна | живёт в | Казань').args,{subject:'Анна',predicate:'живёт в',object:'Казань'});
 assert.ok(parseCommand('запомни что-то').error);
 assert.deepEqual(parseCommand('открой дела'),{fn:'open_page',args:{page:'tasks'}});
 assert.equal(parseCommand('найди Анна').fn,'search_memory');
 assert.equal(parseCommand('сделай резервную копию').fn,'create_backup');
 assert.equal(parseCommand('который час?').fn,'current_time');
 assert.equal(parseCommand('как дела у лисы в лесу'),null);
});
test('avatar tools act through the chat API and respect disabled tools',async()=>{
 const {server}=require('../server');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const say=async(message,tools)=>(await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,tools})})).json();
  const unique='Тест-дело '+Date.now();
  const added=await say('дело: '+unique);
  assert.equal(added.changed,true);assert.deepEqual(added.tools,['add_task']);
  assert.match((await say('мои дела')).reply,new RegExp(unique));
  const done=await say('готово: '+unique);
  assert.match(done.reply,/выполненным/);
  const fact=await say('запомни Лиса | живёт в | Инари');
  assert.match(fact.reply,/Запомнила/);
  assert.match((await say('найди Инари')).reply,/Лиса — живёт в → Инари/);
  const nav=await say('открой факты');
  assert.deepEqual(nav.actions,[{type:'navigate',page:'facts'}]);
  const blocked=await say('дело: нельзя',['clock']);
  assert.match(blocked.reply,/выключен/);assert.equal(blocked.changed,false);
  assert.match((await say('помощь',['clock'])).reply,/Дата и время/);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
test('fact retrieval ranks the subject above many matches of a common word',async()=>{
 const memory=require('../memory-core'),{reply}=require('../chat');
 memory.addFact({subject:'Юрика',predicate:'любит',object:'матча',sourceId:'test'});
 for(let i=0;i<12;i++)memory.addFact({subject:'Гость'+i,predicate:'любит',object:'кофе',sourceId:'test'});
 const r=await reply({message:'Что любит Юрика?'});
 assert.match(r.reply,/Юрика — любит → матча/);
});
test('overlong messages are rejected instead of truncated',async()=>{
 const {reply}=require('../chat');
 await assert.rejects(reply({message:'заметка: Длинная — '+'я'.repeat(2500)}),TypeError);
});
test('completed tool work is reported when a later model round fails',async()=>{
 const http=require('node:http'),{reply}=require('../chat');let calls=0;
 const fake=http.createServer((req,res)=>{calls++;req.resume();req.on('end',()=>{if(calls===1){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'add_task',arguments:JSON.stringify({title:'купить чай'})}}]}}]}))}else{res.writeHead(500);res.end('{}')}})});
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 process.env.CHAT_URL='http://127.0.0.1:'+fake.address().port+'/v1/chat/completions';
 const created=[];
 try{
  const r=await reply({message:'запиши мне купить чай пожалуйста'},{addItem:(c,t)=>{created.push(t);return {title:t}},setTaskDone(){}});
  assert.deepEqual(created,['купить чай']);
  assert.equal(r.fallback,true);assert.equal(r.changed,true);
  assert.match(r.reply,/уже сделано:[\s\S]*купить чай/);
  assert.equal('done' in r,false);
 }finally{delete process.env.CHAT_URL;await new Promise(r=>fake.close(r))}
});
test('extra tools: calculator, reminders, avatar look, fun',async()=>{
 const {reply,parseCommand}=require('../chat');
 assert.match((await reply({message:'посчитай (2+3)*4^2'})).reply,/= 80$/);
 assert.match((await reply({message:'посчитай 1/0'})).reply,/ноль/);
 const r=await reply({message:'напомни через 10 минут выпить чай'});
 assert.equal(r.actions[0].type,'reminder');assert.equal(r.actions[0].text,'выпить чай');assert.ok(Math.abs(r.actions[0].at-Date.now()-600000)<5000);
 assert.equal(parseCommand('помодоро').args.minutes,25);
 assert.deepEqual((await reply({message:'эффект сакура'})).actions,[{type:'avatar',look:{particleType:'petals'}}]);
 assert.deepEqual((await reply({message:'цвет синий'})).actions[0].look,{glowColor:'#6fd6ff'});
 assert.deepEqual((await reply({message:'поза поклон'})).actions[0].look,{pose:'bow'});
 assert.match((await reply({message:'брось кубик'})).reply,/Выпало [1-6]/);
 assert.match((await reply({message:'монетка'})).reply,/Орёл|Решка/);
 assert.match((await reply({message:'эффект сакура',tools:['notes']})).reply,/выключен/);
});
