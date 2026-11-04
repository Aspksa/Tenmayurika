'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-health-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_COLLECTIONS=path.join(dir,'collections.json');process.env.TENMAYURIKA_LIBRARY_QUEUE=path.join(dir,'queue.json');
const library=require('../library'),collections=require('../library-collections'),health=require('../library-health');
test('health reports missing references and fallback rename keeps the original',async()=>{try{
 await fs.mkdir(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});const root=process.env.TENMAYURIKA_LIBRARY_DIR;await fs.writeFile(path.join(root,'оригинал.txt'),'важные данные');const c=await collections.create('Книги');await collections.add(c.id,'оригинал.txt');
 const oldLink=fs.link;fs.link=async()=>{const e=Error('unsupported');e.code='ENOTSUP';throw e};let result;try{result=await library.renameFile('оригинал.txt','новое.txt',collections.replacePath)}finally{fs.link=oldLink}
 assert.equal(result.originalRetained,true);assert.equal(await fs.readFile(path.join(root,'оригинал.txt'),'utf8'),'важные данные');assert.equal(await fs.readFile(path.join(root,'новое.txt'),'utf8'),'важные данные');assert.deepEqual((await collections.list())[0].files,['новое.txt']);
 await fs.unlink(path.join(root,'новое.txt'));const info=await health.check();assert.equal(info.files,1);assert.deepEqual(info.missing,[{collection:'Книги',path:'новое.txt'}]);assert.ok(info.freeBytes===null||BigInt(info.freeBytes)>0n);
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
