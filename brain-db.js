'use strict';
// Общая база «Мозга» для новых слоёв памяти: полезность записей, предпочтения, навыки,
// сводки тем, причинные связи, выводы и дневник; навыки запоминания, промахи и самоэкзамен; рост: крепнущие связи, карточки сущностей,
// псевдонимы, свои типы, постепенно растущие зоны и отбор при размышлении; сердцевина (блоки «кто я», «кто ты»,
// «как мы общаемся») с историей версий. Таблицы создаются один раз на процесс.
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
  CREATE TABLE IF NOT EXISTS brain_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_bonds(
  a TEXT NOT NULL, b TEXT NOT NULL, charge REAL NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0,
  last_at TEXT NOT NULL, PRIMARY KEY(a,b));
  CREATE TABLE IF NOT EXISTS memory_cards(
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, fact_ids TEXT NOT NULL DEFAULT '[]',
  signature TEXT NOT NULL, grew INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'rules',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_aliases(
  alias TEXT PRIMARY KEY, canonical TEXT NOT NULL, canonical_name TEXT NOT NULL, alias_name TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'rules', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_alias_rejects(alias TEXT NOT NULL, canonical TEXT NOT NULL, PRIMARY KEY(alias,canonical));
  CREATE TABLE IF NOT EXISTS memory_entity_types(
  key TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'rules', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_types(
  kind TEXT NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, multi INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'rules', created_at TEXT NOT NULL, PRIMARY KEY(kind,name));
  CREATE TABLE IF NOT EXISTS memory_zones(entity TEXT PRIMARY KEY, zone TEXT NOT NULL, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS memory_zones_zone ON memory_zones(zone);
  CREATE TABLE IF NOT EXISTS memory_zone_info(
  zone TEXT PRIMARY KEY, label TEXT NOT NULL, parent TEXT, created_at TEXT NOT NULL, split_at TEXT);
  CREATE TABLE IF NOT EXISTS memory_selection(ref TEXT PRIMARY KEY, ok INTEGER NOT NULL DEFAULT 0, fix INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_mskills(
  name TEXT PRIMARY KEY, title TEXT NOT NULL, purpose TEXT NOT NULL, when_text TEXT NOT NULL DEFAULT '',
  how TEXT NOT NULL DEFAULT '', avoid TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT 'insert',
  domains TEXT NOT NULL DEFAULT '["all"]', cues TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, ema REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0, fix INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'seed',
  born_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_mskill_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, version INTEGER NOT NULL, change TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_mskill_runs(source TEXT PRIMARY KEY, skills TEXT NOT NULL DEFAULT '[]', at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_mskill_facts(fact_id TEXT PRIMARY KEY, skills TEXT NOT NULL DEFAULT '[]', at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_misses(
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, question TEXT NOT NULL, expected TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', skills TEXT NOT NULL DEFAULT '[]',
  severity REAL NOT NULL DEFAULT .5, count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open',
  first_at TEXT NOT NULL, last_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_selftests(
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, question TEXT NOT NULL, expected TEXT NOT NULL,
  passed INTEGER NOT NULL, cause TEXT, bank INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS memory_selftests_source ON memory_selftests(source);
  CREATE TABLE IF NOT EXISTS memory_mskill_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, bank TEXT NOT NULL, trial_score REAL,
  change TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'kept');
  CREATE TABLE IF NOT EXISTS memory_core_blocks(
  name TEXT PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'seed', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_core_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
  source TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS memory_core_history_name ON memory_core_history(name,version);`);
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
