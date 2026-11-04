'use strict';
// Навыки запоминания и самоучёба по мотивам MemSkill: банк, подбор, операции записи, промахи,
// самоэкзамен, правка кругами с пробой, перезапоминание, откат и просьба о подсказке.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-memskills-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const llm=require('../llm');
const memory=require('../memory-core');
const memskills=require('../memskills');
const learn=require('../learn');
const chatlog=require('../chatlog');
const selfstudy=require('../selfstudy');
const experience=require('../experience');
const {use}=require('../brain-db');
const realConfig=llm.config,realComplete=llm.complete;
function fakeModel(fn){llm.config=()=>({model:'fake'});llm.complete=async({messages})=>({content:fn(messages[0].content,messages[messages.length-1].content)})}
function noModel(){llm.config=realConfig;llm.complete=realComplete}
const ws={notes:[],tasks:[]};
test.after(()=>{noModel();fs.rmSync(dir,{recursive:true,force:true})});

test('bank starts with seed skills and picks skills by text and domain',()=>{
 const names=memskills.list().map(s=>s.name);
 for(const n of ['general','people','time','places','limits','update','retire'])assert.ok(names.includes(n),n);
 const chat=memskills.select('Мама Ольга, у неё день рождения 12 марта',{domain:'chat'}).map(s=>s.name);
 assert.ok(chat.includes('people')&&chat.includes('time'));
 assert.ok(!chat.includes('update'),'без похожих фактов операции не нужны');
 const task=memskills.select('Мама просила позвонить до пятницы',{domain:'task'}).map(s=>s.name);
 assert.ok(!task.includes('people'),'люди — навык для чата и заметок');
 assert.ok(task.includes('time'));
 assert.deepEqual(memskills.select('Привет!',{domain:'chat'}).map(s=>s.name),['general']);
 assert.ok(memskills.select('Анна теперь живёт в Перми',{domain:'chat',similar:2}).some(s=>s.name==='update'));
 assert.equal(memskills.domainOf('note:1'),'note');
});

test('model extraction uses skills and can update or retire known facts',async()=>{
 const old=memory.addFact({subject:'Анна',predicate:'живёт в',object:'Казани',sourceId:'test'});
 const gym=memory.addFact({subject:'Анна',predicate:'ходит в',object:'спортзал',sourceId:'test'});
 let prompt='';
 fakeModel((sys,user)=>{prompt=sys+'\n'+user;
  const n=i=>user.split('\n').findIndex(l=>l.includes(i))>=0?user.split('\n').filter(l=>/^\d+\./.test(l)).findIndex(l=>l.includes(i))+1:0;
  return 'FACT: Анна | работает в | школе\nUPDATE: '+n('Казани')+' | Анна | живёт в | Перми\nRETIRE: '+n('спортзал')});
 const r=await learn.extract({text:'Анна теперь живёт в Перми, работает в школе, а спортзал бросила.',source:'chat:900'});
 assert.equal(r.source,'model');
 assert.ok(r.skills.includes('update')&&r.skills.includes('retire'));
 assert.match(prompt,/Навык «Обновить известное»/);
 assert.match(prompt,/Уже известно/);
 assert.deepEqual(r.facts,[{subject:'Анна',predicate:'работает в',object:'школе'}]);
 assert.equal(r.updates[0].id,old.id);
 assert.equal(r.retire[0].id,gym.id);
 const n=chatlog.apply(r,'chat:900');
 assert.equal(n,3);
 const active=memory.queryFacts({subject:'Анна',limit:50}).filter(f=>!f.valid_to).map(f=>f.predicate+' '+f.object).sort();
 assert.deepEqual(active,['живёт в Перми','работает в школе']);
 // Записанное помечено навыками, а применение посчитано.
 const school=memory.queryFacts({subject:'Анна',limit:50}).find(f=>f.object==='школе');
 assert.ok(memskills.skillsOfFacts([school.id]).includes('update'));
 assert.ok(memskills.get('update').uses>=1);
 assert.deepEqual(memskills.runFor('chat:900').sort(),r.skills.slice().sort());
 noModel();
});

