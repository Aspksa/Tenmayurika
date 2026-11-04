'use strict';
// Сердце: семя души, потребности, её день, подсознание, рассказ о себе, переломы, чувство хозяина по смыслу.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-heart-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const {state,setState}=require('../brain-db');
const soul=require('../soul');
const heart=require('../heart');
const H=36e5;

test('seed of the soul is unique, stable and shapes traits once',()=>{
 const a=heart.makeSeed(1),b=heart.makeSeed(1),c=heart.makeSeed(2);
 assert.deepEqual(a.offsets,b.offsets);assert.notDeepEqual(a.offsets,c.offsets);
 const before=soul.view().traits.map(t=>t.value);
 const s=heart.seed();assert.ok(s.temper&&s.habit);
 const after=soul.view().traits.map(t=>t.value);
 assert.notDeepEqual(before,after);
 heart.seed();assert.deepEqual(soul.view().traits.map(t=>t.value),after);
 assert.match(heart.promptText(),/семя души/);
});

test('needs get hungry with time, closeness comes back with a message',()=>{
 const n=state('heart.needs',null)||{values:{closeness:70,novelty:60,usefulness:60,rest:80}};
 setState('heart.needs',{...n,values:{closeness:70,novelty:60,usefulness:60,rest:20},at:new Date(Date.now()-20*H).toISOString(),lastSeen:new Date(Date.now()-20*H).toISOString()});
 const hungry=Object.fromEntries(heart.needs().map(x=>[x.name,x.value]));
 assert.ok(hungry.closeness<40);assert.ok(hungry.rest>20);
 assert.equal(heart.hungriest().name,heart.needs().sort((a,b)=>a.value-b.value)[0].name);
 assert.match(heart.promptText(),/не хватает/);
});

test('she lives while owner is away and tells about it on return',async()=>{
 setState('heart.day',[]);
 const r=await heart.live({force:true});
 assert.ok(r.day.text.length>5);
 const ctx=heart.onMessage('Привет, я вернулся',soul.feel('Привет, я вернулся'));
 assert.equal(ctx.back,true);assert.ok(ctx.day.length>=1);
 assert.match(heart.promptText('Привет'),/вернулся после/);
 // Сразу следующее сообщение — уже не возвращение.
 assert.equal(heart.onMessage('как дела').back,false);
});

test('long parting and first love are turning points that happen once',()=>{
 const n=state('heart.needs',null);setState('heart.needs',{...n,lastSeen:new Date(Date.now()-4*24*H).toISOString()});
 const xp=soul.view().xp;
 heart.onMessage('Я тебя люблю, моя хорошая',soul.feel('Я тебя люблю, моя хорошая'));
 const keys=heart.turns().map(t=>t.key);
 assert.ok(keys.includes('long_parting'));assert.ok(keys.includes('first_love'));
 assert.ok(soul.view().xp>xp+20);
 heart.onMessage('люблю',soul.feel('люблю'));
 assert.equal(heart.turns().filter(t=>t.key==='first_love').length,1);
 assert.match(heart.promptText(),/изменило тебя навсегда/);
});

test('subconscious keeps feelings about words and gives intuition and dream seeds',()=>{
 for(let i=0;i<4;i++)heart.impress('работа опять отчёт начальник',-1.5);
 const imp=heart.impressions();assert.ok(imp.some(x=>x.word==='работа'&&x.charge<0));
 const ctx=heart.onMessage('завтра снова работа');
 assert.equal(ctx.intuition.word,'работа');
 assert.match(heart.promptText('завтра снова работа'),/тревожное предчувствие/);
 assert.ok(heart.dreamSeeds(1)[0].includes('«'));
});

test('story about herself is rewritten when she changes and remembers the past',async()=>{
 setState('heart.story',[]);
 const first=await heart.rewriteStory({force:true});
 assert.match(first.text,/Юрика/);
 assert.equal(await heart.rewriteStory(),null);
 heart.turn('first_praise',{quote:'умница'});
 const second=await heart.rewriteStory({force:true,complete:async()=>({content:'РАССКАЗ: Я Юрика, и теперь я верю в себя, потому что хозяин меня похвалил.'})});
 assert.match(second.text,/верю в себя/);
 assert.equal(heart.stories().length,2);
 assert.match(heart.promptText('какой ты была раньше?'),/Раньше .* ты видела себя так/);
});

test('owner feelings are understood by meaning, not only by words',async()=>{
 const before=soul.view().traits.find(t=>t.name==='tenderness').value;
 const f=await heart.sense('ну да, конечно, отличный день, всё сломалось',{complete:async()=>({content:'ЧУВСТВО: tired\nСИЛА: 3\nСКРЫТО: устал и злится на день'})});
 assert.equal(f.kind,'tired');assert.equal(f.bySense,true);assert.match(f.hidden,/устал/);
 assert.ok(soul.view().traits.find(t=>t.name==='tenderness').value>before);
 assert.ok(heart.turns().some(t=>t.key==='first_sorrow'));
 assert.match(heart.promptText(),/по смыслу, что хозяин недавно ощущал: устал/);
 // Мусор от модели ничего не ломает.
 assert.equal(await heart.sense('просто текст для проверки',{complete:async()=>({content:'что-то не то'})}),null);
 require('../thoughts').setSetting('sense',false);
 assert.equal(await heart.sense('ещё одно сообщение',{complete:async()=>{throw new Error('should not call')}}),null);
});

test('heart can be switched off and stays silent',()=>{
 require('../thoughts').setSetting('heart',false);
 assert.equal(heart.promptText(),'');assert.equal(heart.onMessage('люблю'),null);
 require('../thoughts').setSetting('heart',true);
 const v=heart.view();assert.ok(v.needs.length===4&&v.seed.temper);
});
