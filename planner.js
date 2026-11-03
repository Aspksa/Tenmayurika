'use strict';
// Даты для дел и календаря: разбор русских выражений («завтра в 15:00», «в пятницу», «12.11», «через 3 дня»)
// и подписи для ответов аватара. Все даты — локальные, в формате ГГГГ-ММ-ДД.

const MONTHS=['январ','феврал','март','апрел','ма[йя]','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const MONTH_NAMES=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
// 0 = воскресенье, как в Date.getDay().
const WEEKDAYS=[['воскресень','вс'],['понедельник','пн'],['вторник','вт'],['сред[ауы]','ср'],['четверг','чт'],['пятниц[ауы]','пт'],['суббот[ауы]','сб']];
const WEEKDAY_SHORT=['вс','пн','вт','ср','чт','пт','сб'];

function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function fromYmd(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
function addDays(d,n){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x}
function startOfDay(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
function daysBetween(a,b){return Math.round((startOfDay(b)-startOfDay(a))/86400000)}
function validParts(y,m,d){const x=new Date(y,m-1,d);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?x:null}

// Границы слова для кириллицы: \b в JS понимает только латиницу.
const L='(?<![\\p{L}\\p{N}])',R='(?![\\p{L}\\p{N}])';
const rx=src=>new RegExp(L+src+R,'iu');

// Находит дату и время в тексте. Возвращает {due, time, rest}, где rest — текст без найденных выражений.
function parseWhen(text,now=new Date()){
 let rest=' '+String(text||'')+' ',due=null,time=null,m;
 const cut=match=>{rest=rest.replace(match[0],' ')};
 const today=startOfDay(now);
 // Время: «в 15:30», «15:30», «в 9 утра», «в 7 вечера», «в 10 ч».
 if((m=rest.match(rx('(?:в|к|на)?\\s*([01]?\\d|2[0-3]):([0-5]\\d)')))){time=m[1].padStart(2,'0')+':'+m[2];cut(m)}
 else if((m=rest.match(rx('(?:в|к)\\s+([01]?\\d|2[0-3])\\s*(?:ч|час[аов]*)?\\s*(утра|дня|вечера|ночи)?'+'')))&&(m[2]||/ч/.test(m[0]))){
  let h=Number(m[1]);if((m[2]==='дня'||m[2]==='вечера')&&h<12)h+=12;if(m[2]==='ночи'&&h===12)h=0;
  time=String(h).padStart(2,'0')+':00';cut(m);
 }
 // Относительные дни.
 if((m=rest.match(rx('(?:на\\s+|к\\s+|до\\s+)?(сегодня|завтра|послезавтра)')))){due=addDays(today,{сегодня:0,завтра:1,послезавтра:2}[m[1].toLocaleLowerCase()]);cut(m)}
 else if((m=rest.match(rx('через\\s+(\\d{1,3})?\\s*(день|дня|дней|недел[юиь]|месяц[аев]*)')))){
  const n=Number(m[1]||1),u=m[2].toLocaleLowerCase();
  if(u.startsWith('нед'))due=addDays(today,7*n);else if(u.startsWith('мес')){due=new Date(today);due.setMonth(due.getMonth()+n)}else due=addDays(today,n);
  cut(m);
 }
 else if((m=rest.match(rx('на\\s+следующей\\s+неделе')))){due=addDays(today,((8-today.getDay())%7)||7);cut(m)}
 // «12.11», «12.11.2026», «12/11».
 else if((m=rest.match(rx('(?:на\\s+|к\\s+|до\\s+)?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{4}|\\d{2}))?')))){
  let y=m[3]?Number(m[3].length===2?'20'+m[3]:m[3]):today.getFullYear();
  let d=validParts(y,Number(m[2]),Number(m[1]));
  if(d&&!m[3]&&d<today)d=validParts(y+1,Number(m[2]),Number(m[1]));
  if(d){due=d;cut(m)}
 }
 // «12 ноября», «к 3 декабря 2027».
 else if((m=rest.match(rx('(?:на\\s+|к\\s+|до\\s+)?(\\d{1,2})\\s+('+MONTHS.map(x=>x+'\\p{L}*').join('|')+')(?:\\s+(\\d{4}))?')))){
  const month=MONTHS.findIndex(x=>new RegExp('^'+x,'iu').test(m[2]))+1;
  let y=m[3]?Number(m[3]):today.getFullYear(),d=validParts(y,month,Number(m[1]));
  if(d&&!m[3]&&d<today)d=validParts(y+1,month,Number(m[1]));
  if(d){due=d;cut(m)}
 }
 else{
  // «в пятницу», «к понедельнику», «в пт».
  for(let i=0;i<7&&!due;i++){
   const [full,short]=WEEKDAYS[i];
   if((m=rest.match(rx('(?:в|во|на|к|до)\\s+(?:'+full+'\\p{L}*|'+short+')')))||(m=rest.match(rx(full+'\\p{L}*')))){
    due=addDays(today,(i-today.getDay()+7)%7);cut(m);
   }
  }
 }
 if(time&&!due)due=today;
 rest=rest.replace(/\s+/g,' ').replace(/\s+([,.!?])/g,'$1').replace(/^[\s,:—–-]+|[\s,:—–-]+$/g,'').trim();
 return {due:due?ymd(due):null,time,rest};
}

// «сегодня», «завтра», «пт, 7 ноября» — для ответов и списков.
function describe(due,now=new Date()){
 if(!due)return 'без даты';
 const d=fromYmd(due),diff=daysBetween(now,d);
 if(diff===0)return 'сегодня';if(diff===1)return 'завтра';if(diff===2)return 'послезавтра';if(diff===-1)return 'вчера';
 return WEEKDAY_SHORT[d.getDay()]+', '+d.getDate()+' '+MONTH_NAMES[d.getMonth()]+(d.getFullYear()!==now.getFullYear()?' '+d.getFullYear():'');
}

// Период для повестки: today | tomorrow | week | overdue | ГГГГ-ММ-ДД.
function periodFrom(text,now=new Date()){
 const t=String(text||'').trim().toLocaleLowerCase();
 if(!t)return null;
 if(['today','tomorrow','week','overdue','all'].includes(t))return t;
 if(/^\d{4}-\d{2}-\d{2}$/.test(t))return t;
 if(/^сегодн/.test(t))return 'today';
 if(/^завтр/.test(t))return 'tomorrow';
 if(/недел/.test(t))return 'week';
 if(/просроч/.test(t))return 'overdue';
 const w=parseWhen(t,now);return w.due&&!w.rest?w.due:null;
}
function inPeriod(task,period,now=new Date()){
 const today=ymd(now);
 if(period==='all'||!period)return true;
 if(period==='overdue')return !task.done&&task.due&&task.due<today;
 if(!task.due)return false;
 if(period==='today')return task.due===today;
 if(period==='tomorrow')return task.due===ymd(addDays(now,1));
 if(period==='week')return task.due>=today&&task.due<=ymd(addDays(now,6));
 return task.due===period;
}
function periodLabel(period,now=new Date()){
 return {today:'на сегодня',tomorrow:'на завтра',week:'на неделю',overdue:'просроченные',all:''}[period]??'на '+describe(period,now);
}
const CATEGORY_LABEL={personal:'личное',work:'рабочее'};
// Сортировка: невыполненные, по дате (без даты в конце), по времени, по важности.
const PRIORITY_RANK={high:0,normal:1,low:2};
function byAgenda(a,b){return (a.done-b.done)||String(a.due||'9999').localeCompare(String(b.due||'9999'))||String(a.time||'99').localeCompare(String(b.time||'99'))||(PRIORITY_RANK[a.priority]??1)-(PRIORITY_RANK[b.priority]??1)}

module.exports={parseWhen,describe,periodFrom,inPeriod,periodLabel,byAgenda,ymd,fromYmd,addDays,daysBetween,MONTH_NAMES,CATEGORY_LABEL};
