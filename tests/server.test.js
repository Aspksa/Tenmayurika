'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
test('local server exposes health and denies private files',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const health=await fetch(base+'/api/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  assert.equal((await fetch(base+'/server.js')).status,404);
  assert.equal((await fetch(base+'/data/workspace.json')).status,404);
  assert.equal((await fetch(base+'/')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
