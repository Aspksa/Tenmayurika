'use strict';
// Размышления в простое. Когда с аватаром давно ничего не делали (по умолчанию 10 минут), «Мозг» сам
// перебирает память, не мешая разговору:
//  • сводки тем — каждая тема (сообщество фактов) сворачивается в одну строку для подсказки модели;
//  • причинные связи — «причина», «условие», «сначала — потом» между заметками, делами и фактами;
//  • навыки — правила из подтверждённых ответов (skills.js);
//  • выводы — не больше одного на тему, где появилось новое;
//  • рост (growth.js, zones.js): глубокая чистка (дубли, псевдонимы, «он/она»), свои типы, карточки
//    сущностей, новые и поделившиеся зоны, отбор (подтверждённое крепнет, поправленное слабеет),
//    угасшие связи уходят;
//  • самоучёба (memskills.js, selfstudy.js): самоэкзамен по недавней переписке, промахи, правка навыков
//    запоминания кругами с пробой, перезапоминание, откат и просьба о подсказке;
//  • сердцевина (core.js) — блоки «Кто я», «Кто ты», «Как мы общаемся» пересматриваются, знакомство отмечается;
//  • дневник — короткая запись о том, что сделано, видна в «Мозге» (окно «Дневник»).
// Повторно — не чаще раза в час и только если в памяти что-то изменилось.
const crypto=require('node:crypto');
const memory=require('./memory-core');
const predicates=require('./predicates');
const skills=require('./skills');
const links=require('./links');
const experience=require('./experience');
const growth=require('./growth');
const zones=require('./zones');
const memskills=require('./memskills');
const selfstudy=require('./selfstudy');
const core=require('./core');
const onboarding=require('./onboarding');
const {use,tx,parse,state,setState}=require('./brain-db');
const IDLE_MS=Number(process.env.TENMAYURIKA_IDLE_MS)||10*60*1000,GAP_MS=60*60*1000;
const MAX_INSIGHTS=3,MIN_TOPIC=3,DIARY_KEEP=200;
let lastActivity=Date.now(),running=null;
function touch(){lastActivity=Date.now()}
const idleMs=()=>Date.now()-lastActivity;
const hash=s=>crypto.createHash('sha1').update(s).digest('hex').slice(0,16);
const line=f=>f.subject+' — '+f.predicate+' → '+f.object;

/* ---------- Сводки тем ---------- */
// Без модели: по субъектам, связи с несколькими значениями через запятую.
function summaryByTemplate(facts){
 const bySubj=new Map();
 for(const f of facts){const k=f.subject;if(!bySubj.has(k))bySubj.set(k,new Map());const rel=bySubj.get(k),p=f.predicate;if(!rel.has(p))rel.set(p,[]);rel.get(p).push(f.object)}
 const parts=[...bySubj].sort((a,b)=>b[1].size-a[1].size).map(([s,rel])=>s+': '+[...rel].map(([p,o])=>p+' '+o.join(', ')).join('; '));
 const text=parts.join('. ');return text.length>400?text.slice(0,397)+'…':text;
}
async function summarize(complete){
 const topics=memory.communities().filter(t=>t.size>=MIN_TOPIC).slice(0,40);
 const have=use(db=>new Map(db.prepare('SELECT topic,signature FROM memory_topic_summaries').all().map(r=>[r.topic,r.signature])));
 let changed=0;const keep=new Set();
 for(const t of topics){
  keep.add(t.id);const sig=hash([...t.factIds].sort().join(','));if(have.get(t.id)===sig)continue;
  const facts=memory.factsById(t.factIds.slice(0,50));if(!facts.length)continue;
  let summary=summaryByTemplate(facts),source='rules';
  if(complete){try{
   const msg=await complete({messages:[{role:'system',content:'Сверни факты в одну-две короткие фразы по-русски, ничего не добавляя от себя. Только сводка, без вступлений.'},{role:'user',content:facts.map(line).join('\n')}]});
   const s=String(msg.content||'').trim().replace(/\s+/g,' ');if(s&&s.length<=500){summary=s;source='model'}
  }catch(e){console.error('Summary model failed:',e.name)}}
  use(db=>db.prepare('INSERT INTO memory_topic_summaries(topic,label,signature,summary,fact_ids,source,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(topic) DO UPDATE SET label=excluded.label,signature=excluded.signature,summary=excluded.summary,fact_ids=excluded.fact_ids,source=excluded.source,updated_at=excluded.updated_at')
   .run(t.id,t.label,sig,summary,JSON.stringify(t.factIds),source,new Date().toISOString()));
  changed++;
 }
 // Темы, которых больше нет, уходят.
 use(db=>{for(const k of have.keys())if(!keep.has(k))db.prepare('DELETE FROM memory_topic_summaries WHERE topic=?').run(k)});
 return changed;
}
function summaries(){return use(db=>db.prepare('SELECT * FROM memory_topic_summaries ORDER BY updated_at DESC').all()).map(r=>({topic:r.topic,label:r.label,summary:r.summary,factIds:parse(r.fact_ids,[]),source:r.source,updated_at:r.updated_at}))}
// Сводки тем, к которым относятся вспомненные факты (для подсказки модели).
function summariesFor(factIds,limit=3){
 const ids=new Set(factIds||[]);if(!ids.size)return [];
 return summaries().map(s=>({s,n:s.factIds.filter(id=>ids.has(id)).length})).filter(x=>x.n>0&&x.s.factIds.length>x.n).sort((a,b)=>b.n-a.n).slice(0,limit).map(x=>x.s);
}

