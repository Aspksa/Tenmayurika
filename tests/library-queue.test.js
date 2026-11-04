'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-queue-'));
process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_QUEUE=path.join(dir,'queue.json');
process.env.TENMAYURIKA_GUARDIAN_MEMORY=path.join(dir,'guardian.json');
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'memory.sqlite');
const queue=require('../library-queue'),activity=require('../guardian-activity');
test('queue tracks local files, changes, failures and retries',async()=>{try{
 await fs.mkdir(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});const file=path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'заметка.txt');
 await fs.writeFile(file,'Первая строка');await fs.writeFile(path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'bad.docx'),'не архив');
 await queue.scan();assert.equal((await queue.status()).counts.queued,2);await queue.run(10);let s=await queue.status();assert.equal(s.counts.ready,1);assert.equal(s.counts.queued,1);assert.ok(activity.snapshot().history.some(x=>x.kind==='read'&&x.file==='заметка.txt'&&x.result==='done'));assert.ok(activity.snapshot().history.some(x=>x.kind==='read'&&x.file==='bad.docx'&&x.result==='error'));
 await queue.run(10);await queue.run(10);s=await queue.status();assert.equal(s.counts.error,1);await queue.retry('bad.docx');assert.equal((await queue.status()).counts.queued,1);
 await queue.setEnabled(false);assert.equal((await queue.run()).disabled,true);await fs.writeFile(file,'Обновлённый документ');await queue.scan();s=await queue.status();assert.equal(s.counts.queued,2);assert.equal(s.enabled,false);
 await fs.unlink(file);await queue.scan();assert.equal((await queue.status()).counts.queued,1);assert.equal(JSON.parse(await fs.readFile(process.env.TENMAYURIKA_LIBRARY_QUEUE,'utf8')).enabled,false);
 }finally{await fs.rm(dir,{recursive:true,force:true})}});

