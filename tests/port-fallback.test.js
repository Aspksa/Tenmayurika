'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
test('doctor finds next free port when preferred port is occupied',{timeout:30000},async()=>{
 const server=net.createServer();
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 if(port>65504){server.close();return}
 try{
  const child=spawn(process.execPath,[path.join(__dirname,'..','tools','launcher.js'),'doctor'],{env:{...process.env,PORT:String(port)},cwd:path.join(__dirname,'..'),windowsHide:true});
  let output='';
  for await(const chunk of child.stdout)output+=chunk;
  const code=await new Promise(resolve=>child.once('exit',resolve));
  assert.equal(code,0,'doctor failed');
  assert.match(output,/Свободный порт:/);
  assert.doesNotMatch(output,new RegExp('Свободный порт: '+port+'(?:\\D|$)'));
 }finally{await new Promise(resolve=>server.close(resolve))}
});
