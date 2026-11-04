'use strict';
// Гибридное вспоминание: несколько сигналов складываются в один балл.
//  • слова — полнотекстовый поиск FTS5 с ранжированием BM25 (факты и заметки);
//  • смысл — векторный поиск заметок в LanceDB, если настроены эмбеддинги;
//  • связи — факты-соседи по графу у сущностей из лучших находок и из самого вопроса;
//  • свежесть и уверенность факта — небольшая добавка;
//  • польза — записи из подтверждённых ответов выше, из поправленных ниже (usefulness.js);
//  • тема — горячие записи рабочей памяти текущего разговора (working.js);
//  • причина — записи, связанные причинной связью с лучшими находками (links.js);
//  • сила памяти — спящие и угасающие факты находятся хуже (strength.js), прошлое — чуть ниже нынешнего (meta.js).
// Затем отсев: слабые находки (меньше пятой части лучшей) отбрасываются, а из похожих друг на друга
// берётся разнообразный набор (MMR), чтобы модель не получала пять почти одинаковых фактов.
// Каждая находка помнит, почему она нашлась (why), — это видно в «Мозге» и в ответе.
const memory=require('./memory-core');
const storage=require('./storage');
const usefulness=require('./usefulness');
const working=require('./working');
const links=require('./links');
const strength=require('./strength');
const meta=require('./meta');

