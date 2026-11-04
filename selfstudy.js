'use strict';
// Самоучёба памяти (по мотивам MemSkill). Пока с аватаром не разговаривают, она сама:
//  • сдаёт себе экзамен — составляет вопросы по недавней переписке и проверяет, находит ли память ответ;
//    промах идёт в журнал с причиной (не записано / не нашлось / размыто);
//  • думает над промахами кругами: разбор → самокритика → предложение (не больше двух изменений);
//  • пробует изменение навыков на текстах промахов и оставляет его, только если стало лучше;
//  • после удачного изменения перечитывает старые сообщения, где оно пригодится;
//  • следит, не стало ли хуже после изменения, и тогда откатывается к лучшей версии банка;
//  • после трёх неудачных попыток подряд перестаёт крутиться на месте и просит подсказки.
// Без модели работают экзамен по правилам и журнал промахов; навыки правит только модель.
const memory=require('./memory-core');
const memskills=require('./memskills');
const learn=require('./learn');
const chatlog=require('./chatlog');
const {use}=require('./brain-db');
const TEST_PER_RUN=4,TEST_DAYS=14,MAX_CHANGES=2,TRIAL_CASES=4,STUBBORN=3,MIN_TESTS=6,DROP=.15;
const now=()=>new Date().toISOString();
const line=f=>f.subject+' '+f.predicate+' '+f.object;

// Ответ найден, если большинство основ слов ожидаемого ответа есть в найденном.
function answerIn(expected,texts){
 const need=memory.terms(expected);if(!need.length)return false;
 const hay=new Set(texts.flatMap(t=>memory.terms(t)));
 return need.filter(x=>hay.has(x)).length>=Math.ceil(need.length*.6);
}
function tested(source){return use(db=>!!db.prepare('SELECT 1 FROM memory_selftests WHERE source=? LIMIT 1').get(source))}
function saveTest(source,question,expected,passed,cause){use(db=>db.prepare('INSERT INTO memory_selftests(source,question,expected,passed,cause,bank,at) VALUES(?,?,?,?,?,?,?)').run(source,question.slice(0,300),String(expected).slice(0,200),passed,cause||null,memskills.bankVersion(),now()))}
async function questionsFor(text,complete){
 if(complete){try{
  const msg=await complete({messages:[{role:'system',content:'Составь не больше двух коротких вопросов о человеке, ответ на которые прямо есть в его сообщении, и сам ответ в 1–4 словах. Только строки «Q: вопрос | A: ответ». Если спросить нечего (вопрос, приветствие, просьба), ответь NONE.'},{role:'user',content:text.slice(0,1500)}]});
  const out=[];for(const l of String(msg.content||'').split(/\r?\n/)){const m=l.trim().match(/^Q:\s*(.{3,200}?)\s*\|\s*A:\s*(.{1,120})$/i);if(m)out.push({q:m[1].trim(),a:m[2].trim()})}
  return out.slice(0,2);
 }catch(e){console.error('Self-test model failed:',e.name)}}
 return learn.byRules(text).slice(0,2).map(f=>({q:f.subject+' '+f.predicate,a:f.object}));
}
// Почему не нашла: нужное есть в памяти — «не нашлось»; из этого сообщения что-то записано, но не то — «размыто»; иначе «не записано».
function causeOf(expected,source){
 const active=memory.queryFacts({limit:5000}).filter(f=>!f.valid_to);
 if(active.some(f=>answerIn(expected,[line(f)])))return 'not_found';
 if(active.some(f=>f.source_id===source))return 'vague';
 return 'not_stored';
}
async function selfTest({ws,complete=null,limit=TEST_PER_RUN}={}){
 const {recall}=require('./recall');
 const since=new Date(Date.now()-TEST_DAYS*864e5).toISOString();
 // Мечты души задают темы: сообщения о том, к чему она тянется, проверяются первыми.
 let focus=null,psyche=null;try{psyche=require('./psyche');focus=psyche.focus();if(!focus.goals.length)focus=null}catch{focus=null}
 const all=chatlog.recent(300).filter(m=>m.role==='user'&&m.learned===1&&m.at>=since&&m.text.trim().length>=12&&!tested('chat:'+m.id));
 const near=new Map();if(focus)for(const m of all){const x=psyche.focusMatch(m.text,focus);if(x)near.set(m.id,x)}
 const msgs=[...all.filter(m=>near.has(m.id)),...all.filter(m=>!near.has(m.id))].slice(0,limit);
 const res={messages:0,tested:0,passed:0,misses:[],focused:0};
 for(const m of msgs){
  const nm=near.get(m.id);if(nm){res.focused++;try{require('./ties').add({from:{kind:'goal',id:nm.goal.id,label:nm.goal.text},to:{kind:'exam',label:m.text.slice(0,100)},why:'мечта выбрала тему экзамена'})}catch(e){console.error('Tie failed:',e.name)}}
  const source='chat:'+m.id;res.messages++;
  const qs=await questionsFor(m.text,complete);
  if(!qs.length){saveTest(source,'(нечего спросить)','',2,null);continue}
  for(const {q,a} of qs){
   const r=await recall(q,{ws,topic:false,factLimit:8,noteLimit:3});
   const ok=answerIn(a,[...r.facts.map(line),...r.notes.map(n=>n.title+' '+String(n.content||'').slice(0,400))]);
   res.tested++;
   if(ok){res.passed++;saveTest(source,q,a,1,null);continue}
   const cause=causeOf(a,source);saveTest(source,q,a,0,cause);
   memskills.addMiss({kind:'self',question:q,expected:a,cause,text:m.text,source,skills:memskills.runFor(source),severity:.6});
   res.misses.push({question:q,expected:a,cause});
  }
 }
 return res;
}
// Доля сданных вопросов за промежуток (вопросы без ответа в сообщении не считаются).
function rate(from,to){
 const r=use(db=>db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(passed),0) AS ok FROM memory_selftests WHERE passed IN (0,1) AND at>=? AND at<?').get(from,to||'9999'));
 return {n:r.n,rate:r.n?r.ok/r.n:null};
}
function score(){const all=rate('0000');return {...all,current:watchInfo().current}}

