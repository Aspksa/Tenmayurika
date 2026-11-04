'use strict';
const storage=require('./storage');
async function status(){let sqlite={ok:false},lancedb={ok:false,configured:Boolean(require('./llm').embedConfig())};try{await storage.load();sqlite={ok:true,engine:'SQLite',portable:true}}catch(e){sqlite.error=e.message}
try{const lance=await import('@lancedb/lancedb');lancedb={ok:Boolean(lance.connect),configured:Boolean(require('./llm').embedConfig()),engine:'LanceDB',portable:true}}catch(e){lancedb.error=e.message}
return {sqlite,lancedb,graph:{ok:sqlite.ok,engine:'SQLite'}}}
module.exports={status};
