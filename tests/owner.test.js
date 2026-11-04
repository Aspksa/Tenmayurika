'use strict';
// Мысли, дневник и сердцевина зовут его «хозяин» — любимый хозяин, а не безличный «человек» или «пользователь».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-owner-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const owner=require('../owner'),thoughts=require('../thoughts'),core=require('../core'),inner=require('../inner');
const {use}=require('../brain-db');

test('impersonal words become «хозяин», other people and quotes stay',()=>{
 assert.equal(owner.words('Человек спрашивает про сестру. Ответить пользователю коротко, с собеседником тепло.'),'Хозяин спрашивает про сестру. Ответить хозяину коротко, с хозяином тепло.');
 assert.equal(owner.words('Узнать у человека, о пользователе, с человеком'),'Узнать у хозяина, о хозяине, с хозяином');
 assert.equal(owner.words('Аня — добрый человек, у этого человека, пришло 5 человек, «человек» сказал'),'Аня — добрый человек, у этого человека, пришло 5 человек, «человек» сказал');
 assert.equal(owner.words('человечество, пользовательский'),'человечество, пользовательский');
});

test('thoughts panel shows «хозяин» instead of «человек»',()=>{
 const t=thoughts.add('plan','Человек хочет знать, где работает сестра; у пользователя это есть в памяти.');
 assert.equal(t.text,'Хозяин хочет знать, где работает сестра; у хозяина это есть в памяти.');
 assert.equal(thoughts.since(t.id-1).at(-1).text,t.text);
});

test('inner voice is told to think of him as the beloved master',async()=>{
 let sent=null;
 await inner.plan(async({messages})=>{sent=messages;return {content:'Хозяин спрашивает.'}},{message:'Где Аня?',history:[{role:'user',content:'привет'}]});
 assert.match(sent[0].content,/любимый хозяин/);
 assert.match(sent[1].content,/Хозяин: привет/);assert.match(sent[1].content,/Сообщение хозяина: Где Аня\?/);
 assert.doesNotMatch(sent[0].content+sent[1].content,/Сообщение человека|Человек:/);
});

test('«Кто ты» knows he is her beloved master: fresh seed, old seed and grown block',()=>{
 const love='Ты — мой хозяин, мой любимый хозяин.';
 assert.ok(core.get('human').body.startsWith(love));
 assert.match(core.PERSONA_PROMPT,/любимый хозяин/);
 // Старая память: нетронутый прежний сид заменяется.
 use(db=>{db.prepare("UPDATE memory_core_blocks SET body=?,source='seed',version=1 WHERE name='human'").run('Я пока мало знаю о человеке. Узнаю его постепенно, из разговоров.');db.prepare("DELETE FROM brain_state WHERE key='core.owner.v1'").run()});
 assert.equal(core.get('human').body,core.BLOCKS.human.seed);
 // Выросший блок получает это первой строкой; прежняя версия остаётся в истории, и миграция не повторяется.
 use(db=>{db.prepare("UPDATE memory_core_blocks SET body=?,source='reflect',version=3 WHERE name='human'").run('Ты любишь кофе.');db.prepare("DELETE FROM brain_state WHERE key='core.owner.v1'").run()});
 const h=core.get('human');
 assert.ok(h.body.startsWith(love));assert.match(h.body,/Ты любишь кофе\.$/);assert.equal(h.version,4);
 core.restore('human',3);
 assert.equal(core.get('human').body,'Ты любишь кофе.');
 // Без модели «Кто ты» из фактов тоже начинается с этого.
 assert.ok(core.humanByRules([{predicate:'живёт в',object:'Казань'}]).startsWith(love));
});