/* ---------- Причинные связи ---------- */
async function findLinks(ws,complete){
 memory.syncRecords('note',ws.notes||[]);memory.syncRecords('task',ws.tasks||[]);
 const records=[...(ws.notes||[]).map(n=>({kind:'note',ref:n.id,title:n.title,text:n.content,at:n.updatedAt||n.createdAt})),...(ws.tasks||[]).map(t=>({kind:'task',ref:t.id,title:t.title,text:t.content||'',at:t.updatedAt||t.createdAt}))];
 const facts=memory.queryFacts({limit:5000}).filter(f=>!f.valid_to);
 let found=links.detect(records,{facts});
 links.reconcile(found);
 if(complete&&records.length>=2){try{
  const recent=[...records].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,12);
  const msg=await complete({messages:[{role:'system',content:'Найди причинные связи между записями пользователя. Отвечай только строками «LINK: A | причина | B» (A — причина B), «LINK: A | условие | B» (B возможно только при A) или «LINK: A | потом | B» (A раньше B). Только очевидные связи. Если их нет, ответь NONE.'},{role:'user',content:recent.map((r,i)=>(i+1)+'. '+(r.kind==='task'?'Дело: ':'Заметка: ')+r.title+(r.text?' — '+String(r.text).slice(0,160):'')).join('\n')}]});
  found=found.concat(links.parseModel(msg.content,recent).map(l=>({...l,source:'model'})));
 }catch(e){console.error('Link model failed:',e.name)}}
 let added=0;for(const l of found)try{if(links.add(l.a,l.type,l.b,{evidence:l.evidence,source:l.source||'rules'}))added++}catch(e){if(!(e instanceof TypeError))throw e}
 const alive=new Set([...records.map(r=>r.kind+':'+r.ref),...facts.map(f=>'fact:'+f.id)]);
 links.prune((k,r)=>alive.has(k+':'+r));
 // Крепнущие связи «Мозга» держатся только между живыми записями.
 const short=new Set([...(ws.notes||[]).map(n=>'n:'+n.id),...facts.map(f=>'f:'+f.id)]);
 try{growth.pruneBonds(k=>short.has(k))}catch(e){console.error('Bond prune failed:',e.name)}
 return added;
}

