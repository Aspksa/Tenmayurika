'use strict';
// Рост «Мозга»: крепнущие связи, карточки сущностей, постепенные зоны, свои типы, глубокая чистка, отбор.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-growth-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
process.env.TENMAYURIKA_ZONE_SPLIT='12';
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const memory=require('../memory-core');
const growth=require('../growth');
const aliases=require('../aliases');
const zones=require('../zones');
const predicates=require('../predicates');
const usefulness=require('../usefulness');
const {use}=require('../brain-db');
const add=(s,p,o,src='note:g')=>memory.addFact({subject:s,predicate:p,object:o,sourceId:src});

test('bonds strengthen with co-recall, fade with time and halve after a correction',()=>{
 const a=add('Лена','любит','пионы','note:b').id,b=add('Лена','живёт в','Самара','note:b').id;
 for(let i=0;i<4;i++)growth.strengthen({facts:[a,b]});
 let bond=growth.bonds().find(x=>[x.a,x.b].includes('f:'+a));
 assert.equal(bond.uses,4);assert.equal(bond.level,'strong');
 growth.weaken({facts:[a,b]});
 bond=growth.bonds().find(x=>[x.a,x.b].includes('f:'+a));
 assert.ok(bond.charge<2.1&&bond.charge>1.9,'поправка — заряд вдвое');
 // Три месяца без дела: связь угасает и уходит при размышлении.
 use(db=>db.prepare('UPDATE memory_bonds SET last_at=?').run(new Date(Date.now()-120*864e5).toISOString()));
 assert.equal(growth.pruneBonds(),1);
 assert.equal(growth.bonds().length,0);
});

test('aliases join two names into one graph node',()=>{
 add('мама','зовут','Ольга Петровна','note:a');add('Ольга Петровна','живёт в','Казань','note:a');add('мама','любит','розы','note:a');
 const a=growth.aliasFrom({subject:'мама',predicate:'зовут',object:'Ольга Петровна',polarity:1});
 assert.deepEqual(a,{alias:'мама',canonical:'Ольга Петровна'});
 assert.equal(growth.aliasFrom({subject:'Анна',predicate:'зовут',object:'Аня',polarity:1}),null,'два имени — не догадка правил');
 assert.ok(aliases.add('мама','Ольга Петровна'));
 const n=memory.neighborhood('маму',1);
 assert.equal(n.entity,'Ольга Петровна');
 assert.ok(n.facts.some(f=>f.object==='розы')&&n.facts.some(f=>f.object==='Казань'));
 assert.equal(memory.findPath('мама','Казань').facts.length,1);
 // Снятый псевдоним правила больше не предлагают.
 assert.equal(aliases.remove('мама'),true);
 assert.equal(aliases.add('мама','Ольга Петровна'),null);
 assert.ok(aliases.add('мама','Ольга Петровна',{source:'user'}),'а вручную — можно');
 assert.equal(aliases.add('Ольга Петровна','мама'),null,'петли нет');
});

test('learned relation types stop false conflicts',()=>{
 assert.equal(predicates.classify('вяжет').single,true);
 add('Ира','вяжет','шарф','note:t');add('Ира','вяжет','носки','note:t');add('Оля','вяжет','плед','note:t');
 const types=growth.relationTypes(memory.activeGraph().rows);
 assert.ok(types.find(t=>t.name==='вяжет'&&t.multi));
 return growth.growTypes(null).then(r=>{
  assert.ok(r.born.some(t=>t.kind==='relation'&&t.name==='вяжет'));
  assert.ok(r.born.some(t=>t.kind==='entity'&&t.name==='человек'));
  assert.equal(predicates.classify('вяжет').single,false);
  assert.equal(add('Ира','вяжет','варежки','note:t').conflicts,0);
  assert.equal(growth.typeOf(predicates.entityKey('Казань')).type,'место');
 });
});

test('the model names new entity types, rules do not override them',async()=>{
 add('Барсик','ест','корм','note:p');add('Барсик','спит на','диване','note:p');
 const complete=async({messages})=>({content:messages[1].content.includes('Барсик')?'ТИП: Барсик | питомец\nТИП: Вася | хакер; drop table':'NONE'});
 const r=await growth.growTypes(complete);
 assert.ok(r.born.some(t=>t.name==='питомец'));
 assert.equal(growth.typeOf('барсик').source,'model');
 assert.deepEqual([...growth.parseTypes('ТИП: Кто-то | 1234',['Кто-то'])],[],'мусор не становится типом');
 growth.setType('Барсик','кот');assert.equal(growth.typeOf('барсик').type,'кот');
});

