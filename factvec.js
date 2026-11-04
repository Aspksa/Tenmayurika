'use strict';
// Поиск по смыслу для фактов. Векторы (эмбеддинги из «Модель ИИ», например BAAI/bge-m3 на Cloud.ru)
// хранятся в SQLite рядом с фактами, поиск — косинусная близость по всем действующим фактам (их немного,
// десятки тысяч — это миллисекунды). Так «машина» находит «автомобиль», а «где я тружусь» — «работает в».
// Векторы считаются фоном пачками (после учёбы из чата и в размышлении), отставленные факты удаляются.
const llm=require('./llm');
const memory=require('./memory-core');
const {use,tx}=require('./brain-db');
const BATCH=32,QUERY_TIMEOUT_MS=2500;
const textOf=f=>f.subject+' '+f.predicate+' '+f.object;
let cache=null,running=null;// {model,sig,ids,vecs}
function toBlob(v){const a=new Float32Array(v);let n=0;for(const x of a)n+=x*x;n=Math.sqrt(n)||1;for(let i=0;i<a.length;i++)a[i]/=n;return Buffer.from(a.buffer)}
function fromBlob(b){const buf=Buffer.from(b);return new Float32Array(buf.buffer,buf.byteOffset,buf.byteLength/4)}
// Досчитать векторы для фактов без них (или со сменившейся моделью). Возвращает {indexed, removed}.
async function index({limit=BATCH*3}={}){
 const c=llm.embedConfig();if(!c)return {indexed:0,removed:0,enabled:false};
 // Уже идёт проход — дождёмся его и досчитаем то, что появилось за это время.
 while(running)await running.catch(()=>{});
 running=(async()=>{
  const facts=memory.queryFacts({limit:5000}).filter(f=>!f.valid_to),active=new Set(facts.map(f=>f.id));
  const have=new Map(use(db=>db.prepare('SELECT fact_id,model,text FROM memory_fact_vectors').all()).map(r=>[r.fact_id,r]));
  const stale=[...have.keys()].filter(id=>!active.has(id));
  if(stale.length)use(db=>tx(db,()=>{const st=db.prepare('DELETE FROM memory_fact_vectors WHERE fact_id=?');for(const id of stale)st.run(id)}));
  const todo=facts.filter(f=>{const h=have.get(f.id);return !h||h.model!==c.model||h.text!==textOf(f)}).slice(0,limit);
  let indexed=0;
  for(let i=0;i<todo.length;i+=BATCH){
   const part=todo.slice(i,i+BATCH),vecs=await llm.embed(part.map(textOf));if(!vecs)break;
   const now=new Date().toISOString();
   use(db=>tx(db,()=>{const st=db.prepare('INSERT OR REPLACE INTO memory_fact_vectors(fact_id,model,text,vec,at) VALUES(?,?,?,?,?)');part.forEach((f,j)=>st.run(f.id,c.model,textOf(f),toBlob(vecs[j]),now))}));
   indexed+=part.length;
  }
  if(indexed||stale.length)cache=null;
  return {indexed,removed:stale.length,enabled:true,left:Math.max(0,facts.filter(f=>!have.has(f.id)).length-indexed)};
 })();
 try{return await running}finally{running=null}
}
function load(model){
 const sig=use(db=>{const r=db.prepare('SELECT COUNT(*) AS n,MAX(at) AS at FROM memory_fact_vectors WHERE model=?').get(model);return r.n+'|'+r.at});
 if(cache&&cache.model===model&&cache.sig===sig)return cache;
 const rows=use(db=>db.prepare('SELECT fact_id,vec FROM memory_fact_vectors WHERE model=?').all(model));
 cache={model,sig,ids:rows.map(r=>r.fact_id),vecs:rows.map(r=>fromBlob(r.vec))};
 return cache;
}
// Ближайшие по смыслу факты: [{id, sim}], самые близкие первыми. Без эмбеддингов или при сбое — [].
async function search(query,limit=10){
 const c=llm.embedConfig();if(!c||!String(query||'').trim())return [];
 try{
  const data=load(c.model);if(!data.ids.length)return [];
  const v=await Promise.race([llm.embed(String(query).slice(0,500),{timeoutMs:QUERY_TIMEOUT_MS}),new Promise(res=>{const t=setTimeout(()=>res(null),QUERY_TIMEOUT_MS);t.unref?.()})]);
  if(!v)return [];
  const q=fromBlob(toBlob(v));if(q.length!==data.vecs[0].length)return [];
  const out=[];
  for(let i=0;i<data.ids.length;i++){const a=data.vecs[i];let s=0;for(let j=0;j<a.length;j++)s+=a[j]*q[j];out.push({id:data.ids[i],sim:s})}
  out.sort((a,b)=>b.sim-a.sim);
  const best=out[0]?.sim||0;
  // Слишком далёкое от лучшего — шум.
  return out.filter(x=>x.sim>=best*.8).slice(0,limit);
 }catch(e){console.error('Fact vector search failed:',e.name);return []}
}
function status(){const c=llm.embedConfig();const n=use(db=>db.prepare('SELECT COUNT(*) AS n FROM memory_fact_vectors'+(c?' WHERE model=?':'')).get(...(c?[c.model]:[])).n);return {enabled:!!c,model:c?.model||'',indexed:n}}
module.exports={index,search,status};
