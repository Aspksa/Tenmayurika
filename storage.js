'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'data','workspace.json');
let pool;
function empty(){return {notes:[],tasks:[]}}
async function connect(){
 if(!process.env.DATABASE_URL)return;
 const {Pool}=require('pg');
 pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,ssl:process.env.PG_SSL==='true'?{rejectUnauthorized:true}:undefined});
 await pool.query('SELECT 1');
 await pool.query('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
 const existing=await pool.query('SELECT id FROM workspace WHERE id=1');
 if(!existing.rowCount){
  const initial=readFile();
  await pool.query('INSERT INTO workspace(id,payload) VALUES(1,$1::jsonb) ON CONFLICT (id) DO NOTHING',[JSON.stringify(initial)]);
 }
}
function readFile(){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code==='ENOENT')return empty();throw e}}
async function load(){if(!pool)return readFile();const result=await pool.query('SELECT payload FROM workspace WHERE id=1');return result.rows[0]?.payload||empty()}
async function save(data){if(pool){await pool.query('UPDATE workspace SET payload=$1::jsonb,updated_at=now() WHERE id=1',[JSON.stringify(data)]);return}fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file)}
async function close(){if(pool)await pool.end()}
module.exports={connect,load,save,close};
