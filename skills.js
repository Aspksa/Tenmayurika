'use strict';
// Навыки из опыта. Когда несколько подтверждённых ответов похожи (похожие вопросы, те же инструменты,
// те же найденные записи), из них складывается правило «на такой вопрос делай так».
// На новый похожий вопрос модель получает правило заранее. Если по навыку отвечали, а пользователь
// поправлял чаще, чем подтверждал, навык уходит на покой. Навыки выводятся фоном (reflect.js).
const crypto=require('node:crypto');
const experience=require('./experience');
const memory=require('./memory-core');
const {use,tx,parse}=require('./brain-db');
const MIN_SUPPORT=2,SIM=.34;
function jaccard(a,b){const A=new Set(a),B=new Set(b);let n=0;for(const x of A)if(B.has(x))n++;return n/((A.size+B.size-n)||1)}
const toolName={add_note:'создать заметку',add_task:'добавить дело',complete_task:'отметить дело',list_tasks:'показать дела',agenda:'повестка',move_task:'перенести дело',days_until:'сколько дней до',remember_fact:'запомнить факт',search_memory:'поиск в памяти',fact_relations:'связи',fact_path:'путь между сущностями',memory_overview:'обзор памяти',day_summary:'итоги дня',set_reminder:'напоминание',calculate:'калькулятор',convert_units:'конвертер',list_notes:'список заметок',open_page:'открыть раздел'};
// Группы похожих подтверждённых эпизодов.
function clusters(episodes){
 const groups=[];
 for(const e of episodes){
  const st=(e.stems||experience.stems(e.question));if(!st.length)continue;
  const tools=[...new Set(e.tools)].sort().join(',');
  let g=groups.find(g=>g.tools===tools&&jaccard(g.stems,st)>=SIM);
  if(!g){g={tools,stems:[...st],items:[]};groups.push(g)}
  g.items.push(e);g.stems=[...new Set([...g.stems,...st])];
 }
 return groups.filter(g=>g.items.length>=MIN_SUPPORT);
}
// Основы слов, общие хотя бы для двух вопросов группы.
function common(items){const c=new Map();for(const e of items)for(const s of new Set(experience.stems(e.question)))c.set(s,(c.get(s)||0)+1);return [...c].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,5).map(([s])=>s)}
function ruleByTemplate(g,stems){
 const ex=g.items.slice(0,2).map(e=>'«'+e.question.slice(0,60)+'»').join(', ');
 const tools=g.tools?g.tools.split(','):[];
 const factIds=new Map();for(const e of g.items)for(const id of e.recalled.facts)factIds.set(id,(factIds.get(id)||0)+1);
 const shared=[...factIds].filter(([,n])=>n>=2).map(([id])=>id);
 const facts=shared.length?memory.factsById(shared).slice(0,2):[];
 const how=tools.length?'сразу используй: '+tools.map(t=>toolName[t]||t).join(', '):facts.length?'отвечай по памяти, опора: '+facts.map(f=>f.subject+' — '+f.predicate+' → '+f.object).join('; '):'отвечай по памяти о «'+stems.join(', ')+'»';
 return 'На вопросы вроде '+ex+' — '+how+'. Пользователь подтверждал такой ответ '+g.items.length+' раз.';
}
// complete — функция модели (llm.complete) или null.
async function induce({complete=null,limit=500}={}){
 const eps=experience.list(limit).filter(e=>e.feedback==='ok'&&e.ok);
 let added=0,updated=0;
 for(const g of clusters(eps)){
  const stems=common(g.items);if(!stems.length)continue;
  const signature=(g.tools||'память')+'|'+[...stems].sort().join(' ');
  let rule=ruleByTemplate(g,stems),source='rules';
  if(complete){try{
   const msg=await complete({messages:[{role:'system',content:'Ты сводишь опыт ассистентки в одно правило. Ответь одной строкой по-русски, начиная с «Когда»: на какие вопросы и что делать. Без вступлений.'},{role:'user',content:'Подтверждённые пользователем ответы:\n'+g.items.slice(0,6).map(experience.describe).join('\n')}]});
   const line=String(msg.content||'').split('\n').map(x=>x.trim()).find(x=>/^когда/i.test(x));if(line&&line.length<=300){rule=line;source='model'}
  }catch(e){console.error('Skill model failed:',e.name)}}
  const examples=JSON.stringify(g.items.slice(0,5).map(e=>e.question.slice(0,120))),tools=JSON.stringify(g.tools?g.tools.split(','):[]),now=new Date().toISOString();
  use(db=>tx(db,()=>{
   const old=db.prepare('SELECT id,status FROM memory_skills WHERE signature=?').get(signature);
   if(old){if(old.status!=='off'){db.prepare('UPDATE memory_skills SET rule=?,examples=?,support=?,source=?,updated_at=? WHERE id=?').run(rule,examples,g.items.length,source,now,old.id);updated++}}
   else{db.prepare('INSERT INTO memory_skills(id,signature,stems,rule,examples,tools,support,source,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),signature,stems.join(' '),rule,examples,tools,g.items.length,source,now);added++}
  }));
 }
 return {added,updated};
}
const view=r=>({id:r.id,rule:r.rule,stems:r.stems.split(' ').filter(Boolean),examples:parse(r.examples,[]),tools:parse(r.tools,[]),support:r.support,ok:r.ok,fix:r.fix,status:r.status,source:r.source,updated_at:r.updated_at});
// Навыки, подходящие к вопросу: большая часть их основ слов есть в вопросе.
function match(question,limit=2){
 const mine=experience.stems(question);if(!mine.length)return [];
 return use(db=>db.prepare("SELECT * FROM memory_skills WHERE status='active'").all()).map(view)
  .map(s=>{const n=s.stems.filter(x=>mine.includes(x)).length;return {s,n,share:n/Math.max(1,s.stems.length)}})
  .filter(x=>x.n>=Math.min(2,x.s.stems.length)&&x.share>=.5).sort((a,b)=>b.share-a.share||b.s.support-a.s.support).slice(0,limit).map(x=>x.s);
}
function list(){return use(db=>db.prepare("SELECT * FROM memory_skills WHERE status<>'off' ORDER BY status,support DESC,updated_at DESC").all()).map(view)}
function remove(id){if(typeof id!=='string'||!id||id.length>100)throw new TypeError('Invalid id');return use(db=>db.prepare("UPDATE memory_skills SET status='off' WHERE id=?").run(id).changes>0)}
// Оценка ответа, в котором применялся навык; смена мнения снимает прежнюю оценку.
function rate(ids,kind,prev){
 if(!ids?.length)return;
 use(db=>tx(db,()=>{for(const id of ids){
  const d={ok:0,fix:0};if(prev&&prev in d)d[prev]--;if(kind in d)d[kind]++;
  db.prepare('UPDATE memory_skills SET ok=max(0,ok+?),fix=max(0,fix+?) WHERE id=?').run(d.ok,d.fix,id);
  // Поправляли чаще, чем подтверждали, — навык на покой; снова подтверждают — возвращается.
  db.prepare("UPDATE memory_skills SET status=CASE WHEN fix>=2 AND fix>ok THEN 'retired' WHEN status='retired' AND ok>=fix THEN 'active' ELSE status END WHERE id=? AND status<>'off'").run(id);
 }}));
}
experience.onFeedback((episode,kind,prev)=>rate(episode.skills,kind,prev));
function promptText(list){return list.length?'Твои навыки из опыта (подтверждены пользователем, следуй им):\n'+list.map(s=>'• '+s.rule).join('\n'):''}
module.exports={induce,match,list,remove,rate,promptText,clusters};
