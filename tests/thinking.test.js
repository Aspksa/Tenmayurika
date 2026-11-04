'use strict';
// Мышление и развитие: время и вид фактов, сила памяти и забывание, догадки, любопытство,
// подвопросы, внутренний голос и сверка, инициатива, поток мыслей.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-thinking-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
process.env.TENMAYURIKA_ASK_EVERY='2';
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const {DatabaseSync}=require('node:sqlite');
const memory=require('../memory-core');
const meta=require('../meta');
const strength=require('../strength');
const guesses=require('../guesses');
const curiosity=require('../curiosity');
const inner=require('../inner');
const initiative=require('../initiative');
const thoughts=require('../thoughts');
const {recall}=require('../recall');
const add=(s,p,o,src='chat:1',conf=1)=>memory.addFact({subject:s,predicate:p,object:o,sourceId:src,confidence:conf});
function age(id,days){const db=new DatabaseSync(process.env.TENMAYURIKA_MEMORY_DB);const t=new Date(Date.now()-days*864e5).toISOString();db.prepare('UPDATE memory_facts SET observed_at=?,valid_from=? WHERE id=?').run(t,t,id);db.close()}

test('fact meta: past, since, opinion, origin; past and opinions do not conflict',()=>{
 assert.equal(meta.analyzeText('раньше жила в','Москва').past,1);
 assert.equal(meta.analyzeText('жил в','Москва').past,1);
 assert.equal(meta.analyzeText('переехала в','Пермь').past,0,'«переехала в» — про нынешнее');
 assert.equal(meta.analyzeText('работает в','студии с 2021').since,'2021');
 assert.equal(meta.analyzeText('считает','что джаз лучше').opinion,1);
 assert.equal(meta.analyzeText('находится в','России').opinion,0);
 assert.equal(meta.analyzeText('зовут','Анна').span,'permanent');
 assert.equal(meta.originOf('guess:1'),'confirmed');assert.equal(meta.originOf('review:3'),'inferred');
 add('Ира','живёт в','Казань');
 assert.equal(add('Ира','раньше жила в','Москва').conflicts,0);
 assert.equal(add('Ира','переехала в','Пермь').conflicts,1);
 const f={id:'x',confidence:.6,predicate:'раньше жила в',object:'Москва'};
 assert.match(meta.tag(f,{...meta.analyzeText(f.predicate,f.object),origin:'inferred'}),/в прошлом.*уверенность 60%, вывела сама/);
});

test('strength: unused old facts fall asleep and are forgotten; people and «Я» are kept; recall wakes and returns',async()=>{
 const old=add('Кафе Луна','находится на','Садовой');age(old.id,3000);
 const mid=add('Кафе Солнце','находится на','Лесной');age(mid.id,60);
 const me=add('Я','люблю','джаз');age(me.id,3000);
 const r=strength.sweep();
 assert.ok(r.forgottenFacts.some(f=>f.id===old.id),'давнее и ненужное забыто');
 assert.ok(memory.queryFacts({limit:500}).find(f=>f.id===me.id&&!f.valid_to),'о себе — не забывается');
 assert.equal(strength.get([mid.id]).get(mid.id).stage,'dormant');
 const found=await recall('Кафе Солнце');assert.ok(found.facts[0].why.includes('спит'));
 assert.deepEqual(strength.wake([mid.id]),[mid.id]);
 assert.equal(strength.forgotten({query:'Луну'})[0].id,old.id);
 assert.equal(strength.remember([old.id]).length,1);
 assert.ok(memory.factsById([old.id]).length,'вернулось в память');
});

test('guesses: shared workplace → guess, a new fact confirms it, an answer turns it into a fact',async()=>{
 add('Оля','работает в','Студия Луч');add('Петя','работает в','Студия Луч');add('Вика','работает в','Студия Луч');
 const made=await guesses.generate();
 assert.ok(made.some(g=>g.predicate==='знаком с'),'догадка о знакомстве');
 const g1=made.find(g=>g.predicate==='знаком с');
 // Взаимная связь: факт в обратную сторону тоже подтверждает догадку.
 add(g1.object,'знаком с',g1.subject);
 assert.ok(guesses.check().confirmed.some(g=>g.id===g1.id));
 const g2=guesses.list('open').find(g=>g.predicate==='знаком с');
 const r=guesses.answer(g2.id,true);assert.equal(r.status,'confirmed');
 assert.ok(memory.factsById([r.fact_id])[0].source_id.startsWith('guess:'));
 assert.deepEqual(guesses.parseModel('GUESS: Я | любит | кино | 0.6 | смотрит фильмы\nмусор').map(g=>g.object),['кино']);
});

test('curiosity: questions are asked rarely, unasked go back, «нет» retires a doubtful fact',async()=>{
 const doubt=add('Соня','работает в','Школа 5','chat:2',.5);
 await curiosity.generate();
 const q=curiosity.list('open',30).find(x=>x.ref===doubt.id);assert.ok(q,'вопрос о неуверенном факте');
 for(const x of curiosity.list('open',30))if(x.id!==q.id)curiosity.dismiss(x.id);
 const first=curiosity.turn();assert.match(first,/Любопытство/);
 curiosity.afterReply('Ответила без вопроса.');
 assert.equal(curiosity.get(q.id).status,'open','вопрос не задан — вернулся в очередь');
 assert.equal(curiosity.turn(),'','не чаще раза в EVERY сообщений');
 assert.match(curiosity.turn(),/Школа 5/);
 curiosity.afterReply('Кстати, правильно ли я помню, что Соня работает в Школе 5?');
 const a=curiosity.onMessage('нет, уже не работает');
 assert.equal(a.effect,'fact-retired');assert.equal(memory.factsById([doubt.id]).length,0);
});

