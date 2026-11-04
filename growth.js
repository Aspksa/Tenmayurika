'use strict';
// Рост «Мозга» (идеи MemoryBear, Apache-2.0; код свой). Память не только копится, но и перестраивается:
//  Б. связи крепнут — записи, которые вспоминают вместе, связываются; связь со временем слабеет сама,
//     а после поправленного ответа — сразу вдвое;
//  А. карточки сущностей — все факты о человеке или вещи сводятся в одно описание, оно дописывается;
//  Г. свои типы — «человек», «место», «питомец», «проект»…: по правилам, а новые придумывает модель;
//     новые виды связей с несколькими значениями перестают считаться противоречиями;
//  Д. глубокая чистка в простое — почти одинаковые факты сливаются, псевдонимы («мама» = «Ольга Петровна»)
//     связываются, «он/она» в фактах заменяются на того, о ком речь;
//  Е. отбор — уверенность подтверждённых фактов растёт, поправленных падает, угасшие связи уходят.
// Зоны, которые растут постепенно (В), — в zones.js.
const crypto=require('node:crypto');
const memory=require('./memory-core');
const predicates=require('./predicates');
const aliases=require('./aliases');
const {use,tx,parse}=require('./brain-db');
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,16);
const line=f=>f.subject+' — '+f.predicate+' → '+f.object;

/* ---------- Б. Крепнущие связи ---------- */
// Заряд связи: каждое совместное вспоминание +1, за HALF дней без дела заряд вдвое меньше.
// Сила 0…1 = 1 − e^(−заряд/3): одно вспоминание — слабая, четыре подряд — сильная.
const HALF_MS=21*864e5,PRUNE_BELOW=.15;
const decayed=(r,now=Date.now())=>r.charge*Math.pow(2,-Math.max(0,now-Date.parse(r.last_at))/HALF_MS);
const strengthOf=c=>1-Math.exp(-c/3);
const levelOf=s=>s>=.65?'strong':s>=.35?'medium':'weak';
function refs(recalled){
 const out=[];for(const [k,p] of [['facts','f:'],['notes','n:']])for(const id of (recalled?.[k]||[]).slice(0,12))if(typeof id==='string'&&id&&id.length<=100)out.push(p+id);
 return [...new Set(out)].slice(0,12);
}
function pairs(list){const out=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)out.push(list[i]<list[j]?[list[i],list[j]]:[list[j],list[i]]);return out}
function strengthen(recalled){
 const ps=pairs(refs(recalled));if(!ps.length)return 0;const now=Date.now(),at=new Date(now).toISOString();
 use(db=>tx(db,()=>{const get=db.prepare('SELECT * FROM memory_bonds WHERE a=? AND b=?'),put=db.prepare('INSERT INTO memory_bonds(a,b,charge,uses,last_at) VALUES(?,?,?,?,?) ON CONFLICT(a,b) DO UPDATE SET charge=excluded.charge,uses=excluded.uses,last_at=excluded.last_at');
  for(const [a,b] of ps){const r=get.get(a,b);put.run(a,b,(r?decayed(r,now):0)+1,(r?r.uses:0)+1,at)}}));
 return ps.length;
}
// Поправленный ответ: связи между тем, что вспомнилось для него, слабеют вдвое.
function weaken(recalled,k=.5){
 const ps=pairs(refs(recalled));if(!ps.length)return 0;const now=Date.now(),at=new Date(now).toISOString();
 return use(db=>tx(db,()=>{let n=0;const get=db.prepare('SELECT * FROM memory_bonds WHERE a=? AND b=?'),up=db.prepare('UPDATE memory_bonds SET charge=?,last_at=? WHERE a=? AND b=?');
  for(const [a,b] of ps){const r=get.get(a,b);if(r){up.run(decayed(r,now)*k,at,a,b);n++}}return n}));
}
function bonds({limit=2000}={}){
 const now=Date.now();
 return use(db=>db.prepare('SELECT * FROM memory_bonds ORDER BY last_at DESC LIMIT 20000').all()).map(r=>{const c=decayed(r,now),s=strengthOf(c);return {a:r.a,b:r.b,charge:Math.round(c*100)/100,strength:Math.round(s*100)/100,level:levelOf(s),uses:r.uses,last_at:r.last_at}})
  .sort((x,y)=>y.charge-x.charge).slice(0,limit);
}
// Угасшие связи и связи с записями, которых больше нет, уходят.
function pruneBonds(alive){
 const now=Date.now();
 return use(db=>tx(db,()=>{const del=db.prepare('DELETE FROM memory_bonds WHERE a=? AND b=?');let n=0;
  for(const r of db.prepare('SELECT * FROM memory_bonds').all())if(decayed(r,now)<PRUNE_BELOW||(alive&&(!alive(r.a)||!alive(r.b)))){del.run(r.a,r.b);n++}return n}));
}
function bondStats(){const out={weak:0,medium:0,strong:0};for(const b of bonds({limit:20000}))out[b.level]++;return out}

