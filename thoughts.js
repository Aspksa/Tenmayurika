'use strict';
// Поток мыслей: короткие записи о том, что Юрика делает в голове прямо сейчас (план ответа, подвопросы,
// сверка с памятью, догадки, вопросы о человеке, предложения, размышление в простое). «Мозг» показывает
// их живой лентой в панели «Мысли». Хранится последнее KEEP записей.
// Здесь же настройки мышления: каждую способность можно выключить.
const {use,parse,state,setState}=require('./brain-db');
const KEEP=400;
const KINDS={plan:'план',split:'подвопросы',check:'сверка',guess:'догадка',ask:'вопрос',offer:'предложение',reflect:'размышление',review:'разбор',forget:'забывание',wake:'проснулось',learn:'выучила',answer:'ответ',context:'контекст',infer:'вывод',unknown:'не знаю',confirm:'подтверждение',future:'планы',tune:'настройка',dream:'сон',self:'о себе'};
function add(kind,text,details={}){
 const t=String(text||'').trim();if(!t)return null;
 const at=new Date().toISOString(),k=KINDS[kind]?kind:'answer';
 return use(db=>{
  const id=Number(db.prepare('INSERT INTO brain_thoughts(at,kind,text,details) VALUES(?,?,?,?)').run(at,k,t.slice(0,600),JSON.stringify(details||{})).lastInsertRowid);
  if(id%50===0)db.prepare('DELETE FROM brain_thoughts WHERE id<=?').run(id-KEEP);
  return {id,at,kind:k,text:t};
 });
}
// Новые мысли после id (панель опрашивает сервер), самые новые последними.
function since(id=0,limit=60){
 const n=Number(id)||0;
 return use(db=>db.prepare('SELECT * FROM (SELECT * FROM brain_thoughts WHERE id>? ORDER BY id DESC LIMIT ?) ORDER BY id').all(n,Math.min(200,Math.max(1,limit)))).map(r=>({id:r.id,at:r.at,kind:r.kind,label:KINDS[r.kind]||r.kind,text:r.text,details:parse(r.details,{})}));
}
// Мысли за день (для ползунка времени и «как я выросла»).
function countSince(iso){return use(db=>db.prepare('SELECT kind,COUNT(*) AS n FROM brain_thoughts WHERE at>=? GROUP BY kind').all(iso)).reduce((o,r)=>(o[r.kind]=r.n,o),{})}

const DEFAULTS={innerVoice:true,verify:true,split:true,curiosity:true,guesses:true,initiative:true,forgetting:true,context:true,infer:true,honest:true,plans:true,tune:true,soul:true,selftune:true,selfcode:true};
const LABELS={innerVoice:'внутренний голос перед ответом',verify:'сверять ответ с памятью',split:'разбивать сложный вопрос',curiosity:'задавать свои вопросы',guesses:'строить догадки',initiative:'предлагать самой',forgetting:'забывать ненужное',context:'понимать «он/она» по разговору',infer:'делать логические выводы',honest:'честно говорить «не знаю»',plans:'следить за планами и сроками',tune:'подстраивать свой поиск',soul:'расти душой: черты, настроение, дорогие моменты, сны, мечты',selftune:'сама подстраивать креативность и длину ответа по 👍/👎',selfcode:'предлагать правки своего кода (применяются только с вашего согласия)'};
function settings(){const s=state('mind.settings',{});return {...DEFAULTS,...(s&&typeof s==='object'?s:{})}}
function on(key){return settings()[key]!==false}
function setSetting(key,value){
 if(!(key in DEFAULTS))throw new TypeError('Нет такой настройки. Есть: '+Object.keys(DEFAULTS).join(', '));
 if(typeof value!=='boolean')throw new TypeError('Invalid value');
 const s=settings();s[key]=value;setState('mind.settings',s);return s;
}
module.exports={add,since,countSince,settings,on,setSetting,KINDS,LABELS,DEFAULTS};
