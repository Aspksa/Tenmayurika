'use strict';
// Знакомство (идея блока onboarding из letta-code): список того, что Юрика хочет узнать о человеке.
// Пункт закрывается сам, когда в памяти появляется нужный факт о «Я» (или пожелание к ответам),
// либо когда человек не хочет отвечать. Пока список не закрыт, модель получает подсказку: если к месту,
// в конце ответа мягко задать один вопрос — не чаще, чем раз в несколько сообщений. Когда всё узнано
// или человек закончил знакомство, список исчезает из подсказки.
const memory=require('./memory-core');
const preferences=require('./preferences');
const {state,setState}=require('./brain-db');
const EVERY=Number(process.env.TENMAYURIKA_ONBOARD_EVERY)||3;
const ITEMS=[
 {id:'name',q:'Как тебя зовут и как к тебе обращаться?',re:/зов|имя|назыв|обращ/i,pref:['name','address']},
 {id:'work',q:'Чем ты занимаешься: работа, учёба?',re:/работа|учит|учу|учё|профес|занима|должност|служ/i},
 {id:'home',q:'Где ты живёшь?',re:/жив[её]т|живу|город|родом|переехал/i},
 {id:'people',q:'Кто твои близкие?',re:/мам|пап|муж|жен|брат|сестр|друг|подруг|сын|доч|дет|ребён|ребен|бабуш|дедуш|партн|родител/i},
 {id:'hobby',q:'Что любишь делать в свободное время?',re:/люб|увлека|хобби|нрав|занимается\s+спорт|игра/i},
 {id:'now',q:'Что сейчас для тебя главное? Над чем работаешь или о чём мечтаешь?',re:/цель|проект|хоч|мечта|планир|строит|разрабат/i},
 {id:'style',q:'Как мне лучше отвечать: коротко или подробно, серьёзно или с шутками?',pref:['length','tone','format','emoji']}
];
const read=()=>{const s=state('onboarding',null);return s&&typeof s==='object'?s:{items:{},turns:0,lastAsk:-99,finished:null,started:new Date().toISOString()}};
const save=s=>setState('onboarding',s);
function covered(item,facts,prefs){
 if(item.pref&&prefs.some(p=>item.pref.includes(p.aspect)))return true;
 return !!item.re&&facts.some(f=>item.re.test(f.predicate));
}
// Пункты, которые закрылись сами, отмечаются; когда открытых не осталось — знакомство закончено.
function refresh(){
 const s=read();if(s.finished)return s;
 let facts=[],prefs=[];
 try{facts=memory.queryFacts({subject:'Я',limit:500}).filter(f=>!f.valid_to)}catch{}
 try{prefs=preferences.list()}catch{}
 let changed=false;
 for(const it of ITEMS){if(s.items[it.id])continue;if(covered(it,facts,prefs)){s.items[it.id]={done:true,at:new Date().toISOString()};changed=true}}
 if(ITEMS.every(it=>s.items[it.id])){s.finished=new Date().toISOString();changed=true}
 if(changed)save(s);
 return s;
}
function status(){
 const s=refresh();
 return {active:!s.finished,finished:s.finished,started:s.started,items:ITEMS.map(it=>({id:it.id,q:it.q,done:!!s.items[it.id]?.done,skipped:!!s.items[it.id]?.skipped})),done:ITEMS.filter(it=>s.items[it.id]).length,total:ITEMS.length};
}
function mark(id,{skipped=false}={}){
 const it=ITEMS.find(x=>x.id===id||x.q===id);if(!it)throw new TypeError('Нет такого пункта знакомства. Есть: '+ITEMS.map(x=>x.id).join(', '));
 const s=read();s.items[it.id]={done:!skipped,skipped:!!skipped,at:new Date().toISOString()};
 if(ITEMS.every(x=>s.items[x.id]))s.finished=new Date().toISOString();
 save(s);return status();
}
function finish(){const s=read();s.finished=s.finished||new Date().toISOString();save(s);return status()}
function restart(){save({items:{},turns:0,lastAsk:-99,finished:null,started:new Date().toISOString()});return status()}
// Ход разговора: возвращает подсказку для модели или пустую строку (вопрос — не чаще раза в EVERY сообщений).
function turn(){
 const s=refresh();if(s.finished)return '';
 s.turns=(s.turns||0)+1;
 const open=ITEMS.filter(it=>!s.items[it.id]);
 let text='';
 if(open.length&&s.turns-(s.lastAsk??-99)>=EVERY){
  s.lastAsk=s.turns;
  text='\nЗнакомство: ты ещё не знаешь о человеке: '+open.slice(0,3).map(it=>'«'+it.q+'» ('+it.id+')').join(', ')+'. Если это к месту и не мешает ответу, в самом конце мягко задай ОДИН такой вопрос. Сначала ответь на то, что спросили. Если человек не хочет об этом говорить, вызови onboarding_mark с skipped=true.';
 }
 save(s);
 return text;
}
module.exports={ITEMS,refresh,status,mark,finish,restart,turn};
