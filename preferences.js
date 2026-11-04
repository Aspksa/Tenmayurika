'use strict';
// Предпочтения: как пользователь хочет получать ответы («отвечай короче», «без смайликов»,
// «называй меня Аня»). Это не факты о мире, а правила общения, поэтому они хранятся отдельно
// и всегда попадают в подсказку модели. Новое предпочтение того же вида заменяет старое.
const crypto=require('node:crypto');
const {use,tx}=require('./brain-db');
const MAX_ACTIVE=20;
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const RULES=[
 [/(?:отвечай|пиши|говори|рассказывай)(?:,?\s*пожалуйста,?)?\s+(?:мне\s+)?(?:по)?(короче|коротко|кратко|кратче|лаконичн\S*|покороче|подробн\S*|подробней|подробнее|развёрнут\S*|развернут\S*|длиннее)/iu,m=>({aspect:'length',text:/корот|короч|крат|лакон/i.test(m[1])?'Отвечать коротко':'Отвечать подробно'})],
 [/(?:без|не\s+(?:используй|ставь|пиши|надо|нужно|нужны|добавляй))\s+(?:\S+\s+)?(смайл\S*|эмодз\S*|эмоджи|эмоци\S*)/iu,()=>({aspect:'emoji',text:'Без смайликов и эмодзи'})],
 [/(?:добавляй|ставь|используй|можно|пиши\s+со?)\s+(?:побольше\s+)?(смайл\S*|эмодз\S*|эмоджи)/iu,()=>({aspect:'emoji',text:'Можно со смайликами'})],
 [/(?:называй|зови)\s+меня\s+([^\s,.!?]{2,30}(?:\s+[^\s,.!?]{2,30})?)/iu,m=>({aspect:'name',text:'Называть пользователя: '+cap(m[1])})],
 [/(?:обращайся|говори)\s+(?:ко\s+мне\s+|со\s+мной\s+)?на\s+[«"]?(ты|вы)[»"]?(?=$|[\s,.!])/iu,m=>({aspect:'address',text:'Обращаться на «'+m[1].toLocaleLowerCase()+'»'})],
 [/(?:отвечай|пиши|говори)\s+(?:мне\s+)?(?:всегда\s+)?(по-[а-яё]+|на\s+[а-яё]+ом\s+языке)/iu,m=>({aspect:'language',text:'Отвечать '+m[1].toLocaleLowerCase()})],
 [/(?:пиши|отвечай|давай|оформляй)\s+(?:ответы\s+)?(списком|списками|пунктами|по\s+пунктам|таблиц\S*|без\s+списков|одним\s+абзацем|сплошным\s+текстом)/iu,m=>({aspect:'format',text:'Оформление: '+m[1].toLocaleLowerCase()})],
 [/(?:будь|отвечай|говори|пиши)\s+(?:со\s+мной\s+|мне\s+)?(серьёзн\S*|серьезн\S*|строже|строго|официальн\S*|проще|попроще|веселее|мягче|теплее|без\s+шуток|по-деловому|по-дружески)/iu,m=>({aspect:'tone',text:'Тон: '+m[1].toLocaleLowerCase()})],
];
// Общая форма: «я хочу, чтобы ты …», «мне удобнее, когда ты …», «пожалуйста, всегда …».
const GENERAL=/(?:^|[.!]\s*)(?:я\s+(?:предпочитаю|хочу|люблю),?\s+чтобы\s+ты|мне\s+(?:удобнее|нравится|приятнее),?\s+когда\s+ты|пожалуйста,?\s+(?:всегда|никогда|впредь)|впредь|на\s+будущее,?)\s+([^.!?\n]{4,140})/iu;
// «Не называй меня Аня», «не говори по-английски» — отрицание: такое правило не запоминается наоборот.
const NEGATED=/(?:^|[\s,.!])(?:не|нельзя|не\s+надо|не\s+нужно|не\s+стоит|перестань|хватит|прекрати)\s*$/i;
function detect(text){
 const t=String(text||'').trim();if(!t||t.length>1000||/\?\s*$/.test(t))return [];
 const out=[],seen=new Set();
 for(const [re,make] of RULES){const m=t.match(re);if(m&&!NEGATED.test(t.slice(Math.max(0,m.index-20),m.index))){const p=make(m);if(!seen.has(p.aspect)){seen.add(p.aspect);out.push(p)}}}
 if(!out.length){const m=t.match(GENERAL);if(m){const clause=m[1].trim().replace(/[\s,;]+$/,'');out.push({aspect:'other:'+crypto.createHash('sha1').update(clause.toLocaleLowerCase()).digest('hex').slice(0,10),text:cap(clause)})}}
 return out;
}
function add(p,source='manual'){
 const text=String(p.text||'').trim().slice(0,200),aspect=String(p.aspect||'').trim().slice(0,60);
 if(!text||!aspect)throw new TypeError('Invalid preference');
 return use(db=>tx(db,()=>{
  const same=db.prepare('SELECT id,text FROM memory_preferences WHERE active=1 AND aspect=?').get(aspect);
  if(same&&same.text===text)return {id:same.id,duplicate:true};
  if(same)db.prepare('UPDATE memory_preferences SET active=0 WHERE id=?').run(same.id);
  const id=crypto.randomUUID();
  db.prepare('INSERT INTO memory_preferences(id,aspect,text,source,created_at) VALUES(?,?,?,?,?)').run(id,aspect,text,String(source).slice(0,100),new Date().toISOString());
  // Слишком много — самые старые уходят.
  db.prepare('UPDATE memory_preferences SET active=0 WHERE active=1 AND id NOT IN (SELECT id FROM memory_preferences WHERE active=1 ORDER BY created_at DESC LIMIT ?)').run(MAX_ACTIVE);
  return {id,duplicate:false,replaced:same?same.id:null};
 }));
}
function learnFrom(text,source='chat'){return detect(text).map(p=>({...p,...add(p,source)})).filter(r=>!r.duplicate)}
// Своё правило из «Мозга»: вид определяется сам, иначе — отдельное правило.
function addText(text){
 const t=String(text||'').trim();if(!t||t.length>200)throw new TypeError('Предпочтение: от 1 до 200 символов');
 const found=detect(t);if(found.length)return add(found[0],'manual');
 return add({aspect:'other:'+crypto.createHash('sha1').update(t.toLocaleLowerCase()).digest('hex').slice(0,10),text:cap(t)},'manual');
}
function list(){return use(db=>db.prepare('SELECT id,aspect,text,source,created_at FROM memory_preferences WHERE active=1 ORDER BY created_at DESC').all().map(r=>({...r})))}
function remove(id){if(typeof id!=='string'||!id||id.length>100)throw new TypeError('Invalid id');return use(db=>db.prepare('UPDATE memory_preferences SET active=0 WHERE id=? AND active=1').run(id).changes>0)}
function promptText(){const l=list();return l.length?'Как пользователь хочет получать ответы (соблюдай всегда):\n'+l.map(p=>'• '+p.text).join('\n'):''}
module.exports={detect,add,addText,learnFrom,list,remove,promptText};
