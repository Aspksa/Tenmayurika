'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const path=require('node:path');
const predicates=require('./predicates');
const {louvain}=require('./graph-cluster');
const DB=process.env.TENMAYURIKA_MEMORY_DB ? path.resolve(process.env.TENMAYURIKA_MEMORY_DB) : path.join(__dirname,'data','tenmayurika.sqlite');
function open(){
 fs.mkdirSync(path.dirname(DB),{recursive:true});
 const db=new DatabaseSync(DB);
 // Встроенный lower() SQLite меняет регистр только у ASCII, поэтому для кириллицы нужен свой.
 db.function('unicode_lower',{deterministic:true},value=>typeof value==='string'?value.toLocaleLowerCase():value);
 db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS memory_facts(
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL, object TEXT NOT NULL,
 source_id TEXT NOT NULL, observed_at TEXT NOT NULL, valid_from TEXT NOT NULL,
 valid_to TEXT, confidence REAL NOT NULL DEFAULT 1 CHECK(confidence>=0 AND confidence<=1),
 fingerprint TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE INDEX IF NOT EXISTS memory_facts_subject ON memory_facts(subject,predicate,valid_to);
 CREATE INDEX IF NOT EXISTS memory_facts_source ON memory_facts(source_id);
 CREATE TABLE IF NOT EXISTS memory_conflicts(
 id TEXT PRIMARY KEY, earlier_id TEXT NOT NULL, newer_id TEXT NOT NULL,
 detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(earlier_id,newer_id)
 );
 CREATE INDEX IF NOT EXISTS memory_facts_observed ON memory_facts(observed_at); 
 CREATE TABLE IF NOT EXISTS memory_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT, fact_id TEXT NOT NULL, action TEXT NOT NULL,
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );`);
 migrate(db);
 return db;
}
// Схема растёт: типы связей (relation, polarity), полнотекстовый индекс FTS5 и отказы «это не дубль».
// Проверка делается один раз на процесс для каждого файла базы.
const migrated=new Set();
// Текст для индекса: «ё» и «е» не различаются (токенизатор FTS5 сам их не сводит).
const YO="replace(replace(%s,'ё','е'),'Ё','Е')";
function migrate(db){
 if(migrated.has(DB))return;
 const cols=db.prepare('PRAGMA table_info(memory_facts)').all().map(c=>c.name);
 if(!cols.includes('relation'))db.exec('ALTER TABLE memory_facts ADD COLUMN relation TEXT');
 if(!cols.includes('polarity'))db.exec('ALTER TABLE memory_facts ADD COLUMN polarity INTEGER NOT NULL DEFAULT 1');
 const body=YO.replace('%s',"new.subject||' '||new.predicate||' '||new.object");
 db.exec(`CREATE INDEX IF NOT EXISTS memory_facts_relation ON memory_facts(relation,valid_to);
 CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(kind UNINDEXED, ref UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
 CREATE TABLE IF NOT EXISTS memory_search_sig(kind TEXT NOT NULL, ref TEXT NOT NULL, sig TEXT NOT NULL, PRIMARY KEY(kind,ref));
 CREATE TABLE IF NOT EXISTS memory_not_duplicates(a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY(a,b));
 CREATE TRIGGER IF NOT EXISTS memory_facts_ai AFTER INSERT ON memory_facts WHEN new.valid_to IS NULL BEGIN
  INSERT INTO memory_search(kind,ref,title,body) VALUES('fact',new.id,${YO.replace('%s','new.subject')},${body});
 END;
 CREATE TRIGGER IF NOT EXISTS memory_facts_au AFTER UPDATE ON memory_facts BEGIN
  DELETE FROM memory_search WHERE kind='fact' AND ref=old.id;
  INSERT INTO memory_search(kind,ref,title,body) SELECT 'fact',new.id,${YO.replace('%s','new.subject')},${body} WHERE new.valid_to IS NULL;
 END;
 CREATE TRIGGER IF NOT EXISTS memory_facts_ad AFTER DELETE ON memory_facts BEGIN
  DELETE FROM memory_search WHERE kind='fact' AND ref=old.id;
 END;`);
 // Старые факты получают тип связи, а индекс — пропущенные факты (база из прошлых версий).
 const untyped=db.prepare('SELECT id,predicate FROM memory_facts WHERE relation IS NULL').all();
 if(untyped.length){const up=db.prepare('UPDATE memory_facts SET relation=?,polarity=? WHERE id=?');db.exec('BEGIN IMMEDIATE');try{for(const r of untyped){const c=predicates.classify(r.predicate);up.run(c.relation,c.polarity,r.id)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
 const active=db.prepare('SELECT COUNT(*) AS n FROM memory_facts WHERE valid_to IS NULL').get().n,indexed=db.prepare("SELECT COUNT(*) AS n FROM memory_search WHERE kind='fact'").get().n;
 if(active!==indexed){db.exec('BEGIN IMMEDIATE');try{db.exec("DELETE FROM memory_search WHERE kind='fact'");db.exec(`INSERT INTO memory_search(kind,ref,title,body) SELECT 'fact',id,${YO.replace('%s','subject')},${YO.replace('%s',"subject||' '||predicate||' '||object")} FROM memory_facts WHERE valid_to IS NULL`);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
 migrated.add(DB);
}
function normalize(value,name,max=2000){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new TypeError('Invalid '+name);
 return value.trim();
}
function addFact(input){
 const subject=normalize(input.subject,'subject',300),predicate=normalize(input.predicate,'predicate',150);
 const object=normalize(input.object,'object'),source=normalize(input.sourceId,'sourceId',300);
 const confidence=input.confidence===undefined?1:input.confidence;
 if(typeof confidence!=='number'||!Number.isFinite(confidence)||confidence<0||confidence>1)throw new TypeError('Invalid confidence');
 const now=new Date().toISOString();
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([subject,predicate,object,source])).digest('hex');
 const db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const old=db.prepare('SELECT id,valid_to FROM memory_facts WHERE fingerprint=?').get(fingerprint);
   // Отставленный факт возвращается только при явном добавлении (restore). Повторный разбор заметки
   // (restore:false) не отменяет решение, принятое при разборе противоречия.
   if(old&&(!old.valid_to||input.restore===false)){db.exec('COMMIT');return {id:old.id,duplicate:true,...(old.valid_to?{retired:true}:{}),conflicts:0}}
   // Факт был отставлен при разборе противоречия, а теперь добавлен снова — возвращаем его в память.
   const id=old?old.id:crypto.randomUUID();
   const kind=predicates.classify(predicate);
   if(old)db.prepare('UPDATE memory_facts SET valid_to=NULL,observed_at=?,valid_from=?,confidence=?,relation=?,polarity=? WHERE id=?').run(now,now,confidence,kind.relation,kind.polarity,id);
   else db.prepare('INSERT INTO memory_facts(id,subject,predicate,object,source_id,observed_at,valid_from,confidence,fingerprint,relation,polarity) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,subject,predicate,object,source,now,now,confidence,fingerprint,kind.relation,kind.polarity);
   const prior=conflictingWith(db,{id,subject,object,...kind});
   for(const row of prior){
    db.prepare('INSERT OR IGNORE INTO memory_conflicts(id,earlier_id,newer_id) VALUES(?,?,?)').run(crypto.randomUUID(),row.id,id);
   }
   db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(id,old?'restored':'created');
   db.exec('COMMIT');return {id,duplicate:false,...(old?{restored:true}:{}),conflicts:prior.length};
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
// Противоречие ищется по типу связи, а не по слову: «живёт в Казани» спорит с «переехала в Пермь».
// Единственное значение (живёт в, зовут): другой объект — спор. Многие значения (любит): спорят только
// «любит X» и «не любит X». Регистр субъекта, «ё» и «г.» в объекте не важны.
function conflictingWith(db,f){
 const key=predicates.entityKey(f.object);
 const rows=db.prepare('SELECT id,object,polarity FROM memory_facts WHERE unicode_lower(subject)=unicode_lower(?) AND relation=? AND valid_to IS NULL AND id<>?').all(f.subject,f.relation,f.id);
 return rows.filter(r=>{const same=predicates.entityKey(r.object)===key;return r.polarity!==f.polarity?same:(f.single&&!same)});
}
function extractFacts(text,sourceId){
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>1048576)throw new TypeError('Invalid text');
 const source=normalize(sourceId,'sourceId',300);
 const results=[];
 for(const line of text.split(/\r?\n/)){
  // Поддерживаются «FACT: субъект | связь | объект» и «FACT: | субъект | связь | объект».
  const trimmed=line.trim();if(!trimmed.startsWith('FACT:'))continue;
  const parts=trimmed.slice(5).split('|');if(parts.length===4&&!parts[0].trim())parts.shift();
  if(parts.length!==3)continue;
  const [subject,predicate,object]=parts.map(x=>x.trim());
  if(!subject||!predicate||!object)continue;
  results.push(addFact({subject,predicate,object,sourceId:source,restore:false}));
  if(results.length>=100)break;
 }
 return results;
}
// Запрос FTS5: слова → основы с «*» (Казань, Казани → «казан*»), через OR; BM25 ставит выше записи,
// где совпало больше редких слов. Служебные слова не ищутся.
const STOP=new Set('что как где когда кто чем чего это эти эта этот мне меня мой моя мои твой твоя тебя тебе ты вы вас нас наш она оно они его ему её ее ней них там тут вот уже еще ещё или для про при над под без все всё был была были быть есть нет так тоже очень можно нужно надо какой какая какие какое знаешь помнишь скажи расскажи покажи найди'.split(' '));
function stem(w){return w.length>=7?w.slice(0,w.length-2):w.length>=5?w.slice(0,w.length-1):w.length===4?w.slice(0,3):w}
function terms(text){return [...new Set(String(text||'').toLocaleLowerCase().replace(/ё/g,'е').split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=2&&!STOP.has(w)).map(stem))].slice(0,16)}
function ftsQuery(text){const t=terms(text);return t.length?t.map(x=>'"'+x.replace(/"/g,'')+'"*').join(' OR '):''}
// Поиск по общему индексу: факты, заметки и дела. score — чем больше, тем лучше (−bm25).
function searchIndex(text,{kinds=['fact','note','task'],limit=30}={}){
 const q=ftsQuery(text);if(!q)return [];
 const db=open();
 try{
  const ks=kinds.filter(k=>['fact','note','task'].includes(k));if(!ks.length)return [];
  return db.prepare('SELECT kind,ref,title,-bm25(memory_search,0,0,2,1) AS score FROM memory_search WHERE memory_search MATCH ? AND kind IN ('+ks.map(()=>'?').join(',')+') ORDER BY score DESC LIMIT ?').all(q,...ks,limit).map(r=>({...r}));
 }catch(e){if(/fts5|syntax/i.test(e.message))return [];throw e}finally{db.close()}
}
function searchFacts(query,limit=30){
 const term=normalize(query,'query',300).toLocaleLowerCase();
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Invalid limit');
 const hits=searchIndex(term,{kinds:['fact'],limit});
 const db=open();
 try{
  if(hits.length){
   const rank=new Map(hits.map((h,i)=>[h.ref,{i,score:h.score}]));
   const rows=db.prepare('SELECT * FROM memory_facts WHERE valid_to IS NULL AND id IN ('+hits.map(()=>'?').join(',')+')').all(...hits.map(h=>h.ref));
   return rows.map(r=>({...r,score:rank.get(r.id).score})).sort((a,b)=>rank.get(a.id).i-rank.get(b.id).i);
  }
  // Запасной путь: часть слова («зань») или знаки, которых нет в индексе.
  const escaped=term.replace(/[\\%_]/g,'\\$&');
  const pattern='%'+escaped+'%';
  return db.prepare(`SELECT *, 
   (CASE WHEN instr(unicode_lower(subject),?)>0 THEN 1 ELSE 0 END +
    CASE WHEN instr(unicode_lower(predicate),?)>0 THEN 1 ELSE 0 END +
    CASE WHEN instr(unicode_lower(object),?)>0 THEN 1 ELSE 0 END) AS score
   FROM memory_facts
   WHERE valid_to IS NULL AND (unicode_lower(subject) LIKE ? ESCAPE '\\' OR unicode_lower(predicate) LIKE ? ESCAPE '\\' OR unicode_lower(object) LIKE ? ESCAPE '\\')
   ORDER BY score DESC,observed_at DESC LIMIT ?`).all(term,term,term,pattern,pattern,pattern,limit);
 }finally{db.close()}
}
// Заметки и дела живут в рабочем пространстве; в индекс попадают только изменённые (подпись: длина и дата правки).
function syncRecords(kind,list){
 if(!['note','task'].includes(kind))throw new TypeError('Invalid kind');
 const db=open();
 try{
  const have=new Map(db.prepare('SELECT ref,sig FROM memory_search_sig WHERE kind=?').all(kind).map(r=>[r.ref,r.sig]));
  const seen=new Set();let changed=0;
  const del=db.prepare('DELETE FROM memory_search WHERE kind=? AND ref=?'),ins=db.prepare('INSERT INTO memory_search(kind,ref,title,body) VALUES(?,?,?,?)'),sig=db.prepare('INSERT INTO memory_search_sig(kind,ref,sig) VALUES(?,?,?) ON CONFLICT(kind,ref) DO UPDATE SET sig=excluded.sig');
  const yo=t=>String(t||'').replace(/ё/g,'е').replace(/Ё/g,'Е');
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const r of list||[]){
    if(!r||typeof r.id!=='string')continue;seen.add(r.id);
    const s=[r.updatedAt||r.createdAt||'',String(r.title||'').length,String(r.content||'').length,r.done?1:0].join(':');
    if(have.get(r.id)===s)continue;
    del.run(kind,r.id);ins.run(kind,r.id,yo(r.title),yo(String(r.title||'')+' '+String(r.content||'').slice(0,20000)));sig.run(kind,r.id,s);changed++;
   }
   for(const ref of have.keys())if(!seen.has(ref)){del.run(kind,ref);db.prepare('DELETE FROM memory_search_sig WHERE kind=? AND ref=?').run(kind,ref);changed++}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  return changed;
 }finally{db.close()}
}
function queryFacts({subject,limit=50}={}){
 if(!Number.isInteger(limit)||limit<1||limit>5000)throw new TypeError('Invalid limit');
 const db=open();
 try{
  if(subject)return db.prepare('SELECT * FROM memory_facts WHERE subject=? ORDER BY observed_at DESC LIMIT ?').all(normalize(subject,'subject',300),limit);
  return db.prepare('SELECT * FROM memory_facts ORDER BY observed_at DESC LIMIT ?').all(limit);
 }finally{db.close()}
}
// Действующие факты по id (опыт аватара вспоминает то, что нашлось на похожий вопрос раньше).
function factsById(ids){
 const list=[...new Set((ids||[]).filter(x=>typeof x==='string'&&x&&x.length<=100))].slice(0,50);if(!list.length)return [];
 const db=open();
 try{return db.prepare('SELECT * FROM memory_facts WHERE valid_to IS NULL AND id IN ('+list.map(()=>'?').join(',')+')').all(...list)}finally{db.close()}
}
function relations(subject,limit=100){
 const key=normalize(subject,'subject',300);
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid limit');
 const db=open();
 try{return db.prepare('SELECT id,subject,predicate,object,source_id,confidence,observed_at FROM memory_facts WHERE valid_to IS NULL AND (unicode_lower(subject)=unicode_lower(?) OR unicode_lower(object)=unicode_lower(?)) ORDER BY observed_at DESC LIMIT ?').all(key,key,limit)}finally{db.close()}
}
function conflicts(limit=100){
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid limit');
 const db=open();
 try{return db.prepare('SELECT c.id,c.detected_at,a.subject,a.predicate,b.predicate AS newer_predicate,a.object AS earlier,b.object AS newer,a.source_id AS earlier_source,b.source_id AS newer_source,a.id AS earlier_id,b.id AS newer_id,a.observed_at AS earlier_at,b.observed_at AS newer_at FROM memory_conflicts c JOIN memory_facts a ON a.id=c.earlier_id JOIN memory_facts b ON b.id=c.newer_id ORDER BY c.detected_at DESC LIMIT ?').all(limit).map(c=>{const r={...c};if(c.newer_predicate!==c.predicate){r.earlier=c.predicate+' '+c.earlier;r.newer=c.newer_predicate+' '+c.newer}return r})}finally{db.close()}
}
// Разбор противоречия: keep = 'earlier' | 'newer' | 'both'. Отвергнутый факт не удаляется,
// а получает valid_to (остаётся в истории), противоречие снимается.
function resolveConflict(id,keep){
 const cid=normalize(id,'id',100);
 if(!['earlier','newer','both'].includes(keep))throw new TypeError('Invalid keep');
 const db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const c=db.prepare('SELECT earlier_id,newer_id FROM memory_conflicts WHERE id=?').get(cid);
   if(!c){db.exec('COMMIT');return null}
   const now=new Date().toISOString(),retired=keep==='earlier'?c.newer_id:keep==='newer'?c.earlier_id:null;
   if(retired){
    db.prepare('UPDATE memory_facts SET valid_to=? WHERE id=? AND valid_to IS NULL').run(now,retired);
    db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(retired,'retired');
    // Отвергнутый факт больше ни с чем не спорит.
    db.prepare('DELETE FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').run(retired,retired);
   }
   db.prepare('DELETE FROM memory_conflicts WHERE id=?').run(cid);
   db.exec('COMMIT');return {id:cid,keep,retired};
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
// Поправка пользователя главнее: новый факт вытесняет всё, с чем спорит (старое уходит в историю).
function supersede(newId){
 const nid=normalize(newId,'id',100),db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const rows=db.prepare('SELECT id,earlier_id,newer_id FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').all(nid,nid),now=new Date().toISOString(),retired=[];
   for(const c of rows){const other=c.earlier_id===nid?c.newer_id:c.earlier_id;
    if(db.prepare('UPDATE memory_facts SET valid_to=? WHERE id=? AND valid_to IS NULL').run(now,other).changes){db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(other,'corrected');retired.push(other)}
    db.prepare('DELETE FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').run(other,other)}
   db.exec('COMMIT');return retired;
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
// Отставить факт по просьбе пользователя («забудь», «это неправда»): остаётся в истории.
function retireFact(id,action='corrected'){
 const fid=normalize(id,'id',100),db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const ok=db.prepare('UPDATE memory_facts SET valid_to=? WHERE id=? AND valid_to IS NULL').run(new Date().toISOString(),fid).changes>0;
   if(ok){db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(fid,String(action).slice(0,20));db.prepare('DELETE FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').run(fid,fid)}
   db.exec('COMMIT');return ok;
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
/* ---------- Граф: сущности и связи ---------- */
// Узлы — сущности (субъекты и объекты фактов), рёбра — действующие факты.
function activeFacts(db){return db.prepare('SELECT id,subject,predicate,object,relation,polarity,source_id,confidence,observed_at FROM memory_facts WHERE valid_to IS NULL').all()}
function buildGraph(rows){
 const names=new Map(),adj=new Map();
 const node=(raw)=>{const k=predicates.entityKey(raw);if(!k)return null;if(!names.has(k))names.set(k,raw);if(!adj.has(k))adj.set(k,[]);return k};
 for(const f of rows){const a=node(f.subject),b=node(f.object);if(!a||!b)continue;adj.get(a).push({to:b,fact:f});if(a!==b)adj.get(b).push({to:a,fact:f})}
 return {names,adj};
}
// Одно слово в разных падежах: общее начало почти во всю длину («анну» — «анна», «перми» — «пермь»).
function near(x,y){let i=0;while(i<x.length&&i<y.length&&x[i]===y[i])i++;return i>=Math.max(3,Math.min(x.length,y.length)-1)}
// Сущность по имени: точное совпадение, иначе по основе слова; из нескольких — самая связанная.
function resolveEntity(graph,name){
 const k=predicates.entityKey(name);if(!k)return null;if(graph.adj.has(k))return k;
 const t=terms(k);if(!t.length)return null;
 let best=null,bd=-1;for(const [key,list] of graph.adj){const kt=terms(key);if(t.every(x=>kt.some(y=>near(x,y)))&&list.length>bd){best=key;bd=list.length}}
 return best;
}
const plain=f=>({id:f.id,subject:f.subject,predicate:f.predicate,object:f.object,source_id:f.source_id,confidence:f.confidence,observed_at:f.observed_at});
// Окрестность сущности на depth шагов: каждый факт с номером шага (hop), через который он найден.
function neighborhood(name,depth=2,limit=60){
 normalize(name,'subject',300);
 if(!Number.isInteger(depth)||depth<1||depth>3)throw new TypeError('Invalid depth');
 const db=open();
 try{
  const g=buildGraph(activeFacts(db)),start=resolveEntity(g,name);if(!start)return {entity:null,facts:[]};
  const seen=new Set([start]),out=[],used=new Set();let frontier=[start];
  for(let hop=1;hop<=depth&&frontier.length&&out.length<limit;hop++){
   const next=[];
   for(const k of frontier){if(out.length>=limit)break;for(const e of g.adj.get(k)){if(out.length>=limit)break;if(used.has(e.fact.id))continue;used.add(e.fact.id);out.push({...plain(e.fact),hop,via:g.names.get(k)});if(!seen.has(e.to)){seen.add(e.to);next.push(e.to)}}}
   frontier=next;
  }
  return {entity:g.names.get(start),facts:out};
 }finally{db.close()}
}
// Кратчайшая цепочка фактов между двумя сущностями (поиск в ширину, до maxDepth шагов).
function findPath(from,to,maxDepth=3){
 normalize(from,'from',300);normalize(to,'to',300);
 if(!Number.isInteger(maxDepth)||maxDepth<1||maxDepth>4)throw new TypeError('Invalid depth');
 const db=open();
 try{
  const g=buildGraph(activeFacts(db)),a=resolveEntity(g,from),b=resolveEntity(g,to);
  const res={from:a?g.names.get(a):null,to:b?g.names.get(b):null,facts:[]};if(!a||!b)return res;if(a===b)return res;
  const prev=new Map([[a,null]]);let frontier=[a];
  for(let d=0;d<maxDepth&&frontier.length&&!prev.has(b);d++){const next=[];for(const k of frontier)for(const e of g.adj.get(k))if(!prev.has(e.to)){prev.set(e.to,{from:k,fact:e.fact});next.push(e.to)}frontier=next}
  if(!prev.has(b))return res;
  const chain=[];for(let k=b;prev.get(k);k=prev.get(k).from)chain.unshift(plain(prev.get(k).fact));
  res.facts=chain;return res;
 }finally{db.close()}
}
// Темы памяти: сообщества сущностей по алгоритму Лувена. Факт относится к теме своего субъекта.
function communities(){
 const db=open();
 try{
  const rows=activeFacts(db),g=buildGraph(rows),keys=[...g.adj.keys()].sort();
  const edges=rows.map(f=>[predicates.entityKey(f.subject),predicates.entityKey(f.object),1]).filter(e=>e[0]&&e[1]);
  const member=louvain(keys,edges),groups=new Map();
  for(const f of rows){const k=predicates.entityKey(f.subject),c=member.get(k);if(c===undefined)continue;if(!groups.has(c))groups.set(c,{facts:[],ents:new Map()});const gr=groups.get(c);gr.facts.push(f.id);for(const e of [k,predicates.entityKey(f.object)])if(member.get(e)===c)gr.ents.set(e,(gr.ents.get(e)||0)+1)}
  return [...groups.values()].map(gr=>{const ents=[...gr.ents].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]));return {id:'t:'+ents[0][0],label:g.names.get(ents[0][0]),entities:ents.slice(0,6).map(e=>g.names.get(e[0])),size:gr.facts.length,factIds:gr.facts}})
   .sort((a,b)=>b.size-a.size||a.label.localeCompare(b.label));
 }finally{db.close()}
}

/* ---------- Почти-дубли ---------- */
// MinHash по триграммам текста факта и LSH-корзины: сравниваются только похожие кандидаты,
// затем точная мера Жаккара. Тот же тип связи и знак обязательны; противоречия и отказы пропускаются.
const HASHES=48,BANDS=16,ROWS=HASHES/BANDS;
function grams(text){const t=' '+text+' ',out=new Set();for(let i=0;i+3<=t.length;i++)out.add(t.slice(i,i+3));return out}
function h32(s,seed){let h=2166136261^seed;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}h^=h>>>13;h=Math.imul(h,0x5bd1e995);return (h^h>>>15)>>>0}
function jaccard(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n||1)}
function duplicates({threshold=.6,limit=50}={}){
 const db=open();
 try{
  const rows=activeFacts(db),items=rows.map(f=>{const text=predicates.entityKey(f.subject)+' | '+(f.polarity<0?'не ':'')+(f.relation||predicates.clean(f.predicate))+' | '+predicates.entityKey(f.object);return {f,text,g:grams(text),gs:grams(predicates.entityKey(f.subject)),go:grams(predicates.entityKey(f.object))}});
  const buckets=new Map();
  items.forEach((it,i)=>{const sig=[];for(let k=0;k<HASHES;k++){let m=4294967295;for(const x of it.g){const v=h32(x,k*2654435761);if(v<m)m=v}sig.push(m)}
   for(let b=0;b<BANDS;b++){const key=b+':'+sig.slice(b*ROWS,b*ROWS+ROWS).join(',');if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i)}});
  const skip=new Set(db.prepare('SELECT a,b FROM memory_not_duplicates').all().map(r=>r.a+'|'+r.b));
  for(const c of db.prepare('SELECT earlier_id,newer_id FROM memory_conflicts').all()){skip.add(c.earlier_id+'|'+c.newer_id);skip.add(c.newer_id+'|'+c.earlier_id)}
  const seen=new Set(),out=[];
  for(const list of buckets.values())for(let x=0;x<list.length;x++)for(let y=x+1;y<list.length;y++){
   const A=items[list[x]],B=items[list[y]],key=A.f.id<B.f.id?A.f.id+'|'+B.f.id:B.f.id+'|'+A.f.id;
   if(seen.has(key))continue;seen.add(key);
   if(skip.has(key)||A.f.relation!==B.f.relation||A.f.polarity!==B.f.polarity)continue;
   // Похожи и субъект, и объект: «Пермь находится в России» и «Сочи находится в России» — не дубли.
   const score=jaccard(A.g,B.g);if(score<threshold||jaccard(A.gs,B.gs)<.5||jaccard(A.go,B.go)<.5)continue;
   // Оставить советуем более уверенный, при равенстве — более ранний (у него обычно больше истории).
   const [keep,drop]=(B.f.confidence>A.f.confidence||(B.f.confidence===A.f.confidence&&B.f.observed_at<A.f.observed_at))?[B.f,A.f]:[A.f,B.f];
   out.push({score:Math.round(score*100)/100,keep:plain(keep),drop:plain(drop)});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,limit);
 }finally{db.close()}
}
// Слить: лишний факт уходит в историю (valid_to), как при разборе противоречия.
function mergeDuplicate(keep,drop){
 const k=normalize(keep,'keep',100),d=normalize(drop,'drop',100);if(k===d)throw new TypeError('Same fact');
 const db=open();
 try{
  db.exec('BEGIN IMMEDIATE');
  try{
   const a=db.prepare('SELECT id FROM memory_facts WHERE id=? AND valid_to IS NULL').get(k),b=db.prepare('SELECT id FROM memory_facts WHERE id=? AND valid_to IS NULL').get(d);
   if(!a||!b){db.exec('COMMIT');return null}
   db.prepare('UPDATE memory_facts SET valid_to=? WHERE id=?').run(new Date().toISOString(),d);
   db.prepare('INSERT INTO memory_events(fact_id,action) VALUES(?,?)').run(d,'merged');
   db.prepare('DELETE FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').run(d,d);
   db.exec('COMMIT');return {keep:k,retired:d};
  }catch(e){db.exec('ROLLBACK');throw e}
 }finally{db.close()}
}
function dismissDuplicate(a,b){
 const x=normalize(a,'a',100),y=normalize(b,'b',100),db=open();
 try{db.prepare('INSERT OR IGNORE INTO memory_not_duplicates(a,b) VALUES(?,?)').run(x<y?x:y,x<y?y:x);return {ok:true}}finally{db.close()}
}

/* ---------- Обзор памяти ---------- */
// Одна сводка: о ком и о чём память, самые связанные узлы, что менялось за неделю, что ждёт разбора.
function overview(){
 const db=open();
 try{
  const rows=activeFacts(db),g=buildGraph(rows);
  const hubs=[...g.adj].map(([k,l])=>({name:g.names.get(k),degree:l.length})).sort((a,b)=>b.degree-a.degree||a.name.localeCompare(b.name)).slice(0,6);
  const rel=new Map();for(const f of rows){const r=(f.polarity<0?'не ':'')+(f.relation||f.predicate);rel.set(r,(rel.get(r)||0)+1)}
  const week=new Date(Date.now()-7*864e5).toISOString().slice(0,19).replace('T',' ');
  const changes={};for(const r of db.prepare('SELECT action,COUNT(*) AS n FROM memory_events WHERE occurred_at>=? GROUP BY action').all(week))changes[r.action]=r.n;
  const recent=db.prepare('SELECT id,subject,predicate,object,observed_at FROM memory_facts WHERE valid_to IS NULL ORDER BY observed_at DESC LIMIT 5').all().map(r=>({...r}));
  const conflictsN=db.prepare('SELECT COUNT(*) AS n FROM memory_conflicts').get().n;
  db.close();
  let topics=[],dups=0;try{topics=communities().slice(0,6).map(t=>({label:t.label,size:t.size,entities:t.entities}))}catch{}try{dups=duplicates({limit:100}).length}catch{}
  return {facts:rows.length,entities:g.adj.size,hubs,relations:[...rel].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([relation,count])=>({relation,count})),topics,week:changes,recent,conflicts:conflictsN,duplicates:dups};
 }finally{if(db.isOpen)db.close()}
}

/* ---------- Что затронет изменение факта ---------- */
// Соседи по графу (те же сущности, на 1–2 шага), противоречия, заметка-источник, ответы аватара,
// где факт был вспомнен, и заметки/дела, где упоминаются его субъект или объект.
function impact(id){
 const fid=normalize(id,'id',100),db=open();
 try{
  const f=db.prepare('SELECT * FROM memory_facts WHERE id=?').get(fid);if(!f)return null;
  const rows=activeFacts(db),g=buildGraph(rows),ents=[predicates.entityKey(f.subject),predicates.entityKey(f.object)].filter(Boolean);
  const facts=[],used=new Set([fid]);let frontier=[...new Set(ents)];const seen=new Set(frontier);
  for(let hop=1;hop<=2&&frontier.length;hop++){const next=[];for(const k of frontier)for(const e of g.adj.get(k)||[]){if(used.has(e.fact.id))continue;used.add(e.fact.id);if(facts.length<40)facts.push({...plain(e.fact),hop});if(!seen.has(e.to)){seen.add(e.to);next.push(e.to)}}frontier=next}
  const conflictsList=db.prepare('SELECT id,earlier_id,newer_id FROM memory_conflicts WHERE earlier_id=? OR newer_id=?').all(fid,fid).map(r=>({...r}));
  let episodes=0;try{episodes=db.prepare("SELECT COUNT(*) AS n FROM memory_experience WHERE recalled LIKE ?").get('%"'+fid+'"%').n}catch{}
  const mention=[f.subject,f.object].map(x=>ftsQuery(x)).filter(Boolean);
  const records=new Map();
  for(const q of mention)for(const r of db.prepare("SELECT kind,ref,title FROM memory_search WHERE memory_search MATCH ? AND kind IN ('note','task') LIMIT 20").all(q.split(' OR ').join(' AND ')))records.set(r.kind+':'+r.ref,{kind:r.kind,id:r.ref,title:r.title});
  if(String(f.source_id).startsWith('note:')){const nid=f.source_id.slice(5);if(!records.has('note:'+nid))records.set('note:'+nid,{kind:'note',id:nid,title:null,source:true});else records.get('note:'+nid).source=true}
  const list=[...records.values()];
  return {fact:plain(f),active:!f.valid_to,facts,hop1:facts.filter(x=>x.hop===1).length,conflicts:conflictsList,episodes,notes:list.filter(r=>r.kind==='note'),tasks:list.filter(r=>r.kind==='task')};
 }finally{if(db.isOpen)db.close()}
}
function diagnostics(){
 const db=open();
 try{
  return {integrity:db.prepare('PRAGMA quick_check').get().quick_check,
   facts:db.prepare('SELECT COUNT(*) AS n FROM memory_facts').get().n,
   conflicts:db.prepare('SELECT COUNT(*) AS n FROM memory_conflicts').get().n,
   events:db.prepare('SELECT COUNT(*) AS n FROM memory_events').get().n,
   pendingVectors:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_queue'").get()?db.prepare('SELECT COUNT(*) AS n FROM vector_queue').get().n:0};
 }finally{db.close()}
}
module.exports={addFact,extractFacts,queryFacts,searchFacts,searchIndex,syncRecords,ftsQuery,terms,factsById,relations,neighborhood,findPath,communities,duplicates,mergeDuplicate,dismissDuplicate,overview,impact,conflicts,resolveConflict,supersede,retireFact,diagnostics};
if(require.main===module){
 try{
  const command=process.argv[2];
  if(command==='diagnostics')console.log(JSON.stringify(diagnostics(),null,2));
  else if(command==='facts')console.log(JSON.stringify(queryFacts({subject:process.argv[3]}),null,2));
  else if(command==='search')console.log(JSON.stringify(searchFacts(process.argv.slice(3).join(' ')),null,2));
  else if(command==='relations')console.log(JSON.stringify(relations(process.argv.slice(3).join(' ')),null,2));
  else if(command==='conflicts')console.log(JSON.stringify(conflicts(),null,2));
  else if(command==='ingest'){const [source,filename]=process.argv.slice(3);if(!source||!filename)throw Error('Usage: ingest source file');console.log(JSON.stringify(extractFacts(fs.readFileSync(filename,'utf8'),source),null,2))}
  else throw Error('Usage: node memory-core.js diagnostics|facts [subject]');
 }catch(e){console.error(e.message);process.exitCode=1}
}
