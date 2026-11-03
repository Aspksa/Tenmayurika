'use strict';
async function checkHttp(base,headers={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3000);
 try{const response=await fetch(base,{headers,signal:controller.signal});return {ok:response.ok,status:response.status}}catch(e){return {ok:false,error:e.name==='AbortError'?'timeout':e.message}}finally{clearTimeout(timeout)}
}
async function status(){
 const q=process.env.QDRANT_URL,n=process.env.NEO4J_URL;
 const out={postgresql:{configured:Boolean(process.env.DATABASE_URL)},qdrant:{configured:Boolean(q)},neo4j:{configured:Boolean(n)}};
 if(q){const url=new URL('/collections',q);out.qdrant={configured:true,...await checkHttp(url,process.env.QDRANT_API_KEY?{'api-key':process.env.QDRANT_API_KEY}:{})}}
 if(n){out.neo4j={configured:true,ok:true,detail:'Bolt connection verified during server startup'}}
 return out;
}
module.exports={status};
