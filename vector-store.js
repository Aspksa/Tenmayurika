'use strict';
const path=require('node:path');
let database;
async function embed(text){
 if(!process.env.EMBEDDING_URL)return null;
 const response=await fetch(process.env.EMBEDDING_URL,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.EMBEDDING_API_KEY?{Authorization:'Bearer '+process.env.EMBEDDING_API_KEY}:{})},body:JSON.stringify({model:process.env.EMBEDDING_MODEL||'text-embedding-3-small',input:text}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Embedding API HTTP '+response.status);
 const data=await response.json(),v=data.data?.[0]?.embedding;
 if(!Array.isArray(v)||!v.length||!v.every(Number.isFinite))throw Error('Invalid embedding vector');
 return v;
}
async function connect(){if(!database){const lance=await import('@lancedb/lancedb');database=await lance.connect(path.join(__dirname,'data','vectors'))}return database}
async function syncNote(note){
 const vector=await embed(note.title+'\n'+(note.content||''));if(!vector)return {enabled:false,reason:'Embedding provider not configured'};
 const db=await connect();const record={id:note.id,title:note.title,content:note.content||'',vector};
 const names=await db.tableNames();
 if(!names.includes('notes')){await db.createTable('notes',[record]);return {enabled:true}}
 const table=await db.openTable('notes');await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([record]);return {enabled:true}
}
async function search(query,limit=10){const vector=await embed(query);if(!vector)return {results:[],reason:'Embedding provider not configured'};const db=await connect();if(!(await db.tableNames()).includes('notes'))return {results:[]};const table=await db.openTable('notes');return {results:await table.vectorSearch(vector).limit(Math.min(30,Math.max(1,limit))).toArray()}}
async function indexedIds(){const db=await connect();if(!(await db.tableNames()).includes('notes'))return new Set();const table=await db.openTable('notes');const rows=await table.query().select(['id']).toArray();return new Set(rows.map(row=>String(row.id)))}
async function hasNotesTable(){const db=await connect();return (await db.tableNames()).includes('notes')}
module.exports={syncNote,search,hasNotesTable,indexedIds};
