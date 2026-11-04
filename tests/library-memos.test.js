'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-memos-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_COLLECTIONS=path.join(dir,'collections.json');
const library=require('../library'),collections=require('../library-collections');
test('private notes and tasks retain source across rename and stay local',async()=>{try{
 const root=process.env.TENMAYURIKA_LIBRARY_DIR;await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'договор.txt'),'содержимое');
 const note=await collections.addMemo('договор.txt','note','Проверить условия','');const task=await collections.addMemo('договор.txt','task','Подготовить отчёт','2027-12-15');assert.equal((await collections.memos()).length,2);await assert.rejects(()=>collections.addMemo('../secret','note','текст',''));await assert.rejects(()=>collections.addMemo('договор.txt','task','срок','2027-02-30'));
 await collections.changeMemo(task.id,'toggle');assert.equal((await collections.memos()).find(x=>x.id===task.id).done,true);await library.renameFile('договор.txt','версия.txt',collections.replacePath);assert.equal((await collections.memos()).find(x=>x.id===note.id).source,'версия.txt');await collections.changeMemo(note.id,'delete');assert.equal(await fs.readFile(path.join(root,'версия.txt'),'utf8'),'содержимое');
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
