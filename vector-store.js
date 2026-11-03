'use strict';
const crypto=require('node:crypto');
const collection='tenmayurika_notes';
async function embed(text){
 const endpoint=process.env.EMBEDDING_URL,token=process.env.EMBEDDING_API_KEY;
 if(!endpoint)return null;
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({model:process.env.EMBEDDING_MODEL||'text-embedding-3-small',input:text}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Embedding service HTTP '+response.status);
 const data=await response.json(),vector=data.data?.[0]?.embedding;
 if(!Array.isArray(vector)||!vector.length||!vector.every(Number.isFinite))throw Error('Invalid embedding vector');
 return vector;
}
async function syncNote(note){
 if(!process.env.QDRANT_URL||!process.env.EMBEDDING_URL)return {enabled:false};
 const vector=await embed(note.title+'\n'+note.content);
 const base=process.env.QDRANT_URL.replace(/\/$/,'');
 const headers={'Content-Type':'application/json',...(process.env.QDRANT_API_KEY?{'api-key':process.env.QDRANT_API_KEY}:{})};
 const request=async(method,path,data)=>{const response=await fetch(base+path,{method,headers,body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Qdrant HTTP '+response.status);return response.json()};
 const existing=await fetch(base+'/collections/'+collection,{headers,signal:AbortSignal.timeout(10000)});
 if(existing.status===404)await request('PUT','/collections/'+collection,{vectors:{size:vector.length,distance:'Cosine'}});
 else if(!existing.ok)throw Error('Qdrant HTTP '+existing.status);
 const h=crypto.createHash('sha256').update(note.id).digest('hex');const id=[h.slice(0,8),h.slice(8,12),'4'+h.slice(13,16),'8'+h.slice(17,20),h.slice(20,32)].join('-');
 await request('PUT','/collections/'+collection+'/points?wait=true',{points:[{id,vector,payload:{id:note.id,title:note.title,content:note.content}}]});
 return {enabled:true,ok:true};
}
module.exports={syncNote};
