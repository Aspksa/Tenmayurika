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
const documents=require('../library-documents');
test('library stores, lists and finds files in nested folders without overwriting',async()=>{
 try{
  await lib.mkdir('Книги');
  await lib.upload('Книги/план.txt',Readable.from(['Содержание']));
  const rows=await lib.list('Книги');assert.equal(rows[0].name,'план.txt');
  assert.equal(await fs.readFile(await lib.filePath('Книги/план.txt'),'utf8'),'Содержание');
  await assert.rejects(()=>lib.upload('Книги/план.txt',Readable.from(['new'])),{code:'EEXIST'});
  assert.equal(await fs.readFile(await lib.filePath('Книги/план.txt'),'utf8'),'Содержание');
  assert.deepEqual((await lib.search('ПЛАН')).results.map(x=>x.path),['Книги/план.txt']);
  const found=await lib.searchText('ДЕРЖАН');assert.equal(found.results.length,1);assert.equal(found.results[0].path,'Книги/план.txt');assert.equal(found.results[0].line,1);
  assert.equal((await lib.searchText('отсутствующая фраза')).results.length,0);
  await assert.rejects(()=>lib.searchText('  '));
  await lib.upload('Книги/копия.txt',Readable.from(['Содержание']));
  const duplicate=await lib.duplicates();assert.equal(duplicate.groups.length,1);assert.deepEqual(duplicate.groups[0].map(x=>x.path).sort(),['Книги/копия.txt','Книги/план.txt']);
  assert.equal((await documents.describe('Книги/план.txt')).excerpt[0],'Содержание');
  assert.equal((await documents.compare('Книги/копия.txt','Книги/план.txt')).identical,true);
  await lib.upload('Книги/другой.txt',Readable.from(['Иной текст']));
  const diff=await documents.compare('Книги/другой.txt','Книги/план.txt');assert.equal(diff.changedLines,1);assert.equal(diff.changes[0].line,1);
  await assert.rejects(()=>documents.describe('../secret.txt'));
  await assert.rejects(()=>lib.list('../'));await assert.rejects(()=>lib.upload('Книги/../x',Readable.from(['x'])));
  if(process.platform!=='win32'){await fs.symlink(os.tmpdir(),path.join(dir,'outside'));await assert.rejects(()=>lib.list('outside'));assert.equal((await lib.list('')).some(x=>x.name==='outside'),false)}
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
