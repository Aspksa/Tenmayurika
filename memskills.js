'use strict';
// Навыки запоминания (идея из MemSkill). Это не опыт и не факты, а способы запоминать:
// что вытаскивать из текста, на что смотреть и что обновлять или отставлять. Вместо одного
// жёсткого промпта извлечения есть банк маленьких инструкций; под каждый текст подбираются
// 2–3 подходящих, и модель разбирает текст за один вызов уже с ними.
// Здесь же: статистика навыков (как часто выбирают, польза записанного ими), пробный бонус новым,
// уход бесполезных на покой, журнал промахов памяти и версии банка для отката.
const crypto=require('node:crypto');
const memory=require('./memory-core');
const {use,tx,parse,state,setState}=require('./brain-db');
const K=3,EMA=.1,TRIAL_DAYS=14,TRIAL_BONUS=.6,WINDOW_DAYS=30,POOL=200;
const DOMAINS=['chat','note','task'];
const now=()=>new Date().toISOString();
const low=s=>String(s||'').toLocaleLowerCase().replace(/ё/g,'е');

// Стартовый банк. cues — слова-подсказки для подбора (по началу слова), domains — где навык нужен.
const SEEDS=[
 {name:'general',title:'Устойчивые факты',purpose:'Записывать то, что о человеке и его мире будет верно и завтра.',when:'Всегда, если в тексте есть новое устойчивое знание.',how:'Каждый факт отдельно и коротко. Если человек говорит о себе, субъект — «Я».',avoid:'Погода, разовые действия, вопросы и догадки — не факты.',action:'insert',domains:['all'],cues:[]},
 {name:'people',title:'Люди и отношения',purpose:'Кто есть кто: имена, родство, дружба, коллеги и как к ним относятся.',when:'В тексте названы люди или родные.',how:'Отношение записывай связью («мама», «брат», «коллега»), имя — отдельным фактом «зовут».',avoid:'Не путай, о ком речь: «он/она» без ясного лица не записывай.',action:'insert',domains:['chat','note'],cues:['мама','папа','брат','сестр','сын','доч','муж','жена','друг','подруг','коллег','начальни','бабушк','дедушк','зовут','знаком']},
 {name:'time',title:'Время и даты',purpose:'Даты, сроки, длительность и порядок событий.',when:'В тексте есть дата, день недели, «с … по», «через», возраст или срок.',how:'Дату пиши как в тексте, без догадок. Начало и конец — отдельными фактами.',avoid:'Не выдумывай год, которого нет в тексте.',action:'insert',domains:['all'],cues:['январ','феврал','март','апрел','мая','июн','июл','август','сентябр','октябр','ноябр','декабр','понедельн','вторник','сред','четверг','пятниц','суббот','воскресен','завтра','вчера','недел','месяц','год','лет','день рожд','срок','до ']},
 {name:'activities',title:'Занятия и детали',purpose:'Чем человек занимается: хобби, спорт, курсы, проекты — с подробностями.',when:'Упомянуто занятие, тренировка, учёба или проект.',how:'Записывай не только «занимается X», но и где, как часто, с кем.',avoid:'Разовое «сегодня сходила» — не привычка.',action:'insert',domains:['chat','note'],cues:['занима','хожу','трениров','курс','учу','учится','играю','рисую','бега','плава','йог','проект','хобби','увлека']},
 {name:'places',title:'Где лежат вещи',purpose:'Где что хранится и куда что положили.',when:'Сказано, где лежит или оставлена вещь.',how:'Субъект — вещь, связь — «лежит в», объект — место.',avoid:'Не записывай место, если человек сам не уверен.',action:'insert',domains:['chat','note'],cues:['лежит','лежат','положил','оставил','хран','в шкаф','в ящик','на полк','ключ','документ','паспорт']},
 {name:'limits',title:'Ограничения и предпочтения',purpose:'Что нельзя, что не подходит, что всегда или никогда.',when:'Аллергии, запреты, «не ем», «терпеть не могу», «только …».',how:'Отрицание держи в связи («не ест»), а не в объекте.',avoid:'Не превращай настроение в правило.',action:'insert',domains:['all'],cues:['аллерг','нельзя','не ем','не пью','не любл','терпеть','всегда','никогда','только','предпочита','боюсь','не перенос']},
 {name:'work',title:'Работа, учёба и места',purpose:'Где человек живёт, работает и учится, куда переехал.',when:'Упомянуты город, работа, учёба, переезд.',how:'Одно значение на связь: новое место жительства обновляет старое.',avoid:'Поездка — не переезд.',action:'insert',domains:['chat','note'],cues:['живу','живет','переех','работа','учусь','учится','универ','школ','офис','город']},
 {name:'deadlines',title:'Сроки и условия дел',purpose:'От чего зависит дело, к какому сроку и кто ждёт.',when:'Текст про дело, задачу или договорённость.',how:'Записывай срок и условие как факты о деле.',avoid:'Сам текст дела не дублируй фактом.',action:'insert',domains:['task','note'],cues:['срок','дедлайн','обещал','договор','ждет','нужно','надо','после','перед']},
 {name:'update',title:'Обновить известное',purpose:'Поправить уже известный факт, если текст его уточняет или меняет.',when:'Похожий факт уже есть, а текст говорит «теперь», «уже не», «сменил», «переехал».',how:'Выбери номер старого факта и дай новую версию целиком.',avoid:'Не создавай второй факт рядом со старым.',action:'update',domains:['all'],cues:['теперь','уже не','больше не','сменил','переех','стал','стала','сейчас']},
 {name:'retire',title:'Отставить устаревшее',purpose:'Убрать в историю факт, который явно отменён или оказался неправдой.',when:'Сказано прямо: «отменили», «уже не», «это неправда».',how:'Только при явных словах в тексте.',avoid:'Если сомневаешься — ничего не трогай.',action:'retire',domains:['all'],cues:['отмен','больше не','уже не','неправда','не будет','бросил','бросила','ушел','ушла']},
];