/* ---------- Думать кругами ---------- */
function bankText(bank){return bank.map(s=>'- '+s.name+' «'+s.title+'»: '+s.purpose+(s.cues.length?' (подсказки: '+s.cues.slice(0,10).join(', ')+')':'')).join('\n')}
function casesText(cases){return cases.map((c,i)=>(i+1)+'. Вопрос: '+c.question+(c.expected?' | нужный ответ: '+c.expected:'')+' | причина: '+({not_stored:'не записано',vague:'записано размыто или неверно',not_found:'записано, но не нашлось'}[c.cause])+' | повторов: '+c.count+(c.text?'\n   Исходный текст: '+c.text.slice(0,300):'')).join('\n')}
function failedText(evo){return (evo.failed||[]).slice(-5).map(f=>'- '+f.summary+' (проба: было '+f.before+', стало '+f.after+')').join('\n')||'нет'}
function json(text){const s=String(text||''),a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<=a)return null;try{return JSON.parse(s.slice(a,b+1))}catch{return null}}
async function think(complete,bank,cases,evo){
 const ctx='Навыки запоминания (не факты, а способы запоминать: что извлекать из текста, на что смотреть):\n'+bankText(bank)+'\n\nПромахи памяти:\n'+casesText(cases)+'\n\nНеудачные прошлые попытки (не повторяй их):\n'+failedText(evo);
 // Круг 1: разбор.
 const a=await complete({messages:[{role:'system',content:'Ты разбираешь, почему память ассистентки промахивается. Сгруппируй промахи по общей причине и скажи для каждой группы, какой навык запоминания стоит уточнить или какой новый завести. Если причина «не нашлось» — это поиск, навыки не меняй. Коротко, по-русски.'},{role:'user',content:ctx}]});
 // Круг 2: самокритика.
 const b=await complete({messages:[{role:'system',content:'Проверь разбор: всё ли верно с причинами, не пропущены ли группы, не слишком ли общие предложения. Дай исправленный разбор, коротко, по-русски.'},{role:'user',content:ctx+'\n\nРазбор:\n'+String(a.content||'').slice(0,3000)}]});
 // Круг 3: предложение.
 const c=await complete({messages:[{role:'system',content:'По разбору предложи не больше '+MAX_CHANGES+' изменений банка навыков запоминания. Отвечай только JSON: {"changes":[{"action":"refine"|"add","name":"имя навыка для refine","title":"название","purpose":"зачем","when":"когда применять","how":"как","avoid":"чего избегать","cues":["подсказки — начала слов, по которым навык выбирается"],"domains":["chat"|"note"|"task"],"reason":"почему"}]}. Если менять нечего, {"changes":[]}.'},{role:'user',content:ctx+'\n\nРазбор:\n'+String(b.content||'').slice(0,3000)}]});
 const plan=json(c.content);
 return {analysis:String(b.content||a.content||'').slice(0,1000),changes:Array.isArray(plan?.changes)?plan.changes.slice(0,MAX_CHANGES):[]};
}
// Проба: тексты промахов разбираются старым и новым банком; нужный ответ должен появиться в записанном.
async function trial(cases,bank,candidate){
 let before=0,after=0;const used=cases.filter(c=>c.text&&c.expected).slice(0,TRIAL_CASES);
 for(const c of used){
  const domain=memskills.domainOf(c.source);
  const got=r=>[...r.facts.map(line),...(r.updates||[]).map(u=>line(u.fact))];
  try{if(answerIn(c.expected,got(await learn.extract({text:c.text,domain},{bank,dry:true}))))before++}catch{}
  try{if(answerIn(c.expected,got(await learn.extract({text:c.text,domain},{bank:candidate,dry:true}))))after++}catch{}
 }
 return {cases:used.length,before,after};
}
async function evolve({complete=null}={}){
 if(!complete)return {skipped:'model'};
 const evo=memskills.evoState();
 if(evo.help)return {blocked:true,help:evo.help};
 const cases=memskills.queue({causes:['not_stored','vague'],limit:8});
 if(cases.length<2)return {skipped:'few'};
 const bank=memskills.list();
 let plan;try{plan=await think(complete,bank,cases,evo)}catch(e){console.error('Skill design failed:',e.name);return {skipped:'error'}}
 const candidate=memskills.withChanges(bank,plan.changes),changed=candidate.filter(s=>s.changed);
 const keys=cases.map(c=>c.key);
 if(!changed.length){memskills.markMisses(keys,'tried');return {skipped:'nochange',analysis:plan.analysis}}
 const t=await trial(cases,bank,candidate);
 const summary=changed.map(s=>(s.isNew?'новый «':'уточнить «')+s.title+'»').join(', ');
 if(t.cases&&t.after>t.before){
  const adopted=memskills.adopt(candidate,{reason:plan.changes.map(c=>c.reason).filter(Boolean).join(' ').slice(0,300)||summary,trialScore:t.after/t.cases,change:{changes:plan.changes,trial:t}});
  const old=new Map(bank.map(s=>[s.name,s]));
  const cues=changed.flatMap(s=>s.isNew?s.cues:s.cues.filter(c=>!old.get(s.name)?.cues.includes(c)));
  const relearned=chatlog.relearn(cues);
  memskills.markMisses(keys,'used');memskills.setEvo({...evo,streak:0,failed:[]});
  return {adopted,trial:t,relearned,analysis:plan.analysis};
 }
 const failed=[...(evo.failed||[]),{at:now(),summary,before:t.before,after:t.after}].slice(-10),streak=(evo.streak||0)+1;
 const help=streak>=STUBBORN?{at:now(),text:'Я '+streak+' раза пробовала научиться запоминать лучше, но проба не помогала. Например, не выходит запомнить: «'+cases[0].question+'»'+(cases[0].expected?' → '+cases[0].expected:'')+'. Подскажи, что в таких разговорах важно запоминать.'}:null;
 memskills.markMisses(keys,'tried');memskills.setEvo({failed,streak,help});
 return {rejected:true,trial:t,summary,help,analysis:plan.analysis};
}

