'use strict';
const crypto=require('node:crypto');
let driver;
async function connect(){
 if(!process.env.NEO4J_BOLT_URL)return;
 const neo4j=require('neo4j-driver');
 driver=neo4j.driver(process.env.NEO4J_BOLT_URL,neo4j.auth.basic(process.env.NEO4J_USER||'neo4j',process.env.NEO4J_PASSWORD||''));
 await driver.verifyConnectivity();
 const session=driver.session();
 try{await session.run('CREATE CONSTRAINT tenmayurika_note_id IF NOT EXISTS FOR (n:TenmayurikaNote) REQUIRE n.id IS UNIQUE')}finally{await session.close()}
}
async function syncNote(note){
 if(!driver)return {enabled:false};
 const session=driver.session();
 try{
  await session.executeWrite(tx=>tx.run('MERGE (n:TenmayurikaNote {id:$id}) SET n.title=$title, n.content=$content, n.updatedAt=$updatedAt',{id:note.id,title:note.title,content:note.content,updatedAt:new Date().toISOString()}));
  return {enabled:true,ok:true}
 }finally{await session.close()}
}
async function close(){if(driver)await driver.close()}
module.exports={connect,syncNote,close};
