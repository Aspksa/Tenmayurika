'use strict';
// Юрика читает Диск — только локально: конспект, выписки со страницами, поиск мест, ничего не уходит в модель.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenma-reading-'));
process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');process.env.TENMAYURIKA_LIBRARY_QUEUE=path.join(dir,'queue.json');
process.env.TENMAYURIKA_GUARDIAN_MEMORY=path.join(dir,'guardian.json');
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'memory.sqlite');process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;delete process.env.EMBEDDING_URL;
const queue=require('../library-queue'),reading=require('../reading'),memory=require('../memory-core'),thoughts=require('../thoughts');
for(const key of ['innerVoice','verify'])thoughts.setSetting(key,false);
const LIB=process.env.TENMAYURIKA_LIBRARY_DIR;

test('chunks keep the page each piece starts on',()=>{
 const c=reading.chunks('[Страница 1]\nАнна живёт в Казани.\n[Страница 2]\nСрок оплаты — до 1 апреля, сумма 50 000 рублей.');
 assert.deepEqual(c.map(x=>x.page),[1,2]);
});

test('reads indexed documents locally: summary, facts with pages, search, reread, forgetting',async()=>{
 await fsp.mkdir(LIB,{recursive:true});
 const text='Договор аренды квартиры.\nАрендатор Анна Петрова живёт в Казани.\nМарина любит пионы.\nОплата аренды вносится до пятого числа каждого месяца, сумма аренды 40 000 рублей.\nАренда квартиры продлевается автоматически.';
 await fsp.writeFile(path.join(LIB,'аренда.txt'),text);
 await queue.scan();await queue.run(10);
 assert.equal(reading.stats().waiting,1);
 const r=reading.readPending();assert.equal(r.read,1);assert.ok(r.facts>=1);
 const d=reading.doc('аренда.txt');
 assert.equal(d.status,'read');assert.ok(d.summary.length>0);assert.ok(d.keywords.includes('аренды'));
 assert.ok(d.facts.some(f=>f.subject==='Марина'&&f.predicate==='любит'&&/пионы/.test(f.object)&&/Марина любит пионы/.test(f.quote)));
 // В общую память (которую видит модель) знания из документов не попадают.
 assert.equal(memory.queryFacts({limit:500}).some(f=>String(f.source_id).startsWith('doc:')),false);
 // Мысли — без имени файла и содержания.
 assert.equal(thoughts.since(0,200).some(t=>/аренда\.txt|пионы|Казан/.test(t.text)),false);
 const hits=reading.find('когда оплата аренды?');assert.equal(hits[0].path,'аренда.txt');assert.match(hits[0].excerpt,/пятого числа/);
 // Повторный проход ничего не перечитывает; «перечитать» читает заново.
 assert.equal(reading.readPending().read,0);
 assert.equal(reading.reread('аренда.txt'),true);assert.equal(reading.readPending().read,1);
 // Документ удалён с Диска — забыт вместе с выписками.
 await fsp.unlink(path.join(LIB,'аренда.txt'));await queue.scan();reading.readPending();
 assert.equal(reading.doc('аренда.txt'),null);assert.equal(reading.list().length,0);
});

test('setting off stops background reading',async()=>{
 await fsp.writeFile(path.join(LIB,'ещё.txt'),'Пётр работает в больнице номер один.');
 await queue.scan();await queue.run(10);
 thoughts.setSetting('reading',false);
 try{assert.equal(reading.readPending().read,0);assert.equal(reading.reply('что ты прочитала?'),null)}finally{thoughts.setSetting('reading',true)}
 assert.equal(reading.readPending().read,1);
});

test('chat: documents are shown to the owner, never sent to the model',async()=>{
 await fsp.writeFile(path.join(LIB,'страховка.txt'),'Полис страхования автомобиля действует до 15 декабря. Номер полиса ХХХ-777.');
 await queue.scan();await queue.run(10);reading.readPending();
 const {reply}=require('../chat');let payload='';
 const server=http.createServer((req,res)=>{req.setEncoding('utf8');req.on('data',s=>payload+=s);req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Сейчас посмотрю.'}}]}))})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.CHAT_URL='http://127.0.0.1:'+server.address().port+'/v1/chat/completions';
 try{
  const own=await reply({message:'что в моих документах про страхование автомобиля?'});
  assert.equal(own.secret,true);assert.match(own.reply,/страховка\.txt/);assert.equal(payload,'');assert.equal(own.docs[0].path,'страховка.txt');
  const normal=await reply({message:'до какого числа действует полис страхования автомобиля?'});
  assert.ok(payload);assert.doesNotMatch(payload,/страховка\.txt|ХХХ-777|15 декабря/);
  assert.equal(normal.docs[0].path,'страховка.txt');
 }finally{delete process.env.CHAT_URL;await new Promise(r=>server.close(r))}
});

test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
