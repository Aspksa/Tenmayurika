'use strict';
// Логика и рост: вопрос в контексте разговора, учёба с контекстом реплик, честное «не знаю», логические
// выводы, противоречия и планы в разговоре, подтверждение повтором, поиск фактов по смыслу, самонастройка поиска.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-logic-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
process.env.TENMAYURIKA_ASK_EVERY='1';
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const memory=require('../memory-core');
const thoughts=require('../thoughts');
const context=require('../context');
const infer=require('../infer');
const plans=require('../plans');
const evidence=require('../evidence');
const curiosity=require('../curiosity');
const chatlog=require('../chatlog');
const inner=require('../inner');
const tune=require('../tune');
const add=(s,p,o,src='manual:1',conf=1)=>memory.addFact({subject:s,predicate:p,object:o,sourceId:src,confidence:conf});
// Поддельная модель: отвечает по очереди из списка, запросы копит.
async function fakeModel(answers){
 const bodies=[];let i=0;
 const srv=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const b=JSON.parse(raw);bodies.push(b);
  if(req.url.endsWith('/embeddings')){const inputs=Array.isArray(b.input)?b.input:[b.input];res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:inputs.map((t,index)=>({index,embedding:vec(t)}))}));return}
  const content=answers[Math.min(i++,answers.length-1)];res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}))})});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 return {bodies,url:'http://127.0.0.1:'+srv.address().port,close:()=>new Promise(r=>srv.close(r))};
}
// «Смысл» для проверки: машина и автомобиль — одно направление.
function vec(t){const s=String(t).toLocaleLowerCase();return [/машин|автомоб|тачк/.test(s)?1:0,/кош|кот/.test(s)?1:0,/город|живёт|живет/.test(s)?1:0,.05]}

test('context: pronouns take the person from the conversation, «а Оля?» borrows the previous question',()=>{
 add('Аня','живёт в','Казань');add('Аня','работает в','Яндекс');add('Оля','живёт в','Пермь');
 const h=[{role:'user',content:'Где живёт Аня?'},{role:'assistant',content:'Аня живёт в Казани.'}];
 const a=context.expand('а она где работает?',h);assert.deepEqual(a.about,['Аня']);assert.match(a.query,/Аня/);
 const b=context.expand('а Оля?',h);assert.match(b.query,/Оля/);assert.match(b.query,/живёт/);
 assert.equal(context.expand('Она любит чай?',[{role:'user',content:'расскажи про Аню'}]).about[0],'Аня','падеж сводится к известному имени');
 assert.equal(context.expand('как дела?',h).query,'как дела?');
 assert.deepEqual(context.expand('Где живёт Оля и что она любит?',h).about,[],'своё имя в вопросе — не трогаем');
});

test('chat: «а она?» recalls the person from the previous turn',async()=>{
 for(const k of ['curiosity','initiative','guesses','innerVoice','verify'])thoughts.setSetting(k,false);
 const {reply}=require('../chat');
 const r=await reply({message:'а где она работает?',history:[{role:'user',text:'Где живёт Аня?'},{role:'assistant',text:'Аня живёт в Казани.'}]},{addItem(){},setTaskDone(){}});
 assert.deepEqual(r.thinking.context,['Аня']);
 assert.match(r.reply,/Яндекс/);
});

test('learning: short answer to her question is learned with the dialogue as context',async()=>{
 const m=await fakeModel(['FACT: Я | сестра | Маша']);
 fs.writeFileSync(path.join(dir,'llm-settings.json'),JSON.stringify({enabled:true,provider:'custom',baseUrl:m.url+'/v1',model:'fake',apiKey:'k'}));
 try{
  chatlog.save('assistant','Как зовут твою сестру?');
  const id=chatlog.save('user','Маша');
  assert.equal(chatlog.message(id).learned,0,'короткий ответ на вопрос ждёт разбора');
  assert.equal(chatlog.message(chatlog.save('user','ок')).learned,2,'а просто короткое — нет');
  const r=await chatlog.learnPending();assert.ok(r.facts>=1);
  const sent=m.bodies.find(b=>/Маша/.test(b.messages.at(-1).content)).messages.at(-1).content;
  assert.match(sent,/Ассистентка: Как зовут твою сестру\?/);assert.match(sent,/Сообщение человека:\nМаша/);
  assert.ok(memory.relations('Маша',10).some(f=>f.predicate==='сестра'));
 }finally{fs.rmSync(path.join(dir,'llm-settings.json'),{force:true});await m.close()}
});

