'use strict';
// Чат аватара. Если в .env задан CHAT_URL (OpenAI-совместимый /chat/completions),
// ответ генерирует модель, а в контекст подставляются найденные факты и заметки.
// Без CHAT_URL аватар отвечает локально: ищет по фактам памяти и заметкам SQLite.
const memory=require('./memory-core');
const storage=require('./storage');

const MAX_MESSAGE=2000,MAX_HISTORY=12;

function words(text){return [...new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3))].slice(0,8)}

function findFacts(text){
 const seen=new Map();
 for(const term of [text,...words(text)]){
  try{for(const fact of memory.searchFacts(term.slice(0,300),10))if(!seen.has(fact.id))seen.set(fact.id,fact)}catch(e){if(!(e instanceof TypeError))throw e}
  if(seen.size>=8)break;
 }
 return [...seen.values()].slice(0,8);
}

async function findNotes(text){
 const terms=words(text);if(!terms.length)return [];
 const data=await storage.load();
 return (data.notes||[]).map(note=>{const hay=(note.title+' '+(note.content||'')).toLocaleLowerCase();return {note,score:terms.filter(t=>hay.includes(t)).length}})
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(x=>x.note);
}

function cleanHistory(history){
 if(!Array.isArray(history))return [];
 return history.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-MAX_HISTORY).map(m=>({role:m.role,content:m.text.slice(0,MAX_MESSAGE)}));
}

function localReply(name,facts,notes){
 const lines=[];
 if(facts.length){lines.push('Вот что я помню:');for(const f of facts)lines.push('• '+f.subject+' — '+f.predicate+' → '+f.object)}
 if(notes.length){lines.push(facts.length?'\nИ в заметках:':'Нашла в заметках:');for(const n of notes)lines.push('• '+n.title+(n.content?': '+n.content.slice(0,140):''))}
 if(!lines.length)lines.push('Пока ничего об этом не знаю. Расскажите — сохраню в памяти строкой «FACT: субъект | связь | объект» в заметке.');
 lines.push('\n('+name+' отвечает локально. Чтобы подключить языковую модель, задайте CHAT_URL в .env.)');
 return lines.join('\n');
}

async function modelReply(name,message,history,facts,notes){
 const context=[...facts.map(f=>'ФАКТ: '+f.subject+' | '+f.predicate+' | '+f.object),...notes.map(n=>'ЗАМЕТКА: '+n.title+' — '+(n.content||'').slice(0,500))].join('\n');
 const system='Ты '+name+' — девятихвостая лиса-кицунэ, хранительница личной памяти Tenmayurika. Отвечай по-русски, тепло и кратко.'+(context?'\nИзвестно из памяти пользователя:\n'+context:'');
 const response=await fetch(process.env.CHAT_URL,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.CHAT_API_KEY?{Authorization:'Bearer '+process.env.CHAT_API_KEY}:{})},
  body:JSON.stringify({model:process.env.CHAT_MODEL||'gpt-4o-mini',messages:[{role:'system',content:system},...history,{role:'user',content:message}]}),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error('Chat API HTTP '+response.status);
 const data=await response.json(),text=data.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim())throw Error('Empty chat reply');
 return text.trim();
}

async function reply(input){
 if(!input||typeof input!=='object'||typeof input.message!=='string'||!input.message.trim())throw new TypeError('Invalid message');
 const message=input.message.trim().slice(0,MAX_MESSAGE);
 const name=typeof input.avatar==='string'&&input.avatar.trim()?input.avatar.trim().slice(0,40):'Юрика';
 const facts=findFacts(message),notes=await findNotes(message);
 if(process.env.CHAT_URL){
  try{return {reply:await modelReply(name,message,cleanHistory(input.history),facts,notes),source:'model',facts:facts.length,notes:notes.length}}
  catch(e){console.error('Chat model failed:',e.name);return {reply:localReply(name,facts,notes),source:'local',fallback:true,facts:facts.length,notes:notes.length}}
 }
 return {reply:localReply(name,facts,notes),source:'local',facts:facts.length,notes:notes.length};
}
module.exports={reply};