function row(r){return {name:r.name,title:r.title,purpose:r.purpose,when:r.when_text,how:r.how,avoid:r.avoid,action:r.action,domains:parse(r.domains,['all']),cues:parse(r.cues,[]),status:r.status,version:r.version,uses:r.uses,ema:r.ema,ok:r.ok,fix:r.fix,value:(r.ok+1)/(r.ok+r.fix+2),source:r.source,born_at:r.born_at,updated_at:r.updated_at}}
const body=s=>({title:s.title,purpose:s.purpose,when:s.when||'',how:s.how||'',avoid:s.avoid||'',action:s.action||'insert',domains:s.domains||['all'],cues:s.cues||[]});
let seeded=new Set();
function ensure(){
 const key=process.env.TENMAYURIKA_MEMORY_DB||'default';if(seeded.has(key))return;
 use(db=>{
  if(db.prepare('SELECT COUNT(*) AS n FROM memory_mskills').get().n){return}
  tx(db,()=>{const at=now();for(const s of SEEDS){insertSkill(db,{...s,status:'active',source:'seed'},at);history(db,s.name,1,'seed',body(s),'стартовый банк',at)}
   db.prepare('INSERT INTO memory_mskill_snapshots(at,bank,change,status) VALUES(?,?,?,?)').run(at,JSON.stringify(SEEDS.map(s=>({name:s.name,...body(s),status:'active'}))),JSON.stringify({kind:'seed'}),'current')});
 });
 seeded.add(key);
}
function insertSkill(db,s,at){
 db.prepare('INSERT INTO memory_mskills(name,title,purpose,when_text,how,avoid,action,domains,cues,status,version,source,born_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(s.name,s.title,s.purpose,s.when||'',s.how||'',s.avoid||'',s.action||'insert',JSON.stringify(s.domains||['all']),JSON.stringify(s.cues||[]),s.status||'trial',s.version||1,s.source||'model',at,at);
}
function history(db,name,version,change,b,reason,at=now()){db.prepare('INSERT INTO memory_mskill_history(name,version,change,body,reason,at) VALUES(?,?,?,?,?,?)').run(name,version,change,JSON.stringify(b||{}),String(reason||'').slice(0,400),at)}
function list({all=false}={}){ensure();return use(db=>db.prepare('SELECT * FROM memory_mskills '+(all?'':"WHERE status<>'retired' ")+'ORDER BY uses DESC,name').all()).map(row)}
function get(name){ensure();const r=use(db=>db.prepare('SELECT * FROM memory_mskills WHERE name=?').get(String(name||'')));return r?row(r):null}
const bankVersion=()=>state('mskills.version',0);

/* ---------- Подбор навыков под текст ---------- */
function domainOf(source){const s=String(source||'');return s.startsWith('note:')?'note':s.startsWith('task:')?'task':'chat'}
function hits(skill,text){const t=' '+low(text);return skill.cues.filter(c=>c&&t.includes(low(c))).length}
// Новые навыки получают бонус, пока не наберут пять применений (иначе они никогда не будут выбраны).
function trialBonus(s){return s.status==='trial'||(s.uses<5&&Date.now()-Date.parse(s.born_at)<TRIAL_DAYS*864e5&&s.source!=='seed')?TRIAL_BONUS:0}
function select(text,{domain='chat',k=K,similar=0,bank=null}={}){
 const pool=(bank||list()).filter(s=>s.status!=='retired'&&(s.domains.includes('all')||s.domains.includes(domain)));
 const scored=pool.map(s=>{const h=hits(s,text);return {s,h,score:h?h+.3*(s.value??.5)+trialBonus(s):0}});
 const insert=scored.filter(x=>x.s.action==='insert'&&x.h).sort((a,b)=>b.score-a.score).slice(0,k).map(x=>x.s);
 const general=pool.find(s=>s.name==='general');
 if(!insert.length&&general)insert.push(general);
 // Операции над известным нужны, только если похожие факты уже есть.
 const ops=similar?scored.filter(x=>x.s.action!=='insert'&&(x.h||x.s.name==='update')).map(x=>x.s).slice(0,2):[];
 return [...insert,...ops];
}
function promptFor(skills){
 return skills.map(s=>'Навык «'+s.title+'». Зачем: '+s.purpose+(s.when?' Когда: '+s.when:'')+(s.how?' Как: '+s.how:'')+(s.avoid?' Нельзя: '+s.avoid:'')).join('\n');
}
// Частота: выбранным EMA растёт, остальным затухает.
function recordUse(names,source){
 const list=[...new Set((names||[]).filter(x=>typeof x==='string'))].slice(0,8);if(!list.length)return;
 const at=now();
 use(db=>tx(db,()=>{
  db.prepare('UPDATE memory_mskills SET ema=ema*?').run(1-EMA);
  const st=db.prepare('UPDATE memory_mskills SET uses=uses+1,ema=ema+? WHERE name=?');for(const n of list)st.run(EMA,n);
  if(source)db.prepare('INSERT INTO memory_mskill_runs(source,skills,at) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET skills=excluded.skills,at=excluded.at').run(String(source).slice(0,300),JSON.stringify(list),at);
 }));
}
function runFor(source){return use(db=>{const r=db.prepare('SELECT skills FROM memory_mskill_runs WHERE source=?').get(String(source||''));return r?parse(r.skills,[]):[]})}
// Какие навыки записали факт: его польза потом становится пользой навыков.
function attribute(factIds,names){
 const ids=(factIds||[]).filter(x=>typeof x==='string'&&x);const ns=(names||[]).filter(x=>typeof x==='string');if(!ids.length||!ns.length)return;
 use(db=>tx(db,()=>{const st=db.prepare('INSERT INTO memory_mskill_facts(fact_id,skills,at) VALUES(?,?,?) ON CONFLICT(fact_id) DO UPDATE SET skills=excluded.skills');const at=now();for(const id of ids)st.run(id,JSON.stringify(ns),at)}));
}
function skillsOfFacts(ids){
 const list=[...new Set((ids||[]).filter(x=>typeof x==='string'))].slice(0,200);if(!list.length)return [];
 const rows=use(db=>db.prepare('SELECT skills FROM memory_mskill_facts WHERE fact_id IN ('+list.map(()=>'?').join(',')+')').all(...list));
 return [...new Set(rows.flatMap(r=>parse(r.skills,[])))];
}
function rateFacts(ids,{ok=0,fix=0}){
 const names=skillsOfFacts(ids);if(!names.length||(!ok&&!fix))return;
 use(db=>{const st=db.prepare('UPDATE memory_mskills SET ok=max(0,ok+?),fix=max(0,fix+?) WHERE name=?');for(const n of names)st.run(ok,fix,n)});
}
require('./experience').onFeedback((ep,kind,prev,correction)=>{try{const ids=ep.recalled?.facts||[];if(prev)rateFacts(ids,{[prev]:-1});rateFacts(ids,{[kind]:1});if(kind==='fix')missFromCorrection(ep,correction||'')}catch(e){console.error('Memory skill rating failed:',e.name)}});

// Бесполезные на покой: часто поправляли или давно никто не выбирает (кроме основного навыка и операций).
function retireUseless(){
 const out=[];
 for(const s of list()){
  if(s.name==='general'||s.action!=='insert')continue;
  const age=(Date.now()-Date.parse(s.born_at))/864e5;
  const bad=s.ok+s.fix>=6&&s.fix>2*s.ok;
  const idle=s.source!=='seed'&&age>WINDOW_DAYS&&s.uses<3;
  if(bad||idle){use(db=>tx(db,()=>{db.prepare("UPDATE memory_mskills SET status='retired',updated_at=? WHERE name=?").run(now(),s.name);history(db,s.name,s.version,'retire',{},bad?'записанное им чаще поправляли, чем подтверждали':'давно не пригождался')}));out.push({name:s.name,title:s.title,why:bad?'поправляли':'не пригождался'})}
 }
 return out;
}
// Новый навык после пробы становится обычным.
function graduate(){
 const out=[];
 for(const s of list())if(s.status==='trial'&&s.uses>=5&&s.fix<=s.ok){use(db=>db.prepare("UPDATE memory_mskills SET status='active',updated_at=? WHERE name=?").run(now(),s.name));out.push(s.name)}
 return out;
}

/* ---------- Изменения банка ---------- */
const slug=t=>low(t).replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,40)||'skill';
function clean(c){
 const str=(v,n)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
 const out={action:c.action==='refine'?'refine':'add',name:str(c.name,60),title:str(c.title,60),purpose:str(c.purpose,300),when:str(c.when,300),how:str(c.how,400),avoid:str(c.avoid,300),reason:str(c.reason,300)};
 out.cues=[...new Set((Array.isArray(c.cues)?c.cues:[]).map(x=>low(x).trim()).filter(x=>x.length>=3&&x.length<=30))].slice(0,16);
 out.domains=(Array.isArray(c.domains)?c.domains:[]).filter(d=>DOMAINS.includes(d));if(!out.domains.length)out.domains=['all'];
 return out;
}
// Банк с изменениями, не записанный в базу (для пробы).
function withChanges(bank,changes){
 const out=bank.map(s=>({...s}));
 for(const raw of changes){const c=clean(raw);
  if(c.action==='refine'){const s=out.find(x=>x.name===c.name);if(!s)continue;for(const k of ['purpose','when','how','avoid'])if(c[k])s[k]=c[k];if(c.title)s.title=c.title;s.cues=[...new Set([...s.cues,...c.cues])].slice(0,30);s.version++;s.changed=true}
  else{if(!c.title||!c.purpose)continue;let name=c.name&&/^[a-z0-9-]+$/.test(c.name)?c.name:slug(c.title);while(out.some(x=>x.name===name))name+='-2';
   out.push({name,title:c.title,purpose:c.purpose,when:c.when,how:c.how,avoid:c.avoid,action:'insert',domains:c.domains,cues:c.cues,status:'trial',version:1,uses:0,ema:0,ok:0,fix:0,value:.5,source:'model',born_at:now(),changed:true,isNew:true})}
 }
 return out;
}
function adopt(bank,{reason='',trialScore=null,change={}}={}){
 const at=now(),changed=bank.filter(s=>s.changed);if(!changed.length)return null;
 use(db=>tx(db,()=>{
  for(const s of changed){
   if(s.isNew)insertSkill(db,{...s,status:s.source==='user'?'active':'trial',source:s.source||'model'},at);
   else db.prepare('UPDATE memory_mskills SET title=?,purpose=?,when_text=?,how=?,avoid=?,cues=?,domains=?,version=?,updated_at=? WHERE name=?').run(s.title,s.purpose,s.when,s.how,s.avoid,JSON.stringify(s.cues),JSON.stringify(s.domains),s.version,at,s.name);
   history(db,s.name,s.version,s.isNew?'add':'refine',body(s),reason,at);
  }
  db.prepare("UPDATE memory_mskill_snapshots SET status='kept' WHERE status='current'").run();
  db.prepare('INSERT INTO memory_mskill_snapshots(at,bank,trial_score,change,status) VALUES(?,?,?,?,?)').run(at,JSON.stringify(list({all:true}).map(s=>({name:s.name,...body(s),status:s.status}))),trialScore,JSON.stringify(change),'current');
 }));
 setState('mskills.version',bankVersion()+1);
 return changed.map(s=>({name:s.name,title:s.title,kind:s.isNew?'add':'refine',cues:s.cues}));
}
function snapshots(limit=20){return use(db=>db.prepare('SELECT * FROM memory_mskill_snapshots ORDER BY id DESC LIMIT ?').all(limit)).map(r=>({id:r.id,at:r.at,bank:parse(r.bank,[]),trialScore:r.trial_score,change:parse(r.change,{}),status:r.status}))}
// Откат к снимку: определения навыков возвращаются, статистика остаётся; навыки, которых в снимке нет, уходят на покой.
function restore(snapshotId,reason){
 const snap=use(db=>db.prepare('SELECT * FROM memory_mskill_snapshots WHERE id=?').get(snapshotId));if(!snap)return null;
 const bank=parse(snap.bank,[]),names=new Set(bank.map(s=>s.name)),at=now(),touched=[];
 use(db=>tx(db,()=>{
  for(const s of bank){const cur=db.prepare('SELECT version FROM memory_mskills WHERE name=?').get(s.name);if(!cur)continue;
   db.prepare('UPDATE memory_mskills SET title=?,purpose=?,when_text=?,how=?,avoid=?,cues=?,domains=?,status=?,version=?,updated_at=? WHERE name=?').run(s.title,s.purpose,s.when,s.how,s.avoid,JSON.stringify(s.cues),JSON.stringify(s.domains),s.status==='retired'?'retired':'active',cur.version+1,at,s.name);
   history(db,s.name,cur.version+1,'rollback',body(s),reason,at);touched.push(s.name)}
  for(const r of db.prepare("SELECT name,version FROM memory_mskills WHERE status<>'retired'").all())if(!names.has(r.name)){db.prepare("UPDATE memory_mskills SET status='retired',updated_at=? WHERE name=?").run(at,r.name);history(db,r.name,r.version,'retire',{},reason,at)}
  // Откат — тоже новый снимок (с тем же банком): так окно самоэкзамена после отката считается заново.
  db.prepare("UPDATE memory_mskill_snapshots SET status='rolled_back' WHERE status='current'").run();
  db.prepare('INSERT INTO memory_mskill_snapshots(at,bank,trial_score,change,status) VALUES(?,?,?,?,?)').run(at,snap.bank,snap.trial_score,JSON.stringify({kind:'rollback',to:snapshotId,reason}),'current');
 }));
 setState('mskills.version',bankVersion()+1);
 return {snapshot:snapshotId,touched};
}
function historyList(limit=30){return use(db=>db.prepare('SELECT h.*,s.title FROM memory_mskill_history h LEFT JOIN memory_mskills s ON s.name=h.name ORDER BY h.id DESC LIMIT ?').all(limit)).map(r=>({name:r.name,title:r.title||parse(r.body,{}).title||r.name,version:r.version,change:r.change,reason:r.reason,at:r.at,body:parse(r.body,{})}))}

