'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {verify}=require('../tools/verify-complete');
test('complete snapshot verifier detects changed files',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-full-'));
 try{
  const sqlite=path.join(folder,'tenmayurika.sqlite'),db=new DatabaseSync(sqlite);
  db.exec('CREATE TABLE item(id INTEGER)');db.close();
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(sqlite)).digest('hex');
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({files:[{path:'tenmayurika.sqlite',sha256}]}));
  assert.equal(verify(folder).ok,true);
  fs.appendFileSync(sqlite,'changed');
  assert.throws(()=>verify(folder),/Контрольная сумма/);
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