const W={text:1,vector:.8,graph:.45,fresh:.12,topic:.35,cause:.4};
const CUTOFF=.2,MMR_LAMBDA=.35;
const rrf=i=>1/(8+i);
const VECTOR_TIMEOUT_MS=2500;
async function vectorNotes(text){
 if(!require('./llm').embedConfig())return [];
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
function grams(text){const t=' '+String(text||'').toLocaleLowerCase().replace(/ё/g,'е')+' ',out=new Set();for(let i=0;i+3<=t.length;i++)out.add(t.slice(i,i+3));return out}
function jaccard(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n||1)}
// Отсев и разнообразие: слабее CUTOFF от лучшей — прочь; дальше жадно, со штрафом за сходство с уже взятыми.
function diverse(list,limit,textOf){
 if(!list.length)return list;
 const best=list[0].score||1,pool=list.filter(x=>x.score>=best*CUTOFF).map(x=>({x,g:grams(textOf(x))})),out=[];
 while(out.length<limit&&pool.length){
  let bi=0,bv=-Infinity;
  for(let i=0;i<pool.length;i++){const sim=out.length?Math.max(...out.map(o=>jaccard(o.g,pool[i].g))):0;const v=pool[i].x.score/best-MMR_LAMBDA*sim;if(v>bv){bv=v;bi=i}}
  out.push(pool.splice(bi,1)[0]);
 }
 return out.map(o=>o.x);
}
async function recall(text,{factLimit=8,noteLimit=5,ws,diversify=true,topic=true}={}){
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
 // По всей фразе и по каждому слову отдельно; чем больше слов совпало, тем выше.
 if(!facts.size){const hit=new Map();for(const t of [query,...new Set(query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3))].slice(0,9)){try{for(const f of memory.searchFacts(t,20))hit.set(f.id,(hit.get(f.id)||0)+1)}catch(e){if(!(e instanceof TypeError))throw e}}
  [...hit].sort((x,y)=>y[1]-x[1]).slice(0,20).forEach(([id],i)=>add(facts,id,'слова',W.text*rrf(i)*6))}
 // Смысл.
 (await vectorNotes(query)).forEach((id,i)=>add(notes,id,'смысл',W.vector*rrf(i)*8));
 // Связи: сущности лучших фактов и сущности, названные в вопросе.
 const top=memory.factsById([...facts.values()].sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.id));
 const ents=new Set();for(const f of top){ents.add(f.subject);ents.add(f.object)}
 for(const e of ents){let rel=[];try{rel=memory.relations(e,20)}catch{}rel.forEach((f,i)=>{if(!facts.has(f.id)||[...facts.get(f.id).why].every(w=>w==='связь'))add(facts,f.id,'связь',W.graph*rrf(i)*6)})}
 // Тема разговора: горячие записи рабочей памяти.
 if(topic)for(const h of working.hot('fact'))add(facts,h.id,'тема',W.topic*h.heat);
 if(topic)for(const h of working.hot('note'))add(notes,h.id,'тема',W.topic*h.heat);
 // Причинные связи лучших находок (причина, условие, «сначала — потом»).
 try{
  const seeds=[...[...facts.values()].sort((a,b)=>b.score-a.score).slice(0,3).map(x=>({kind:'fact',ref:x.id,score:x.score})),...[...notes.values()].sort((a,b)=>b.score-a.score).slice(0,2).map(x=>({kind:'note',ref:x.id,score:x.score}))];
  for(const sd of seeds)for(const l of links.of(sd.kind,sd.ref,8)){const map=l.kind==='fact'?facts:l.kind==='note'?notes:null;if(map&&!(l.kind===sd.kind&&l.ref===sd.ref))add(map,l.ref,l.type,W.cause*Math.min(1,sd.score))}
 }catch(e){console.error('Link recall failed:',e.name)}
 // factsById берёт не больше 50 id за раз — грузим всех кандидатов пачками, чтобы порядок решал итоговый балл.
 const ids=[...facts.keys()],rows=[];for(let i=0;i<ids.length;i+=50)rows.push(...memory.factsById(ids.slice(i,i+50)));const now=Date.now();
 const useF=usefulness.get('fact',rows.map(f=>f.id));
 let stF=new Map(),metaF=new Map();try{stF=strength.get(rows.map(f=>f.id));metaF=meta.ensure(rows)}catch(e){console.error('Strength lookup failed:',e.name)}
 // О прошлом спрашивают словами «раньше», «жил(а)», «был(а)» — тогда прошлое не опускается.
 const askPast=/раньше|прежде|бывш|когда-то|в прошлом|\S+(л|ла|ли)\s/i.test(query+' ');
 const allFacts=rows.map(f=>{const e=facts.get(f.id),age=(now-Date.parse(f.observed_at||0))/864e5,u=useF.get(f.id),st=stF.get(f.id),m=metaF.get(f.id);
   const score=(e.score+W.fresh*Math.exp(-Math.max(0,age)/30))*(.6+.4*(Number(f.confidence)||0))*usefulness.factor(u)*strength.factor(st)*(m&&m.past&&!askPast?.85:1);
   if(u&&u.ok>u.fix)e.why.add('польза');
   if(st&&st.stage!=='active')e.why.add(strength.label(st.stage));
   if(m&&m.past)e.why.add('в прошлом');
   return {...f,score,why:[...e.why],...(m?{meta:m}:{}),...(st?{stage:st.stage}:{})}})
  .sort((a,b)=>b.score-a.score||String(b.observed_at).localeCompare(String(a.observed_at)));
 const byId=new Map((data.notes||[]).map(n=>[n.id,n]));
 const live=[...notes.values()].filter(e=>byId.has(e.id)),useN=usefulness.get('note',live.map(e=>e.id));
 const allNotes=live.map(e=>{const n=byId.get(e.id),u=useN.get(e.id);if(u&&u.ok>u.fix)e.why.add('польза');return {...n,score:(e.score+(n.pinned?.05:0))*usefulness.factor(u),why:[...e.why]}})
  .sort((a,b)=>b.score-a.score);
 const outFacts=diversify?diverse(allFacts,factLimit,f=>f.subject+' '+f.predicate+' '+f.object):allFacts.slice(0,factLimit);
 const outNotes=diversify?diverse(allNotes,noteLimit,n=>n.title+' '+String(n.content||'').slice(0,200)):allNotes.slice(0,noteLimit);
 return {facts:outFacts,notes:outNotes};
}
module.exports={recall,diverse};
