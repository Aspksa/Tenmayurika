'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-planner-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
const planner=require('../planner');
const {parseCommand}=require('../chat');

// Вторник, 3 ноября 2026, 10:00.
const NOW=new Date(2026,10,3,10);
test('russian dates and times are parsed out of task titles',()=>{
 const p=t=>planner.parseWhen(t,NOW);
 assert.deepEqual(p('купить чай завтра в 15:00'),{due:'2026-11-04',time:'15:00',rest:'купить чай'});
 assert.deepEqual(p('позвонить маме в пятницу'),{due:'2026-11-06',time:null,rest:'позвонить маме'});
 assert.deepEqual(p('отчёт к 12.11'),{due:'2026-11-12',time:null,rest:'отчёт'});
 assert.deepEqual(p('сдать проект 5 декабря'),{due:'2026-12-05',time:null,rest:'сдать проект'});
 assert.deepEqual(p('встреча через 3 дня в 9 утра'),{due:'2026-11-06',time:'09:00',rest:'встреча'});
 assert.deepEqual(p('ужин в 7 вечера'),{due:'2026-11-03',time:'19:00',rest:'ужин'});
 assert.equal(p('отчёт 01.02').due,'2027-02-01');
 assert.equal(p('31.02').due,null);
 assert.deepEqual(p('зайти в 3 подъезд'),{due:null,time:null,rest:'зайти в 3 подъезд'});
});
test('agenda helpers pick the right tasks',()=>{
 const t=[{due:'2026-11-02',done:false},{due:'2026-11-03',done:false},{due:'2026-11-08',done:false},{due:null,done:false}];
 assert.equal(t.filter(x=>planner.inPeriod(x,'overdue',NOW)).length,1);
 assert.equal(t.filter(x=>planner.inPeriod(x,'today',NOW)).length,1);
 assert.equal(t.filter(x=>planner.inPeriod(x,'week',NOW)).length,2);
 assert.equal(planner.describe('2026-11-04',NOW),'завтра');
 assert.equal(planner.describe('2026-11-07',NOW),'сб, 7 ноября');
});
test('task, agenda and helper commands are recognised',()=>{
 const work=parseCommand('рабочее важное дело: отчёт в пятницу в 10:00');
 assert.equal(work.fn,'add_task');
 assert.equal(work.args.title,'отчёт');assert.equal(work.args.category,'work');assert.equal(work.args.priority,'high');assert.equal(work.args.time,'10:00');assert.ok(work.args.due);
 assert.deepEqual(parseCommand('дело: купить чай'),{fn:'add_task',args:{title:'купить чай'}});
 assert.equal(parseCommand('работа: созвон').args.category,'work');
 assert.deepEqual(parseCommand('рабочие дела'),{fn:'list_tasks',args:{category:'work',when:undefined}});
 assert.equal(parseCommand('личные дела на завтра').args.when,'tomorrow');
 assert.equal(parseCommand('просроченные').args.when,'overdue');
 assert.deepEqual(parseCommand('что на сегодня'),{fn:'agenda',args:{when:'today'}});
 assert.equal(parseCommand('что на неделе').args.when,'week');
 assert.deepEqual(parseCommand('перенеси отчёт на понедельник'),{fn:'move_task',args:{title:'отчёт',when:'на понедельник'}});
 assert.equal(parseCommand('сколько дней до нового года').fn,'days_until');
 assert.equal(parseCommand('переведи 5 км в мили').fn,'convert_units');
 assert.equal(parseCommand('придумай пароль на 20').args.length,20);
 assert.equal(parseCommand('выбери чай, кофе или какао').fn,'pick_random');
 assert.equal(parseCommand('рабочая заметка: План — пункты').args.category,'work');
 assert.equal(parseCommand('открой календарь').args.page,'calendar');
});
test('items API stores categories and dates, edits and deletes',async()=>{
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(method,body)=>{const r=await fetch(base+'/api/items',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
  const made=await call('POST',{collection:'tasks',title:'Квартальный отчёт',category:'work',due:'2026-11-12',time:'10:30',priority:'high'});
  assert.equal(made.status,201);
  assert.equal(made.data.category,'work');assert.equal(made.data.due,'2026-11-12');assert.equal(made.data.time,'10:30');assert.equal(made.data.priority,'high');
  assert.equal((await call('POST',{collection:'tasks',title:'Плохая дата',due:'2026-02-31'})).status,400);
  assert.equal((await call('POST',{collection:'tasks',title:'Плохая категория',category:'other'})).status,400);
  const moved=await call('PATCH',{collection:'tasks',id:made.data.id,due:'2026-11-13',title:'Отчёт за квартал',done:true});
  assert.equal(moved.data.due,'2026-11-13');assert.equal(moved.data.title,'Отчёт за квартал');assert.equal(moved.data.done,true);assert.ok(moved.data.doneAt);
  const note=await call('POST',{collection:'notes',title:'Идея',content:'текст',category:'work'});
  assert.equal(note.data.category,'work');assert.equal(note.data.pinned,false);
  assert.equal((await call('PATCH',{collection:'notes',id:note.data.id,pinned:true})).data.pinned,true);
  assert.equal((await call('DELETE',{collection:'notes',id:note.data.id})).status,200);
  assert.equal((await call('DELETE',{collection:'notes',id:note.data.id})).status,404);
  const ws=await (await fetch(base+'/api/workspace')).json();
  assert.ok(!ws.notes.some(n=>n.id===note.data.id));
 }finally{await new Promise(r=>server.close(r))}
});
test('avatar plans tasks with dates and reschedules them',async()=>{
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const say=async message=>(await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})})).json();
  const added=await say('рабочее дело: Созвон с командой сегодня в 23:59');
  assert.match(added.reply,/рабочее, сегодня в 23:59/);
  assert.match((await say('что на сегодня')).reply,/Созвон с командой/);
  assert.match((await say('рабочие дела')).reply,/Созвон с командой/);
  assert.doesNotMatch((await say('личные дела')).reply,/Созвон с командой/);
  const moved=await say('перенеси созвон на завтра');
  assert.match(moved.reply,/Перенесла «Созвон с командой» → .*завтра в 23:59/);
  assert.equal(moved.changed,true);
  assert.match((await say('что на завтра')).reply,/Созвон с командой/);
  assert.match((await say('переведи 100 f в c')).reply,/100 °F = 37,7/);
  assert.match((await say('переведи 2 гб в мб')).reply,/2 ГБ = 2\s?048 МБ/);
  const pw=(await say('придумай пароль на 24')).reply.match(/🔐 (\S+)/)[1];
  assert.equal(pw.length,24);
  assert.match((await say('сколько дней до 31.12')).reply,/дн|день|Это сегодня/);
  const blocked=await (await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'что на сегодня',tools:['tasks']})})).json();
  assert.match(blocked.reply,/выключен/);
 }finally{await new Promise(r=>server.close(r))}
});
test('review fixes: calculator precedence, navigation words, server survives bad JSON',async()=>{
 const {reply}=require('../chat');
 assert.match((await reply({message:'посчитай -2^2'})).reply,/= -4$/);
 assert.match((await reply({message:'посчитай 3-2^2'})).reply,/= -1$/);
 assert.match((await reply({message:'посчитай 2^-1'})).reply,/= 0\.5$/);
 assert.equal(parseCommand('открой раздел фактов').args.page,'facts');
 assert.equal(parseCommand('открой настройки модели').args.page,'settings');
 const {server}=require('../server');
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  for(const p of ['/api/llm','/api/facts']){const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:'{oops'});assert.equal(r.status,400)}
  assert.equal((await fetch(base+'/api/health')).status,200);
 }finally{await new Promise(r=>server.close(r))}
});
