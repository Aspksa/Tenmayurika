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
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})}
});