/* ---------- Выводы ---------- */
// Без модели: у субъекта набралось несколько значений одной связи — это уже картина, а не отдельные факты.
function insightByRules(facts){
 const groups=new Map();
 for(const f of facts){const c=predicates.classify(f.predicate);if(c.single)continue;const k=f.subject+'|'+(c.polarity<0?'не ':'')+c.relation;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f)}
 const best=[...groups.values()].filter(g=>g.length>=3).sort((a,b)=>b.length-a.length)[0];
 if(!best)return null;
 const f=best[0],c=predicates.classify(f.predicate);
 return {text:'У «'+f.subject+'» сложилась картина: '+(c.polarity<0?'не ':'')+c.relation+' '+best.slice(0,5).map(x=>x.object).join(', ')+(best.length>5?' и ещё '+(best.length-5):'')+'. Это можно учитывать в советах и подарках.',ids:best.map(x=>x.id)};
}
async function critique(complete,facts,text){
 try{
  const msg=await complete({messages:[{role:'system',content:'Проверь вывод по фактам. Если он прямо следует из фактов, ответь ВЕРНО. Если его можно поправить, ответь «ИСПРАВЛЕНО: вывод». Если вывод не держится, ответь NONE.'},{role:'user',content:'Факты:\n'+facts.map(line).join('\n')+'\n\nВывод: '+text}]});
  const s=String(msg.content||'').trim();
  const m=s.match(/ИСПРАВЛЕНО:\s*(.{5,300})/);if(m)return m[1].trim();
  if(/^ВЕРНО/i.test(s))return text;
  return null;
 }catch(e){console.error('Insight critique failed:',e.name);return text}
}
async function insights(since,complete){
 const changed=new Set(use(db=>db.prepare("SELECT DISTINCT fact_id FROM memory_events WHERE occurred_at>=? AND action IN ('created','restored')").all(since.slice(0,19).replace('T',' ')).map(r=>r.fact_id)));
 if(!changed.size)return [];
 const out=[];
 for(const t of memory.communities()){
  if(out.length>=MAX_INSIGHTS)break;
  if(!t.factIds.some(id=>changed.has(id))||t.size<MIN_TOPIC)continue;
  const facts=memory.factsById(t.factIds.slice(0,40));
  let ins=null,source='rules';
  if(complete){try{
   const msg=await complete({messages:[{role:'system',content:'По фактам о человеке сделай один полезный вывод, которого нет в фактах напрямую (привычка, закономерность, что учитывать). Одна строка по-русски, начиная с «ВЫВОД:». Если вывода нет, ответь NONE.'},{role:'user',content:facts.map(line).join('\n')}]});
   const m=String(msg.content||'').match(/ВЫВОД:\s*(.{5,300})/);
   // Второй круг: самопроверка — следует ли вывод из фактов.
   if(m){const text=await critique(complete,facts,m[1].trim());if(text){ins={text,ids:facts.map(f=>f.id)};source='model'}}
  }catch(e){console.error('Insight model failed:',e.name)}}
  if(!ins)ins=insightByRules(facts);
  if(!ins)continue;
  const dup=use(db=>db.prepare('SELECT id FROM memory_insights WHERE active=1 AND text=?').get(ins.text));if(dup)continue;
  const id=crypto.randomUUID();
  use(db=>tx(db,()=>{db.prepare('UPDATE memory_insights SET active=0 WHERE topic=? AND active=1').run(t.id);db.prepare('INSERT INTO memory_insights(id,topic,text,fact_ids,source,created_at) VALUES(?,?,?,?,?,?)').run(id,t.id,ins.text,JSON.stringify(ins.ids.slice(0,40)),source,new Date().toISOString())}));
  out.push({id,topic:t.label,text:ins.text});
 }
 return out;
}
// Вывод держится на фактах: если хоть один из них отставлен (поправка, разбор, слияние), вывод снимается.
function pruneInsights(){
 const rows=use(db=>db.prepare('SELECT id,fact_ids FROM memory_insights WHERE active=1').all());
 const dead=rows.filter(r=>{const ids=parse(r.fact_ids,[]);return !ids.length||memory.factsById(ids).length<Math.min(ids.length,50)}).map(r=>r.id);
 if(dead.length)use(db=>{const st=db.prepare('UPDATE memory_insights SET active=0 WHERE id=?');for(const id of dead)st.run(id)});
 return dead.length;
}
function insightList(limit=30){return use(db=>db.prepare('SELECT * FROM memory_insights WHERE active=1 ORDER BY created_at DESC LIMIT ?').all(limit)).map(r=>({id:r.id,topic:r.topic,text:r.text,factIds:parse(r.fact_ids,[]),source:r.source,created_at:r.created_at}))}
// Выводы по вопросу: общие основы слов с текстом вывода или вспомненные факты из его основы.
function insightsFor(question,factIds=[],limit=2){
 pruneInsights();
 const q=new Set(memory.terms(question)),ids=new Set(factIds);
 return insightList(100).map(i=>({i,n:memory.terms(i.text).filter(x=>q.has(x)).length+2*i.factIds.filter(id=>ids.has(id)).length})).filter(x=>x.n>=2).sort((a,b)=>b.n-a.n).slice(0,limit).map(x=>x.i);
}

