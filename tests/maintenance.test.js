'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {checkDisk,maintenance}=require('../tools/maintenance');
test('disk preflight validates writable temporary folder',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-disk-'));
 try{assert.equal(checkDisk(dir).ok,true);assert.deepEqual(fs.readdirSync(dir),[])}
 finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('maintenance never removes SQLite or backup files',()=>{
 const root=path.resolve(__dirname,'..');
 const data=path.join(root,'data');
 fs.mkdirSync(data,{recursive:true});
 const filename='.disk-probe-test-'+process.pid;
 const probe=path.join(data,filename);
 const sqlite=path.join(data,'test-preserve-'+process.pid+'.sqlite');
 try{
  fs.writeFileSync(probe,'old');
  fs.writeFileSync(sqlite,'keep');
  const old=new Date(Date.now()-10*86400000);
  fs.utimesSync(probe,old,old);
  fs.utimesSync(sqlite,old,old);
  maintenance();
  assert.equal(fs.existsSync(probe),false);
  assert.equal(fs.readFileSync(sqlite,'utf8'),'keep');
 }finally{for(const f of [probe,sqlite])try{fs.unlinkSync(f)}catch{}}
});
