'use strict';
// Вопрос в контексте разговора. Память ищется по словам вопроса, а «а она где работает?» само по себе
// ничего не находит: «она» — это та, о ком говорили только что. Перед поиском вопрос дополняется
// тем, о ком или о чём шла речь (без модели, по правилам):
//  • местоимения и «там/туда/это» — к вопросу добавляется последнее упомянутое лицо или вещь;
//  • короткое «а Оля?» после «где живёт Аня?» — у прошлого вопроса берётся его суть, а лицо меняется.
// Кандидаты — названия из последних реплик (с большой буквы не в начале предложения или известные памяти)
// и записи, горячие в рабочей памяти (working.js). Чем свежее упоминание, тем выше.
const memory=require('./memory-core');
const working=require('./working');

const PRONOUN=/(^|[^\p{L}])(он|она|оно|они|его|её|ее|ему|ей|им|ими|их|него|неё|нее|нему|ней|них|ним|нём|нем|там|туда|оттуда|тот|та|те|того|той|тем|этот|эта|этого|этой|этим|этом)(?=[^\p{L}]|$)/iu;
const QWORDS=new Set('кто что где когда как какой какая какое какие сколько почему зачем чем куда откуда чей чья чьи ли а и но да нет ну мне меня мой моя мои ты тебя твой я мы вы привет спасибо'.split(' '));
const norm=s=>String(s||'').toLocaleLowerCase().replace(/ё/g,'е');
const STOP=new Set('это этот эта эти там тут вот так уже ещё еще очень'.split(' '));

// Названия в тексте: слова с большой буквы не в начале предложения, кавычки «…».
function namesIn(text){
 const t=String(text||''),out=[];
 for(const m of t.matchAll(/«([^»]{2,40})»/g))out.push(m[1].trim());
 for(const sentence of t.split(/(?<=[.!?\n])\s+/)){
  const words=sentence.split(/\s+/);
  words.forEach((w,i)=>{const x=w.replace(/^[^\p{L}]+|[^\p{L}-]+$/gu,'');if(x.length>=2&&/^\p{Lu}/u.test(x)&&!QWORDS.has(norm(x))&&!PRONOUN.test(' '+x+' ')&&!/^(Юрика|Ты|Вы)$/.test(x)&&(i>0||known(x)))out.push(x)});
 }
 return out;
}
function known(name){try{return memory.relations(name,1).length>0}catch{return false}}
// Падежи: «Ани», «Аню», «Аней» → «Аня», если такое лицо известно памяти.
function canon(word,facts){
 const w=norm(word),stem=w.length>3?w.slice(0,-1):w;
 for(const f of facts)for(const e of [f.subject,f.object]){const k=norm(e);if(k===w||(k.length>3&&k.slice(0,-1)===stem))return e}
 if(known(word))return word;
 // Окончания падежей: «Аню», «Ани» → «Аня», «Олей» → «Оля», «Игоря» → «Игорь».
 for(const cut of [1,2])if(word.length-cut>=2)for(const end of ['','а','я','ь','й','о']){const c=word.slice(0,-cut)+end;if(c!==word&&known(c))return c}
 return null;
}
function hasOwnSubject(message){
 const names=namesIn(message).filter(n=>!QWORDS.has(norm(n)));
 return names.length>0;
}
function isEllipsis(message){
 const t=norm(message).replace(/[?!.]+$/,'').trim();
 return /^(а|и)\s+/.test(t)&&t.split(/\s+/).length<=4;
}
// history — [{role,content}], свежие в конце. Возвращает {query, about:[…], reason} или {query:message}.
function expand(message,history=[]){
 const text=String(message||'').trim();if(!text)return {query:text,about:[]};
 const recent=(history||[]).slice(-6);
 const pron=PRONOUN.test(text),ellipsis=isEllipsis(text),own=hasOwnSubject(text);
 if(!pron&&!ellipsis)return {query:text,about:[]};
 // Горячие факты темы: их участники — лучшие кандидаты.
 let hot=[];try{hot=memory.factsById(working.hot('fact',8).map(h=>h.id))}catch{}
 // Кандидаты из реплик, свежие — выше; известные памяти — выше.
 const score=new Map(),names=new Map();
 recent.forEach((m,i)=>{for(const raw of namesIn(m.content)){const name=canon(raw,hot)||raw,k=norm(name);if(STOP.has(k))continue;names.set(k,name);score.set(k,(score.get(k)||0)+1+i*.5+(m.role==='user'?.3:0)+(known(name)?1.5:0))}});
 hot.forEach((f,i)=>{for(const e of [f.subject]){const k=norm(e);if(k==='я')continue;names.set(k,e);score.set(k,(score.get(k)||0)+(score.has(k)?1:.6)-i*.05)}});
 const mine=new Set(namesIn(text).map(norm));
 const ranked=[...score].filter(([k])=>!mine.has(k)).sort((a,b)=>b[1]-a[1]).map(([k])=>names.get(k));
 // «а Оля?» — суть прошлого вопроса с новым лицом.
 if(ellipsis&&own){
  const prev=[...recent].reverse().find(m=>m.role==='user');
  if(!prev)return {query:text,about:[]};
  const prevNames=new Set(namesIn(prev.content).map(norm));
  const core=String(prev.content).split(/\s+/).filter(w=>{const x=norm(w.replace(/[^\p{L}-]/gu,''));return x&&!prevNames.has(x)&&!(prevNames.size&&[...prevNames].some(n=>n.length>3&&x.startsWith(n.slice(0,-1))))}).join(' ').replace(/[?!.]+$/,'');
  return core?{query:(text.replace(/^(а|и)\s+/i,'').replace(/[?!.]+$/,'')+' '+core).trim(),about:[],reason:'ellipsis',borrowed:core}:{query:text,about:[]};
 }
 if(own||!ranked.length)return {query:text,about:[]};
 const about=ranked.slice(0,1);
 return {query:text+' '+about.join(' '),about,reason:pron?'pronoun':'ellipsis'};
}
module.exports={expand,namesIn,isEllipsis};
