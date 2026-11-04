'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-collections-'));
process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_COLLECTIONS=path.join(dir,'collections.json');
const collections=require('../library-collections');
test('collections reference local files without moving or deleting originals',async()=>{try{
 await fs.mkdir(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});const file=path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'книга.txt');await fs.writeFile(file,'текст');
 const c=await collections.create('Проекты');await assert.rejects(()=>collections.create('проекты'));await collections.add(c.id,'книга.txt');await collections.add(c.id,'книга.txt');assert.deepEqual((await collections.list())[0].files,['книга.txt']);await assert.rejects(()=>collections.add(c.id,'../outside.txt'));
 await collections.remove(c.id,'книга.txt');await collections.add(c.id,'книга.txt');await collections.drop(c.id);assert.equal((await collections.list()).length,0);assert.equal(await fs.readFile(file,'utf8'),'текст');
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
