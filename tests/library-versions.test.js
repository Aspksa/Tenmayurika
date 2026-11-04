'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{Readable}=require('node:stream');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-version-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_VERSIONS=path.join(dir,'versions');
const versions=require('../library-versions');
test('replacement preserves prior version and interrupted upload preserves original',async()=>{try{
 const root=process.env.TENMAYURIKA_LIBRARY_DIR;await fs.mkdir(root,{recursive:true});const original=path.join(root,'договор.txt');await fs.writeFile(original,'старая версия');
 async function* broken(){yield Buffer.from('часть');throw Error('connection lost')}
 await assert.rejects(()=>versions.replace('договор.txt',Readable.from(broken())));assert.equal(await fs.readFile(original,'utf8'),'старая версия');
 const done=await versions.replace('договор.txt',Readable.from(['новая версия']));assert.equal(await fs.readFile(original,'utf8'),'новая версия');assert.equal((await versions.list('договор.txt')).length,1);const backup=await versions.file(done.backup);assert.equal(await fs.readFile(backup.full,'utf8'),'старая версия');await assert.rejects(()=>versions.file('../secret'));await assert.rejects(()=>versions.replace('../secret',Readable.from(['bad'])));
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
