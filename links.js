'use strict';
// Причинные связи между записями: не «похоже», а «причина», «условие», «сначала — потом».
// Связь a → b: a — причина b, a — условие b, или a идёт раньше b.
// Находятся фоном (reflect.js): с моделью — её силами, без неё — по словам-связкам в тексте
// заметок и дел («потому что», «из-за», «если …, то», «после того как», «сначала … потом», «перед»).
const memory=require('./memory-core');
const {use,tx}=require('./brain-db');
const TYPES=['причина','условие','потом'];
const KINDS=['fact','note','task'];
function add(a,type,b,{evidence='',source='rules'}={}){
 if(!TYPES.includes(type))throw new TypeError('Invalid link type');
 for(const x of [a,b])if(!x||!KINDS.includes(x.kind)||typeof x.ref!=='string'||!x.ref||x.ref.length>100)throw new TypeError('Invalid link end');
 if(a.kind===b.kind&&a.ref===b.ref)return null;
 return use(db=>db.prepare('INSERT OR IGNORE INTO memory_links(a_kind,a_ref,type,b_kind,b_ref,evidence,source,created_at) VALUES(?,?,?,?,?,?,?,?)').run(a.kind,a.ref,type,b.kind,b.ref,String(evidence).slice(0,300),source,new Date().toISOString()).changes>0);
}
// Связи записи в обе стороны. dir: 'out' — запись причина/условие/раньше; 'in' — наоборот.
function of(kind,ref,limit=20){
 return use(db=>[...db.prepare('SELECT b_kind AS kind,b_ref AS ref,type,evidence FROM memory_links WHERE a_kind=? AND a_ref=? LIMIT ?').all(kind,ref,limit).map(r=>({...r,dir:'out'})),
  ...db.prepare('SELECT a_kind AS kind,a_ref AS ref,type,evidence FROM memory_links WHERE b_kind=? AND b_ref=? LIMIT ?').all(kind,ref,limit).map(r=>({...r,dir:'in'}))].slice(0,limit));
}
function list(limit=200){return use(db=>db.prepare('SELECT * FROM memory_links ORDER BY created_at DESC LIMIT ?').all(limit).map(r=>({...r})))}
function count(){return use(db=>db.prepare('SELECT COUNT(*) AS n FROM memory_links').get().n)}
// Записи, которых больше нет, уносят свои связи.
function prune(alive){
 return use(db=>tx(db,()=>{let n=0;const del=db.prepare('DELETE FROM memory_links WHERE id=?');
  for(const r of db.prepare('SELECT id,a_kind,a_ref,b_kind,b_ref FROM memory_links').all())if(!alive(r.a_kind,r.a_ref)||!alive(r.b_kind,r.b_ref)){del.run(r.id);n++}
  return n}));
}

/* ---------- Поиск связей по словам-связкам ---------- */
// [шаблон, тип, какая часть — другая запись, направление]: 'from' — другая запись → эта, 'to' — эта → другая.
const MARKERS=[
 [/(?:потому\s+что|так\s+как|поскольку|ведь|из-за\s+того,?\s+что)\s+([^.!?;\n]{3,80})/iu,'причина','from'],
 [/из-за\s+([^.!?;,\n]{3,60})/iu,'причина','from'],
 [/(?:^|[\s,])если\s+([^,.!?;\n]{3,80}),?\s+(?:то\s+)?/iu,'условие','from'],
 [/(?:при\s+условии,?\s+что|только\s+когда)\s+([^.!?;\n]{3,80})/iu,'условие','from'],
 [/(?:после\s+того,?\s+как|после)\s+([^,.!?;\n]{3,60})/iu,'потом','from'],
 [/сначала\s+([^,.!?;\n]{3,60}),?\s+(?:а\s+)?(?:потом|затем)/iu,'потом','from'],
 [/(?:перед\s+тем,?\s+как|перед|до\s+того,?\s+как)\s+([^,.!?;\n]{3,60})/iu,'потом','to'],
 [/(?:поэтому|из-за\s+этого|в\s+итоге|чтобы)\s+([^.!?;\n]{3,80})/iu,'причина','to'],
];
function stemsOf(text){return memory.terms(text)}
// Другая запись, о которой говорит фраза: большинство её основ слов есть в названии записи.
function match(phrase,self,index){
 const want=stemsOf(phrase).slice(0,5);if(!want.length)return null;
 const hits=memory.searchIndex(phrase,{kinds:['note','task','fact'],limit:8});
 let best=null,bs=0;
 for(const h of hits){
  if(h.kind===self.kind&&h.ref===self.ref)continue;
  const title=index.get(h.kind+':'+h.ref)||h.title||'',have=stemsOf(title);if(!have.length)continue;
  const n=want.filter(w=>have.some(x=>x.startsWith(w)||w.startsWith(x))).length,share=n/Math.min(want.length,have.length);
  if(n>=1&&share>=.6&&share>bs){bs=share;best={kind:h.kind,ref:h.ref}}
 }
 return best;
}
// records: [{kind:'note'|'task', ref, title, text}]; facts — заголовок «субъект объект».
function detect(records,{facts=[]}={}){
 const index=new Map();for(const r of records)index.set(r.kind+':'+r.ref,r.title);for(const f of facts)index.set('fact:'+f.id,f.subject+' '+f.object);
 const found=[];
 for(const r of records){
  const text=String(r.title||'')+'. '+String(r.text||'').slice(0,4000);
  for(const [re,type,dir] of MARKERS){
   const m=text.match(re);if(!m)continue;
   const other=match(m[1],r,index);if(!other)continue;
   const self={kind:r.kind,ref:r.ref};
   found.push(dir==='from'?{a:other,type,b:self,evidence:m[0].trim()}:{a:self,type,b:other,evidence:m[0].trim()});
  }
 }
 return found;
}
// Ответ модели: «LINK: 3 | причина | 5».
function parseModel(text,items){
 const out=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const m=line.trim().match(/^LINK:\s*(\d+)\s*\|\s*(причина|условие|потом)\s*\|\s*(\d+)/i);if(!m)continue;
  const a=items[Number(m[1])-1],b=items[Number(m[3])-1];if(!a||!b||a===b)continue;
  out.push({a:{kind:a.kind,ref:a.ref},type:m[2].toLocaleLowerCase(),b:{kind:b.kind,ref:b.ref},evidence:'модель'});
 }
 return out.slice(0,12);
}
module.exports={TYPES,add,of,list,count,prune,detect,parseModel};
