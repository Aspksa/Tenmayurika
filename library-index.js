'use strict';
// The index lives in the project SQLite database, with local-only document text.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const library=require('./library');
const DB=process.env.TENMAYURIKA_MEMORY_DB?path.resolve(process.env.TENMAYURIKA_MEMORY_DB):path.join(__dirname,'data','tenmayurika.sqlite');
function open(){fs.mkdirSync(path.dirname(DB),{recursive:true});const db=new DatabaseSync(DB);db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS library_index(path TEXT PRIMARY KEY,modified TEXT NOT NULL,size INTEGER NOT NULL,text TEXT NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS library_index_fts USING fts5(path UNINDEXED, body, tokenize='unicode61');`);return db}
function put(file,modified,size,text){if(typeof file!=='string'||typeof text!=='string'||typeof modified!=='string'||!Number.isFinite(size))throw new TypeError('Некорректные данные индекса');const db=open();try{db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO library_index(path,modified,size,text) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET modified=excluded.modified,size=excluded.size,text=excluded.text').run(file,modified,size,text);db.prepare('DELETE FROM library_index_fts WHERE path=?').run(file);db.prepare('INSERT INTO library_index_fts(path,body) VALUES(?,?)').run(file,text);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}finally{db.close()}}
function reconcile(paths){const valid=new Set(paths),db=open();try{db.exec('BEGIN IMMEDIATE');try{for(const row of db.prepare('SELECT path FROM library_index').all())if(!valid.has(row.path)){db.prepare('DELETE FROM library_index_fts WHERE path=?').run(row.path);db.prepare('DELETE FROM library_index WHERE path=?').run(row.path)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}finally{db.close()}}
async function search(query){if(typeof query!=='string'||!query.trim()||query.length>200)throw new TypeError('Введите запрос до 200 символов');const words=[...new Set(query.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{2,}/gu)||[])].slice(0,10);if(!words.length)throw new TypeError('Введите слова для поиска');const db=open();let rows;try{rows=db.prepare("SELECT i.path,i.modified,i.size,snippet(library_index_fts,1,'','', ' … ',18) AS excerpt FROM library_index_fts JOIN library_index i ON i.path=library_index_fts.path WHERE library_index_fts MATCH ? ORDER BY bm25(library_index_fts) LIMIT 100").all(words.map(w=>'"'+w+'"').join(' AND '))}finally{db.close()}
 const results=[];let stale=0;for(const row of rows){try{const stat=await fsp.stat(await library.filePath(row.path));if(stat.size!==row.size||stat.mtime.toISOString()!==row.modified){stale++;continue}results.push({path:row.path,excerpt:row.excerpt})}catch{stale++}}
 return {results,stale,limited:rows.length===100};
}
module.exports={put,reconcile,search};
