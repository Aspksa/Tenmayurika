'use strict';
// Сила памяти и забывание (идея ACT-R из MemoryBear). Сила факта считается на сервере:
//  активация = ln(1 + сколько раз вспоминали) − DECAY · ln(1 + дней с последнего раза)
//              + польза (подтверждали 👍 / поправляли 👎) + уверенность + важность.
// По силе факт проходит три стадии: действует → спит → угасает → забыт. Спящий и угасающий
// находятся хуже (recall.js), забытый уходит в историю (valid_to, событие «forgotten») и возвращается
// по просьбе «вспомни забытое». Вспомнили — факт сразу просыпается.
// Не забываются никогда: факты о самом человеке («Я»), о близких людях, имена и дни рождения,
// то, чему научили вручную, и то, что хоть раз подтвердили.
const memory=require('./memory-core');
const usefulness=require('./usefulness');
const {use,tx}=require('./brain-db');
const DECAY=Number(process.env.TENMAYURIKA_DECAY)||.35;
const STAGES=[['active',-1.3],['dormant',-1.7],['fading',-2.1]];
const FACTOR={active:1,dormant:.8,fading:.6};
const LABEL={active:'действует',dormant:'спит',fading:'угасает',forgotten:'забыт'};
const PEOPLE=/мам|пап|мать|отец|брат|сестр|муж|жен|сын|доч|друг|подруг|бабуш|дедуш|родител|ребен|ребён|дет|партн|коллег/;
const MAX_FORGET=20;
function isProtected(f,u){
 const s=String(f.subject||'').trim().toLocaleLowerCase();
 if(s==='я'||s==='мне'||s==='меня')return true;
 if(/^manual/.test(f.source_id||''))return true;
 if(['зовут','день рождения','женат на','дружит с'].includes(f.relation))return true;
 if(PEOPLE.test(String(f.predicate||'').toLocaleLowerCase()))return true;
 return !!(u&&u.ok>0);
}
function activation(f,u,now=Date.now()){
 const last=Math.max(Date.parse(f.observed_at||0)||0,u?.at?Date.parse(u.at)||0:0);
 const days=Math.max(0,(now-last)/864e5),n=u?.used||0;
 const useful=u ? 0.25*Math.max(-2,Math.min(2,(u.ok||0)-(u.fix||0))):0;
 return Math.log(1+n)-DECAY*Math.log(1+days)+useful+.5*((Number(f.confidence)||0)-1);
}
function stageOf(a,prot){for(const [name,min] of STAGES)if(a>=min)return name;return prot?'fading':'forgotten'}
function activeFacts(){return memory.queryFacts({limit:5000}).filter(f=>!f.valid_to)}
// Пересчёт силы всех действующих фактов. forget=false — только посчитать (без забывания).
function sweep({forget=true,now=Date.now()}={}){
 const facts=activeFacts(),u=usefulness.get('fact',facts.map(f=>f.id).slice(0,500));
 // usefulness.get берёт до 500 id за раз — остальное догружаем пачками.
 for(let i=500;i<facts.length;i+=500)for(const [k,v] of usefulness.get('fact',facts.slice(i,i+500).map(f=>f.id)))u.set(k,v);
 const rows=facts.map(f=>{const uu=u.get(f.id),prot=isProtected(f,uu),a=activation(f,uu,now);return {f,a,prot,stage:stageOf(a,prot)}});
 const at=new Date(now).toISOString(),counts={active:0,dormant:0,fading:0,forgotten:0},forgotten=[];
 let doomed=rows.filter(r=>r.stage==='forgotten').sort((x,y)=>x.a-y.a);
 if(!forget)doomed=[];else doomed=doomed.slice(0,MAX_FORGET);
 const doomedIds=new Set(doomed.map(r=>r.f.id));
 use(db=>{const st=db.prepare('INSERT INTO memory_strength(fact_id,value,stage,protected,at) VALUES(?,?,?,?,?) ON CONFLICT(fact_id) DO UPDATE SET value=excluded.value,stage=excluded.stage,protected=excluded.protected,at=excluded.at');
  tx(db,()=>{for(const r of rows){const stage=r.stage==='forgotten'&&!doomedIds.has(r.f.id)?'fading':r.stage;st.run(r.f.id,Math.round(r.a*1000)/1000,stage,r.prot?1:0,at);counts[stage]++}})});
 for(const r of doomed){try{if(memory.retireFact(r.f.id,'forgotten')){forgotten.push(r.f);counts.fading--;counts.forgotten++}}catch(e){console.error('Forget failed:',e.name)}}
 return {...counts,forgottenFacts:forgotten.map(f=>({id:f.id,subject:f.subject,predicate:f.predicate,object:f.object}))};
}
function get(ids){
 const list=[...new Set((ids||[]).filter(x=>typeof x==='string'&&x))];if(!list.length)return new Map();
 const out=new Map();
 use(db=>{for(let i=0;i<list.length;i+=400){const part=list.slice(i,i+400);for(const r of db.prepare('SELECT * FROM memory_strength WHERE fact_id IN ('+part.map(()=>'?').join(',')+')').all(...part))out.set(r.fact_id,{value:r.value,stage:r.stage,protected:!!r.protected})}});
 return out;
}
function factor(s){return s?FACTOR[s.stage]??1:1}
// Вспомнили — проснулся (стадия «действует» до следующего пересчёта). Возвращает разбуженные id.
function wake(ids){
 const list=(ids||[]).filter(x=>typeof x==='string'&&x).slice(0,40);if(!list.length)return [];
 return use(db=>{const rows=db.prepare("SELECT fact_id FROM memory_strength WHERE stage<>'active' AND fact_id IN ("+list.map(()=>'?').join(',')+')').all(...list).map(r=>r.fact_id);
  if(rows.length)db.prepare("UPDATE memory_strength SET stage='active' WHERE fact_id IN ("+rows.map(()=>'?').join(',')+')').run(...rows);return rows});
}
// Забытое: факты, ушедшие в историю из-за забывания (последнее событие — forgotten).
function forgotten({query='',limit=20}={}){
 const q=String(query||'').trim().toLocaleLowerCase().replace(/ё/g,'е');
 const words=q.split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3).map(w=>w.length>=4?w.slice(0,-1):w);
 memory.queryFacts({limit:1});
 const rows=use(db=>db.prepare(`SELECT f.id,f.subject,f.predicate,f.object,f.source_id,f.confidence,f.valid_to FROM memory_facts f
  WHERE f.valid_to IS NOT NULL AND (SELECT action FROM memory_events e WHERE e.fact_id=f.id ORDER BY e.id DESC LIMIT 1)='forgotten'
  ORDER BY f.valid_to DESC LIMIT 500`).all());
 const hay=f=>(f.subject+' '+f.predicate+' '+f.object).toLocaleLowerCase().replace(/ё/g,'е');
 return rows.filter(f=>!words.length||words.some(w=>hay(f).includes(w))).slice(0,limit).map(f=>({...f}));
}
// «Вспомни забытое»: факт возвращается в память той же записью (тот же отпечаток), сила начинается заново.
function remember(ids){
 const out=[];
 for(const f of forgotten({limit:500}).filter(x=>ids.includes(x.id))){
  try{const r=memory.addFact({subject:f.subject,predicate:f.predicate,object:f.object,sourceId:f.source_id,confidence:f.confidence});if(r.restored||!r.duplicate)out.push(f)}catch(e){if(!(e instanceof TypeError))throw e}
 }
 if(out.length)use(db=>db.prepare("UPDATE memory_strength SET stage='active',at=? WHERE fact_id IN ("+out.map(()=>'?').join(',')+')').run(new Date().toISOString(),...out.map(f=>f.id)));
 return out;
}
function stats(){return use(db=>db.prepare('SELECT stage,COUNT(*) AS n FROM memory_strength m JOIN memory_facts f ON f.id=m.fact_id WHERE f.valid_to IS NULL GROUP BY stage').all()).reduce((o,r)=>(o[r.stage]=r.n,o),{active:0,dormant:0,fading:0})}
// Для подсказки «спит/угасает»: стадия видна в «Мозге» и в карточке факта.
function label(stage){return LABEL[stage]||stage}
module.exports={sweep,get,factor,wake,forgotten,remember,stats,label,activation,isProtected,LABEL};
