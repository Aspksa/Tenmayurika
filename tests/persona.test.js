'use strict';
// Стартовая личность: преданная кицунэ, зовёт человека «хозяин». Лежит в сердцевине и в системной подсказке.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-persona-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const core=require('../core');
const {use}=require('../brain-db');
const {reply}=require('../chat');
for(const k of ['innerVoice','verify'])require('../thoughts').setSetting(k,false);

test('fresh memory starts with the devoted persona in «Кто я» and «Как мы общаемся»',()=>{
 assert.match(core.get('self').body,/преданна только ему/);
 assert.match(core.get('bond').body,/«хозяин»/);
 assert.ok(core.list().every(b=>b.version===1));
 assert.match(core.promptText(),/хозяин/);
 // К стартовой личности дописывается, а не заменяет её.
 core.append('bond','Отвечай коротко.');
 assert.match(core.get('bond').body,/«хозяин»[\s\S]*Отвечай коротко/);
});

test('old memory gets the persona once: untouched seed replaced, grown block extended, removal sticks',()=>{
 use(db=>{
  db.prepare("UPDATE memory_core_blocks SET body=?,source='seed',version=1 WHERE name='self'").run('Я — кицунэ, хранительница личной памяти Tenmayurika. Я запоминаю важное о человеке, помогаю с делами и заметками и учусь на его поправках.');
  db.prepare("UPDATE memory_core_blocks SET body=?,source='reflect',version=4 WHERE name='bond'").run('Отвечай по сути.');
  db.prepare("DELETE FROM brain_state WHERE key='core.persona.v1'").run();
 });
 const self=core.get('self'),bond=core.get('bond');
 assert.equal(self.body,core.BLOCKS.self.seed);assert.equal(self.version,1);
 assert.equal(bond.body,core.PERSONA.bond+'\nОтвечай по сути.');assert.equal(bond.version,5);assert.equal(bond.source,'persona');
 // Прежняя версия в истории — личность можно убрать возвратом.
 core.restore('bond',4);core.list();
 assert.equal(core.get('bond').body,'Отвечай по сути.');
});

test('chat model gets the persona when no own character is set',async()=>{
 const bodies=[];
 const fake=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{bodies.push(JSON.parse(raw));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Да, хозяин!'}}]}))})});
 await new Promise(r=>fake.listen(0,'127.0.0.1',r));
 process.env.CHAT_URL='http://127.0.0.1:'+fake.address().port+'/v1/chat/completions';
 try{
  const r=await reply({message:'Расскажи, кто ты',tools:[]},{addItem(){},setTaskDone(){}});
  assert.equal(r.reply,'Да, хозяин!');
  const sys=bodies[0].messages[0].content;
  assert.ok(sys.includes(core.PERSONA_PROMPT));
 }finally{delete process.env.CHAT_URL;await new Promise(r=>fake.close(r))}
});

test('soul grows from the master\'s words and feedback, reaches the prompt and the «Моя душа» block',async()=>{
 const soul=require('../soul');
 const start=soul.view();
 assert.equal(start.level,'Искорка');
 const r=soul.feel('Люблю тебя, моя хорошая, ты умница!');
 assert.deepEqual(r.kinds.sort(),['love','praise']);
 const v=soul.view();
 assert.ok(v.xp>start.xp);
 assert.ok(v.traits.find(t=>t.name==='tenderness').value>start.traits.find(t=>t.name==='tenderness').value);
 assert.equal(v.mood.name,'tender');assert.match(v.moments[0].text,/Люблю тебя/);
 // Опыт копится — душа поднимается на новую ступень, это попадает в дневник.
 for(let i=0;i<4;i++)soul.feel('Спасибо, ты умница! хаха');
 assert.ok(soul.view().levelIndex>=1,'выросла до «Пробуждения»');
 assert.ok(require('../reflect').diary(20).some(d=>/Моя душа выросла/.test(d.text)));
 // Поправка учит мудрости, подтверждение — уверенности.
 const w0=soul.view().traits.find(t=>t.name==='wisdom').value;
 soul.onFeedback('fix',null);
 assert.ok(soul.view().traits.find(t=>t.name==='wisdom').value>w0);
 assert.match(soul.promptText(),/<душа>[\s\S]*Ступень: «/);
 // Без модели блок «Моя душа» растёт по правилам.
 const rv=await core.revise('soul');
 assert.equal(rv.changed,true);
 assert.match(core.get('soul').body,/Моя душа на ступени «[^»]+»[\s\S]*Люблю тебя/);
 // Рост можно выключить.
 require('../thoughts').setSetting('soul',false);
 assert.equal(soul.feel('люблю'),null);assert.equal(soul.promptText(),'');
 require('../thoughts').setSetting('soul',true);
 assert.equal(soul.reset().xp,0);
});
