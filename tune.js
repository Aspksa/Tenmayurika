'use strict';
// Самонастройка поиска. В recall.js несколько способов вспомнить (слова, смысл, связи, свежесть, тема,
// причины), у каждого свой вес. Какой способ помогает именно этому человеку, Юрика узнаёт сама:
//  • отклик: в каждом ответе помнится, какими способами нашлись записи; 👍 — этим способам плюс,
//    👎 — минус (сглаженно, после нескольких оценок);
//  • проба в простое: вопросы самоэкзамена (selfstudy.js) прогоняются с текущими весами и с чуть
//    изменёнными; лучший набор принимается, только если он находит ответ чаще, а не просто «не хуже».
// Множители весов держатся в пределах 0,5–1,6, каждое изменение — в дневнике мыслей с причиной.
const {use,state,setState}=require('./brain-db');
const thoughts=require('./thoughts');
const SIGNALS=['text','vector','graph','fresh','topic','cause'];
const LABEL={text:'слова',vector:'смысл',graph:'связи',fresh:'свежесть',topic:'тема разговора',cause:'причины'};
// Какой способ стоит за пометкой why у находки.
const WHY={'слова':'text','смысл':'vector','связь':'graph','тема':'topic','причина':'cause','условие':'cause','потом':'cause'};
const MIN=.5,MAX=1.6,STEP=1.25,MIN_FEEDBACK=5,MIN_TESTS=8,KEEP_EPISODES=300;
const clamp=x=>Math.max(MIN,Math.min(MAX,Math.round(x*1000)/1000));
function read(){const s=state('recall.tune',null);const base={m:Object.fromEntries(SIGNALS.map(k=>[k,1])),stats:Object.fromEntries(SIGNALS.map(k=>[k,{ok:0,fix:0}])),history:[]};if(!s||typeof s!=='object')return base;return {m:{...base.m,...(s.m||{})},stats:{...base.stats,...(s.stats||{})},history:Array.isArray(s.history)?s.history:[]}}
function multipliers(){return read().m}
function signalsOf(why){const out=new Set();for(const w of why||[])if(WHY[w])out.add(WHY[w]);return [...out]}
// Ответ записан эпизодом: запомним, какими способами нашлось вспомненное.
function remember(episodeId,signals=[]){
 if(!episodeId)return;
 const sig=[...new Set(signals)].filter(k=>SIGNALS.includes(k));if(!sig.length)return;
 const e=state('recall.episodes',{});const map=e&&typeof e==='object'?e:{};
 map[episodeId]=sig;const keys=Object.keys(map);for(const k of keys.slice(0,Math.max(0,keys.length-KEEP_EPISODES)))delete map[k];
 setState('recall.episodes',map);
}
// 👍/👎 к ответу (или смена оценки): счётчики способов, которыми он нашёл память.
function feedback(episodeId,kind,prev=null){
 const map=state('recall.episodes',{})||{},sig=map[episodeId];if(!Array.isArray(sig)||!sig.length)return null;
 const s=read();
 for(const k of sig){const st=s.stats[k]||(s.stats[k]={ok:0,fix:0});if(prev&&st[prev]>0)st[prev]--;if(kind==='ok'||kind==='fix')st[kind]++}
 setState('recall.tune',s);return s.stats;
}
// Сдвиг по откликам: доля 👍 у способа против средней по всем.
function fromFeedback(s){
 const all=SIGNALS.reduce((a,k)=>({ok:a.ok+(s.stats[k]?.ok||0),fix:a.fix+(s.stats[k]?.fix||0)}),{ok:0,fix:0});
 const avg=(all.ok+1)/(all.ok+all.fix+2),changes=[];
 for(const k of SIGNALS){const st=s.stats[k]||{ok:0,fix:0},n=st.ok+st.fix;if(n<MIN_FEEDBACK)continue;
  const r=(st.ok+1)/(n+2),target=clamp(1+(r-avg)*1.2),next=clamp(s.m[k]*.8+target*.2);
  if(Math.abs(next-s.m[k])>=.02){changes.push({signal:k,from:s.m[k],to:next,why:'👍 '+st.ok+' / 👎 '+st.fix});s.m[k]=next}}
 return changes;
}
function tests(limit=24){return use(db=>{try{return db.prepare('SELECT question,expected FROM memory_selftests WHERE passed IN (0,1) ORDER BY id DESC LIMIT ?').all(limit)}catch{return []}})}
// Проба в простое: сколько вопросов самоэкзамена находит ответ с данными множителями.
async function score(cases,m,ws){
 const {recall}=require('./recall'),{answerIn}=require('./selfstudy');let ok=0;
 for(const c of cases){const r=await recall(c.question,{ws,topic:false,vector:false,weights:m,factLimit:8,noteLimit:3});if(answerIn(c.expected,[...r.facts.map(f=>f.subject+' '+f.predicate+' '+f.object),...r.notes.map(n=>n.title+' '+String(n.content||'').slice(0,400))]))ok++}
 return ok;
}
async function run({ws}={}){
 const s=read(),out={feedback:fromFeedback(s),trial:null};
 const cases=tests();
 if(cases.length>=MIN_TESTS){
  const base=await score(cases,s.m,ws);let best={m:s.m,ok:base,signal:null};
  // Тема и смысл в пробе не участвуют (нет разговора, без вызовов эмбеддингов) — их настраивают отклики.
  for(const k of ['text','graph','fresh','cause'])for(const f of [STEP,1/STEP]){
   const m={...s.m,[k]:clamp(s.m[k]*f)};if(m[k]===s.m[k])continue;
   const ok=await score(cases,m,ws);if(ok>best.ok)best={m,ok,signal:k};
  }
  out.trial={cases:cases.length,base,best:best.ok};
  if(best.signal){out.trial.signal=best.signal;out.trial.from=s.m[best.signal];out.trial.to=best.m[best.signal];s.m=best.m}
 }
 const changed=[...out.feedback.map(c=>({...c,by:'feedback'})),...(out.trial?.signal?[{signal:out.trial.signal,from:out.trial.from,to:out.trial.to,why:'самоэкзамен: '+out.trial.base+' → '+out.trial.best+' из '+out.trial.cases,by:'trial'}]:[])];
 if(changed.length){
  s.history=[...s.history,...changed.map(c=>({...c,at:new Date().toISOString()}))].slice(-50);
  thoughts.add('tune','Подстроила свой поиск: '+changed.map(c=>'«'+LABEL[c.signal]+'» '+(c.to>c.from?'важнее':'тише')+' ('+c.why+')').join('; '),{changed});
 }
 setState('recall.tune',s);
 return {...out,changed,multipliers:s.m};
}
function view(){const s=read();return {multipliers:s.m,stats:s.stats,history:s.history.slice(-10),labels:LABEL}}
require('./experience').onFeedback((ep,kind,prev)=>{try{feedback(ep.id,kind,prev)}catch(e){console.error('Tune feedback failed:',e.name)}});
module.exports={multipliers,remember,feedback,run,view,signalsOf,SIGNALS};
