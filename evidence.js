'use strict';
// Подтверждение повтором. Когда то же самое сказано снова — в другом сообщении, в заметке, вручную, —
// это не дубль, который надо выбросить, а ещё одно свидетельство: уверенность в факте растёт,
// факт крепнет и не забывается (strength.js не трогает подтверждённое). Один источник считается
// один раз: повторный разбор того же сообщения ничего не добавляет.
const memory=require('./memory-core');
const usefulness=require('./usefulness');
const thoughts=require('./thoughts');
const {use}=require('./brain-db');
const STEP=.35;// доля оставшегося до 100%: 60% → 74% → 83% → 89%
function kindOf(source){return String(source||'').split(':')[0]}
// Возвращает {count, confidence} или null, если источник уже был учтён.
function confirm(factId,sourceId){
 const id=String(factId||''),src=String(sourceId||'').slice(0,200);if(!id||!src)return null;
 const f=memory.factsById([id])[0];if(!f||f.source_id===src)return null;
 const added=use(db=>db.prepare('INSERT OR IGNORE INTO memory_evidence(fact_id,source_id,at) VALUES(?,?,?)').run(id,src,new Date().toISOString()).changes>0);
 if(!added)return null;
 const n=count([id]).get(id)||1;
 // Из другого рода источника (заметка после разговора) — свидетельство весомее.
 const step=kindOf(src)!==kindOf(f.source_id)?STEP+.1:STEP;
 const c=Number(f.confidence)||0,next=Math.min(1,Math.round((c+(1-c)*step)*1000)/1000);
 if(next>c)memory.setConfidence(id,next);
 try{usefulness.rate({facts:[id]},{ok:1})}catch(e){console.error('Evidence usefulness failed:',e.name)}
 thoughts.add('confirm','Снова услышала: «'+f.subject+' — '+f.predicate+' '+f.object+'» — теперь увереннее ('+Math.round(next*100)+'%, подтверждений: '+n+').',{fact:id});
 return {count:n,confidence:next};
}
// id → сколько раз подтверждено (кроме первого источника).
function count(ids){
 const list=(ids||[]).filter(x=>typeof x==='string');if(!list.length)return new Map();
 const out=new Map();
 for(let i=0;i<list.length;i+=200){const part=list.slice(i,i+200);for(const r of use(db=>db.prepare('SELECT fact_id,COUNT(*) AS n FROM memory_evidence WHERE fact_id IN ('+part.map(()=>'?').join(',')+') GROUP BY fact_id').all(...part)))out.set(r.fact_id,r.n)}
 return out;
}
module.exports={confirm,count};
