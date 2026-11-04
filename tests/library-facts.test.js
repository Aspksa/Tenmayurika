'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-facts-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_COLLECTIONS=path.join(dir,'collections.json');
const library=require('../library'),collections=require('../library-collections'),analysis=require('../library-analysis');
test('local fact proposals require confirmation, retain source and ignore questions',async()=>{try{
 const root=process.env.TENMAYURIKA_LIBRARY_DIR;await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'данные.txt'),'Анна живёт в Перми.\nАнна любит чай?\nЗавод находится в Артёме.');
 const candidates=await analysis.proposeFacts('данные.txt');assert.equal(candidates.items.length,2);assert.equal(candidates.items[0].subject,'Анна');assert.equal((await collections.facts()).length,0);
 const f=candidates.items[0];const fact=await collections.addFact('данные.txt',f.subject,f.predicate,f.object,f.quote);assert.equal((await collections.facts()).length,1);assert.equal((await collections.addFact('данные.txt',f.subject,f.predicate,f.object,f.quote)).id,fact.id);
 await assert.rejects(()=>collections.addFact('../секрет',f.subject,f.predicate,f.object,''));await library.renameFile('данные.txt','проверено.txt',collections.replacePath);assert.equal((await collections.facts())[0].source,'проверено.txt');await collections.deleteFact(fact.id);assert.equal((await collections.facts()).length,0);assert.ok(await fs.readFile(path.join(root,'проверено.txt'),'utf8'));
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
