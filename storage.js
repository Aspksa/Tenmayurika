'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const dir=path.join(__dirname,'data'),file=path.join(dir,'tenmayurika.sqlite');
let db;
function empty(){return {notes:[],tasks:[]}}
function connect(){
 fs.mkdirSync(dir,{recursive:true});db=new DatabaseSync(file);
 db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS knowledge_nodes(id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS knowledge_edges(source TEXT NOT NULL,target TEXT NOT NULL,relation TEXT NOT NULL,PRIMARY KEY(source,target,relation));");
 const prior=db.prepare('SELECT payload FROM workspace WHERE id=1').get();
 if(!prior){let data=empty();const old=path.join(dir,'workspace.json');if(fs.existsSync(old))data=JSON.parse(fs.readFileSync(old,'utf8'));db.prepare('INSERT INTO workspace(id,payload) VALUES(1,?)').run(JSON.stringify(data));}
}
function ensure(){if(!db)connect()}
async function load(){ensure();return JSON.parse(db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload)}
async function save(data){ensure();db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(data))}
function syncNode(note){ensure();db.prepare("INSERT INTO knowledge_nodes(id,title,content) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content").run(note.id,note.title,note.content||'')}
function graph(){ensure();return {nodes:db.prepare('SELECT * FROM knowledge_nodes').all(),edges:db.prepare('SELECT * FROM knowledge_edges').all()}}
function close(){if(db){db.close();db=undefined}}
module.exports={connect,load,save,syncNode,graph,close};
