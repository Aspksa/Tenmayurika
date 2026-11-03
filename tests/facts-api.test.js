'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-facts-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
const {server}=require('../server');
test('facts API stores, searches, relates and reports conflicts',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const post=fact=>fetch(base+'/api/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fact)});
  const first=await post({subject:'Анна',predicate:'живёт в',object:'Казань'});
  assert.equal(first.status,201);
  assert.equal((await first.json()).duplicate,false);
  const again=await post({subject:'Анна',predicate:'живёт в',object:'Казань'});
  assert.equal(again.status,200);
  assert.equal((await again.json()).duplicate,true);
  const conflict=await (await post({subject:'Анна',predicate:'живёт в',object:'Пермь'})).json();
  assert.equal(conflict.conflicts,1);
  assert.equal((await post({subject:'',predicate:'x',object:'y'})).status,400);
  assert.equal((await post(null)).status,400);
  const found=await (await fetch(base+'/api/facts?q='+encodeURIComponent('казань'))).json();
  assert.equal(found.length,1);
  assert.equal(found[0].source_id,'manual');
  assert.equal((await (await fetch(base+'/api/facts')).json()).length,2);
  assert.equal((await (await fetch(base+'/api/facts/relations?subject='+encodeURIComponent('Анна'))).json()).length,2);
  const conflicts=await (await fetch(base+'/api/facts/conflicts')).json();
  assert.equal(conflicts.length,1);
  assert.equal(conflicts[0].newer,'Пермь');
  assert.equal((await fetch(base+'/api/facts?limit=0')).status,400);
  assert.equal((await fetch(base+'/api/facts/relations')).status,400);
  assert.equal((await (await fetch(base+'/api/facts/diagnostics')).json()).integrity,'ok');
  // Разбор противоречия: «новее вернее» — старый факт уходит в историю и пропадает из поиска.
  const resolve=b=>fetch(base+'/api/facts/conflicts/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await resolve({id:conflicts[0].id,keep:'maybe'})).status,400);
  assert.equal((await resolve({id:'нет-такого',keep:'newer'})).status,404);
  const done=await resolve({id:conflicts[0].id,keep:'newer'});
  assert.equal(done.status,200);
  assert.equal((await done.json()).retired,conflicts[0].earlier_id);
  assert.equal((await (await fetch(base+'/api/facts/conflicts')).json()).length,0);
  assert.equal((await (await fetch(base+'/api/facts?q='+encodeURIComponent('казань'))).json()).length,0);
  assert.equal((await (await fetch(base+'/api/facts?q='+encodeURIComponent('пермь'))).json()).length,1);
  // Отставленный факт не попадает в «связи», а добавленный снова — возвращается в память.
  assert.equal((await (await fetch(base+'/api/facts/relations?subject='+encodeURIComponent('Анна'))).json()).some(f=>f.object==='Казань'),false);
  const back=await (await post({subject:'Анна',predicate:'живёт в',object:'Казань'})).json();
  assert.equal(back.duplicate,false);assert.equal(back.restored,true);assert.equal(back.conflicts,1);
  assert.equal((await (await fetch(base+'/api/facts?q='+encodeURIComponent('казань'))).json()).length,1);
  const again2=(await (await fetch(base+'/api/facts/conflicts')).json()).find(c=>c.predicate==='живёт в');
  assert.equal((await (await resolve({id:again2.id,keep:'newer'})).json()).retired,again2.earlier_id);
  // «Оба верны» снимает противоречие, ничего не убирая.
  await post({subject:'Анна',predicate:'любит',object:'чай'});await post({subject:'Анна',predicate:'любит',object:'кофе'});
  const both=(await (await fetch(base+'/api/facts/conflicts')).json())[0];
  if(both){assert.equal((await (await resolve({id:both.id,keep:'both'})).json()).retired,null);assert.equal((await (await fetch(base+'/api/facts?q='+encodeURIComponent('чай'))).json()).length,1)}
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})}
});
