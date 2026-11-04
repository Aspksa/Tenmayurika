'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenma-guardian-'));
process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_QUEUE=path.join(dir,'queue.json');process.env.TENMAYURIKA_LIBRARY_JOURNAL=path.join(dir,'journal.jsonl');process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'memory.sqlite');process.env.TENMAYURIKA_GUARDIAN_MEMORY=path.join(dir,'guardian.json');process.env.TENMAYURIKA_LIBRARY_COLLECTIONS=path.join(dir,'collections.json');
const activity=require('../guardian-activity'),{server}=require('../server');
test('guardian endpoint exposes actual activity and local journal on request',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const base='http://127.0.0.1:'+server.address().port;let data=await (await fetch(base+'/api/brain/guardian')).json();assert.deepEqual(data.active,[]);assert.equal(data.queue.enabled,true);
 const id=activity.start('ocr',{file:'scan.pdf'});activity.update(id,{page:2,total:3});data=await (await fetch(base+'/api/brain/guardian')).json();assert.equal(data.active[0].file,'scan.pdf');assert.equal(data.active[0].page,2);assert.equal(data.active[0].total,3);activity.finish(id);data=await (await fetch(base+'/api/brain/guardian?journal=1')).json();assert.equal(data.active.length,0);assert.equal(data.history[0].result,'done');assert.ok(Array.isArray(data.journal));
 const post=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let response=await post('/api/library/guardian-rule',{keyword:'договор',folder:'Договоры'});assert.equal(response.status,200);const rule=await response.json();data=await (await fetch(base+'/api/library/guardian-memory')).json();assert.equal(data.rules[0].folder,'Договоры');response=await post('/api/library/guardian-rule/delete',{id:rule.id});assert.equal(response.status,200);data=await (await fetch(base+'/api/brain/guardian?journal=1')).json();
 assert.equal(data.memory.rules,0);
 }finally{await new Promise(resolve=>server.close(resolve));await fsp.rm(dir,{recursive:true,force:true})}
});
