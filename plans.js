'use strict';
// Планы и сроки. «В следующем месяце переезжаю в Казань» — это не вечный факт, а намерение со сроком.
// При фоновой учёбе срок из фразы привязывается к настоящей дате (относительно времени сообщения),
// а факты из того же предложения помечаются планом. Срок прошёл — Юрика спрашивает, сбылось ли
// (curiosity.js): да — факт подтверждён, нет — отставлен. В подсказке модели план виден пометкой.
const planner=require('./planner');
const {use}=require('./brain-db');

const L='(?<![\\p{L}\\p{N}])',R='(?![\\p{L}\\p{N}])';
const rx=src=>new RegExp(L+src+R,'iu');
const MONTHS=['январ','феврал','март','апрел','ма[йя]','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const SEASONS=[['зим|зимой',2],['весн|весной',5],['лет|летом',8],['осен|осенью',11]];
// Признаки будущего, без которых «в декабре» может быть и прошлым.
const FUTURE=/(^|[^\p{L}])(буду|будет|будем|будут|собира\p{L}*|планиру\p{L}*|хочу|хочет|хотим|поеду|поедет|поедем|пойду|пойдёт|пойдет|переезжа\p{L}*|перееду|переедет|начну|начнёт|начнет|выйду|выйдет|устроюсь|поступлю|поступит|женюсь|выхожу|еду|едем|лечу|летим|иду|идём|идем|запишусь|сдаю|сдам|сдаст|получу|куплю|купит|готовлюсь|скоро|через|завтра|послезавтра|следующ\p{L}*)(?=[^\p{L}]|$)/iu;
const endOfMonth=(y,m)=>new Date(y,m,0);// m — 1..12
// Срок из фразы: {due:'YYYY-MM-DD', phrase} или null. now — время сообщения.
function when(text,now=new Date()){
 const t=' '+String(text||'')+' ';
 if(!FUTURE.test(t))return null;
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());let m;
 if((m=t.match(rx('в\\s+следующем\\s+месяце'))))return out(endOfMonth(today.getFullYear(),today.getMonth()+2),m[0]);
 if((m=t.match(rx('в\\s+следующем\\s+году'))))return out(new Date(today.getFullYear()+1,11,31),m[0]);
 if((m=t.match(rx('через\\s+(\\d{1,2})?\\s*(год|года|лет)')))){const n=Number(m[1]||1);return out(new Date(today.getFullYear()+n,today.getMonth(),today.getDate()),m[0])}
 if((m=t.match(rx('(?:в|во|к)\\s+('+MONTHS.join('|')+')\\p{L}*(?:\\s+(\\d{4}))?')))&&!/\d\s*$/.test(t.slice(0,m.index+1))){
  const i=MONTHS.findIndex(x=>new RegExp('^(?:'+x+')','iu').test(m[1]))+1;let y=m[2]?Number(m[2]):today.getFullYear();
  if(!m[2]&&i<today.getMonth()+1)y++;return out(endOfMonth(y,i),m[0].trim());
 }
 for(const [w,last] of SEASONS)if((m=t.match(rx('(?:этим\\s+|следующим\\s+|будущим\\s+)?(?:'+w+')(?:\\s+(\\d{4}))?')))){
  let y=m[1]?Number(m[1]):today.getFullYear();if(!m[1]&&last<today.getMonth()+1)y++;return out(endOfMonth(y,last),m[0].trim());
 }
 const p=planner.parseWhen(t,now,{defaultToday:false});
 if(p.due&&p.due>=planner.ymd(today)){const left=t.replace(/\s+/g,' ').trim();return {due:p.due,phrase:phraseOf(left,p.rest)}}
 return null;
 function out(d,phrase){return d>=today?{due:planner.ymd(d),phrase:String(phrase).trim()}:null}
}
// Что именно планер вырезал из фразы — это и есть сказанный срок.
function phraseOf(full,rest){const a=full.split(' '),b=new Set(String(rest).split(' '));return a.filter(w=>!b.has(w)).join(' ').trim().slice(0,40)||'срок'}
const stems=s=>String(s||'').toLocaleLowerCase().replace(/ё/g,'е').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=4).map(w=>w.slice(0,4));
// После разбора сообщения: факты из предложений со сроком в будущем становятся планами.
function capture(text,facts,at=new Date().toISOString()){
 const list=(facts||[]).filter(f=>f&&f.id);if(!list.length)return [];
 const now=new Date(at),made=[];
 for(const sentence of String(text||'').split(/(?<=[.!?\n;])\s+/)){
  const w=when(sentence,now);if(!w)continue;w.phrase=w.phrase.toLocaleLowerCase();
  const hay=new Set(stems(sentence));
  for(const f of list){
   // Факт из этого предложения: его связь или объект названы в нём.
   const own=[...stems(f.predicate),...stems(f.object)];if(!own.some(s=>hay.has(s)))continue;
   if(made.some(x=>x.fact_id===f.id))continue;
   use(db=>db.prepare("INSERT INTO memory_plans(fact_id,due,phrase,status,at) VALUES(?,?,?,'open',?) ON CONFLICT(fact_id) DO UPDATE SET due=excluded.due,phrase=excluded.phrase,status='open'").run(f.id,w.due,w.phrase,at));
   made.push({fact_id:f.id,due:w.due,phrase:w.phrase,fact:f});
  }
 }
 return made;
}
function get(ids){
 const list=(ids||[]).filter(x=>typeof x==='string');if(!list.length)return new Map();
 return new Map(use(db=>db.prepare('SELECT * FROM memory_plans WHERE fact_id IN ('+list.map(()=>'?').join(',')+')').all(...list)).map(r=>[r.fact_id,{...r}]));
}
// Сроки, которые уже прошли, а ответа «сбылось ли» ещё нет.
function due(today=planner.ymd(new Date()),limit=3){return use(db=>db.prepare("SELECT * FROM memory_plans WHERE status='open' AND due<? ORDER BY due LIMIT ?").all(today,limit)).map(r=>({...r}))}
function upcoming(limit=10){return use(db=>db.prepare("SELECT * FROM memory_plans WHERE status='open' ORDER BY due LIMIT ?").all(limit)).map(r=>({...r}))}
function setStatus(factId,status){return use(db=>db.prepare('UPDATE memory_plans SET status=?,at=? WHERE fact_id=?').run(status,new Date().toISOString(),String(factId||'')).changes>0)}
// Пометка для подсказки: «(план: в следующем месяце, к 31.12)».
function tag(p){if(!p)return '';const d=p.due.split('-').reverse().join('.');return p.status==='done'?'(план сбылся)':p.status==='missed'?'(план не сбылся)':'(план: '+p.phrase+', к '+d+')'}
module.exports={when,capture,get,due,upcoming,setStatus,tag};
