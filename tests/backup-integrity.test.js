'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {verify}=require('../tools/verify-backup');
test('verify backup accepts valid SQLite and rejects corrupted data',{timeout:15000},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-backup-'));
 try{
  const name='tenmayurika-1000-1234abcd.sqlite',file=path.join(dir,name);
  const db=new DatabaseSync(file);
  db.exec('CREATE TABLE example(id INTEGER PRIMARY KEY); INSERT INTO example VALUES(1)');
  db.close();
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.writeFileSync(file+'.sha256',hash+'  '+name+'\n');
  assert.equal(verify(file).ok,true);
  fs.appendFileSync(file,'tampered');
  assert.throws(()=>verify(file),/Контрольная сумма/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
