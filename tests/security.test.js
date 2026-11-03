'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
const http=require('node:http');
// fetch() cannot override the Host header, so send the spoofed Host through node:http.
function statusWithHost(port,path,host){return new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path,headers:{Host:host}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)})}
test('rejects untrusted host and origin',async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const port=server.address().port,base='http://127.0.0.1:'+port;
  assert.equal(await statusWithHost(port,'/api/health','attacker.example'),403);
  const badOrigin=await fetch(base+'/api/items',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(badOrigin.status,403);
  const malformed=await fetch(base+'/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
