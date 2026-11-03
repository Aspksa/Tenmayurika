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
