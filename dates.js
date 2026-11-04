'use strict';
// Прошедшее время словами: «вчера», «позавчера», «в понедельник», «на прошлой неделе», «3 ноября», «03.11»,
// «5 дней назад». Для вспоминания разговоров по датам. Границы — по местному времени, конец не включается.
const MONTHS=['январ','феврал','март','апрел','ма[йя]','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const DAYS=[['воскресен',0],['понедельн',1],['вторн',2],['сред',3],['четверг',4],['пятниц',5],['суббот',6]];
const DAY_NAMES=['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];
const MONTH_GEN=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const startOf=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
const add=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
const dayLabel=d=>d.getDate()+' '+MONTH_GEN[d.getMonth()];
const range=(from,to,label)=>({from,to,label});
// Возвращает {from,to,label,rest} или null. rest — текст без слов о времени (для поиска по теме).
function parsePast(text,now=new Date()){
 const t=' '+String(text||'').toLocaleLowerCase().replace(/ё/g,'е')+' ';
 const today=startOf(now);let m,r=null,hit='';
 const tryRe=(re,fn)=>{if(r)return;const x=t.match(re);if(x){const v=fn(x);if(v){r=v;hit=x[0]}}};
 tryRe(/\s(сегодня|сегодняшн\S*)\s/,()=>range(today,add(today,1),'сегодня'));
 tryRe(/\s(позавчера)\s/,()=>{const d=add(today,-2);return range(d,add(d,1),'позавчера ('+dayLabel(d)+')')});
 tryRe(/\s(вчера|вчерашн\S*)\s/,()=>{const d=add(today,-1);return range(d,add(d,1),'вчера ('+dayLabel(d)+')')});
 tryRe(/\s(\d{1,3}|один|два|три|четыре|пять|шесть|семь|неделю|месяц)\s+(дн\S*|день|недел\S*|месяц\S*)?\s*назад\s/,x=>{
  const words={один:1,два:2,три:3,четыре:4,пять:5,шесть:6,семь:7,неделю:1,месяц:1};
  const n=/^\d+$/.test(x[1])?Number(x[1]):words[x[1]];const unit=x[1]==='неделю'?'н':x[1]==='месяц'?'м':(x[2]||'д')[0];
  if(!n||n>400)return null;
  const d=unit==='н'?add(today,-7*n):unit==='м'?new Date(today.getFullYear(),today.getMonth()-n,today.getDate()):add(today,-n);
  return range(d,add(d,1),dayLabel(d));
 });
 tryRe(/\s(?:на|за)\s+прошл\S*\s+недел\S*\s/,()=>{const wd=(today.getDay()+6)%7,mon=add(today,-wd-7);return range(mon,add(mon,7),'на прошлой неделе')});
 tryRe(/\s(?:на|за)\s+(?:этой|этой\s+же|текущей)\s+недел\S*\s|\sза\s+неделю\s/,x=>{if(/за\s+неделю/.test(x[0]))return range(add(today,-6),add(today,1),'за последнюю неделю');const wd=(today.getDay()+6)%7,mon=add(today,-wd);return range(mon,add(today,1),'на этой неделе')});
 tryRe(/\s(?:в|за)\s+прошл\S*\s+месяц\S*\s/,()=>{const a=new Date(today.getFullYear(),today.getMonth()-1,1);return range(a,new Date(today.getFullYear(),today.getMonth(),1),'в прошлом месяце')});
 tryRe(/\s(?:в|за)\s+(?:этом|текущем)\s+месяц\S*\s|\sза\s+месяц\s/,x=>/за\s+месяц/.test(x[0])?range(add(today,-30),add(today,1),'за последний месяц'):range(new Date(today.getFullYear(),today.getMonth(),1),add(today,1),'в этом месяце'));
 tryRe(/\s(?:в|во)\s+(?:прошл\S*\s+)?(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s/,x=>{
  const day=DAYS.find(([s])=>x[1].startsWith(s.slice(0,4)))[1];let back=(today.getDay()-day+7)%7;
  if(/прошл/.test(x[0])&&back===0)back=7;
  const d=add(today,-back);return range(d,add(d,1),(back===0?'сегодня, в ':'в ')+DAY_NAMES[day]+' ('+dayLabel(d)+')');
 });
 tryRe(new RegExp('\\s(\\d{1,2})\\s+('+MONTHS.join('|')+')\\S*(?:\\s+(\\d{4}))?\\s'),x=>{
  const mon=MONTHS.findIndex(s=>new RegExp('^'+s).test(x[2]));let y=x[3]?Number(x[3]):today.getFullYear();
  let d=new Date(y,mon,Number(x[1]));if(!x[3]&&d>today)d=new Date(y-1,mon,Number(x[1]));
  if(d.getMonth()!==mon)return null;return range(d,add(d,1),dayLabel(d));
 });
 tryRe(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s/,x=>{
  const mon=Number(x[2])-1;if(mon<0||mon>11)return null;let y=x[3]?Number(x[3].length===2?'20'+x[3]:x[3]):today.getFullYear();
  let d=new Date(y,mon,Number(x[1]));if(!x[3]&&d>today)d=new Date(y-1,mon,Number(x[1]));
  if(d.getMonth()!==mon)return null;return range(d,add(d,1),dayLabel(d));
 });
 if(!r)return null;
 m=t.replace(hit,' ').replace(/\s+/g,' ').trim();
 return {...r,rest:m};
}
module.exports={parsePast,dayLabel};