/* ---------- Г. Свои типы ---------- */
// По связи понятно, кто есть кто: у кого есть имя и друзья — человек, где живут — место, и т. д.
const SUBJECT_TYPE={'зовут':'человек','женат на':'человек','дружит с':'человек','день рождения':'человек','возраст':'человек','живёт в':'человек','работает в':'человек','учится в':'человек'};
const OBJECT_TYPE={'живёт в':'место','работает в':'организация','учится в':'учёба','дружит с':'человек','женат на':'человек','любит':'интерес','умеет':'умение','знает':'человек'};
const PRON=/^(он|она|оно|они|его|её|ее|их|ему|ей|им|там|тут|здесь|это|этот|эта|тот|та)$/;
function ruleTypes(rows,g){
 const votes=new Map(),vote=(k,t)=>{if(!k||!t||PRON.test(k))return;if(!votes.has(k))votes.set(k,new Map());const m=votes.get(k);m.set(t,(m.get(t)||0)+1)};
 for(const f of rows){const rel=f.relation||predicates.classify(f.predicate).relation;
  // «Умеет X» и «знает X» про людей бывают про предметы: объект «знает» — человек, только если имя с большой буквы.
  vote(g.key(f.subject),SUBJECT_TYPE[rel]);if(rel!=='знает'||/^\p{Lu}/u.test(f.object))vote(g.key(f.object),OBJECT_TYPE[rel])}
 const out=new Map();for(const [k,m] of votes)out.set(k,[...m].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0]);return out;
}
const TYPE_RE=/^[\p{L}][\p{L} -]{1,23}$/u;
function parseTypes(text,names){
 const out=new Map(),allowed=new Map(names.map(n=>[predicates.entityKey(n),n]));
 for(const m of String(text||'').matchAll(/ТИП:\s*([^|\n]{1,120})\|\s*([^\n]{1,40})/g)){const k=predicates.entityKey(m[1]),t=m[2].trim().toLocaleLowerCase().replace(/[.«»"]/g,'');if(allowed.has(k)&&TYPE_RE.test(t))out.set(k,t)}
 return out;
}
// Новые виды связей: связь, которой нет в словаре, встречается часто — у неё появляется своё имя;
// если у одного субъекта несколько значений («играет в теннис», «играет в шахматы»), она многозначная.
function relationTypes(rows){
 const by=new Map();
 for(const f of rows){const c=predicates.classify(f.predicate);if(predicates.known(c.relation))continue;const r=(c.polarity<0?'не ':'')+c.relation;if(!by.has(r))by.set(r,{count:0,subj:new Map()});const e=by.get(r);e.count++;const s=predicates.entityKey(f.subject);if(!e.subj.has(s))e.subj.set(s,new Set());e.subj.get(s).add(predicates.entityKey(f.object))}
 return [...by].filter(([,e])=>e.count>=3).map(([name,e])=>({name,count:e.count,multi:[...e.subj.values()].some(o=>o.size>=2)}));
}
function loadLearned(){try{predicates.learn(new Map(use(db=>db.prepare("SELECT name FROM memory_types WHERE kind='relation' AND multi=1").all()).map(r=>[r.name,{multi:true}])))}catch(e){console.error('Learned types failed:',e.name)}}
async function growTypes(complete){
 const {rows,graph}=memory.activeGraph(),now=new Date().toISOString();
 const types=ruleTypes(rows,graph);
 const have=use(db=>new Map(db.prepare('SELECT key,type,source FROM memory_entity_types').all().map(r=>[r.key,{type:r.type,source:r.source}])));
 // Модель называет тип тем, кому правила его не дали (не больше 20 за проход).
 if(complete){
  const need=[...graph.adj].filter(([k,l])=>l.length>=2&&!types.has(k)&&!have.has(k)&&!PRON.test(k)).sort((a,b)=>b[1].length-a[1].length).slice(0,20);
  if(need.length)try{
   const names=need.map(([k])=>graph.names.get(k));
   const msg=await complete({messages:[{role:'system',content:'Для каждой сущности назови её тип одним-двумя словами по-русски в единственном числе (человек, питомец, город, проект, книга, болезнь…). Отвечай только строками «ТИП: имя | тип».'},{role:'user',content:need.map(([k,l])=>graph.names.get(k)+': '+l.slice(0,4).map(e=>line(e.fact)).join('; ')).join('\n')}]});
   for(const [k,t] of parseTypes(msg.content,names))types.set(k,t+'\u0000model');
  }catch(e){console.error('Type model failed:',e.name)}
 }
 let changed=0;
 use(db=>tx(db,()=>{const put=db.prepare('INSERT INTO memory_entity_types(key,type,source,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET type=excluded.type,source=excluded.source,updated_at=excluded.updated_at');
  for(const [k,raw] of types){const [t,src='rules']=raw.split('\u0000'),old=have.get(k);
   // Тип, данный моделью или пользователем, правила не перебивают.
   if(old&&(old.type===t||(src==='rules'&&old.source!=='rules')))continue;put.run(k,t,src,now);changed++}
  const del=db.prepare('DELETE FROM memory_entity_types WHERE key=?');for(const k of have.keys())if(!graph.adj.has(k))del.run(k)}));
 // Реестр типов: сколько сущностей каждого типа, какие связи стали своими.
 const born=[];
 use(db=>tx(db,()=>{
  const old=new Map(db.prepare('SELECT kind,name,multi FROM memory_types').all().map(r=>[r.kind+'|'+r.name,r]));
  const counts=new Map(),srcOf=new Map();for(const r of db.prepare('SELECT type,source FROM memory_entity_types').all()){counts.set(r.type,(counts.get(r.type)||0)+1);if(r.source!=='rules')srcOf.set(r.type,r.source)}
  const put=db.prepare('INSERT INTO memory_types(kind,name,count,multi,source,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,name) DO UPDATE SET count=excluded.count,multi=max(memory_types.multi,excluded.multi)');
  for(const [t,n] of counts){if(!old.has('entity|'+t))born.push({kind:'entity',name:t});put.run('entity',t,n,0,srcOf.get(t)||'rules',now)}
  for(const r of relationTypes(rows)){if(!old.has('relation|'+r.name))born.push({kind:'relation',name:r.name,multi:r.multi});put.run('relation',r.name,r.count,r.multi?1:0,'rules',now)}
  db.prepare("UPDATE memory_types SET count=0 WHERE kind='entity' AND name NOT IN (SELECT DISTINCT type FROM memory_entity_types)").run();
 }));
 loadLearned();
 return {changed,born};
}
function typeOf(key){return use(db=>db.prepare('SELECT type,source FROM memory_entity_types WHERE key=?').get(key))||null}
function setType(name,type){
 const k=predicates.entityKey(name),t=String(type||'').trim().toLocaleLowerCase();if(!k||!TYPE_RE.test(t))throw new TypeError('Invalid type');
 use(db=>db.prepare('INSERT INTO memory_entity_types(key,type,source,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET type=excluded.type,source=excluded.source,updated_at=excluded.updated_at').run(aliases.canon(aliases.map(),k),t,'user',new Date().toISOString()));
 return {name,type:t};
}
function typeList(){return use(db=>db.prepare('SELECT * FROM memory_types WHERE count>0 ORDER BY kind,count DESC,name').all()).map(r=>({kind:r.kind,name:r.name,count:r.count,multi:!!r.multi,source:r.source,created_at:r.created_at}))}

/* ---------- А. Карточки сущностей ---------- */
// Без модели: что известно о сущности (её связи) и кто с ней связан.
function cardByTemplate(name,edges){
 const own=new Map(),about=[];
 for(const e of edges){const f=e.fact;if(e.self){const p=(f.polarity<0&&!/^не\s/i.test(f.predicate)?'не ':'')+f.predicate;if(!own.has(p))own.set(p,[]);own.get(p).push(f.object)}else about.push(f.subject+' ('+f.predicate+')')}
 const parts=[...own].map(([p,o])=>p+' '+[...new Set(o)].join(', '));
 let text=name+(parts.length?': '+parts.join('; '):'')+(about.length?(parts.length?'. Связаны: ':': связаны ')+[...new Set(about)].slice(0,6).join(', '):'')+'.';
 return text.length>500?text.slice(0,497)+'…':text;
}
const MAX_CARDS=60;
async function growCards(complete){
 const {graph}=memory.activeGraph(),now=new Date().toISOString();
 const have=use(db=>new Map(db.prepare('SELECT * FROM memory_cards').all().map(r=>[r.key,r])));
 const list=[...graph.adj].filter(([k,l])=>l.length>=2&&!PRON.test(k)).sort((a,b)=>b[1].length-a[1].length);
 let grown=0,created=0,modelBudget=complete?12:0;
 for(const [k,l] of list.slice(0,MAX_CARDS*4)){
  const ids=[...new Set(l.map(e=>e.fact.id))].sort(),sig=hash(ids.join(','));const old=have.get(k);
  if(old&&old.signature===sig)continue;
  if(grown+created>=MAX_CARDS)break;
  // Факт-псевдоним («мама — зовут → Ольга Петровна») о самой сущности ничего не добавляет.
  const edges=l.filter(e=>!(graph.key(e.fact.subject)===k&&graph.key(e.fact.object)===k)).map(e=>({fact:e.fact,self:graph.key(e.fact.subject)===k}));
  const name=graph.names.get(k),prevIds=new Set(old?parse(old.fact_ids,[]):[]),fresh=edges.filter(e=>!prevIds.has(e.fact.id));
  let text=cardByTemplate(name,edges),source='rules';
  if(modelBudget>0){modelBudget--;try{
   // Карточка дописывается: модель получает прежнее описание и только новые факты.
   const msg=await complete({messages:[{role:'system',content:old?'Допиши описание сущности новыми фактами. Сохрани всё верное из прежнего описания, ничего не выдумывай. 1–3 предложения по-русски, только описание.':'Сверни факты в описание сущности: 1–3 предложения по-русски, ничего не добавляя от себя. Только описание.'},
    {role:'user',content:(old?'Прежнее описание: '+old.description+'\nНовые факты:\n'+fresh.map(e=>line(e.fact)).join('\n'):'Сущность: '+name+'\nФакты:\n'+edges.slice(0,30).map(e=>line(e.fact)).join('\n'))}]});
   const s=String(msg.content||'').trim().replace(/\s+/g,' ');if(s&&s.length<=600){text=s;source='model'}
  }catch(e){console.error('Card model failed:',e.name)}}
  use(db=>db.prepare('INSERT INTO memory_cards(key,name,description,fact_ids,signature,grew,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name,description=excluded.description,fact_ids=excluded.fact_ids,signature=excluded.signature,grew=memory_cards.grew+excluded.grew,source=excluded.source,updated_at=excluded.updated_at')
   .run(k,name,text,JSON.stringify(ids),sig,old?fresh.length:0,source,now,now));
  if(old)grown++;else created++;
 }
 // Сущность ушла из памяти (или у неё остался один факт) — карточка тоже.
 const keep=new Set(list.map(([k])=>k));
 use(db=>{const del=db.prepare('DELETE FROM memory_cards WHERE key=?');for(const k of have.keys())if(!keep.has(k))del.run(k)});
 return {created,grown};
}
function cardRow(r){if(!r)return null;const t=typeOf(r.key);return {name:r.name,type:t?.type||null,aliases:aliases.namesOf(r.key),description:r.description,facts:parse(r.fact_ids,[]).length,grew:r.grew,source:r.source,created_at:r.created_at,updated_at:r.updated_at}}
// Карточка по имени: точное имя, псевдоним или то же слово в другом падеже.
function card(name){
 if(typeof name!=='string'||!name.trim()||name.length>300)throw new TypeError('Invalid name');
 const al=aliases.map(),k=aliases.canon(al,predicates.entityKey(name));
 let r=use(db=>db.prepare('SELECT * FROM memory_cards WHERE key=?').get(k));
 if(!r){const t=memory.terms(k);if(t.length)r=use(db=>db.prepare('SELECT * FROM memory_cards').all()).find(c=>{const ct=memory.terms(c.key);return ct.length===t.length&&t.every(x=>ct.some(y=>y.startsWith(x)||x.startsWith(y)))})}
 return cardRow(r);
}
function cards(limit=50){return use(db=>db.prepare('SELECT * FROM memory_cards ORDER BY updated_at DESC LIMIT ?').all(limit)).map(cardRow)}
// Карточки сущностей вспомненных фактов — в подсказку модели (не больше двух).
function cardsFor(facts,limit=2){
 if(!facts?.length)return [];
 const al=aliases.map(),count=new Map();
 for(const f of facts)for(const x of [f.subject,f.object]){const k=aliases.canon(al,predicates.entityKey(x));if(k)count.set(k,(count.get(k)||0)+1)}
 const rows=use(db=>{const st=db.prepare('SELECT * FROM memory_cards WHERE key=?');return [...count].sort((a,b)=>b[1]-a[1]).map(([k])=>st.get(k)).filter(Boolean)});
 return rows.slice(0,limit).map(cardRow);
}

/* ---------- Д. Глубокая чистка ---------- */
// Псевдоним из факта: «мама — зовут → Ольга Петровна», «Ольга Петровна — это → мама», «Саша — прозвище → Шурик».
const ALIAS_PRED=/^(зовут|имя|по имени|это|он же|она же|также|то же что|прозвище|псевдоним|ник|кличка|называют)$/;
const isName=s=>/^\p{Lu}/u.test(String(s).trim());
function aliasFrom(f){
 const p=predicates.clean(f.predicate);if(!ALIAS_PRED.test(p)||f.polarity<0)return null;
 const s=String(f.subject).trim(),o=String(f.object).trim();if(!s||!o||s.length>80||o.length>80||PRON.test(predicates.entityKey(s)))return null;
 // Прозвище — второе имя того же: прозвище → имя.
 if(/^(прозвище|псевдоним|ник|кличка|называют)$/.test(p))return {alias:o,canonical:s};
 // Роль («мама», «я», «начальник») — псевдоним имени собственного.
 if(!isName(s)&&isName(o))return {alias:s,canonical:o};
 if(isName(s)&&!isName(o)&&p==='это')return {alias:o,canonical:s};
 return null;
}
async function deepClean({complete=null,ws={}}={}){
 const out={merged:0,aliases:0,resolved:0};
 // 1. Почти одинаковые факты об одном и том же сливаются (то, что раньше ждало кнопки «≈ Похожие»).
 try{for(const d of memory.duplicates({threshold:.9,limit:50}))if(d.score>=.9&&predicates.entityKey(d.keep.subject)===predicates.entityKey(d.drop.subject)&&memory.mergeDuplicate(d.keep.id,d.drop.id))out.merged++}catch(e){console.error('Auto merge failed:',e.name)}
 // 2. Псевдонимы.
 const {rows}=memory.activeGraph();
 for(const f of rows){const a=aliasFrom(f);if(!a)continue;try{if(aliases.add(a.alias,a.canonical,{evidence:line(f),source:'rules'}))out.aliases++}catch(e){if(!(e instanceof TypeError))throw e}}
 // 3. «Он/она» в субъекте факта: о ком речь — по другим фактам того же источника.
 const bySource=new Map();for(const f of rows){if(!bySource.has(f.source_id))bySource.set(f.source_id,[]);bySource.get(f.source_id).push(f)}
 const notes=new Map((ws.notes||[]).map(n=>['note:'+n.id,n]));
 let modelBudget=complete?5:0;
 for(const f of rows){
  if(!PRON.test(predicates.entityKey(f.subject)))continue;
  const cands=[...new Map((bySource.get(f.source_id)||[]).filter(x=>x.id!==f.id&&!PRON.test(predicates.entityKey(x.subject))).map(x=>[predicates.entityKey(x.subject),x.subject])).values()];
  let who=cands.length===1?cands[0]:null;
  if(!who&&cands.length>1&&modelBudget>0&&notes.has(f.source_id)){modelBudget--;try{
   const n=notes.get(f.source_id);
   const msg=await complete({messages:[{role:'system',content:'Определи, к кому или чему относится местоимение в факте. Ответь только именем из списка или NONE.'},{role:'user',content:'Текст: '+String(n.title+'. '+(n.content||'')).slice(0,1500)+'\nФакт: '+line(f)+'\nВарианты: '+cands.join(', ')}]});
   const ans=String(msg.content||'').trim();who=cands.find(c=>predicates.entityKey(c)===predicates.entityKey(ans))||null;
  }catch(e){console.error('Pronoun model failed:',e.name)}}
  if(!who)continue;
  try{memory.addFact({subject:who,predicate:f.predicate,object:f.object,sourceId:f.source_id,confidence:Number(f.confidence)||1,restore:false});if(memory.retireFact(f.id,'resolved'))out.resolved++}catch(e){if(!(e instanceof TypeError))throw e}
 }
 return out;
}

/* ---------- Е. Отбор ---------- */
// Оценки ответов (👍/👎, «верно», поправки) раздаются вспомненным фактам (usefulness.js). При размышлении
// подтверждённое крепнет (+0,05 к уверенности за каждое новое подтверждение, не выше 1), поправленное
// слабеет быстрее (−0,1, не ниже 0,3). Учитываются только оценки, пришедшие с прошлого отбора.
function select(){
 const out={strengthened:0,weakened:0};const now=new Date().toISOString();
 const rows=use(db=>db.prepare("SELECT ref,ok,fix FROM memory_usefulness WHERE kind='fact'").all());
 const prev=use(db=>new Map(db.prepare('SELECT ref,ok,fix FROM memory_selection').all().map(r=>[r.ref,r])));
 const changed=rows.filter(r=>{const p=prev.get(r.ref);return r.ok!==(p?.ok||0)||r.fix!==(p?.fix||0)});
 for(let i=0;i<changed.length;i+=50){
  const part=changed.slice(i,i+50),facts=new Map(memory.factsById(part.map(r=>r.ref)).map(f=>[f.id,f]));
  for(const r of part){const p=prev.get(r.ref)||{ok:0,fix:0},f=facts.get(r.ref);if(!f)continue;
   const up=Math.max(0,r.ok-p.ok),down=Math.max(0,r.fix-p.fix),c=Number(f.confidence)||0;
   const next=Math.min(1,Math.max(Math.min(c,.3),c+.05*up-.1*down));
   if(next>c&&memory.setConfidence(f.id,next))out.strengthened++;else if(next<c&&memory.setConfidence(f.id,next))out.weakened++}
 }
 use(db=>tx(db,()=>{const put=db.prepare('INSERT INTO memory_selection(ref,ok,fix,at) VALUES(?,?,?,?) ON CONFLICT(ref) DO UPDATE SET ok=excluded.ok,fix=excluded.fix,at=excluded.at');for(const r of changed)put.run(r.ref,r.ok,r.fix,now)}));
 return out;
}

/* ---------- Сводка роста (для «Мозга») ---------- */
function stats(){
 const c=use(db=>({cardCount:db.prepare('SELECT COUNT(*) AS n FROM memory_cards').get().n,grew:db.prepare('SELECT COUNT(*) AS n FROM memory_cards WHERE grew>0').get().n}));
 return {...c,bonds:bondStats(),types:typeList(),aliases:aliases.list().slice(0,30)};
}
loadLearned();
// Оценка ответа: поправка ослабляет связи между вспомненным для него, подтверждение — укрепляет.
require('./experience').onFeedback((ep,kind)=>{try{if(kind==='fix')weaken(ep.recalled);else if(kind==='ok')strengthen(ep.recalled)}catch(e){console.error('Bond feedback failed:',e.name)}});
module.exports={strengthen,weaken,bonds,pruneBonds,bondStats,strengthOf,levelOf,growTypes,ruleTypes,parseTypes,relationTypes,typeOf,setType,typeList,cardByTemplate,growCards,card,cards,cardsFor,aliasFrom,deepClean,select,stats,loadLearned};
