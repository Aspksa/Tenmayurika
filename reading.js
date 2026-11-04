'use strict';
// Юрика читает Диск — только локально. Документы из Личной библиотеки, которые Хранитель уже
// проиндексировал (library-index.js), фоном прочитываются по кускам: у документа появляется конспект
// (выдержки), из текста простыми правилами вынимаются факты со ссылкой на страницу и цитатой.
// Хозяин решил: текст документов и выученное из них не уходят в модель. Поэтому знания из документов
// живут в своей таблице brain_reading_facts, а не в общей памяти (которую видит модель), и в разговоре
// найденные места показываются хозяину под ответом (поле docs), а не подсказкой модели.
// Имена файлов и конспекты не попадают в мысли и журнал агентов — те иногда идут в подсказки модели.
const path=require('node:path');
const crypto=require('node:crypto');
const learn=require('./learn');
const thoughts=require('./thoughts');
const {use,tx}=require('./brain-db');

const CHUNK=2500,MAX_CHUNKS=80,PASS_CHUNKS=20,MAX_ATTEMPTS=3,SNIPPET=360,MAX_FACTS_DOC=200;
let busy=false;
const on=()=>thoughts.on('reading');
const nameOf=p=>path.posix.basename(String(p||''));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const norm=s=>String(s||'').toLocaleLowerCase('ru').replace(/ё/g,'е');
function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c}

/* ---------- Куски ---------- */
// Текст режется по абзацам на куски до CHUNK символов; у куска — страница, с которой он начинается ([Страница N] из PDF).
function chunks(text){
 const out=[];let cur='',page=null,start=null;
 const push=()=>{const t=cur.trim();if(t.length>=20)out.push({text:t,page:start});cur='';start=null};
 for(const raw of String(text||'').split(/\r?\n/)){
  const pm=raw.match(/^\[Страница (\d+)\]$/);if(pm){push();page=Number(pm[1]);continue}
  const line=raw.trim();if(!line)continue;
  if(cur.length+line.length+1>CHUNK)push();
  if(start===null)start=page;
  cur+=(cur?'\n':'')+line.slice(0,CHUNK);
 }
 push();
 return out.slice(0,MAX_CHUNKS);
}

/* ---------- Конспект: выдержки ---------- */
const STOP=new Set('это как что для или при где когда если этот эта эти его она они был была были будет также который которая которые свой свои'.split(' '));
function terms(v){return (norm(v).match(/[\p{L}\p{N}]{4,}/gu)||[]).filter(w=>!STOP.has(w))}
// Три самых «центральных» предложения документа в исходном порядке.
function extractSummary(text){
 const phrases=String(text||'').split(/(?<=[.!?])\s+|\r?\n/).map(s=>s.trim()).filter(s=>s.length>=20&&!/^\[(Страница \d+|Лист: .+)\]$/.test(s)).slice(0,300);
 const freq=new Map();for(const w of terms(phrases.join(' ')))freq.set(w,(freq.get(w)||0)+1);
 return phrases.map((t,i)=>({t:t.slice(0,300),i,s:terms(t).reduce((n,w)=>n+(freq.get(w)||0),0)/Math.sqrt(Math.max(terms(t).length,1))})).sort((a,b)=>b.s-a.s).slice(0,3).sort((a,b)=>a.i-b.i).map(x=>x.t).join(' ').slice(0,700);
}
// Ключевые слова документа — темы, по которым она теперь «что-то знает».
function keywords(text,n=8){
 const freq=new Map();for(const w of terms(String(text).slice(0,200000)))freq.set(w,(freq.get(w)||0)+1);
 return [...freq].filter(([w,c])=>c>=2&&!/^\d+$/.test(w)).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([w])=>w);
}

/* ---------- Факты: правила, с цитатой ---------- */
// Предложение, из которого взят факт: для цитаты в окне.
function quoteFor(text,f){
 const o=norm(f.object).slice(0,20);
 for(const s of String(text).match(/[^.!?\n;]+[.!?]?/g)||[])if(norm(s).includes(o)&&norm(s).includes(norm(f.subject).slice(0,12)))return clean(s).slice(0,300);
 return '';
}

