'use strict';
// Оглавление памяти (идея «ядро + отложенная память» из letta-code). В подсказке модели всегда лежит
// короткая карта: зоны памяти, их размер и сводка в одну строку. Целиком зона открывается по требованию
// инструментом open_zone, так модель видит всю память сразу, а подробности берёт только нужные.
// Карта пересчитывается, только когда меняются факты.
const memory=require('./memory-core');
const {use}=require('./brain-db');
const MAX_CHARS=1400,MAX_ZONES=12;
let cache={sig:null,zones:[]};
function signature(){return use(db=>{try{const r=db.prepare('SELECT MAX(id) AS m,COUNT(*) AS n FROM memory_events').get();const t=db.prepare('SELECT MAX(updated_at) AS u FROM memory_topic_summaries').get();return (r.m||0)+':'+(r.n||0)+':'+(t.u||'')}catch{return '0'}})}
function zones(){
 memory.queryFacts({limit:1});
 const sig=signature();if(cache.sig===sig)return cache.zones;
 const sums=use(db=>new Map(db.prepare('SELECT topic,summary FROM memory_topic_summaries').all().map(r=>[r.topic,r.summary])));
 const list=memory.communities().map(t=>({id:t.id,label:t.label,size:t.size,entities:t.entities,parent:t.parent,summary:sums.get(t.id)||'',factIds:t.factIds}));
 cache={sig,zones:list};
 return list;
}
function index(limit=MAX_ZONES){return zones().slice(0,limit).map(({factIds,...z})=>z)}
function promptText({tool=false}={}){
 let list;try{list=index()}catch(e){console.error('Atlas failed:',e.name);return ''}
 if(!list.length)return '';
 const lines=[];let len=0;
 for(const z of list){const l='• «'+z.label+'» ('+z.size+'): '+(z.summary||z.entities.join(', ')).replace(/\s+/g,' ').slice(0,160);if(len+l.length>MAX_CHARS)break;lines.push(l);len+=l.length}
 const more=zones().length-lines.length;
 return '\nОглавление памяти — зоны и сколько в них фактов'+(tool?' (зону целиком открывает инструмент open_zone)':'')+':\n'+lines.join('\n')+(more>0?'\n…и ещё '+more+' '+(more===1?'зона':'зон')+'.':'');
}
// Найти зону по id или подписи (точное совпадение, затем начало, затем вхождение).
function find(name){
 const q=String(name||'').trim().toLocaleLowerCase().replace(/^[«"]|[»"]$/g,'');if(!q)return null;
 const l=zones();
 return l.find(z=>z.id===name)||l.find(z=>z.label.toLocaleLowerCase()===q)||l.find(z=>z.label.toLocaleLowerCase().startsWith(q))||l.find(z=>z.label.toLocaleLowerCase().includes(q)||z.entities.some(e=>e.toLocaleLowerCase()===q))||null;
}
function open(name,limit=40){
 const z=find(name);if(!z)return null;
 const facts=[];for(let i=0;i<z.factIds.length&&facts.length<limit;i+=50)facts.push(...memory.factsById(z.factIds.slice(i,i+50)));
 return {zone:{id:z.id,label:z.label,size:z.size,summary:z.summary,parent:z.parent},facts:facts.slice(0,limit)};
}
function reset(){cache={sig:null,zones:[]}}
module.exports={index,promptText,find,open,reset};
