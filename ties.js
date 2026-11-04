'use strict';
// Связи роста: кто кого чему научил. Агент → опыт Мозга, поправка → урок агента, мечта души → вопрос
// любопытства или тема самоэкзамена, мечта → новый помощник, Учитель → исправленный промах памяти.
// «Мозг» → «Дневник» → «связи» показывает эти цепочки. Хранится последнее KEEP записей в brain_state.
const crypto=require('node:crypto');
const {state,setState}=require('./brain-db');
const KEY='ties',KEEP=200;
const KINDS={agent:'агент',episode:'опыт Мозга',lesson:'урок',goal:'мечта',question:'вопрос',exam:'экзамен',miss:'промах',rule:'правило',owner:'хозяин'};
const short=(t,n)=>String(t||'').replace(/\s+/g,' ').trim().slice(0,n);
const end=x=>({kind:KINDS[x?.kind]?x.kind:'agent',...(x?.id?{id:String(x.id).slice(0,80)}:{}),label:short(x?.label,140)});
function list(limit=KEEP){const l=state(KEY,[]);return (Array.isArray(l)?l:[]).slice(0,Math.max(1,Math.min(KEEP,limit)))}
function add({from,to,why=''}={}){
 if(!from||!to)return null;
 const a=end(from),b=end(to),l=list();
 // Одно и то же звено подряд не дублируется — только время обновляется.
 const same=l.slice(0,30).find(x=>x.from.kind===a.kind&&x.from.label===a.label&&x.to.kind===b.kind&&x.to.label===b.label);
 if(same){same.at=new Date().toISOString();same.n=(same.n||1)+1;setState(KEY,l);return same}
 const item={id:crypto.randomUUID().slice(0,10),at:new Date().toISOString(),from:a,to:b,why:short(why,80),n:1};
 setState(KEY,[item,...l].slice(0,KEEP));return item;
}
// Сводка: сколько раз какой вид учил какой (агент → урок: 3).
function summary(){const out={};for(const t of list()){const k=t.from.kind+'>'+t.to.kind;out[k]=(out[k]||0)+(t.n||1)}
 return Object.entries(out).map(([k,n])=>{const [a,b]=k.split('>');return {from:a,to:b,label:KINDS[a]+' → '+KINDS[b],n}}).sort((x,y)=>y.n-x.n)}
function view(limit=60){return {items:list(limit),summary:summary(),kinds:KINDS}}
module.exports={add,list,summary,view,KINDS};
