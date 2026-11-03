'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
test('database status does not expose credentials',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/services');
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(typeof data.postgresql.configured,'boolean');
  assert.equal(typeof data.qdrant.configured,'boolean');
  assert.equal(typeof data.neo4j.configured,'boolean');
  assert.equal(JSON.stringify(data).includes('PASSWORD='),false);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
