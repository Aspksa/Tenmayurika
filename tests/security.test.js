'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
test('rejects untrusted host and origin',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const port=server.address().port,base='http://127.0.0.1:'+port;
  const badHost=await fetch(base+'/api/health',{headers:{Host:'attacker.example'}});
  assert.equal(badHost.status,403);
  const badOrigin=await fetch(base+'/api/items',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(badOrigin.status,403);
  const malformed=await fetch(base+'/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
