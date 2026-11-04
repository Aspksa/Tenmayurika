'use strict';
// Инициатива: Юрика сама смотрит на дела и даты и предлагает помочь, не дожидаясь вопроса.
//  • prepare  — завтра важное дело или дело со временем: напомнить заранее?
//  • overdue  — дело просрочено: перенести на завтра?
//  • birthday — через неделю или раньше день рождения у кого-то из памяти: добавить дело «поздравить»?
// Каждое предложение делается один раз (kind + ref уникальны). Аватар показывает новое облачком,
// в чате оно приходит с кнопками «Да» и «Не надо»; «Да» выполняет действие (перенос, новое дело).
// Если предложение недавно показано, модель знает о нём и может помочь, когда человек ответит словами.
const crypto=require('node:crypto');
const memory=require('./memory-core');
const planner=require('./planner');
const thoughts=require('./thoughts');
const {use}=require('./brain-db');
const MONTHS=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const DAY=864e5;
function dayStart(d){const x=new Date(d);x.setHours(0,0,0,0);return x}
// «12 марта», «12.03», «1990-03-12», «12 марта 1990» → {m,d}.
function monthDay(text){
 const t=String(text||'').toLocaleLowerCase().replace(/ё/g,'е');let m;
 if((m=t.match(/(\d{4})-(\d{2})-(\d{2})/)))return {m:+m[2],d:+m[3]};
 if((m=t.match(/(\d{1,2})[./](\d{1,2})/)))return {m:+m[2],d:+m[1]};
 if((m=t.match(/(\d{1,2})\s+([а-я]+)/))){const i=MONTHS.findIndex(k=>m[2].startsWith(k)&&(k!=='ма'||/^ма[яй]$/.test(m[2])));if(i>=0)return {m:i+1,d:+m[1]}}
 return null;
}
function daysUntil(md,now=new Date()){
 const t0=dayStart(now);let next=new Date(t0.getFullYear(),md.m-1,md.d);if(next<t0)next=new Date(t0.getFullYear()+1,md.m-1,md.d);
 return {days:Math.round((next-t0)/DAY),date:next};
}
const plural=(n,a,b,c)=>{const x=n%10,h=n%100;return x===1&&h!==11?a:x>=2&&x<=4&&(h<12||h>14)?b:c};
function add(kind,ref,text,data={}){
 const id=crypto.randomUUID();
 const ok=use(db=>db.prepare('INSERT OR IGNORE INTO brain_suggestions(id,kind,ref,text,status,created_at) VALUES(?,?,?,?,?,?)').run(id,kind,ref+'|'+JSON.stringify(data),text,'new',new Date().toISOString()).changes>0);
 if(ok)thoughts.add('offer','Хочу предложить: '+text,{id,kind});
 return ok?id:null;
}
function scan(ws,now=new Date()){
 const made=[],today=planner.ymd(now),tomorrow=planner.ymd(new Date(dayStart(now).getTime()+DAY));
 for(const t of (ws.tasks||[]).filter(t=>!t.done&&t.due)){
  if(t.due===tomorrow&&(t.priority==='high'||t.time)){const id=add('prepare','task:'+t.id+':'+t.due,'Завтра '+(t.time?'в '+t.time+' ':'')+'«'+t.title+'». Напомнить заранее, утром?',{task:t.id});if(id)made.push(id)}
  else if(t.due<today){const late=Math.round((dayStart(now)-dayStart(t.due+'T00:00:00'))/DAY);if(late>=1){const id=add('overdue','task:'+t.id+':'+t.due,'«'+t.title+'» просрочено на '+late+' '+plural(late,'день','дня','дней')+'. Перенести на завтра?',{task:t.id});if(id)made.push(id)}}
 }
 let facts=[];try{facts=memory.queryFacts({limit:2000}).filter(f=>!f.valid_to&&f.relation==='день рождения')}catch{}
 for(const f of facts){const md=monthDay(f.object);if(!md)continue;const u=daysUntil(md,now);if(u.days>7)continue;
  const who=String(f.subject).trim().toLocaleLowerCase()==='я'?'у тебя':'у '+f.subject;
  const when=u.days===0?'Сегодня':u.days===1?'Завтра':'Через '+u.days+' '+plural(u.days,'день','дня','дней');
  const id=add('birthday','fact:'+f.id+':'+u.date.getFullYear(),when+' день рождения '+who+' ('+u.date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})+').'+(who==='у тебя'?' Поздравляю заранее!':' Добавить дело «поздравить»?'),{fact:f.id,due:planner.ymd(u.date),who:f.subject,self:who==='у тебя'});if(id)made.push(id)}
 return made;
}
const row=r=>{const i=r.ref.indexOf('|');let data={};try{data=JSON.parse(r.ref.slice(i+1))}catch{}return {id:r.id,kind:r.kind,text:r.text,status:r.status,created_at:r.created_at,shown_at:r.shown_at,data}};
function list(status=null,limit=20){return use(db=>status?db.prepare('SELECT * FROM brain_suggestions WHERE status=? ORDER BY created_at DESC LIMIT ?').all(status,limit):db.prepare('SELECT * FROM brain_suggestions ORDER BY created_at DESC LIMIT ?').all(limit)).map(row)}
function get(id){const r=use(db=>db.prepare('SELECT * FROM brain_suggestions WHERE id=?').get(String(id||'')));return r?row(r):null}
// Новые (за последние 3 дня), которые ещё не показывали.
function fresh(limit=3){const since=new Date(Date.now()-3*DAY).toISOString();return list('new',20).filter(s=>s.created_at>=since).slice(0,limit)}
function mark(id,status){const col=status==='shown'?'shown_at':'done_at';return use(db=>db.prepare('UPDATE brain_suggestions SET status=?,'+col+'=? WHERE id=?').run(status,new Date().toISOString(),String(id||'')).changes>0)}
function shown(id){const s=get(id);if(!s||s.status!=='new')return false;return mark(id,'shown')}
function dismiss(id){const s=get(id);if(!s||['accepted','dismissed'].includes(s.status))return null;mark(id,'dismissed');thoughts.add('offer','Не стала настаивать: '+s.text,{id});return {ok:true,text:'Хорошо, не буду.'}}
// «Да»: выполняет действие предложения (ctx — те же функции, что у инструментов чата).
async function accept(id,ctx){
 const s=get(id);if(!s||['accepted','dismissed'].includes(s.status))return null;
 let text='Хорошо.';
 if(s.kind==='overdue'&&s.data.task&&ctx?.updateTask){const due=planner.ymd(new Date(dayStart(new Date()).getTime()+DAY));await ctx.updateTask(s.data.task,{due});text='Перенесла на завтра.'}
 else if(s.kind==='birthday'&&!s.data.self&&ctx?.addItem){await ctx.addItem('tasks','Поздравить: '+s.data.who,'',{category:'personal',due:s.data.due,priority:'high'});text='Добавила дело «Поздравить: '+s.data.who+'» на '+s.data.due+'.'}
 else if(s.kind==='prepare')text='Напомню: утром дело будет в моей сводке на день.';
 mark(id,'accepted');thoughts.add('offer','Вы согласились: '+s.text+' → '+text,{id});
 return {ok:true,text,changed:s.kind!=='prepare'};
}
// Для подсказки модели: недавно показанное (человек может ответить на него словами) и одно новое.
function promptText({offer=true}={}){
 const hour=new Date(Date.now()-3600e3).toISOString();
 const recent=list('shown',5).filter(s=>s.shown_at>=hour)[0];
 let t='';
 if(recent)t+='\nТы недавно сама предложила: «'+recent.text+'». Если человек отвечает на это — помоги (например, инструментами дел).';
 const next=offer?fresh(1)[0]:null;
 if(next){shown(next.id);t+='\nПо своей инициативе: если к месту, в конце ответа можешь коротко предложить: «'+next.text+'».'}
 return t;
}
function stats(){return use(db=>db.prepare('SELECT status,COUNT(*) AS n FROM brain_suggestions GROUP BY status').all()).reduce((o,r)=>(o[r.status]=r.n,o),{new:0,shown:0,accepted:0,dismissed:0})}
module.exports={scan,list,get,fresh,shown,dismiss,accept,promptText,stats,monthDay,daysUntil};
