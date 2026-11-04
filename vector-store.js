'use strict';
const path=require('node:path');
// Векторы лежат рядом с базой: TENMAYURIKA_DATA_DIR (тесты) изолирует и их, чтобы сверка не тронула рабочий индекс.
const VECTORS=path.join(process.env.TENMAYURIKA_DATA_DIR?path.resolve(process.env.TENMAYURIKA_DATA_DIR):path.join(__dirname,'data'),'vectors');
let database;
// Эмбеддинги: модель из «Модель ИИ» или EMBEDDING_URL из .env (llm.js).
async function embed(text){return require('./llm').embed(text)}
async function connect(){if(!database){const lance=await import('@lancedb/lancedb');database=await lance.connect(VECTORS)}return database}
async function syncNote(note){
 const vector=await embed(note.title+'\n'+(note.content||''));if(!vector)return {enabled:false,reason:'Embedding provider not configured'};
 const db=await connect();const record={id:note.id,title:note.title,content:note.content||'',vector};
 const names=await db.tableNames();
 if(!names.includes('notes')){await db.createTable('notes',[record]);return {enabled:true}}
 const table=await db.openTable('notes');await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([record]);return {enabled:true}
}
// Удаляет вектор заметки (если LanceDB уже создана). id — UUID, поэтому подстановка в фильтр безопасна.
async function removeNote(id){if(!/^[0-9a-f-]{36}$/i.test(id))return {removed:false};if(!require('node:fs').existsSync(VECTORS))return {removed:false};const db=await connect();if(!(await db.tableNames()).includes('notes'))return {removed:false};const table=await db.openTable('notes');await table.delete("id = '"+id+"'");return {removed:true}}
async function search(query,limit=10){const vector=await embed(query);if(!vector)return {results:[],reason:'Embedding provider not configured'};const db=await connect();if(!(await db.tableNames()).includes('notes'))return {results:[]};const table=await db.openTable('notes');return {results:await table.vectorSearch(vector).limit(Math.min(30,Math.max(1,limit))).toArray()}}
async function indexedIds(){const db=await connect();if(!(await db.tableNames()).includes('notes'))return new Set();const table=await db.openTable('notes');const rows=await table.query().select(['id']).toArray();return new Set(rows.map(row=>String(row.id)))}
async function hasNotesTable(){const db=await connect();return (await db.tableNames()).includes('notes')}
module.exports={syncNote,search,removeNote,hasNotesTable,indexedIds};