test('honest: nothing about a personal question → instruction and a check against empty memory',async()=>{
 assert.equal(inner.personal('как зовут мою бабушку по папе?'),true);
 assert.equal(inner.personal('что такое фотосинтез?'),false);
 thoughts.setSetting('verify',true);
 const m=await fakeModel(['Твою бабушку зовут Галина.','FIX: Не помню, как зовут твою бабушку по папе. Расскажешь?']);
 process.env.CHAT_URL=m.url+'/v1/chat/completions';
 try{
  const {reply}=require('../chat');
  const r=await reply({message:'Как зовут мою прабабушку Евдокию по отчеству?'},{addItem(){},setTaskDone(){}});
  assert.equal(r.thinking.unknown,true);
  assert.match(m.bodies[0].messages[0].content,/ничего не нашлось. Не выдумывай/);
  assert.match(m.bodies[1].messages[1].content,/ничего не нашлось/);
  assert.match(r.reply,/Не помню/);
 }finally{delete process.env.CHAT_URL;thoughts.setSetting('verify',false);await m.close()}
});

test('infer: inverse, grandparents, uncles, siblings, age and place chains',()=>{
 let n=0;const F=(s,p,o)=>({id:'i'+(++n),subject:s,predicate:p,object:o});
 const d=infer.derive([F('Я','мама','Ольга'),F('Ольга','мама','Нина'),F('Ольга','брат','Пётр'),F('Аня','муж','Игорь'),F('Петя','папа','Сергей'),F('Вася','папа','Сергей'),
  F('Аня','день рождения','12.03.1995'),F('Я','живёт в','Казань'),F('Казань','находится в','Россия')]).map(infer.text);
 const has=re=>assert.ok(d.some(x=>re.test(x)),re+' in '+d.join('\n'));
 has(/^Я \| бабушка \| Нина/);has(/^Я \| дядя \| Пётр/);has(/^Нина \| дочь \| Ольга/);has(/^Игорь \| (жена|супруг или супруга) \| Аня/);
 has(/^Петя \| брат или сестра \| Вася/);has(/^Аня \| возраст \| \d+ (год|года|лет)/);has(/^Я \| живёт в \| Россия/);
 assert.ok(!d.some(x=>/^Я \| мама \| Ольга/.test(x)),'известное не выводится');
 assert.deepEqual(infer.parseDate('5 мая 1990'),{d:5,m:5,y:1990});
});

test('infer in chat: «кто моя бабушка?» answers from a two-step chain',async()=>{
 add('Я','мама','Ольга Петровна');add('Ольга Петровна','мама','Нина Ивановна');
 const {reply}=require('../chat');
 const r=await reply({message:'кто моя бабушка?'},{addItem(){},setTaskDone(){}});
 assert.ok((r.thinking.inferred||[]).some(x=>/бабушка \| Нина Ивановна/.test(x)),JSON.stringify(r.thinking));
 assert.match(r.reply,/Нина Ивановна/);
});

test('conflict: asked in chat, «да» keeps the newer, the older goes to history',async()=>{
 const a=add('Лена','работает в','Сбер','chat:10'),b=add('Лена','работает в','Озон','chat:11');
 assert.equal(b.conflicts,1);
 thoughts.setSetting('curiosity',true);
 const made=await curiosity.generate();
 const q=made.find(x=>x.kind==='conflict');assert.ok(q,'вопрос о противоречии');assert.match(q.text,/Сбер[\s\S]*Озон/);
 // Отложим остальные вопросы, чтобы ход достался этому.
 for(const x of curiosity.list('open',50))if(x.id!==q.id)curiosity.dismiss(x.id);
 assert.match(curiosity.turn(),/Сбер/);
 curiosity.afterReply('Кстати: '+q.text);
 const r=curiosity.onMessage('да, перешла');
 assert.equal(r.effect,'conflict-newer');
 assert.equal(memory.factsById([a.id]).length,0);assert.equal(memory.factsById([b.id]).length,1);
 assert.equal(memory.conflicts(10).filter(c=>c.subject==='Лена').length,0);
 thoughts.setSetting('curiosity',false);
});

test('plans: future phrase becomes a dated plan, overdue plan is asked, «нет» retires it',async()=>{
 const now=new Date(2026,10,4,10);
 assert.equal(plans.when('в следующем месяце переезжаю в Казань',now).due,'2026-12-31');
 assert.equal(plans.when('завтра иду к врачу',now).due,'2026-11-05');
 assert.equal(plans.when('летом поеду в Японию',now).due,'2027-08-31');
 assert.equal(plans.when('Аня живёт в Казани',now),null);
 assert.equal(plans.when('в мае я жила в Москве',now),null,'без признака будущего — не план');
 const f=add('Я','переезжаю в','Сочи','chat:20');
 const fact=memory.factsById([f.id]);
 const made=plans.capture('В следующем месяце переезжаю в Сочи. А Аня любит чай.',fact,new Date(2026,8,1).toISOString());
 assert.equal(made.length,1);assert.equal(made[0].due,'2026-10-31');
 assert.match(plans.tag(plans.get([f.id]).get(f.id)),/план: в следующем месяце, к 31\.10\.2026/);
 assert.equal(plans.due('2026-11-04').length,1);
 thoughts.setSetting('curiosity',true);
 for(const x of curiosity.list('open',50))curiosity.dismiss(x.id);
 const q=(await curiosity.generate()).find(x=>x.kind==='plan');assert.ok(q);assert.match(q.text,/Получилось\?/);
 for(const x of curiosity.list('open',50))if(x.id!==q.id)curiosity.dismiss(x.id);
 curiosity.turn();curiosity.afterReply(q.text);
 assert.equal(curiosity.onMessage('нет, не вышло').effect,'plan-missed');
 assert.equal(memory.factsById([f.id]).length,0);assert.equal(plans.get([f.id]).get(f.id).status,'missed');
 thoughts.setSetting('curiosity',false);
});

