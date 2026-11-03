'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-learn-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
const {byRules,parseLines}=require('../learn');
test('rules find simple Russian facts without a model',()=>{
 const f=byRules('Кстати, Анна любит зелёный чай. У мамы день рождения 12 марта! Я живу в Казани. Погода хорошая.');
 assert.deepEqual(f,[{subject:'Анна',predicate:'любит',object:'зелёный чай'},{subject:'Мамы',predicate:'день рождения',object:'12 марта'},{subject:'Я',predicate:'живу в',object:'Казани'}]);
 assert.deepEqual(byRules('Анна живёт в Казани? Пётр живёт в Перми!'),[{subject:'Пётр',predicate:'живёт в',object:'Перми'}]);
 assert.deepEqual(byRules('Меня зовут Анна.'),[{subject:'Я',predicate:'зовут',object:'Анна'}]);
 assert.deepEqual(parseLines('FACT: Анна | любит | чай\n- FACT: | Кот | зовут | Мурзик\nNONE'),[{subject:'Анна',predicate:'любит',object:'чай'},{subject:'Кот',predicate:'зовут',object:'Мурзик'}]);
});
test('learn API proposes only unknown facts and never saves them itself',async()=>{
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port,post=(u,b)=>fetch(base+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  await post('/api/facts',{subject:'Анна',predicate:'любит',object:'зелёный чай'});
  const r=await (await post('/api/learn',{text:'Анна любит зелёный чай. Анна работает в больнице.',source:'chat'})).json();
  assert.equal(r.source,'rules');
  assert.deepEqual(r.facts,[{subject:'Анна',predicate:'работает в',object:'больнице'}]);
  assert.equal((await (await fetch(base+'/api/facts')).json()).length,1);
  assert.equal((await post('/api/learn',{text:''})).status,400);
  // Отставленный при разборе факт снова можно предложить.
  await post('/api/facts',{subject:'Анна',predicate:'живёт в',object:'Казань'});await post('/api/facts',{subject:'Анна',predicate:'живёт в',object:'Пермь'});
  const c=(await (await fetch(base+'/api/facts/conflicts')).json())[0];
  await post('/api/facts/conflicts/resolve',{id:c.id,keep:'newer'});
  assert.deepEqual((await (await post('/api/learn',{text:'Анна живёт в Казань.'})).json()).facts,[{subject:'Анна',predicate:'живёт в',object:'Казань'}]);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
