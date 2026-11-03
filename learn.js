'use strict';
// Самообучение памяти: из текста (заметка, сообщение в чате) извлекаются кандидаты в факты.
// С подключённой моделью — её силами, без модели — простыми правилами русского языка.
// Кандидаты не сохраняются сами: пользователь подтверждает их в разделе «Мозг».
const llm=require('./llm');
const memory=require('./memory-core');

const MAX_TEXT=8000,MAX_FACTS=8;
const VERBS='не любит|любит|обожает|ненавидит|живёт в|живет в|переехал в|переехала в|работает в|работает|учится в|родился в|родилась в|родился|родилась|зовут|предпочитает|боится|увлекается|занимается|хочет|мечтает о|умеет|говорит на|пьёт|пьет|ест|играет в|ездит на|водит';
// Частные правила раньше общего: «Меня зовут Анна» — это «Я | зовут | Анна», а не «Меня | зовут | Анна».
const RULES=[
 [/^у\s+(.{2,40}?)\s+день\s+рождения\s+(.{2,40})$/iu,m=>[m[1],'день рождения',m[2]]],
 [/^(.{2,40}?)\s+[—–-]\s+это\s+(.{2,80})$/iu,m=>[m[1],'это',m[2]]],
 [/^меня\s+зовут\s+(.{2,40})$/iu,m=>['Я','зовут',m[1]]],
 [/^я\s+(люблю|не люблю|живу в|работаю в|учусь в|боюсь|хочу|пью|умею)\s+(.{2,80})$/iu,m=>['Я',m[1],m[2]]],
 [new RegExp('^(.{2,40}?)\\s+((?:не\\s+)?(?:'+VERBS+'))\\s+(.{2,80})$','iu'),m=>[m[1],m[2],m[3]]],
];
const clean=s=>String(s||'').replace(/^[«"'\s]+|[»"'\s.,;:!?]+$/g,'').replace(/\s+/g,' ').trim();
function byRules(text){
 const out=[];
 // Предложения вместе со знаком конца: вопросы («Анна живёт в Казани?») — не факты.
 for(const raw of String(text).match(/[^.!?\n;]+[.!?\n;]*/g)||[]){
  if(/\?/.test(raw))continue;
  const line=clean(raw.replace(/^(кстати|вообще|а ещё|а еще|и|ну)\s*,?\s+/i,''));if(line.length<5)continue;
  for(const [re,pick] of RULES){const m=line.match(re);if(m){const [s,p,o]=pick(m).map(clean);if(s&&p&&o)out.push({subject:s.charAt(0).toUpperCase()+s.slice(1),predicate:p.toLocaleLowerCase(),object:o});break}}
 }
 return out;
}
function parseLines(text){
 const out=[];
 for(const line of String(text).split(/\r?\n/)){
  const t=line.trim().replace(/^[-•*\d.)\s]+/,'');if(!/^FACT:/i.test(t))continue;
  const parts=t.slice(5).split('|').map(clean);if(parts.length===4&&!parts[0])parts.shift();
  if(parts.length===3&&parts.every(x=>x&&x.length<=300))out.push({subject:parts[0],predicate:parts[1].slice(0,150),object:parts[2]});
 }
 return out;
}
async function byModel(text){
 const msg=await llm.complete({messages:[
  {role:'system',content:'Ты извлекаешь устойчивые факты о человеке и его мире: люди, места, предпочтения, привычки, даты, работа. Отвечай только строками вида\nFACT: субъект | связь | объект\nНе больше '+MAX_FACTS+'. Пиши по-русски, коротко. Если пользователь говорит о себе, субъект — «Я». Мнения о погоде, разовые действия и вопросы — не факты. Если фактов нет, ответь NONE.'},
  {role:'user',content:text}]});
 return parseLines(msg.content);
}
// Уже известное не предлагаем повторно.
function known(f){
 try{const k=x=>String(x).toLocaleLowerCase();return memory.queryFacts({subject:f.subject,limit:500}).some(x=>!x.valid_to&&k(x.predicate)===k(f.predicate)&&k(x.object)===k(f.object))}catch{return false}
}
async function extract(input){
 if(!input||typeof input!=='object'||typeof input.text!=='string'||!input.text.trim())throw new TypeError('Invalid text');
 const text=input.text.slice(0,MAX_TEXT);
 let facts,source='rules',note;
 if(llm.config()){try{facts=await byModel(text);source='model'}catch(e){note='Модель не ответила, разобрала по правилам';console.error('Learn model failed:',e.name)}}
 if(!facts)facts=byRules(text);
 const seen=new Set(),out=[];
 for(const f of facts){const key=[f.subject,f.predicate,f.object].join('|').toLocaleLowerCase();if(seen.has(key)||known(f))continue;seen.add(key);out.push(f);if(out.length>=MAX_FACTS)break}
 return {facts:out,source,...(note?{note}:{})};
}
module.exports={extract,byRules,parseLines};