test('self-test asks itself about recent messages and logs misses with a cause',async()=>{
 const id=chatlog.save('user','Пётр работает в банке');
 await chatlog.learnPending();
 const pass=await selfstudy.selfTest({ws});
 assert.equal(pass.tested,1);assert.equal(pass.passed,1);
 // То, что не записано, — промах «не записано».
 const id2=chatlog.save('user','Олег живёт в Самаре');
 use(db=>db.prepare('UPDATE chat_log SET learned=1 WHERE id=?').run(id2));
 const miss=await selfstudy.selfTest({ws});
 assert.equal(miss.tested,1);assert.equal(miss.passed,0);
 assert.equal(miss.misses[0].cause,'not_stored');
 // Повторно то же сообщение не экзаменуется.
 assert.equal((await selfstudy.selfTest({ws})).tested,0);
 const q=memskills.queue();
 assert.ok(q.some(m=>m.source==='chat:'+id2&&m.cause==='not_stored'&&m.text.includes('Самаре')));
 assert.ok(id>0);
});

test('a correction becomes a miss in the journal',()=>{
 const ep=experience.record({question:'где работает Лена',recalled:{facts:[],notes:[]},answer:'Не знаю'});
 experience.feedback(ep,'fix','Лена работает в аптеке');
 const m=memskills.queue().find(x=>x.kind==='correction');
 assert.equal(m.cause,'not_stored');assert.equal(m.severity,1);
 assert.equal(m.expected,'Лена работает в аптеке');
});

test('misses queue ranks by severity and repeats',()=>{
 memskills.addMiss({kind:'self',question:'редкий',expected:'x',cause:'vague',severity:.3});
 for(let i=0;i<4;i++)memskills.addMiss({kind:'self',question:'частый',expected:'y',cause:'vague',severity:.6});
 const q=memskills.queue();
 assert.ok(q.findIndex(m=>m.question==='частый')<q.findIndex(m=>m.question==='редкий'));
 assert.equal(q.find(m=>m.question==='частый').count,4);
 memskills.markMisses(q.filter(m=>['частый','редкий'].includes(m.question)).map(m=>m.key),'used');
});

test('skills are refined by thinking in rounds, tried first and adopted only if better',async()=>{
 const rounds=[];
 chatlog.save('user','Мы ходим в бассейн по вторникам');use(db=>db.prepare("UPDATE chat_log SET learned=1 WHERE text LIKE '%бассейн%'").run());
 memskills.addMiss({kind:'self',question:'Где работает Лена',expected:'аптеке',cause:'not_stored',text:'Кстати, Лена теперь в аптеке на углу',source:'chat:1001',severity:.6});
 memskills.addMiss({kind:'self',question:'Куда ходит Лена по вторникам',expected:'бассейн',cause:'not_stored',text:'По вторникам Лена в бассейне',source:'chat:1002',severity:.6});
 fakeModel((sys,user)=>{
  if(/почему память/.test(sys)){rounds.push('analysis');return 'Не записаны места, куда человек ходит.'}
  if(/Проверь разбор/.test(sys)){rounds.push('critique');return 'Исправленный разбор: нужны места и регулярные походы.'}
  if(/предложи не больше/.test(sys)){rounds.push('plan');return 'Вот: {"changes":[{"action":"add","title":"Места и походы","purpose":"Куда и когда человек ходит","how":"Место — объектом","cues":["аптек","бассейн","хожу"],"domains":["chat"],"reason":"не записаны места"}]}'}
  // Извлечение: с новым навыком модель находит места.
  if(/Места и походы/.test(sys)){if(/аптеке/.test(user))return 'FACT: Лена | работает в | аптеке';if(/бассейне/.test(user))return 'FACT: Лена | ходит в | бассейн';}
  return 'NONE';
 });
 const r=await selfstudy.evolve({complete:llm.complete});
 assert.deepEqual(rounds,['analysis','critique','plan']);
 assert.equal(r.trial.before,0);assert.ok(r.trial.cases>=2);assert.ok(r.trial.after>=2);
 assert.equal(r.adopted[0].kind,'add');
 const s=memskills.list().find(x=>x.title==='Места и походы');
 assert.equal(s.status,'trial');
 assert.ok(r.relearned>=1,'старое сообщение про бассейн перечитывается');
 assert.equal(memskills.snapshots(1)[0].status,'current');
 assert.ok(selfstudy.learnedLog().some(h=>h.change==='add'&&h.title==='Места и походы'));
 assert.equal(memskills.queue({causes:['not_stored']}).filter(m=>m.source.startsWith('chat:100')).length,0,'разобранные промахи ушли из очереди');
 noModel();
});

