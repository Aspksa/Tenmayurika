'use strict';
// Поправка словами меняет саму память, а не только помечает эпизод.
// «Нет, Анна живёт в Перми» → новый факт с полной уверенностью, а спорящий с ним старый
// («Анна живёт в Казани») уходит в историю. «Забудь это» / «это неправда» без нового факта
// отставляет то, что аватар вспомнил в поправленном ответе (только если это был один факт).
// С моделью решение принимает она: какие из вспомненных фактов отставить и что добавить.
const memory=require('./memory-core');
const learn=require('./learn');
const PREFIX=/^(?:нет|не так|не то|не совсем|неправильно|неверно|ошиблась|ошибка|я (?:имела?|хотела?) в виду|имелось в виду|я про|я о другом)[\s,.!:;—–-]*/i;
const FORGET=/(?:забудь|это неправда|это не так|это неверно|это ошибка|это устарело|больше не)/i;
function strip(text){let t=String(text||'').trim();for(let i=0;i<3&&PREFIX.test(t);i++)t=t.replace(PREFIX,'').trim();return t.replace(/^(?:что|а)\s+/i,'')}
async function byModel(complete,facts,text){
 const list=facts.map((f,i)=>(i+1)+'. '+f.subject+' | '+f.predicate+' | '+f.object).join('\n');
 const msg=await complete({messages:[
  {role:'system',content:'Пользователь поправил ответ ассистентки. Реши, что изменить в памяти. Отвечай только строками:\nRETIRE: номер — если вспомненный факт неверен или устарел;\nFACT: субъект | связь | объект — верный факт из поправки.\nЕсли менять нечего, ответь NONE. Пиши по-русски.'},
  {role:'user',content:'Вспомненные факты:\n'+(list||'(нет)')+'\n\nПоправка пользователя: '+text}]});
 const retire=[],add=learn.parseLines(msg.content);
 for(const line of String(msg.content||'').split(/\r?\n/)){const m=line.trim().match(/^RETIRE:\s*(\d+)/i);if(m&&facts[Number(m[1])-1])retire.push(facts[Number(m[1])-1].id)}
 return {retire,add};
}
// episode — эпизод опыта, который поправили; complete — функция модели или null.
async function apply(episode,correction,{complete=null}={}){
 const text=strip(correction);if(!text||text.length<4)return {added:[],retired:[]};
 const recalled=memory.factsById(episode?.recalled?.facts||[]);
 let plan=null;
 if(complete){try{plan=await byModel(complete,recalled,text)}catch(e){console.error('Correction model failed:',e.name)}}
 if(!plan){
  const add=learn.byRules(text),retire=[];
  if(!add.length&&FORGET.test(correction)&&recalled.length===1)retire.push(recalled[0].id);
  plan={add,retire};
 }
 const added=[],retired=new Set();
 for(const f of plan.add.slice(0,5)){
  try{
   const r=memory.addFact({subject:f.subject,predicate:f.predicate,object:f.object,sourceId:'correction:'+(episode?.id||'chat'),confidence:1});
   added.push({id:r.id,subject:f.subject,predicate:f.predicate,object:f.object,duplicate:r.duplicate});
   for(const id of memory.supersede(r.id))retired.add(id);
  }catch(e){if(!(e instanceof TypeError))throw e}
 }
 for(const id of plan.retire)if(memory.retireFact(id,'corrected'))retired.add(id);
 const gone=retired.size?memory.queryFacts({limit:5000}).filter(f=>retired.has(f.id)):[];
 return {added,retired:gone.map(f=>({id:f.id,subject:f.subject,predicate:f.predicate,object:f.object}))};
}
function describe(r){
 if(!r||(!r.added.length&&!r.retired.length))return '';
 const parts=[];
 const fresh=r.added.filter(f=>!f.duplicate);
 if(fresh.length)parts.push('запомнила '+fresh.map(f=>f.subject+' — '+f.predicate+' → '+f.object).join('; '));
 if(r.retired.length)parts.push('убрала в историю '+r.retired.map(f=>'«'+f.subject+' — '+f.predicate+' → '+f.object+'»').join(', '));
 return parts.length?'✎ Поправила память: '+parts.join(', ')+'.':'';
}
module.exports={apply,describe,strip};