/* ---------- Откат ---------- */
// Окно снимка — от его создания до следующего. Если с текущим банком экзамен заметно хуже, чем с лучшим прошлым, — откат.
function windows(){
 const snaps=memskills.snapshots(20).reverse();
 return snaps.map((s,i)=>({...s,...rate(s.at,snaps[i+1]?.at)}));
}
function watchInfo(){const w=windows();const cur=w.find(s=>s.status==='current')||w[w.length-1]||null;return {current:cur?{id:cur.id,n:cur.n,rate:cur.rate}:null,windows:w.map(s=>({id:s.id,at:s.at,n:s.n,rate:s.rate,status:s.status,kind:s.change?.kind||'change'}))}}
function watch(){
 const w=windows(),cur=w.find(s=>s.status==='current');
 if(!cur||cur.n<MIN_TESTS+2)return null;
 const best=w.filter(s=>s.id!==cur.id&&s.n>=MIN_TESTS&&s.rate!=null).sort((a,b)=>b.rate-a.rate)[0];
 if(!best||cur.rate>=best.rate-DROP)return null;
 const reason='после изменения самоэкзамен стал хуже: '+Math.round(cur.rate*100)+'% вместо '+Math.round(best.rate*100)+'%';
 const r=memskills.restore(best.id,reason);
 const evo=memskills.evoState(),streak=(evo.streak||0)+1;
 memskills.setEvo({...evo,streak,failed:[...(evo.failed||[]),{at:now(),summary:'изменение банка (откат)',before:Math.round(best.rate*100)+'%',after:Math.round(cur.rate*100)+'%'}].slice(-10),help:evo.help||(streak>=STUBBORN?{at:now(),text:'Мои изменения в том, как я запоминаю, уже '+streak+' раза не помогали, и я откатилась назад. Подскажи, что важно запоминать.'}:null)});
 return {...r,reason,before:best.rate,after:cur.rate};
}
// Дневник: что изменилось в навыках запоминания.
function learnedLog(limit=20){return memskills.historyList(limit).filter(h=>h.change!=='seed')}
function selftests(limit=20){return use(db=>db.prepare('SELECT * FROM memory_selftests WHERE passed IN (0,1) ORDER BY id DESC LIMIT ?').all(limit)).map(r=>({question:r.question,expected:r.expected,passed:!!r.passed,cause:r.cause,at:r.at}))}
module.exports={answerIn,selfTest,evolve,watch,watchInfo,score,learnedLog,selftests,questionsFor,trial,think,causeOf};
