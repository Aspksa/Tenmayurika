'use strict';
// Псевдонимы сущностей: «мама» и «Ольга Петровна» — один узел графа. Ключи — как в predicates.entityKey.
// Граф (memory-core) сводит псевдоним к основному имени, поэтому поиск окрестностей, путей и зоны
// видят одну сущность, как бы её ни называли. Связь можно снять — тогда она больше не появится сама.
const {use}=require('./brain-db');
const predicates=require('./predicates');
function map(){
 try{return use(db=>{const m=new Map(),names=new Map();for(const r of db.prepare('SELECT alias,canonical,canonical_name FROM memory_aliases').all()){m.set(r.alias,r.canonical);names.set(r.canonical,r.canonical_name)}return {to:m,names}})}
 catch{return {to:new Map(),names:new Map()}}
}
// Цепочка «а → б → в» сводится к последнему имени; петли не бывает (add её не пропустит), но на всякий случай — не больше 5 шагов.
function canon(m,key){let k=key,n=0;while(m.to.has(k)&&n++<5)k=m.to.get(k);return k}
function add(aliasName,canonicalName,{evidence='',source='rules'}={}){
 const alias=predicates.entityKey(aliasName),canonical=predicates.entityKey(canonicalName);
 if(!alias||!canonical||alias===canonical||alias.length>300||canonical.length>300)throw new TypeError('Invalid alias');
 return use(db=>{
  if(source!=='user'&&db.prepare('SELECT 1 FROM memory_alias_rejects WHERE alias=? AND canonical=?').get(alias,canonical))return null;
  // Основное имя само не может быть чьим-то псевдонимом в обратную сторону — иначе петля.
  const m={to:new Map(db.prepare('SELECT alias,canonical FROM memory_aliases').all().map(r=>[r.alias,r.canonical]))};
  if(canon(m,canonical)===alias)return null;
  const old=db.prepare('SELECT canonical FROM memory_aliases WHERE alias=?').get(alias);
  if(old&&old.canonical===canonical)return null;
  if(old&&source!=='user')return null;
  db.prepare('INSERT INTO memory_aliases(alias,canonical,canonical_name,alias_name,evidence,source,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(alias) DO UPDATE SET canonical=excluded.canonical,canonical_name=excluded.canonical_name,evidence=excluded.evidence,source=excluded.source')
   .run(alias,canonical,String(canonicalName).trim(),String(aliasName).trim(),String(evidence).slice(0,300),source,new Date().toISOString());
  if(source==='user')db.prepare('DELETE FROM memory_alias_rejects WHERE alias=? AND canonical=?').run(alias,canonical);
  return {alias:String(aliasName).trim(),canonical:String(canonicalName).trim()};
 });
}
// Снять псевдоним: пользователь сказал, что это разные. Правила больше его не предложат.
function remove(aliasName){
 const alias=predicates.entityKey(aliasName);if(!alias)throw new TypeError('Invalid alias');
 return use(db=>{const r=db.prepare('SELECT canonical FROM memory_aliases WHERE alias=?').get(alias);if(!r)return false;
  db.prepare('DELETE FROM memory_aliases WHERE alias=?').run(alias);db.prepare('INSERT OR IGNORE INTO memory_alias_rejects(alias,canonical) VALUES(?,?)').run(alias,r.canonical);return true});
}
function list(){return use(db=>db.prepare('SELECT alias_name,canonical_name,evidence,source,created_at FROM memory_aliases ORDER BY created_at DESC').all()).map(r=>({alias:r.alias_name,canonical:r.canonical_name,evidence:r.evidence,source:r.source,created_at:r.created_at}))}
// Все имена одной сущности (для карточки).
function namesOf(key){return use(db=>db.prepare('SELECT alias_name FROM memory_aliases WHERE canonical=?').all(key).map(r=>r.alias_name))}
module.exports={map,canon,add,remove,list,namesOf};
