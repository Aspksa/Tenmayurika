'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-index-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_QUEUE=path.join(dir,'queue.json');process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'memory.sqlite');
process.env.TENMAYURIKA_GUARDIAN_MEMORY=path.join(dir,'guardian.json');
const queue=require('../library-queue'),index=require('../library-index');
test('local index finds processed files and excludes stale or removed entries',async()=>{try{
 await fs.mkdir(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});const file=path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'договор.txt');await fs.writeFile(file,'Условие: перевозка щебня по договору.');await queue.scan();assert.equal((await index.search('перевозка')).results.length,0);await queue.run();let result=await index.search('перевозка');assert.equal(result.results[0].path,'договор.txt');assert.match(result.results[0].excerpt,/щебня/);
 await fs.writeFile(file,'Новые данные и другой размер текста');result=await index.search('перевозка');assert.equal(result.results.length,0);assert.equal(result.stale,1);await queue.scan();await queue.run();assert.equal((await index.search('данные')).results[0].path,'договор.txt');await fs.unlink(file);await queue.scan();assert.equal((await index.search('данные')).results.length,0);assert.equal((await index.search('" OR *')).results.length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
