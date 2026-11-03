'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
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
 console.log('Копия SQLite и LanceDB:',dest);
}
if(require.main===module)run().catch(e=>{console.error('Ошибка:',e.message);process.exitCode=1});
module.exports={run};
