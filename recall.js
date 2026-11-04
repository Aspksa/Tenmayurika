'use strict';
// Гибридное вспоминание: несколько сигналов складываются в один балл.
//  • слова — полнотекстовый поиск FTS5 с ранжированием BM25 (факты и заметки);
//  • смысл — векторный поиск заметок в LanceDB, если настроены эмбеддинги;
//  • связи — факты-соседи по графу у сущностей из лучших находок и из самого вопроса;
//  • свежесть и уверенность факта — небольшая добавка.
// Каждая находка помнит, почему она нашлась (why), — это видно в «Мозге» и в ответе.
const memory=require('./memory-core');
const storage=require('./storage');

const W={text:1,vector:.8,graph:.45,fresh:.12};
const rrf=i=>1/(8+i);
const VECTOR_TIMEOUT_MS=2500;
async function vectorNotes(text){
 if(!process.env.EMBEDDING_URL)return [];
 try{
  const search=require('./vector-store').search(text,8);
  const r=await Promise.race([search,new Promise(res=>{const t=setTimeout(()=>res({results:[]}),VECTOR_TIMEOUT_MS);t.unref?.()})]);
  return (r.results||[]).map(x=>x.id).filter(x=>typeof x==='string');
 }catch{return []}
}
function add(map,id,signal,value,extra){
 const e=map.get(id)||{id,score:0,why:new Set(),...extra};
 e.score+=value;e.why.add(signal);map.set(id,e);return e;
}
async function recall(text,{factLimit=8,noteLimit=5,ws}={}){
 const query=String(text||'').trim().slice(0,300);if(!query)return {facts:[],notes:[]};
 const data=ws||await storage.load();
 try{memory.syncRecords('note',data.notes||[])}catch(e){console.error('Note index failed:',e.name)}
 const facts=new Map(),notes=new Map();
 // Слова.
 // Кандидаты отдельно для фактов и заметок: много фактов не вытесняют заметки.
 memory.searchIndex(query,{kinds:['fact'],limit:40}).forEach((h,i)=>add(facts,h.ref,'слова',W.text*rrf(i)*8));
 memory.searchIndex(query,{kinds:['note'],limit:30}).forEach((h,i)=>add(notes,h.ref,'слова',W.text*rrf(i)*8));
 // Заметки по части слова («зань»), если индекс ничего не дал.
 if(!notes.size){const ws=[...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3))].slice(0,8);
  if(ws.length)(data.notes||[]).map(n=>{const hay=(n.title+' '+(n.content||'')).toLocaleLowerCase();return {n,c:ws.filter(w=>hay.includes(w)).length}}).filter(x=>x.c>0).sort((a,b)=>b.c-a.c).slice(0,10).forEach((x,i)=>add(notes,x.n.id,'слова',W.text*rrf(i)*6))}
 // Часть слова, которой нет в индексе («зань»): старый поиск по подстроке.
 if(!facts.size)try{memory.searchFacts(query,20).forEach((f,i)=>add(facts,f.id,'слова',W.text*rrf(i)*6))}catch(e){if(!(e instanceof TypeError))throw e}
 // Смысл.
 (await vectorNotes(query)).forEach((id,i)=>add(notes,id,'смысл',W.vector*rrf(i)*8));
 // Связи: сущности лучших фактов и сущности, названные в вопросе.
 const top=memory.factsById([...facts.values()].sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.id));
 const ents=new Set();for(const f of top){ents.add(f.subject);ents.add(f.object)}
 for(const e of ents){let rel=[];try{rel=memory.relations(e,20)}catch{}rel.forEach((f,i)=>{if(!facts.has(f.id)||[...facts.get(f.id).why].every(w=>w==='связь'))add(facts,f.id,'связь',W.graph*rrf(i)*6)})}
 const rows=memory.factsById([...facts.keys()]),now=Date.now();
 const outFacts=rows.map(f=>{const e=facts.get(f.id),age=(now-Date.parse(f.observed_at||0))/864e5;
   const score=(e.score+W.fresh*Math.exp(-Math.max(0,age)/30))*(.6+.4*(Number(f.confidence)||0));
   return {...f,score,why:[...e.why]}})
  .sort((a,b)=>b.score-a.score||String(b.observed_at).localeCompare(String(a.observed_at))).slice(0,factLimit);
 const byId=new Map((data.notes||[]).map(n=>[n.id,n]));
 const outNotes=[...notes.values()].filter(e=>byId.has(e.id)).map(e=>{const n=byId.get(e.id);return {...n,score:e.score+(n.pinned?.05:0),why:[...e.why]}})
  .sort((a,b)=>b.score-a.score).slice(0,noteLimit);
 return {facts:outFacts,notes:outNotes};
}
module.exports={recall};