test('entity cards are created and then grow with new facts',async()=>{
 add('Миша','работает в','школа','note:c');add('Миша','любит','джаз','note:c');
 await growth.growTypes(null);
 let r=await growth.growCards(null);assert.ok(r.created>=1);
 let c=growth.card('Мише');
 assert.equal(c.name,'Миша');assert.match(c.description,/работает в школа/);assert.equal(c.type,'человек');
 add('Миша','любит','бег','note:c');
 const seen=[];
 r=await growth.growCards(async({messages})=>{seen.push(messages[1].content);return {content:'Миша работает в школе и любит джаз и бег.'}});
 assert.ok(r.grown>=1);
 const prompt=seen.find(t=>t.includes('Прежнее описание'));
 assert.ok(prompt&&prompt.includes('бег')&&!prompt.includes('Новые факты:\nМиша — любит → джаз'),'модель дописывает только новым');
 c=growth.card('Миша');assert.equal(c.description,'Миша работает в школе и любит джаз и бег.');assert.equal(c.grew,1);
 assert.equal(growth.cardsFor([{subject:'Миша',object:'бег'}])[0].name,'Миша');
 const o=growth.card('Ольга Петровна');assert.ok(o.aliases.includes('мама'));assert.doesNotMatch(o.description,/зовут Ольга/);
});

test('deep clean resolves pronouns and merges exact repeats',async()=>{
 add('Вера','живёт в','Тула','note:d');const p=add('она','любит','сирень','note:d').id;
 const r=await growth.deepClean({});
 assert.equal(r.resolved,1);
 assert.equal(memory.factsById([p]).length,0);
 assert.ok(memory.relations('Вера').some(f=>f.object==='сирень'));
});

test('zones grow in place: new entities join neighbours, islands become zones, big zones split',()=>{
 const before=memory.communities(),ids=new Map(before.map(t=>[t.label,t.id]));
 add('Лена','дружит с','Миша','note:z');
 const after=memory.communities();
 for(const t of after)if(ids.has(t.label))assert.equal(t.id,ids.get(t.label),'старые зоны на месте');
 add('Зоя','любит','кактусы','note:z2');
 const z=memory.communities().find(t=>t.factIds.length&&t.entities.includes('Зоя'));
 assert.ok(z&&!ids.has(z.label),'островок — новая зона');
 // Две плотные группы в одной зоне: зона разрастается и делится.
 for(let i=0;i<8;i++)add('Зоя','знает','друг'+i,'note:z3');
 add('Зоя','любит','группа','note:z3');
 for(let i=0;i<8;i++)add('группа','включает','участник'+i,'note:z3');
 const grown=memory.communities();
 const child=grown.find(t=>t.parent);
 assert.ok(child,'появилась зона, выросшая из другой');
 const g=zones.grownSince(new Date(Date.now()-60000).toISOString());
 assert.ok(g.split.length>=1);
 assert.ok(!g.created.some(x=>x.label==='Лена'),'первая раскладка — не рост');
});

test('selection raises confirmed facts and lowers corrected ones once',()=>{
 const good=add('Тимур','любит','чай','note:s').id,bad=add('Тимур','любит','кофе','note:s').id;
 memory.setConfidence(good,.8);
 usefulness.rate({facts:[good]},{ok:1});usefulness.rate({facts:[bad]},{fix:1});usefulness.rate({facts:[bad]},{fix:1});
 const r=growth.select();
 assert.ok(r.strengthened>=1&&r.weakened>=1);
 assert.equal(memory.factsById([good])[0].confidence,.85);
 assert.equal(memory.factsById([bad])[0].confidence,.8);
 assert.deepEqual(growth.select(),{strengthened:0,weakened:0},'старые оценки не считаются дважды');
});

test('reflection writes growth into the diary',async()=>{
 const reflect=require('../reflect');
 add('Гоша','зовут','Георгий','note:r');
 const r=await reflect.run({ws:{notes:[],tasks:[]}});
 assert.ok(r.details.clean&&r.details.cards&&r.details.selection);
 assert.equal(typeof r.text,'string');
});
