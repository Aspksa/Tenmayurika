'use strict';
// Что известно о факте кроме него самого.
//  • Время: «раньше жила в Москве» — факт в прошлом; «работаю в студии с 2021» — с какого времени;
//    «до 2020» — до какого. Вид: постоянный (имя, день рождения, родство), меняющийся (где живёт, что любит)
//    или вне времени (Казань находится в России).
//  • Факт или мнение: «считает, что…», «кажется», оценки («лучший», «скучный») — мнение. Мнения и прошлое
//    не спорят с нынешними фактами как противоречия: «раньше жила в Москве» и «живёт в Казани» — оба верны.
//  • Откуда известно: сказали вручную, в чате, в заметке, вывела сама из разговора, догадка подтвердилась.
// Правила простые, без модели; разбор хранится рядом с фактом (memory_fact_meta).
const {use,tx}=require('./brain-db');
const predicates=require('./predicates');
const clean=s=>String(s||'').toLocaleLowerCase().replace(/ё/g,'е').trim();
const PAST_WORD=/(^|[\s(])(раньше|бывш\S*|прежде|когда-то|в прошлом|ранее|прошл\S+ (?:году|лет))(?=[\s),.]|$)/;
// Глагол прошедшего времени в начале связи: «жила в», «работал в», «училась», «был».
const PAST_VERB=/^(не\s+)?[а-я]{2,}(л|ла|ло|ли|лся|лась|лось|лись)(\s|$)/;
const NOT_VERB=/^(дел|стол|пол|угол|осел|орел|посол|котел|мыл|зал|бал|вол|ал)$/;
const MONTHS={январ:1,феврал:2,март:3,апрел:4,ма:5,июн:6,июл:7,август:8,сентябр:9,октябр:10,ноябр:11,декабр:12};
const SEASONS={зим:12,весн:3,лет:6,осен:9};
function monthOf(word){const w=clean(word);for(const [k,v] of Object.entries(MONTHS))if(w.startsWith(k)&&(k!=='ма'||/^ма[яй]$/.test(w)))return v;return null}
function seasonOf(word){const w=clean(word);for(const [k,v] of Object.entries(SEASONS))if(w.startsWith(k))return v;return null}
// «с 2021», «с весны», «с марта 2023», «до 2020», «по 2019».
function dateFrom(text,obs){
 const year=(text.match(/\b(19|20)\d{2}\b/)||[])[0];
 const word=(text.match(/[а-я]+/)||[])[0]||'';
 const m=monthOf(word)||seasonOf(word);
 if(year)return m?year+'-'+String(m).padStart(2,'0'):year;
 if(m){const o=obs?new Date(obs):new Date();let y=o.getFullYear();if(m>o.getMonth()+1)y--;return y+'-'+String(m).padStart(2,'0')}
 return null;
}
const PERMANENT=/^(зовут|день рождения|родил|родом|возраст при|группа крови)|(^|\s)(мама|папа|мать|отец|брат|сестра|сын|дочь|бабушка|дедушка)(\s|$)/;
const TIMELESS=/^(находится в|находится|является|это|столица|состоит из|входит в|часть)$/;
const OPINION_VERB=/^(считает|думает|полагает|уверен|уверена|кажется|по мнению|по-моему|находит(?!ся))/;
const EVAL=/^(сам\S* )?(лучш|худш|прекрасн|ужасн|скучн|отличн|плох|хорош|красив|некрасив|глуп|умн|интересн|неинтересн|вкусн|невкусн|странн|классн|крут|любим)/;
// Только по тексту связи и объекта: этим пользуется и memory-core, чтобы не заводить ложное противоречие.
function analyzeText(predicate,object,observed){
 const p=clean(predicate),o=clean(object),both=p+' '+o;
 const first=p.replace(/^не\s+/,'').split(/\s+/)[0]||'';
 // «Переехала в», «устроился на» — прошедшее время, но про нынешнее: такие глаголы — синонимы известной связи.
 const pastVerb=PAST_VERB.test(p)&&!NOT_VERB.test(first)&&!predicates.known(predicates.classify(p).relation);
 const sinceM=both.match(/(?:^|\s|\()(?:с|со)\s+((?:\d{4})|(?:[а-я]+(?:\s+\d{4})?))(?=[\s),.]|$)/);
 const untilM=both.match(/(?:^|\s|\()(?:до|по)\s+((?:\d{4})|(?:[а-я]+\s+\d{4}))(?=[\s),.]|$)/);
 const since=sinceM?dateFrom(sinceM[1],observed):null,until=untilM?dateFrom(untilM[1],observed):null;
 const past=PAST_WORD.test(both)||pastVerb||(!!until&&until<String(new Date().getFullYear()));
 const opinion=OPINION_VERB.test(p)||(/^(это|является|—|-|кажется|был|была)$/.test(p)&&EVAL.test(o));
 const span=PERMANENT.test(p)?'permanent':TIMELESS.test(p)?'timeless':'changing';
 return {since,until,past:past?1:0,span,opinion:opinion?1:0};
}
// Прошлое и мнения не спорят с нынешними фактами.
function quiet(predicate,object){const a=analyzeText(predicate,object);return !!(a.past||a.opinion)}
const ORIGINS=[
 [/^manual/,'said','вы научили'],
 [/^chat/,'said','из разговора'],
 [/^(note|n:)/,'note','из заметки'],
 [/^correct/,'said','ваша поправка'],
 [/^review/,'inferred','вывела из разговора'],
 [/^guess/,'confirmed','догадка, подтвердилась'],
 [/^(model|learn|reflect|clean)/,'inferred','вывела сама']
];
function originOf(source){const s=String(source||'');for(const [re,kind] of ORIGINS)if(re.test(s))return kind;return 'said'}
const ORIGIN_LABEL={said:'вы сказали',note:'из заметки',inferred:'вывела сама',confirmed:'догадка, подтвердилась'};
const SPAN_LABEL={permanent:'постоянное',changing:'может меняться',timeless:'вне времени'};
function analyze(f){return {...analyzeText(f.predicate,f.object,f.observed_at),origin:originOf(f.source_id)}}
// Разбор для фактов, у которых его ещё нет. Возвращает id → разбор.
function ensure(facts){
 const list=(facts||[]).filter(f=>f&&typeof f.id==='string');if(!list.length)return new Map();
 const out=new Map();
 use(db=>{
  for(let i=0;i<list.length;i+=200){const part=list.slice(i,i+200);for(const r of db.prepare('SELECT * FROM memory_fact_meta WHERE fact_id IN ('+part.map(()=>'?').join(',')+')').all(...part.map(f=>f.id)))out.set(r.fact_id,{since:r.since,until:r.until,past:r.past,span:r.span,opinion:r.opinion,origin:r.origin})}
  const missing=list.filter(f=>!out.has(f.id));
  if(missing.length){const st=db.prepare('INSERT OR REPLACE INTO memory_fact_meta(fact_id,since,until,past,span,opinion,origin,at) VALUES(?,?,?,?,?,?,?,?)'),now=new Date().toISOString();
   tx(db,()=>{for(const f of missing){const a=analyze(f);st.run(f.id,a.since,a.until,a.past,a.span,a.opinion,a.origin,now);out.set(f.id,a)}})}
 });
 return out;
}
// Короткая пометка для подсказки модели и для карточки: «(в прошлом, до 2020) [мнение] — уверенность 60%, вывела сама».
function tag(f,m){
 if(!m)return '';
 const time=[m.past?'в прошлом':'',m.since?'с '+m.since:'',m.until?'до '+m.until:''].filter(Boolean);
 const parts=[time.length?'('+time.join(', ')+')':'',m.opinion?'[мнение]':''];
 const conf=Number(f.confidence);
 const tail=[conf<.9?'уверенность '+Math.round(conf*100)+'%':'',m.origin!=='said'?ORIGIN_LABEL[m.origin]:''].filter(Boolean);
 return [parts.filter(Boolean).join(' '),tail.length?'— '+tail.join(', '):''].filter(Boolean).join(' ');
}
function label(m){return m?{span:SPAN_LABEL[m.span]||m.span,origin:ORIGIN_LABEL[m.origin]||m.origin}:null}
module.exports={analyzeText,analyze,quiet,ensure,tag,label,originOf,ORIGIN_LABEL,SPAN_LABEL};