/* ---------- Чтение ---------- */
function hasTable(d,name){return !!d.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name)}
function indexed(){try{return use(d=>hasTable(d,'library_index')?d.prepare('SELECT path,modified,size FROM library_index ORDER BY modified DESC').all():[])}catch{return []}}
function textOf(file){try{return use(d=>hasTable(d,'library_index')?d.prepare('SELECT text FROM library_index WHERE path=?').get(file)?.text||'':'')}catch{return ''}}
function row(file){return use(d=>d.prepare('SELECT * FROM brain_reading WHERE path=?').get(file)||null)}
function view(r){
 if(!r)return null;
 let kw=[];try{kw=JSON.parse(r.keywords||'[]')}catch{}
 return {path:r.path,name:nameOf(r.path),status:r.status,progress:r.chunks_total?Math.round(r.chunks_done/r.chunks_total*100):0,chunks:r.chunks_total,facts:r.facts,summary:r.summary,keywords:Array.isArray(kw)?kw:[],error:r.error||null,startedAt:r.started_at,readAt:r.read_at||null};
}
// Что читать: новое, изменённое и недочитанное. Удалённый с Диска документ забывается вместе с его знаниями.
function queue(){
 const docs=indexed(),have=new Map(use(d=>d.prepare('SELECT path,modified,status,attempts FROM brain_reading').all()).map(r=>[r.path,r]));
 const alive=new Set(docs.map(x=>x.path)),gone=[...have.keys()].filter(p=>!alive.has(p));
 if(gone.length)use(d=>tx(d,()=>{for(const p of gone)forgetIn(d,p)}));
 return docs.filter(x=>{const r=have.get(x.path);return !r||r.modified!==x.modified||(r.status==='reading'&&r.attempts<MAX_ATTEMPTS)});
}
function forgetIn(d,p){d.prepare('DELETE FROM brain_reading WHERE path=?').run(p);d.prepare('DELETE FROM brain_reading_facts WHERE path=?').run(p)}
function saveFacts(d,file,page,text,facts){
 const seen=new Set(d.prepare('SELECT subject,predicate,object FROM brain_reading_facts WHERE path=?').all(file).map(f=>norm(f.subject+'|'+f.predicate+'|'+f.object)));
 let n=seen.size,added=0;const st=d.prepare('INSERT INTO brain_reading_facts(id,path,page,subject,predicate,object,quote,at) VALUES(?,?,?,?,?,?,?,?)'),at=new Date().toISOString();
 for(const f of facts){if(n>=MAX_FACTS_DOC)break;const k=norm(f.subject+'|'+f.predicate+'|'+f.object);if(seen.has(k))continue;seen.add(k);n++;added++;st.run(crypto.randomUUID(),file,page,f.subject.slice(0,200),f.predicate.slice(0,150),f.object.slice(0,300),quoteFor(text,f),at)}
 return added;
}
// Один проход читает до PASS_CHUNKS кусков (это быстро: без модели) и уступает до следующей минуты.
function readPending({limit=PASS_CHUNKS,force=false}={}){
 if(busy||(!on()&&!force))return {read:0,chunks:0,facts:0};
 busy=true;const out={read:0,chunks:0,facts:0};
 try{
  for(const doc of queue()){
   if(out.chunks>=limit)break;
   const text=textOf(doc.path);if(!text.trim())continue;
   const parts=chunks(text);
   let r=row(doc.path);
   if(!r||r.modified!==doc.modified){
    use(d=>tx(d,()=>{d.prepare('DELETE FROM brain_reading_facts WHERE path=?').run(doc.path);
     d.prepare("INSERT INTO brain_reading(path,modified,size,status,chunks_done,chunks_total,facts,summary,keywords,attempts,error,started_at,read_at) VALUES(?,?,?,'reading',0,?,0,?,?,0,NULL,?,NULL) ON CONFLICT(path) DO UPDATE SET modified=excluded.modified,size=excluded.size,status='reading',chunks_done=0,chunks_total=excluded.chunks_total,facts=0,summary=excluded.summary,keywords=excluded.keywords,attempts=0,error=NULL,started_at=excluded.started_at,read_at=NULL").run(doc.path,doc.modified,doc.size,parts.length,extractSummary(text),JSON.stringify(keywords(text)),new Date().toISOString())}));
    r=row(doc.path);
   }
   let i=r.chunks_done,added=0;
   try{
    use(d=>tx(d,()=>{for(;i<parts.length&&out.chunks<limit;i++){added+=saveFacts(d,doc.path,parts[i].page,parts[i].text,learn.byRules(parts[i].text));out.chunks++}}));
    const done=i>=parts.length;
    use(d=>d.prepare('UPDATE brain_reading SET chunks_done=?,facts=facts+?,status=?,read_at=?,attempts=0,error=NULL WHERE path=?').run(i,added,done?'read':'reading',done?new Date().toISOString():null,doc.path));
    out.facts+=added;
    if(done){out.read++;finished(row(doc.path))}
   }catch(e){
    use(d=>d.prepare("UPDATE brain_reading SET attempts=attempts+1,error=?,status=CASE WHEN attempts+1>=? THEN 'error' ELSE 'reading' END WHERE path=?").run(String(e.message||e.name).slice(0,200),MAX_ATTEMPTS,doc.path));
    console.error('Reading failed:',e.name);
   }
  }
  return out;
 }finally{busy=false}
}
// Дочитала: мысль без имени файла и без содержания, сытость души («новое» — потребность novelty в heart.js).
function finished(r){
 if(!r)return;
 thoughts.add('read','Дочитала ещё один документ с Диска'+(r.facts?' и выписала '+r.facts+' '+plural(r.facts,'факт','факта','фактов'):'')+'. Знаю его только я — наружу не отдаю.',{reading:true});
 try{if(thoughts.on('heart'))require('./heart').satisfy({novelty:6})}catch(e){console.error('Reading heart failed:',e.name)}
}
// Перечитать документ заново.
function reread(file){
 if(typeof file!=='string'||!file)throw new TypeError('Укажите документ');
 return use(d=>tx(d,()=>{const had=!!d.prepare('SELECT 1 FROM brain_reading WHERE path=?').get(file);forgetIn(d,file);return had}));
}

