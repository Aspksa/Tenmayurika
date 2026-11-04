'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-library-'));
process.env.TENMAYURIKA_LIBRARY_DIR=dir;
const lib=require('../library');
test('library stores, lists and finds files in nested folders without overwriting',async()=>{
 try{
  await lib.mkdir('Книги');
  await lib.upload('Книги/план.txt',Readable.from(['Содержание']));
  const rows=await lib.list('Книги');assert.equal(rows[0].name,'план.txt');
  assert.equal(await fs.readFile(await lib.filePath('Книги/план.txt'),'utf8'),'Содержание');
  await assert.rejects(()=>lib.upload('Книги/план.txt',Readable.from(['new'])),{code:'EEXIST'});
  assert.equal(await fs.readFile(await lib.filePath('Книги/план.txt'),'utf8'),'Содержание');
  assert.deepEqual((await lib.search('ПЛАН')).results.map(x=>x.path),['Книги/план.txt']);
  await assert.rejects(()=>lib.list('../'));await assert.rejects(()=>lib.upload('Книги/../x',Readable.from(['x'])));
  if(process.platform!=='win32'){await fs.symlink(os.tmpdir(),path.join(dir,'outside'));await assert.rejects(()=>lib.list('outside'));assert.equal((await lib.list('')).some(x=>x.name==='outside'),false)}
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