/* ---------- Журнал промахов ---------- */
// cause: not_stored — не записано; not_found — записано, но не нашлось; vague — записано слишком размыто или неверно.
const CAUSES=['not_stored','not_found','vague'];
function addMiss(m){
 if(!CAUSES.includes(m.cause))throw new TypeError('Invalid cause');
 const question=String(m.question||'').trim().slice(0,300);if(!question)return null;
 const key=crypto.createHash('sha1').update((m.kind||'')+'|'+low(question)).digest('hex').slice(0,20),at=now();
 use(db=>db.prepare(`INSERT INTO memory_misses(key,kind,question,expected,cause,text,source,skills,severity,count,status,first_at,last_at) VALUES(?,?,?,?,?,?,?,?,?,1,'open',?,?)
  ON CONFLICT(key) DO UPDATE SET count=count+1,cause=excluded.cause,severity=max(severity,excluded.severity),status='open',last_at=excluded.last_at,expected=excluded.expected,text=CASE WHEN excluded.text<>'' THEN excluded.text ELSE text END`)
  .run(key,String(m.kind||'self'),question,String(m.expected||'').slice(0,200),m.cause,String(m.text||'').slice(0,2000),String(m.source||'').slice(0,300),JSON.stringify(m.skills||[]),Math.max(0,Math.min(1,Number(m.severity)||.5)),at,at));
 return key;
}
function missRow(r){return {key:r.key,kind:r.kind,question:r.question,expected:r.expected,cause:r.cause,text:r.text,source:r.source,skills:parse(r.skills,[]),severity:r.severity,count:r.count,status:r.status,first_at:r.first_at,last_at:r.last_at,importance:r.severity*Math.log1p(r.count)}}
// Очередь «о чём подумать»: тяжесть × log(1+повторы); старые выпадают, пул ограничен.
function pruneMisses(){
 const cutoff=new Date(Date.now()-WINDOW_DAYS*864e5).toISOString();
 use(db=>{db.prepare('DELETE FROM memory_misses WHERE last_at<?').run(cutoff);db.prepare('DELETE FROM memory_misses WHERE key IN (SELECT key FROM memory_misses ORDER BY last_at DESC LIMIT -1 OFFSET ?)').run(POOL)});
}
function queue({limit=20,status='open',causes=CAUSES}={}){
 pruneMisses();
 return use(db=>db.prepare('SELECT * FROM memory_misses WHERE status=?').all(status)).map(missRow).filter(m=>causes.includes(m.cause)).sort((a,b)=>b.importance-a.importance||b.last_at.localeCompare(a.last_at)).slice(0,limit);
}
function markMisses(keys,status){use(db=>{const st=db.prepare('UPDATE memory_misses SET status=? WHERE key=?');for(const k of keys)st.run(status,k)})}
function missStats(){return use(db=>db.prepare("SELECT cause,COUNT(*) AS n FROM memory_misses WHERE status='open' GROUP BY cause").all()).reduce((o,r)=>(o[r.cause]=r.n,o),{not_stored:0,not_found:0,vague:0})}
// Ответ поправили — это тоже промах памяти. Причина: ничего не вспомнила, а нужное есть — «не нашлось»;
// ничего не вспомнила и нужного нет — «не записано»; вспомнила, но не то — «размыто».
function missFromCorrection(ep,correction){
 if(!ep?.question)return null;const text=String(correction||'').trim()||ep.question;
 const recalled=ep.recalled?.facts||[];let cause='vague';
 if(!recalled.length){
  // «Нашлось бы»: есть факт, где большинство слов поправки.
  const need=memory.terms(text);
  const facts=need.length?memory.factsById(memory.searchIndex(text.slice(0,300),{kinds:['fact'],limit:10}).map(h=>h.ref)):[];
  const has=facts.some(f=>{const hay=new Set(memory.terms(f.subject+' '+f.predicate+' '+f.object));return need.filter(x=>hay.has(x)).length>=Math.ceil(need.length*.6)});
  cause=has?'not_found':'not_stored';
 }
 return addMiss({kind:'correction',question:ep.question,expected:correction?text.slice(0,200):'',cause,text,source:'correction:'+ep.id,skills:skillsOfFacts(recalled),severity:1});
}

