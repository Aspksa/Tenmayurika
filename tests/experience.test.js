'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-exp-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
const experience=require('../experience');

test('feedback words are detected',()=>{
 assert.equal(experience.detect('нет, я имела в виду Анну из Казани'),'fix');
 assert.equal(experience.detect('Не то'),'fix');
 assert.equal(experience.detect('верно, спасибо'),'ok');
 assert.equal(experience.detect('нетфликс посоветуй'),null);
 assert.equal(experience.detect('где живёт Анна?'),null);
});

test('avatar remembers how she understood questions and learns from corrections',async()=>{
 const {server}=require('../server');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const say=async body=>(await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
  await say({message:'запомни Мурка | любит | сметану'});
  const first=await say({message:'что любит кошка Мурка?'});
  assert.ok(first.experience.id,'эпизод записан');
  assert.equal(first.recalled.facts.length,1);
  // Похожий вопрос другими словами: «Мурка» уже не названа, но опыт помнит, что тогда нашлось.
  const again=await say({message:'что любит кошка?'});
  assert.deepEqual(again.experience.used,[first.experience.id]);
  assert.deepEqual(again.recalled.facts,first.recalled.facts);
  assert.match(again.reply,/сметану/);
  // Поправка словами относится к последнему ответу.
  await say({message:'нет, я про кошку соседки Люси'});
  const items=(await (await fetch(base+'/api/experience?limit=10')).json()).items;
  const fixed=items.find(e=>e.id===again.experience.id);
  assert.equal(fixed.feedback,'fix');
  assert.match(fixed.correction,/соседки Люси/);
  // На следующий похожий вопрос поправка звучит в ответе, а поправленный эпизод не подтягивает старые записи.
  const later=await say({message:'что любит кошка?'});
  assert.match(later.reply,/поправили: «нет, я про кошку соседки Люси»/);
  // Отвергнутую запись не возвращает ни поиск, ни более ранний похожий эпизод.
  assert.doesNotMatch(later.reply,/сметану/);
  assert.deepEqual(later.recalled.facts,[]);
  // Неудачное действие инструмента — неудачный опыт.
  const miss=await say({message:'готово: несуществующее дело '+Date.now()});
  const missEp=(await (await fetch(base+'/api/experience?limit=5')).json()).items.find(e=>e.id===miss.experience.id);
  assert.equal(missEp.ok,false);
  // Явная оценка кнопкой и поправка следующим сообщением.
  const ok=await fetch(base+'/api/experience/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:first.experience.id,kind:'ok'})});
  assert.equal(ok.status,200);
  const bad=await fetch(base+'/api/experience/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'x',kind:'maybe'})});
  assert.equal(bad.status,400);
  await say({message:'Мурка любит рыбу',correctionFor:later.experience.id});
  const after=(await (await fetch(base+'/api/experience?limit=20')).json());
  assert.equal(after.items.find(e=>e.id===later.experience.id).correction,'Мурка любит рыбу');
  assert.ok(after.stats.corrected>=2);
  const log=await say({message:'чему ты научилась'});
  assert.match(log.reply,/Чему вы меня научили/);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
