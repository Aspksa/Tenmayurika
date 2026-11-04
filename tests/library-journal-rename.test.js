'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-rename-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_COLLECTIONS=path.join(dir,'collections.json');process.env.TENMAYURIKA_LIBRARY_JOURNAL=path.join(dir,'journal.jsonl');
const library=require('../library'),collections=require('../library-collections'),journal=require('../library-journal');
test('rename preserves data and collection links, blocks overwriting and journals metadata',async()=>{try{
 await fs.mkdir(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});const root=process.env.TENMAYURIKA_LIBRARY_DIR;await fs.writeFile(path.join(root,'старое.txt'),'личное содержимое');await fs.writeFile(path.join(root,'занято.txt'),'не менять');
 const c=await collections.create('Тема');await collections.add(c.id,'старое.txt');await assert.rejects(()=>library.renameFile('старое.txt','занято.txt',collections.replacePath),{code:'EEXIST'});assert.equal(await fs.readFile(path.join(root,'занято.txt'),'utf8'),'не менять');
 const moved=await library.renameFile('старое.txt','новое.txt',collections.replacePath);assert.equal(moved.path,'новое.txt');assert.equal(await fs.readFile(path.join(root,'новое.txt'),'utf8'),'личное содержимое');assert.deepEqual((await collections.list())[0].files,['новое.txt']);await assert.rejects(()=>fs.stat(path.join(root,'старое.txt')),{code:'ENOENT'});
 await assert.rejects(()=>library.renameFile('новое.txt','/bad',collections.replacePath));await assert.rejects(()=>library.renameFile('новое.txt','временное.txt',async()=>{throw Error('fail')}));await assert.rejects(()=>fs.stat(path.join(root,'временное.txt')),{code:'ENOENT'});
 await journal.record('file_renamed',{path:'старое.txt',target:'новое.txt',content:'НЕ СОХРАНЯТЬ'});const entries=await journal.recent();assert.equal(entries[0].target,'новое.txt');assert.equal(JSON.stringify(entries).includes('НЕ СОХРАНЯТЬ'),false);
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
