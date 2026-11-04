'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
async function run(){
 const data=path.join(root,'data');
 if(fs.existsSync(path.join(data,'launcher.lock')))throw Error('Закройте приложение перед полной копией');
 const source=path.join(data,'tenmayurika.sqlite');
 if(!fs.existsSync(source))throw Error('SQLite не найдена');
 const dest=path.join(root,'backups','complete','snapshot-'+Date.now());
 fs.mkdirSync(dest,{recursive:true});
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,path.join(dest,'tenmayurika.sqlite'))}finally{db.close()}
 const vectors=path.join(data,'vectors');
 if(fs.existsSync(vectors))fs.cpSync(vectors,path.join(dest,'vectors'),{recursive:true});
 const library=path.join(data,'library');
 if(fs.existsSync(library))fs.cpSync(library,path.join(dest,'library'),{recursive:true});
 const checked=new DatabaseSync(path.join(dest,'tenmayurika.sqlite'),{readOnly:true});
 try{if(checked.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Копия SQLite повреждена')}finally{checked.close()}
 const manifest={createdAt:new Date().toISOString(),files:[]};
 function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Символическая ссылка в резервной копии');if(entry.isDirectory())scan(full);else if(entry.isFile()){const hash=crypto.createHash('sha256');const fd=fs.openSync(full,'r');try{const buffer=Buffer.allocUnsafe(1048576);let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n))}finally{fs.closeSync(fd)}manifest.files.push({path:path.relative(dest,full).split(path.sep).join('/'),sha256:hash.digest('hex')})}}}
 scan(dest);
 fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2));
 const verified=require('./verify-complete').verify(dest);
 console.log('Проверенная копия SQLite и LanceDB:',dest,verified.files,'файлов');
}
if(require.main===module)run().catch(e=>{console.error('Ошибка:',e.message);process.exitCode=1});
module.exports={run};

