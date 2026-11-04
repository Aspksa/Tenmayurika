'use strict';
// Правки по ревью мышления: близкие не забываются, счётчики забывания, вопрос не переходит в другой чат,
// предложение не считается показанным без ответа, отрицание не опровергает другую догадку, сверка видит инструменты.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-thinking-fixes-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
process.env.TENMAYURIKA_ASK_EVERY='1';
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const {DatabaseSync}=require('node:sqlite');
const memory=require('../memory-core');
const strength=require('../strength');
const guesses=require('../guesses');
const curiosity=require('../curiosity');
const inner=require('../inner');
const initiative=require('../initiative');
const add=(s,p,o,src='chat:1',conf=1)=>memory.addFact({subject:s,predicate:p,object:o,sourceId:src,confidence:conf});
function age(id,days){const db=new DatabaseSync(process.env.TENMAYURIKA_MEMORY_DB);const t=new Date(Date.now()-days*864e5).toISOString();db.prepare('UPDATE memory_facts SET observed_at=?,valid_from=? WHERE id=?').run(t,t,id);db.close()}

test('strength: close people as subjects are kept; counts are not doubled',()=>{
 const mom=add('Мама','живёт в','Самара');age(mom.id,3000);
 add('Я','сестра','Ольга');const sis=add('Ольга','любит','розы');age(sis.id,3000);
 const cafe=add('Кафе Звезда','находится на','Морской');age(cafe.id,3000);
 const total=memory.queryFacts({limit:500}).filter(f=>!f.valid_to).length;
 const r=strength.sweep();
 assert.ok(r.forgottenFacts.some(f=>f.id===cafe.id));
 assert.ok(!r.forgottenFacts.some(f=>f.id===mom.id),'о маме не забываем');
 assert.ok(!r.forgottenFacts.some(f=>f.id===sis.id),'о сестре (по имени) не забываем');
 assert.equal(r.forgotten,r.forgottenFacts.length);
 assert.equal(r.active+r.dormant+r.fading+r.forgotten,total);
});

test('curiosity: a pending question does not carry into another conversation',async()=>{
 const doubt=add('Лена','работает в','Почта','chat:2',.5);
 await curiosity.generate();
 const q=curiosity.list('open',30).find(x=>x.ref===doubt.id);assert.ok(q);
 for(const x of curiosity.list('open',30))if(x.id!==q.id)curiosity.dismiss(x.id);
 assert.match(curiosity.turn({conversation:'a'}),/Почта/);
 curiosity.afterReply('Кстати, Лена всё ещё работает на почте?');
 assert.equal(curiosity.onMessage('нет',{conversation:'b'}),null);
 assert.equal(curiosity.get(q.id).status,'open','вопрос вернулся в очередь');
 assert.ok(memory.factsById([doubt.id]).length,'факт не отставлен');
 curiosity.turn({conversation:'c'});curiosity.afterReply('Лена всё ещё работает на почте?');
 assert.equal(curiosity.onMessage('нет',{conversation:'c',fresh:true}),null,'новый чат — не ответ');
 curiosity.turn({conversation:'c'});curiosity.afterReply('Лена всё ещё работает на почте?');
 assert.equal(curiosity.onMessage('нет, уже нет',{conversation:'c'}).effect,'fact-retired');
});

test('initiative: an offer is shown only when the reply carries it',()=>{
 initiative.scan({tasks:[{id:'t9',title:'Позвонить в банк',due:'2020-02-02',done:false}]});
 const p=initiative.promptText();assert.ok(p.offerId);assert.match(p.text,/Позвонить в банк/);
 assert.equal(initiative.afterReply(p.offerId,'Готово, записала.'),false);
 assert.equal(initiative.get(p.offerId).status,'new','осталось для облачка');
 assert.equal(initiative.afterReply(p.offerId,'Кстати, «Позвонить в банк» просрочено — перенести на завтра?'),true);
 assert.equal(initiative.get(p.offerId).status,'shown');
});

test('guesses: a negated fact about another value does not reject the guess',()=>{
 const g=guesses.add({subject:'Дима',predicate:'живёт в',object:'Казань',confidence:.5,why:'тест'});
 assert.ok(g);
 add('Дима','не живёт в','Москва');
 const r=guesses.check();
 assert.ok(!r.rejected.some(x=>x.subject==='Дима'));
 add('Дима','живёт в','Уфа');
 assert.ok(guesses.check().rejected.some(x=>x.subject==='Дима'),'другой город сказан утвердительно — опровергает');
});

test('verify sees conversation and tool results',async()=>{
 let body=null;
 const r=await inner.verify(async b=>{body=b;return {content:'OK'}},{message:'что в планах?',reply:'Добавила дело «Купить хлеб».',extra:['Инструмент add_item: добавлено «Купить хлеб»']});
 assert.deepEqual(r,{ok:true});
 assert.match(body.messages[1].content,/Купить хлеб[\s\S]*Черновик/);
 assert.match(body.messages[0].content,/результатах инструментов/);
});
