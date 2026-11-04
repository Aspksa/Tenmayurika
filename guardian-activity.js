'use strict';
// Only task metadata; no document contents, search queries or cloud calls.
const active=new Map(),history=[];let next=0;
const TYPES=new Set(['scan','read','ocr','search']);
function start(kind,details={}){
 if(!TYPES.has(kind))throw new TypeError('Неизвестный вид работы');const id=++next;
 const item={id,kind,startedAt:new Date().toISOString(),...(typeof details.file==='string'?{file:details.file.slice(0,2000)}:{}),...(typeof details.phase==='string'?{phase:details.phase.slice(0,120)}:{}),quiet:!!details.quiet};active.set(id,item);return id;
}
function update(id,details={}){const item=active.get(id);if(!item)return;for(const key of ['phase','file'])if(typeof details[key]==='string')item[key]=details[key].slice(0,key==='file'?2000:120);for(const key of ['page','total'])if(Number.isInteger(details[key])&&details[key]>0)item[key]=details[key]}
function finish(id,result='done',message=''){
 const item=active.get(id);if(!item)return;active.delete(id);if(item.quiet&&result!=='error')return;
 const event={...item,result:['done','error','deferred'].includes(result)?result:'done',finishedAt:new Date().toISOString()};delete event.quiet;if(result==='error'&&typeof message==='string')event.message=message.slice(0,200);history.unshift(event);if(history.length>50)history.length=50;
}
async function track(kind,details,fn){const id=start(kind,details);try{const result=await fn();finish(id);return result}catch(e){finish(id,'error',e?.message||'Ошибка');throw e}}
function snapshot(){return {active:[...active.values()].map(({quiet,...item})=>({...item})),history:history.map(item=>({...item}))}}
module.exports={start,update,finish,track,snapshot};