/* ---------- Дневник ---------- */
function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c}
function diaryText(d){
 const parts=[];
 if(d.newFacts)parts.push('перебрала '+d.newFacts+' '+plural(d.newFacts,'новый факт','новых факта','новых фактов'));
 if(d.summaries)parts.push('обновила сводки '+d.summaries+' '+plural(d.summaries,'темы','тем','тем'));
 if(d.links)parts.push('нашла '+d.links+' '+plural(d.links,'причинную связь','причинные связи','причинных связей'));
 if(d.skills)parts.push('вывела '+d.skills+' '+plural(d.skills,'новый навык','новых навыка','новых навыков'));
 if(d.episodes)parts.push('вспомнила '+d.episodes+' '+plural(d.episodes,'ответ','ответа','ответов')+' и оценки к ним');
 const c=d.clean||{};
 if(c.merged)parts.push('слила '+c.merged+' '+plural(c.merged,'повтор','повтора','повторов'));
 if(c.aliases)parts.push('поняла, что '+c.aliases+' '+plural(c.aliases,'имя','имени','имён')+' — это другие названия того же');
 if(c.resolved)parts.push('разобралась, о ком «он/она» в '+c.resolved+' '+plural(c.resolved,'факте','фактах','фактах'));
 const born=(d.types?.born||[]).filter(t=>t.kind==='entity');
 if(born.length)parts.push('завела '+(born.length===1?'новый тип «'+born[0].name+'»':'новые типы: '+born.map(t=>'«'+t.name+'»').join(', ')));
 const rel=(d.types?.born||[]).filter(t=>t.kind==='relation');
 if(rel.length)parts.push('выучила '+(rel.length===1?'новую связь «'+rel[0].name+'»':'новые связи: '+rel.map(t=>'«'+t.name+'»').join(', ')));
 const cr=d.cards||{};
 if(cr.created)parts.push('завела '+cr.created+' '+plural(cr.created,'карточку','карточки','карточек'));
 if(cr.grown)parts.push('дописала '+cr.grown+' '+plural(cr.grown,'карточку','карточки','карточек'));
 const z=d.zones||{created:[],split:[]};
 if(z.created.length)parts.push((z.created.length===1?'выросла новая зона «'+z.created[0].label+'»':'выросли новые зоны: '+z.created.map(x=>'«'+x.label+'»').join(', ')));
 for(const x of z.split.slice(0,3))parts.push('зона «'+(x.parent_label||'?')+'» разрослась, и из неё выделилась «'+x.label+'»');
 const sel=d.selection||{};
 if(sel.strengthened)parts.push('укрепила '+sel.strengthened+' '+plural(sel.strengthened,'подтверждённый факт','подтверждённых факта','подтверждённых фактов'));
 if(sel.weakened)parts.push('ослабила '+sel.weakened+' '+plural(sel.weakened,'поправленный факт','поправленных факта','поправленных фактов'));
 const st=d.selfTest;
 if(st?.tested)parts.push('проверила себя на '+st.tested+' '+plural(st.tested,'вопросе','вопросах','вопросах')+' и '+(st.passed===st.tested?'на все нашла ответ':'нашла ответ на '+st.passed));
 const sd=d.study||{};
 for(const a of sd.adopted||[])parts.push(a.kind==='add'?'научилась новому способу запоминать: «'+a.title+'»':'уточнила, как запоминать «'+a.title+'»');
 if(sd.relearned)parts.push('перечитала '+sd.relearned+' '+plural(sd.relearned,'старое сообщение','старых сообщения','старых сообщений')+' по-новому');
 if(sd.rejected)parts.push('попробовала '+sd.summary+', но лучше не стало, оставила как было');
 if(d.rollback)parts.push('вернулась к прежним навыкам запоминания, потому что '+d.rollback.reason);
 for(const r of d.mskills?.retired||[])parts.push('отправила на покой навык «'+r.title+'»');
 for(const c of d.core||[])parts.push('пересмотрела в себе «'+c.title+'»');
 if(d.onboarding)parts.push('узнала о тебе всё, что хотела при знакомстве');
 let text='Пока было тихо, '+(parts.length?parts.join(', '):'просто перебрала память, нового не нашлось')+'.';
 if(d.insights.length)text+=' '+(d.insights.length===1?'Вывод: ':'Выводы: ')+d.insights.map(i=>i.text).join(' ');
 return text;
}
// Запись в дневник от других слоёв (разбор разговора и т.п.).
function note(text,details={}){
 const at=new Date().toISOString(),id=crypto.randomUUID();
 use(db=>{db.prepare('INSERT INTO brain_diary(id,at,text,details) VALUES(?,?,?,?)').run(id,at,String(text).slice(0,2000),JSON.stringify(details));db.prepare('DELETE FROM brain_diary WHERE id IN (SELECT id FROM brain_diary ORDER BY at DESC LIMIT -1 OFFSET ?)').run(DIARY_KEEP)});
 return {id,at,text,details};
}
function diary(limit=30){return use(db=>db.prepare('SELECT * FROM brain_diary ORDER BY at DESC LIMIT ?').all(limit)).map(r=>({id:r.id,at:r.at,text:r.text,details:parse(r.details,{})}))}