/* ---------- Упрямство ---------- */
function evoState(){return state('mskills.evo',{failed:[],streak:0,help:null})}
function setEvo(v){setState('mskills.evo',v)}
// Пользователь ответил или сам поправил навыки — можно снова пробовать.
function clearHelp(){const e=evoState();setEvo({...e,streak:0,help:null});return true}
// Подсказка пользователя становится навыком запоминания (подсказки — слова из неё и из главного промаха).
function addHint(text){
 const t=String(text||'').replace(/\s+/g,' ').trim();if(t.length<5||t.length>600)throw new TypeError('Invalid text');
 const top=queue({limit:1})[0];
 const cues=[...new Set([...memory.terms(t),...(top?memory.terms(top.question):[])].filter(x=>x.length>=3))].slice(0,12);
 const bank=withChanges(list(),[{action:'add',title:'Подсказка: '+t.slice(0,40),purpose:t,when:top?'Похоже на: «'+top.question+'»':'',how:'Записывай то, о чём говорит подсказка, отдельными фактами.',cues,reason:'подсказка пользователя'}]);
 const s=bank.find(x=>x.isNew);if(!s)return null;s.source='user';
 const r=adopt(bank,{reason:'подсказка пользователя',change:{kind:'hint',text:t}});
 if(top)markMisses([top.key],'used');
 clearHelp();
 return r?.[0]||null;
}

function stats(){
 const all=list({all:true});
 return {skills:all.filter(s=>s.status!=='retired').length,trial:all.filter(s=>s.status==='trial').length,retired:all.filter(s=>s.status==='retired').length,version:bankVersion(),misses:missStats()};
}
module.exports={SEEDS,ensure,list,get,select,promptFor,recordUse,runFor,attribute,skillsOfFacts,rateFacts,retireUseless,graduate,withChanges,adopt,restore,snapshots,historyList,addMiss,queue,markMisses,missStats,missFromCorrection,pruneMisses,evoState,setEvo,clearHelp,addHint,stats,domainOf,bankVersion,clean};