test('subquestions, check parsing',()=>{
 assert.deepEqual(inner.split('Где живёт Анна и что она любит?'),['Где живёт Анна','что она любит? (Анна)']);
 assert.deepEqual(inner.split('Привет, как дела?'),[]);
 assert.deepEqual(inner.parseCheck('OK'),{ok:true});
 assert.deepEqual(inner.parseCheck('FIX: Не знаю, где она живёт.'),{ok:false,fixed:'Не знаю, где она живёт.'});
});

test('initiative: overdue and birthday suggestions, once each; «Да» acts',async()=>{
 const today=new Date(),soon=new Date(Date.now()+3*864e5);
 add('Мама','день рождения',soon.getDate()+'.'+(soon.getMonth()+1));
 const ws={tasks:[{id:'t1',title:'Сдать отчёт',due:'2020-01-01',done:false}]};
 assert.equal(initiative.scan(ws,today).length,2);
 assert.equal(initiative.scan(ws,today).length,0,'одно и то же не предлагается дважды');
 const items=initiative.fresh(5),late=items.find(x=>x.kind==='overdue'),bd=items.find(x=>x.kind==='birthday');
 assert.match(bd.text,/Через 3 дня день рождения у Мама/);
 let moved=null,added=null;
 const r=await initiative.accept(late.id,{updateTask:(id,p)=>{moved=[id,p]},addItem:(c,t)=>{added=t}});
 assert.equal(r.text,'Перенесла на завтра.');assert.equal(moved[0],'t1');
 await initiative.accept(bd.id,{addItem:(c,t)=>{added=t}});assert.equal(added,'Поздравить: Мама');
 assert.equal(await initiative.accept(bd.id,{}),null,'второй раз не выполняется');
 assert.deepEqual(initiative.monthDay('12 марта 1990'),{m:3,d:12});
});

test('chat: inner voice plans, check fixes the draft, subquestions recall each part, thoughts stream',async()=>{
 add('Анна','любит','зелёный чай');add('Анна','живёт в','Казань');
 for(const k of ['curiosity','initiative','guesses'])thoughts.setSetting(k,false);
 const bodies=[];let step=0;
 const fake=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{bodies.push(JSON.parse(raw));step++;
  const content=step===1?'Спрашивают про Анну: где живёт и что любит. В памяти есть оба факта.':step===2?'Анна живёт в Москве и любит чай.':'FIX: Анна живёт в Казани и любит зелёный чай.';
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}))})});
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 process.env.CHAT_URL='http://127.0.0.1:'+fake.address().port+'/v1/chat/completions';
 const before=thoughts.since(0,200).at(-1)?.id||0;
 try{
  const {reply}=require('../chat');
  const r=await reply({message:'Где живёт Анна и что она любит?'},{addItem(){},setTaskDone(){}});
  assert.equal(r.reply,'Анна живёт в Казани и любит зелёный чай.');
  assert.equal(r.thinking.check,'fixed');assert.match(r.thinking.plan,/Спрашивают про Анну/);
  assert.equal(r.thinking.split.length,2);
  assert.match(bodies[1].messages[0].content,/Твой план ответа[\s\S]*Спрашивают про Анну/);
  const kinds=thoughts.since(before).map(t=>t.kind);
  for(const k of ['split','plan','check'])assert.ok(kinds.includes(k),k);
 }finally{delete process.env.CHAT_URL;await new Promise(r=>fake.close(r))}
 assert.throws(()=>thoughts.setSetting('nope',true),/Нет такой настройки/);
});

test('brain API: thinking, settings, guesses answer, forgotten restore',async()=>{
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port,post=(u,b)=>fetch(base+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  const t=await (await fetch(base+'/api/brain/thinking')).json();
  assert.ok(Array.isArray(t.guesses)&&Array.isArray(t.questions)&&t.strength&&t.labels.innerVoice);
  assert.equal((await (await post('/api/brain/settings',{key:'verify',value:false})).json()).verify,false);
  assert.equal((await post('/api/brain/settings',{key:'verify',value:'да'})).status,400);
  const th=await (await fetch(base+'/api/brain/thoughts?since=0')).json();assert.ok(th.items.length>0);
  const facts=await (await fetch(base+'/api/facts?limit=500')).json();
  const past=facts.find(f=>f.predicate==='раньше жила в');assert.equal(past.meta.past,1);assert.equal(past.meta.origin,'вы сказали');
  assert.equal((await post('/api/brain/guesses/answer',{id:'нет такой',yes:true})).status,404);
  assert.equal((await (await post('/api/brain/forgotten/restore',{ids:['нет']})).json()).restored,0);
 }finally{await new Promise(r=>server.close(r))}
});