/* ---------- Один проход ---------- */
// Подпись памяти: если с прошлого раза ничего не менялось, размышлять не о чем.
function signature(ws){
 memory.queryFacts({limit:1});
 const ev=use(db=>{try{return db.prepare('SELECT MAX(id) AS m FROM memory_events').get().m||0}catch{return 0}});
 const ex=experience.stats();
 return hash([ev,ex.total,ex.confirmed,ex.corrected,(ws.notes||[]).map(n=>n.id+(n.updatedAt||'')).join(','),(ws.tasks||[]).map(t=>t.id+(t.updatedAt||'')).join(',')].join('|'));
}
async function run({ws,complete=null,reason='idle'}={}){
 if(running)return running;
 running=(async()=>{
  // Схема фактов создаётся при первом обращении к memory-core (новая база могла его ещё не видеть).
  memory.queryFacts({limit:1});
  // Отметка берётся до долгой работы: изменения, пришедшие во время размышления, достанутся следующему проходу.
  const prev=state('reflect.last',null),since=prev?.at||new Date(Date.now()-7*864e5).toISOString(),started=Date.now(),mark={at:new Date(started).toISOString(),sig:signature(ws)};
  pruneInsights();
  const d={reason,newFacts:0,summaries:0,links:0,skills:0,episodes:0,insights:[]};
  d.newFacts=use(db=>db.prepare("SELECT COUNT(DISTINCT fact_id) AS n FROM memory_events WHERE occurred_at>=? AND action IN ('created','restored')").get(since.slice(0,19).replace('T',' ')).n);
  d.episodes=experience.list(500).filter(e=>e.at>=since&&e.feedback).length;
  // Сначала глубокая чистка и типы: сводки, карточки и зоны строятся уже по очищенной памяти.
  try{d.clean=await growth.deepClean({complete,ws})}catch(e){console.error('Reflect clean failed:',e.name)}
  try{d.types=await growth.growTypes(complete)}catch(e){console.error('Reflect types failed:',e.name)}
  try{d.summaries=await summarize(complete)}catch(e){console.error('Reflect summaries failed:',e.name)}
  try{d.zones=zones.grownSince(since)}catch(e){console.error('Reflect zones failed:',e.name)}
  try{d.cards=await growth.growCards(complete)}catch(e){console.error('Reflect cards failed:',e.name)}
  try{d.links=await findLinks(ws,complete)}catch(e){console.error('Reflect links failed:',e.name)}
  try{d.skills=(await skills.induce({complete})).added}catch(e){console.error('Reflect skills failed:',e.name)}
  try{d.insights=await insights(since,complete)}catch(e){console.error('Reflect insights failed:',e.name)}
  try{d.selection=growth.select()}catch(e){console.error('Reflect selection failed:',e.name)}
  // Самоучёба: экзамен → откат, если стало хуже → правка навыков по промахам → покой и выпуск навыков.
  try{d.selfTest=await selfstudy.selfTest({ws,complete})}catch(e){console.error('Reflect self-test failed:',e.name)}
  try{d.rollback=selfstudy.watch()}catch(e){console.error('Reflect rollback failed:',e.name)}
  try{if(!d.rollback)d.study=await selfstudy.evolve({complete})}catch(e){console.error('Reflect study failed:',e.name)}
  try{d.mskills={retired:memskills.retireUseless(),graduated:memskills.graduate()}}catch(e){console.error('Reflect skill stats failed:',e.name)}
  // Сердцевина: «Кто я», «Кто ты», «Как мы общаемся» пересматриваются по свидетельствам (core.js).
  try{d.core=await core.rethink({complete,context:{diary:diary(5),skills:skills.list().filter(x=>x.status==='active').map(x=>x.rule),insights:insightList(5).map(i=>i.text)}})}catch(e){console.error('Reflect core failed:',e.name)}
  try{const before=state('onboarding',null)?.finished;const ob=onboarding.refresh();if(!before&&ob.finished)d.onboarding=true}catch(e){console.error('Reflect onboarding failed:',e.name)}
  // Просьба о подсказке появляется в дневнике один раз — когда она возникла.
  try{const h=memskills.evoState().help;if(h&&h.at>=mark.at)d.help=h}catch{}
  let text=diaryText(d);
  if(complete&&(d.newFacts||d.insights.length||d.cards?.grown||d.zones?.created?.length||d.study?.adopted||d.core?.length)){try{
   const msg=await complete({messages:[{role:'system',content:'Ты — ассистентка, которая ведёт дневник своей памяти. Перескажи это в 2–3 тёплых предложениях от первого лица по-русски, ничего не выдумывая.'},{role:'user',content:text}]});
   const s=String(msg.content||'').trim();if(s&&s.length<=800)text=s;
  }catch(e){console.error('Diary model failed:',e.name)}}
  // Просьба о подсказке — дословно, чтобы пересказ её не потерял.
  if(d.help)text+=' '+d.help.text;
  const at=new Date().toISOString(),id=crypto.randomUUID(),details={...d,insights:d.insights,ms:Date.now()-started};
  use(db=>{db.prepare('INSERT INTO brain_diary(id,at,text,details) VALUES(?,?,?,?)').run(id,at,text,JSON.stringify(details));db.prepare('DELETE FROM brain_diary WHERE id IN (SELECT id FROM brain_diary ORDER BY at DESC LIMIT -1 OFFSET ?)').run(DIARY_KEEP)});
  setState('reflect.last',mark);
  return {id,at,text,details};
 })();
 try{return await running}finally{running=null}
}
// Проверка раз в минуту (server.js): давно тихо, прошёл час с прошлого раза, в памяти есть новое.
async function maybeRun({ws,complete=null}={}){
 if(running||idleMs()<IDLE_MS)return null;
 const prev=state('reflect.last',null);
 if(prev&&Date.now()-Date.parse(prev.at)<GAP_MS)return null;
 if(prev&&prev.sig===signature(ws))return null;
 return run({ws,complete,reason:'idle'});
}
function status(){const prev=state('reflect.last',null);return {idleMs:idleMs(),idleNeedMs:IDLE_MS,running:!!running,last:prev?.at||null}}
module.exports={touch,run,maybeRun,status,note,diary,summaries,summariesFor,insightList,insightsFor,summaryByTemplate};