test('a change that does not help is rejected; after three tries she asks for a hint',async()=>{
 for(let i=0;i<3;i++){
  memskills.addMiss({kind:'self',question:'Что любит кот '+i,expected:'рыбу',cause:'not_stored',text:'Кот любит рыбу '+i,source:'chat:'+(2000+i),severity:.6});
  memskills.addMiss({kind:'self',question:'Как зовут кота '+i,expected:'Барсик',cause:'vague',text:'Кота зовут Барсик '+i,source:'chat:'+(2100+i),severity:.6});
  fakeModel(sys=>/предложи не больше/.test(sys)?'{"changes":[{"action":"refine","name":"general","cues":["кот"],"reason":"коты"}]}':/почему|Проверь/.test(sys)?'разбор':'NONE');
  const r=await selfstudy.evolve({complete:llm.complete});
  assert.ok(r.rejected,'проба не дала лучше');
  if(i<2)assert.equal(r.help,null);else assert.match(r.help.text,/Подскажи/);
 }
 assert.ok(!memskills.get('general').cues.includes('кот'),'отвергнутая правка не записана');
 assert.equal(memskills.evoState().failed.length,3);
 assert.ok((await selfstudy.evolve({complete:llm.complete})).blocked,'пока нет подсказки — не крутится');
 const hint=memskills.addHint('Запоминай клички и привычки домашних животных');
 assert.ok(hint.title.startsWith('Подсказка'));
 assert.equal(memskills.get(hint.name).status,'active');
 assert.equal(memskills.evoState().help,null);
 noModel();
});

test('if the self-test gets worse after a change, the bank rolls back to the best version',()=>{
 const snaps=memskills.snapshots(20).reverse();
 const best=snaps[0],cur=snaps[snaps.length-1];
 // Хорошие оценки в окне стартового банка, плохие — в окне текущего.
 const t=(at,p)=>use(db=>db.prepare("INSERT INTO memory_selftests(source,question,expected,passed,bank,at) VALUES('x','q','a',?,0,?)").run(p,at));
 use(db=>db.prepare('DELETE FROM memory_selftests').run());
 const between=new Date(Date.parse(best.at)+1).toISOString(),before=snaps[1]?.at||new Date().toISOString();
 assert.ok(between<before);
 for(let i=0;i<8;i++)t(between,1);
 const later=new Date(Date.now()+1000).toISOString();
 for(let i=0;i<10;i++)t(later,i<3?1:0);
 const r=selfstudy.watch();
 assert.ok(r,'откат случился');
 assert.match(r.reason,/стал хуже/);
 const now=memskills.snapshots(1)[0];
 assert.equal(now.status,'current');assert.equal(now.change.kind,'rollback');assert.equal(now.change.to,best.id);
 // Навыков, которых не было в стартовом банке, больше нет в работе.
 assert.equal(memskills.list().find(s=>s.title==='Места и походы'),undefined);
 assert.ok(selfstudy.learnedLog(50).some(h=>h.change==='rollback'));
 assert.ok(cur.id<now.id);
});

test('useless skills retire, proven trial skills graduate',()=>{
 const bank=memskills.withChanges(memskills.list(),[{action:'add',title:'Пробный',purpose:'проба',cues:['проба']}]);
 memskills.adopt(bank,{reason:'тест'});
 const s=memskills.list().find(x=>x.title==='Пробный');
 use(db=>db.prepare('UPDATE memory_mskills SET uses=6,ok=3,fix=0 WHERE name=?').run(s.name));
 assert.ok(memskills.graduate().includes(s.name));
 use(db=>db.prepare("UPDATE memory_mskills SET ok=1,fix=7 WHERE name='places'").run());
 assert.ok(memskills.retireUseless().some(r=>r.name==='places'));
 assert.equal(memskills.get('places').status,'retired');
 assert.ok(!memskills.select('ключи лежат в ящике',{domain:'chat'}).some(x=>x.name==='places'));
});

test('brain API shows memory skills and accepts a hint',async()=>{
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const mind=await (await fetch(base+'/api/brain/mind')).json();
  assert.ok(mind.memskills.skills.length>=8);
  assert.ok(Array.isArray(mind.memskills.history));
  assert.ok('score' in mind.memskills);
  const full=await (await fetch(base+'/api/brain/memskills')).json();
  assert.ok(Array.isArray(full.selftests)&&Array.isArray(full.windows));
  const r=await fetch(base+'/api/brain/memskills/hint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Запоминай, кто во что играет'})});
  assert.equal(r.status,201);
  assert.equal((await fetch(base+'/api/brain/memskills/hint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:1})})).status,400);
 }finally{await new Promise(r=>server.close(r))}
});
