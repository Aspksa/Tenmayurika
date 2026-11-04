'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-graph-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
const m=require('../memory-core'),{louvain}=require('../graph-cluster'),{classify}=require('../predicates');
const add=(s,p,o,src='t')=>m.addFact({subject:s,predicate:p,object:o,sourceId:src});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('relation types: synonyms conflict, preferences only with negation',()=>{
 assert.equal(classify('переехала в').relation,'живёт в');
 assert.deepEqual(classify('не любит'),{relation:'любит',polarity:-1,single:false});
 add('Анна','живёт в','Казань');
 assert.equal(add('Анна','переехала в','Пермь').conflicts,1);
 assert.equal(add('Анна','любит','чай').conflicts,0);
 assert.equal(add('Анна','любит','кофе').conflicts,0);
 assert.equal(add('Анна','не любит','чай').conflicts,1);
 const c=m.conflicts().find(x=>x.newer==='не любит чай');assert.equal(c.earlier,'любит чай');
});
test('full-text search understands word forms and ё',()=>{
 assert.ok(m.searchFacts('где живет Анна').length>=2);
 assert.equal(m.searchFacts('Казани')[0].object,'Казань');
 assert.equal(m.searchFacts('зань').length,1); // часть слова — запасной поиск
 m.syncRecords('note',[{id:'n1',title:'Поездка',content:'Билеты в Казань на май',createdAt:'2026-01-01'}]);
 assert.equal(m.searchIndex('казанские билеты',{kinds:['note']})[0].ref,'n1');
 m.syncRecords('note',[]);assert.equal(m.searchIndex('билеты',{kinds:['note']}).length,0);
});
test('graph: neighborhood, path, communities',()=>{
 add('Пётр','работает в','Пермь');add('Мария','дружит с','Пётр');add('Олег','живёт в','Сочи');add('Олег','любит','шахматы');
 const p=m.findPath('Анну','Марию',4);
 assert.deepEqual(p.facts.map(f=>f.subject),['Анна','Пётр','Мария']);
 assert.ok(m.neighborhood('Анна',2).facts.some(f=>f.hop===2&&f.subject==='Пётр'));
 const t=m.communities();assert.ok(t.find(x=>x.label==='Олег').size===2);
 const ids=louvain(['a','b','c','d'],[['a','b'],['c','d']]);assert.equal(ids.get('a'),ids.get('b'));assert.notEqual(ids.get('a'),ids.get('c'));
});
test('near-duplicates are found, merged and dismissed',()=>{
 add('Олег','живет в','г. Сочи','note:x');add('Сочи','находится в','Россия');add('Пермь','находится в','Россия');
 const d=m.duplicates();assert.equal(d.length,1);assert.equal(d[0].keep.object,'Сочи');
 const imp=m.impact(d[0].drop.id);assert.ok(imp.facts.length>=1);assert.equal(imp.notes[0].source,true);
 assert.equal(m.mergeDuplicate(d[0].keep.id,d[0].drop.id).retired,d[0].drop.id);
 assert.equal(m.duplicates().length,0);
 const o=m.overview();assert.equal(o.week.merged,1);assert.ok(o.hubs[0].degree>=3);assert.ok(o.topics.length>=2);
});
test('hybrid recall: words plus graph neighbours, with reasons',async()=>{
 const {recall}=require('../recall');
 const r=await recall('где живёт Анна',{ws:{notes:[{id:'n2',title:'Анна',content:'день рождения в мае'}],tasks:[]}});
 assert.ok(r.facts[0].why.includes('слова'));
 assert.ok(r.facts.some(f=>f.why.includes('связь')));
 assert.equal(r.notes[0].id,'n2');
 // Часть слова в заметке и заметка за множеством фактов не теряются.
 assert.equal((await recall('зань',{ws:{notes:[{id:'n3',title:'Поездка в Казань',content:''}]}})).notes[0].id,'n3');
 for(let i=0;i<65;i++)add('Анна','знает','язык '+i);
 assert.equal((await recall('Анна',{ws:{notes:[{id:'n4',title:'День рождения',content:'Анна'}]}})).notes[0].id,'n4');
 assert.ok(m.neighborhood('Анна',2,6).facts.length<=6);
});
