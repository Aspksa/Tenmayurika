'use strict';
const storage=require('./storage');
async function status(){let sqlite={ok:false},lancedb={ok:false,configured:Boolean(process.env.EMBEDDING_URL)};try{await storage.load();sqlite={ok:true,engine:'SQLite',portable:true}}catch(e){sqlite.error=e.message}
try{const lance=await import('@lancedb/lancedb');lancedb={ok:Boolean(lance.connect),configured:Boolean(process.env.EMBEDDING_URL),engine:'LanceDB',portable:true}}catch(e){lancedb.error=e.message}
return {sqlite,lancedb,graph:{ok:sqlite.ok,engine:'SQLite'}}}
module.exports={status};
