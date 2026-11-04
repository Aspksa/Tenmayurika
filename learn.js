'use strict';
// Самообучение памяти: из текста (заметка, сообщение в чате) извлекаются кандидаты в факты.
// С подключённой моделью — её силами и с навыками запоминания, без модели — простыми правилами русского языка.
// Кандидаты не сохраняются сами: пользователь подтверждает их в разделе «Мозг».
const llm=require('./llm');
const memory=require('./memory-core');
const memskills=require('./memskills');

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
// Разбор моделью с навыками запоминания: под текст подобраны 2–3 навыка (memskills.js), а рядом —
// похожие факты, которые уже есть, чтобы модель могла не только добавить новое, но и обновить
// или отставить известное (FACT / UPDATE / RETIRE / NONE).
async function byModel(text,skills,similar,context=[]){
 const known=similar.length?'\n\nУже известно (номер. субъект | связь | объект):\n'+similar.map((f,i)=>(i+1)+'. '+f.subject+' | '+f.predicate+' | '+f.object).join('\n'):'';
 const ops=similar.length?'\nUPDATE: номер | субъект | связь | объект — известный факт изменился (новая версия целиком)\nRETIRE: номер — известный факт явно отменён или неверен':'';
 const msg=await llm.complete({messages:[
  {role:'system',content:'Ты запоминаешь устойчивые факты о человеке и его мире. Пользуйся навыками запоминания:\n'+memskills.promptFor(skills)+'\n\nОтвечай только строками:\nFACT: субъект | связь | объект — новый факт'+ops+'\nНе больше '+MAX_FACTS+' строк. Пиши по-русски, коротко. Если пользователь говорит о себе, субъект — «Я». Что было раньше и уже не так — начни связь со слова «раньше» (Я | раньше жил в | Москва). Если сказано, с какого времени, допиши в объект «(с 2021)». Мнения и оценки пиши через «считает» (Я | считает | …). Если нечего записать, ответь NONE.'},
  {role:'user',content:dialogText(context)+text+known}]});
 return {facts:parseLines(msg.content),...parseOps(msg.content,similar)};
}
// Реплики перед сообщением: только чтобы понять, о ком «он/она» и на какой вопрос короткий ответ.
function dialogText(context){
 const lines=(Array.isArray(context)?context:[]).filter(m=>m&&typeof m.text==='string'&&m.text.trim()).slice(-3).map(m=>(m.role==='assistant'?'Ассистентка: ':'Человек: ')+m.text.slice(0,600));
 return lines.length?'Перед этим в разговоре (только чтобы понять, о ком речь и на какой вопрос отвечают; сами факты бери из сообщения человека, «он/она» заменяй на имя):\n'+lines.join('\n')+'\n\nСообщение человека:\n':'';
}
function parseOps(text,similar){
 const updates=[],retire=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const t=line.trim().replace(/^[-•*\s]+/,'');
  let m=t.match(/^UPDATE:\s*(\d+)\s*\|(.+)$/i);
  if(m){const old=similar[Number(m[1])-1],parts=m[2].split('|').map(clean);if(old&&parts.length===3&&parts.every(x=>x&&x.length<=300))updates.push({old,fact:{subject:parts[0],predicate:parts[1].slice(0,150),object:parts[2]}});continue}
  m=t.match(/^RETIRE:\s*(\d+)/i);if(m){const old=similar[Number(m[1])-1];if(old&&!retire.some(x=>x.id===old.id))retire.push(old)}
 }
 return {updates,retire};
}
// Похожие известные факты: по словам текста.
function similarFacts(text,limit=10){
 try{return memory.factsById(memory.searchIndex(String(text).slice(0,300),{kinds:['fact'],limit}).map(h=>h.ref)).slice(0,limit)}catch{return []}
}
// Уже известное не предлагаем повторно.
// Возвращает сам известный факт (повтор подтверждает его, evidence.js) или null.
function known(f){
 try{const k=x=>String(x).toLocaleLowerCase();return memory.queryFacts({subject:f.subject,limit:500}).find(x=>!x.valid_to&&k(x.predicate)===k(f.predicate)&&k(x.object)===k(f.object))||null}catch{return null}
}
// input: {text, source?, domain?, context?:[{role,text}]}. Опции: bank — банк навыков для пробы (без записи статистики), dry — не считать применение.
async function extract(input,{bank=null,dry=false,prepared=null}={}){
 if(!input||typeof input!=='object'||typeof input.text!=='string'||!input.text.trim())throw new TypeError('Invalid text');
 const text=input.text.slice(0,MAX_TEXT);
 const domain=['chat','note','task'].includes(input.domain)?input.domain:memskills.domainOf(input.source);
 let facts,source='rules',note,updates=[],retire=[],used=[];
 if(prepared){facts=prepared.result.facts;updates=prepared.result.updates;retire=prepared.result.retire;used=prepared.skills.map(s=>s.name);source='model';if(!dry)memskills.recordUse(used,typeof input.source==='string'?input.source:null)}else if(llm.config()){try{
  const similar=similarFacts(text),skills=memskills.select((Array.isArray(input.context)?input.context.map(m=>m&&m.text||'').join(' ').slice(-600)+' ':'')+text,{domain,similar:similar.length,bank});
  const r=await byModel(text,skills,similar,input.context);facts=r.facts;updates=r.updates;retire=r.retire;used=skills.map(s=>s.name);source='model';
  if(!dry)memskills.recordUse(used,typeof input.source==='string'?input.source:null);
 }catch(e){note='Модель не ответила, разобрала по правилам';console.error('Learn model failed:',e.name)}}
 if(!facts)facts=byRules(text);
 const seen=new Set(),out=[],confirmed=[];
 for(const f of facts){const key=[f.subject,f.predicate,f.object].join('|').toLocaleLowerCase();if(seen.has(key))continue;seen.add(key);const k=known(f);if(k){if(!confirmed.includes(k.id))confirmed.push(k.id);continue}out.push(f);if(out.length>=MAX_FACTS)break}
 return {facts:out,confirmed,source,domain,skills:used,updates:updates.map(u=>({id:u.old.id,old:{subject:u.old.subject,predicate:u.old.predicate,object:u.old.object},fact:u.fact})),retire:retire.map(f=>({id:f.id,subject:f.subject,predicate:f.predicate,object:f.object})),...(note?{note}:{})};
}
// Model output must contain every source separately; otherwise fall back to independent extraction.
async function extractBatch(inputs){
 if(!Array.isArray(inputs)||inputs.length<2||!llm.config())return Promise.all(inputs.map(x=>extract(x)));
 const data=inputs.map((input,i)=>{const text=input.text.slice(0,MAX_TEXT),similar=similarFacts(text),skills=memskills.select((input.context||[]).map(m=>m.text||'').join(' ').slice(-600)+' '+text,{domain:'chat',similar:similar.length});return {id:i,text,similar,skills,context:input.context||[]}});
 try{const blocks=data.map(x=>({id:x.id,text:x.text,context:dialogText(x.context),skills:memskills.promptFor(x.skills),known:x.similar.map((f,i)=>({number:i+1,subject:f.subject,predicate:f.predicate,object:f.object}))}));const msg=await llm.complete({messages:[{role:'system',content:'Извлеки устойчивые факты отдельно для каждого сообщения. Верни только JSON-массив объектов {"id": номер, "lines": "строки"}. Для каждого id обязательно один объект. В lines используй FACT: субъект | связь | объект; UPDATE: номер известного факта | субъект | связь | объект; RETIRE: номер; либо NONE. Не смешивай источники. Контекст — только для понимания местоимений, не записывай его как факты.'},{role:'user',content:JSON.stringify(blocks)}]});const raw=String(msg.content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length!==data.length)throw Error('Incomplete batch');const byId=new Map();for(const item of parsed){if(!Number.isInteger(item.id)||item.id<0||item.id>=data.length||byId.has(item.id)||typeof item.lines!=='string')throw Error('Invalid batch');byId.set(item.id,item.lines)}
 const out=[];for(const x of data){const lines=byId.get(x.id);if(!/^(?:\s*(?:FACT:|UPDATE:|RETIRE:|NONE)\s*.*\s*)+$/im.test(lines))throw Error('Invalid response');out.push(await extract(inputs[x.id],{prepared:{skills:x.skills,result:{facts:parseLines(lines),...parseOps(lines,x.similar)}}}))}return out;
 }catch(e){console.error('Batch learning fallback:',e.name);const out=[];for(const input of inputs)out.push(await extract(input));return out}
}
module.exports={extract,extractBatch,byRules,parseLines,parseOps};