/* ---------- Поиск: для разговора и окон ---------- */
const STEMS=q=>[...new Set(terms(q).map(w=>w.slice(0,Math.max(4,Math.min(6,w.length-1)))))].slice(0,8);
// Нужные места в прочитанных документах: до трёх документов, в каждом — лучший абзац со страницей,
// и выписанные факты, которые подходят под вопрос.
function find(query,{limit=3}={}){
 const stems=STEMS(query);if(!stems.length)return [];
 const need=stems.length>2?2:1;
 let rows=[];
 try{rows=use(d=>hasTable(d,'library_index_fts')?d.prepare("SELECT f.path FROM library_index_fts f JOIN brain_reading r ON r.path=f.path WHERE r.chunks_done>0 AND library_index_fts MATCH ? ORDER BY bm25(library_index_fts) LIMIT ?").all(stems.map(s=>'"'+s.replace(/"/g,'')+'"*').join(' OR '),limit*3):[])}catch(e){console.error('Reading search failed:',e.name);return []}
 const out=[];
 for(const r of rows){
  const lines=textOf(r.path).split(/\r?\n/);let page=null,best=null;
  for(let i=0;i<lines.length;i++){
   const pm=lines[i].match(/^\[Страница (\d+)\]$/);if(pm){page=Number(pm[1]);continue}
   const low=norm(lines[i]),score=stems.filter(s=>low.includes(s)).length;
   if(score&&(!best||score>best.score))best={score,page,line:i};
  }
  if(!best||best.score<need)continue;
  const near=lines.slice(Math.max(0,best.line-1),best.line+2).filter(l=>!/^\[Страница \d+\]$/.test(l)).join(' ');
  const facts=use(d=>d.prepare('SELECT page,subject,predicate,object FROM brain_reading_facts WHERE path=?').all(r.path)).filter(f=>{const t=norm(f.subject+' '+f.predicate+' '+f.object);return stems.some(s=>t.includes(s))}).slice(0,3);
  out.push({path:r.path,name:nameOf(r.path),page:best.page,excerpt:clean(near).slice(0,SNIPPET),facts,score:best.score});
  if(out.length>=limit)break;
 }
 return out.sort((a,b)=>b.score-a.score);
}
// Вопросы про документы — без модели: «что ты прочитала», «что в документах про X».
const ASKED=/(что|какие)\s+(ты\s+)?(прочитала|прочла|читала)|что\s+(есть\s+)?в\s+(моих\s+)?(документах|файлах)|в\s+(моих\s+)?документах/iu;
function reply(message){
 if(!on()||!ASKED.test(String(message||'')))return null;
 const rest=String(message).replace(ASKED,' ').replace(/\b(про|о|об|насчёт|насчет)\b/giu,' ');
 const hits=STEMS(rest).length?find(rest):[];
 if(hits.length)return {text:'Нашла в твоих документах (только для тебя, наружу это не уходит):\n'+hits.map(h=>'📄 '+h.name+(h.page?', стр. '+h.page:'')+': «'+h.excerpt+'»'+(h.facts.length?'\n   выписала: '+h.facts.map(f=>f.subject+' — '+f.predicate+' '+f.object).join('; '):'')).join('\n'),docs:hits};
 const l=list(8).filter(x=>x.status==='read');
 if(!l.length)return {text:'Я ещё не прочитала ни одного документа с Диска. Положи туда текстовые файлы, PDF, Word или Excel — я прочитаю их сама, когда Хранитель их проиндексирует.',docs:[]};
 return {text:'Недавно прочитала:\n'+l.map(x=>'📄 '+x.name+(x.summary?' — '+x.summary.slice(0,160):'')).join('\n'),docs:l.map(x=>({path:x.path,name:x.name,page:null}))};
}

/* ---------- Для окон ---------- */
function list(limit=60){return use(d=>d.prepare('SELECT * FROM brain_reading ORDER BY COALESCE(read_at,started_at) DESC LIMIT ?').all(limit)).map(view)}
function stats(){
 const r=use(d=>d.prepare("SELECT COUNT(*) AS n,SUM(status='read') AS done,SUM(status='reading') AS reading,SUM(status='error') AS errors,COALESCE(SUM(facts),0) AS facts FROM brain_reading").get());
 const idx=indexed(),have=new Set(use(d=>d.prepare('SELECT path FROM brain_reading').all()).map(x=>x.path));
 return {documents:r.n||0,read:r.done||0,reading:r.reading||0,errors:r.errors||0,facts:r.facts||0,waiting:idx.filter(x=>!have.has(x.path)).length,indexed:idx.length,on:on(),busy};
}
function doc(file){const v=view(row(file));if(!v)return null;v.facts=use(d=>d.prepare('SELECT page,subject,predicate,object,quote FROM brain_reading_facts WHERE path=? ORDER BY page,at LIMIT 30').all(file));v.factCount=row(file).facts;return v}
module.exports={chunks,extractSummary,keywords,readPending,reread,find,reply,list,stats,doc};
