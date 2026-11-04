'use strict';
// Полезность записей. Оценка ответа (👍/👎, «верно» или поправка словами) раздаётся фактам и заметкам,
// которые аватар вспомнил для этого ответа. Поиск поднимает то, что помогало, и опускает то,
// из-за чего ответ поправляли. Здесь же сервер считает, сколько раз запись вспоминалась
// (сила памяти в «Мозге» больше не живёт только в браузере).
const {use,tx}=require('./brain-db');
const KINDS={facts:'fact',notes:'note'};
function each(recalled,fn){for(const [k,kind] of Object.entries(KINDS))for(const ref of (recalled?.[k]||[]).slice(0,40))if(typeof ref==='string'&&ref&&ref.length<=100)fn(kind,ref)}
const UPSERT='INSERT INTO memory_usefulness(kind,ref,used,ok,fix,last_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,ref) DO UPDATE SET used=max(0,used+excluded.used),ok=max(0,ok+excluded.ok),fix=max(0,fix+excluded.fix),last_at=COALESCE(excluded.last_at,last_at)';
// Запись вспомнена для ответа.
function used(recalled){
 const now=new Date().toISOString();
 use(db=>{const st=db.prepare(UPSERT);tx(db,()=>each(recalled,(k,r)=>st.run(k,r,1,0,0,now)))});
}
// Оценка эпизода: ok/fix со знаком (+1 — поставить, −1 — снять прежнюю оценку при смене мнения).
function rate(recalled,{ok=0,fix=0}){
 if(!ok&&!fix)return;
 use(db=>{const st=db.prepare(UPSERT);tx(db,()=>each(recalled,(k,r)=>st.run(k,r,0,ok,fix,null)))});
}
// Польза от 0 до 1 (сглажено: без оценок — 0,5).
const value=r=>r?(r.ok+1)/(r.ok+r.fix+2):.5;
function get(kind,ids){
 const list=[...new Set((ids||[]).filter(x=>typeof x==='string'&&x))].slice(0,500);if(!list.length)return new Map();
 return use(db=>new Map(db.prepare('SELECT * FROM memory_usefulness WHERE kind=? AND ref IN ('+list.map(()=>'?').join(',')+')').all(kind,...list).map(r=>[r.ref,{used:r.used,ok:r.ok,fix:r.fix,value:value(r),at:r.last_at}])));
}
// Множитель для поиска: 0,75 (только поправляли) … 1,25 (только подтверждали); без оценок — 1.
function factor(r){if(!r||!(r.ok+r.fix))return 1;return .75+.5*value(r)}
// Для «Мозга»: f:/n: id → сколько вспоминали, когда последний раз, оценки.
function strength(limit=5000){
 return use(db=>Object.fromEntries(db.prepare('SELECT * FROM memory_usefulness ORDER BY last_at DESC LIMIT ?').all(limit).map(r=>[(r.kind==='fact'?'f:':'n:')+r.ref,{n:r.used,t:r.last_at?Date.parse(r.last_at):0,ok:r.ok,fix:r.fix}])));
}
module.exports={used,rate,get,factor,value,strength};