test('evidence: the same fact from another source raises confidence once per source',()=>{
 const f=add('Дима','любит','шахматы','chat:30',.6);
 const r=evidence.confirm(f.id,'chat:31');assert.ok(r&&r.confidence>.6&&r.confidence<1);
 assert.equal(evidence.confirm(f.id,'chat:31'),null,'тот же источник — один раз');
 assert.equal(evidence.confirm(f.id,'chat:30'),null,'свой источник не в счёт');
 const r2=evidence.confirm(f.id,'note:5');assert.ok(r2.confidence>r.confidence);
 assert.equal(evidence.count([f.id]).get(f.id),2);
 // Через фоновую учёбу: повтор не теряется как дубль.
 chatlog.apply({facts:[],confirmed:[f.id],source:'rules'},'chat:32');
 assert.equal(evidence.count([f.id]).get(f.id),3);
});

test('vectors: embedding model from settings, facts indexed and found by meaning',async()=>{
 const m=await fakeModel(['ok']);
 fs.writeFileSync(path.join(dir,'llm-settings.json'),JSON.stringify({enabled:false,provider:'custom',baseUrl:m.url+'/v1',model:'fake',apiKey:'k',embeddingModel:'BAAI/bge-m3'}));
 try{
  const llm=require('../llm');
  assert.equal(llm.view().embeddingModel,'BAAI/bge-m3');assert.equal(llm.view().embeddingActive,true);
  assert.ok(llm.view().embeddingHints.cloudru.includes('BAAI/bge-m3'));
  assert.equal((await llm.embedTest()).dim,4);
  const f=add('Я','водит','автомобиль Тойота');
  const factvec=require('../factvec');
  const r=await factvec.index();assert.ok(r.enabled&&factvec.status().indexed>=1);
  const hits=await factvec.search('какая у меня машина?',5);assert.equal(hits[0].id,f.id,JSON.stringify(memory.factsById(hits.map(h=>h.id)).map(x=>x.subject+' '+x.predicate+' '+x.object)));
  const {recall}=require('../recall');
  const found=await recall('какая у меня машина?');
  const hit=found.facts.find(x=>x.id===f.id);assert.ok(hit,'нашлось по смыслу');assert.ok(hit.why.includes('смысл'));
  memory.retireFact(f.id);assert.ok((await factvec.index()).removed>=1);
  assert.throws(()=>llm.save({embeddingModel:'x'.repeat(201)}),/эмбеддингов/);
 }finally{fs.rmSync(path.join(dir,'llm-settings.json'),{force:true});await m.close()}
});

test('tune: feedback moves the weight of the signals that found the answer; trial adopts only a real gain',async()=>{
 const experience=require('../experience');
 for(let i=0;i<6;i++){const id=experience.record({question:'вопрос '+i,understood:'x',recalled:{facts:[],notes:[]},tools:[],answer:'a',source:'model',ok:true});tune.remember(id,['graph']);experience.feedback(id,'fix')}
 for(let i=0;i<6;i++){const id=experience.record({question:'другой '+i,understood:'x',recalled:{facts:[],notes:[]},tools:[],answer:'a',source:'model',ok:true});tune.remember(id,['text']);experience.feedback(id,'ok')}
 const st=tune.view().stats;assert.equal(st.graph.fix,6);assert.equal(st.text.ok,6);
 const r=await tune.run({ws:{notes:[],tasks:[]}});
 assert.ok(r.multipliers.graph<1,'связи тише');assert.ok(r.multipliers.text>1,'слова важнее');
 assert.ok(r.changed.every(c=>c.by==='feedback'),'без самоэкзамена пробы нет');
 assert.ok(tune.view().history.length>=2);
 const {recall}=require('../recall');
 const base=await recall('Аня',{weights:{text:1,graph:1}}),strong=await recall('Аня',{weights:{text:1.6,graph:.5}});
 assert.ok(base.facts.length&&strong.facts.length,'веса можно передать явно');
});

test('brain API exposes plans, tuning and vectors',async()=>{
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const t=await (await fetch('http://127.0.0.1:'+server.address().port+'/api/brain/thinking')).json();
  assert.ok(Array.isArray(t.plans)&&t.tune.multipliers&&typeof t.vectors.indexed==='number');
  assert.ok(t.labels.context&&t.labels.infer&&t.labels.honest&&t.labels.plans&&t.labels.tune);
 }finally{await new Promise(r=>server.close(r))}
});
