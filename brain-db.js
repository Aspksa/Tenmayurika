'use strict';
// Общая база «Мозга» для новых слоёв памяти: полезность записей, предпочтения, навыки,
// сводки тем, причинные связи, выводы и дневник. Таблицы создаются один раз на процесс.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const dbPath=()=>process.env.TENMAYURIKA_MEMORY_DB?path.resolve(process.env.TENMAYURIKA_MEMORY_DB):path.join(__dirname,'data','tenmayurika.sqlite');
const ready=new Set();
function open(){
 const file=dbPath();
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const db=new DatabaseSync(file);
 db.function('unicode_lower',{deterministic:true},v=>typeof v==='string'?v.toLocaleLowerCase():v);
 db.exec('PRAGMA busy_timeout=5000;');
 if(!ready.has(file)){
  db.exec(`CREATE TABLE IF NOT EXISTS memory_usefulness(
  kind TEXT NOT NULL, ref TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 0,
  fix INTEGER NOT NULL DEFAULT 0, last_at TEXT, PRIMARY KEY(kind,ref));
  CREATE TABLE IF NOT EXISTS memory_preferences(
  id TEXT PRIMARY KEY, aspect TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL,
  created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
  CREATE INDEX IF NOT EXISTS memory_preferences_active ON memory_preferences(active,aspect);
  CREATE TABLE IF NOT EXISTS memory_skills(
  id TEXT PRIMARY KEY, signature TEXT NOT NULL UNIQUE, stems TEXT NOT NULL, rule TEXT NOT NULL,
  examples TEXT NOT NULL DEFAULT '[]', tools TEXT NOT NULL DEFAULT '[]', support INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0, fix INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'rules', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_topic_summaries(
  topic TEXT PRIMARY KEY, label TEXT NOT NULL, signature TEXT NOT NULL, summary TEXT NOT NULL,
  fact_ids TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'rules', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_links(
  id INTEGER PRIMARY KEY AUTOINCREMENT, a_kind TEXT NOT NULL, a_ref TEXT NOT NULL, type TEXT NOT NULL,
  b_kind TEXT NOT NULL, b_ref TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'rules',
  created_at TEXT NOT NULL, UNIQUE(a_kind,a_ref,type,b_kind,b_ref));
  CREATE INDEX IF NOT EXISTS memory_links_b ON memory_links(b_kind,b_ref);
  CREATE TABLE IF NOT EXISTS memory_insights(
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, text TEXT NOT NULL, fact_ids TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'rules', created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS brain_diary(
  id TEXT PRIMARY KEY, at TEXT NOT NULL, text TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS brain_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  ready.add(file);
 }
 return db;
}
// Обёртка: открыть, выполнить, закрыть.
function use(fn){const db=open();try{return fn(db)}finally{db.close()}}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
const parse=(s,d)=>{try{const v=JSON.parse(s);return v??d}catch{return d}};
function state(key,fallback=null){return use(db=>{const r=db.prepare('SELECT value FROM brain_state WHERE key=?').get(key);return r?parse(r.value,fallback):fallback})}
function setState(key,value){use(db=>db.prepare('INSERT INTO brain_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value)))}
module.exports={open,use,tx,parse,state,setState};
