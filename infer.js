'use strict';
// Логические выводы. Из того, что сказано, следует то, что не сказано, но верно:
//  • взаимные связи: «у Ани сестра Оля» → у Оли сестра (или брат) Аня; муж ↔ жена, друг ↔ друг;
//  • родство через шаг: мама мамы — бабушка, ребёнок ребёнка — внук, брат мамы — дядя,
//    у детей одной мамы — брат или сестра;
//  • возраст из дня рождения с годом (и сколько дней до него);
//  • место через место: живёт в Казани, Казань — в России → живёт в России.
// Выводы не записываются в память как факты: они считаются заново из действующих фактов, поэтому
// всегда сходятся с ними и исчезают, если исходный факт отставлен. У каждого вывода — цепочка «потому что».
// Факт «X | R | Y» читается как «у X R — это Y» («Я | мама | Ольга», «Аня | сестра | Оля»);
// «X | является сестрой | Y» — наоборот: X — сестра для Y.
const memory=require('./memory-core');
const predicates=require('./predicates');

const key=s=>{const k=predicates.entityKey(s);return ['я','мне','меня','мой','моя'].includes(k)?'я':k};
const ROLES=[
 [/^(мам|мать|матер|мамочк)/,'parent','f'],[/^(пап|отец|отц|папочк)/,'parent','m'],[/^родител/,'parent',null],
 [/^(доч|дочк)/,'child','f'],[/^сын/,'child','m'],[/^(ребен|ребён|дет|дит)/,'child',null],
 [/^брат/,'sibling','m'],[/^сестр/,'sibling','f'],
 [/^(бабуш|бабк|бабул)/,'grand','f'],[/^(дедуш|дед)/,'grand','m'],
 [/^внучк/,'grandchild','f'],[/^внук/,'grandchild','m'],
 [/^муж/,'spouse','m'],[/^(жена|жены|жене|жену|женой|супруга)/,'spouse','f'],[/^супруг/,'spouse',null],
 [/^подруг/,'friend','f'],[/^(друг|друз|дружит)/,'friend','m'],[/^коллег/,'colleague',null],
 [/^(дяд)/,'uncle','m'],[/^(тет|тёт)/,'uncle','f'],
 [/^(племянниц)/,'nephew','f'],[/^(племянник)/,'nephew','m']
];
const LABEL={parent:{f:'мама',m:'папа',x:'родитель'},child:{f:'дочь',m:'сын',x:'ребёнок'},sibling:{f:'сестра',m:'брат',x:'брат или сестра'},
 grand:{f:'бабушка',m:'дедушка',x:'бабушка или дедушка'},grandchild:{f:'внучка',m:'внук',x:'внук или внучка'},spouse:{f:'жена',m:'муж',x:'супруг или супруга'},
 friend:{f:'подруга',m:'друг',x:'друг'},colleague:{f:'коллега',m:'коллега',x:'коллега'},uncle:{f:'тётя',m:'дядя',x:'дядя или тётя'},nephew:{f:'племянница',m:'племянник',x:'племянник или племянница'}};
const INVERSE={parent:'child',child:'parent',sibling:'sibling',grand:'grandchild',grandchild:'grand',spouse:'spouse',friend:'friend',colleague:'colleague',uncle:'nephew',nephew:'uncle'};
function roleOf(word){const w=predicates.clean(word).replace(/ё/g,'е');for(const [re,role,g] of ROLES)if(re.test(w))return {role,g};return null}
// Факт → ребро «у from роль — to» или null.
function edge(f){
 const p=predicates.clean(f.predicate);
 if(/^(женат на|замужем за)$/.test(p))return {from:f.subject,to:f.object,role:'spouse',g:p==='женат на'?'f':'m',fact:f};
 let m=p.match(/^(?:является|приходится|это)\s+(\S+)(?:\s+(?:для|у))?$/);
 if(m){const r=roleOf(m[1]);return r?{from:f.object,to:f.subject,...r,fact:f}:null}
 m=p.match(/^(?:(?:мой|моя|мое|мои|его|ее|её|их)\s+)?(\S+)(?:\s+(?:у|это))?$/);
 if(!m)return null;
 const r=roleOf(m[1]);if(!r)return null;
 // «дружит с» — взаимно, без пола.
 return {from:f.subject,to:f.object,...r,fact:f};
}
const show=(name,k)=>k==='я'?'Я':name;
function line(f){return f.subject+' — '+f.predicate+' '+f.object}
// Главное: выводы из набора фактов. Возвращает [{subject,predicate,object,why,from:[ids],confidence,rule}].
function derive(facts,{limit=40}={}){
 const list=(facts||[]).filter(f=>f&&!f.valid_to);
 const edges=list.map(edge).filter(Boolean);
 const names=new Map(),gender=new Map();
 const has=new Set();// from|role|to — уже известно
 for(const e of edges){const a=key(e.from),b=key(e.to);names.set(a,show(e.from,a));names.set(b,show(e.to,b));has.add(a+'|'+e.role+'|'+b);if(e.g&&b!=='я')gender.set(b,e.g)}
 const out=[],seen=new Set();
 const push=(a,role,b,why,from,confidence,rule)=>{
  if(a===b||!a||!b)return;const k=a+'|'+role+'|'+b;if(has.has(k)||seen.has(k))return;seen.add(k);
  out.push({subject:names.get(a)||a,predicate:LABEL[role][gender.get(b)||'x'],object:names.get(b)||b,why,from:[...new Set(from)],confidence,rule});
 };
 const by=new Map();for(const e of edges){const a=key(e.from);if(!by.has(a))by.set(a,[]);by.get(a).push(e)}
 for(const e of edges){
  const a=key(e.from),b=key(e.to);
  // Взаимное: у Ани сестра Оля → у Оли Аня — сестра или брат (пол Ани, если известен).
  push(b,INVERSE[e.role],a,'потому что «'+line(e.fact)+'»',[e.fact.id],.95,'inverse');
  for(const e2 of by.get(b)||[]){
   const c=key(e2.to);if(c===a)continue;const why='потому что «'+line(e.fact)+'» и «'+line(e2.fact)+'»',ids=[e.fact.id,e2.fact.id];
   if(e.role==='parent'&&e2.role==='parent')push(a,'grand',c,why,ids,.95,'chain');
   else if(e.role==='child'&&e2.role==='child')push(a,'grandchild',c,why,ids,.95,'chain');
   else if(e.role==='parent'&&e2.role==='sibling')push(a,'uncle',c,why,ids,.85,'chain');
   else if(e.role==='sibling'&&e2.role==='parent')push(a,'parent',c,why,ids,.7,'chain');
   else if(e.role==='sibling'&&e2.role==='sibling')push(a,'sibling',c,why,ids,.8,'chain');
   else if(e.role==='parent'&&e2.role==='child')push(a,'sibling',c,why,ids,.8,'chain');
   else if(e.role==='spouse'&&e2.role==='child')push(a,'child',c,why,ids,.6,'chain');
  }
 }
 // Дети одного родителя — братья и сёстры.
 const kids=new Map();
 for(const e of edges)if(e.role==='parent'){const p=key(e.to);if(!kids.has(p))kids.set(p,[]);kids.get(p).push(e)}
 for(const list2 of kids.values())for(const x of list2)for(const y of list2){const a=key(x.from),b=key(y.from);if(a!==b)push(a,'sibling',b,'у обоих '+LABEL.parent[gender.get(key(x.to))||'x']+' — '+x.to,[x.fact.id,y.fact.id],.8,'chain')}
 // Возраст из дня рождения и место через место.
 const now=new Date();
 const ageKnown=new Set(list.filter(f=>predicates.classify(f.predicate).relation==='возраст').map(f=>key(f.subject)));
 for(const f of list){
  const kind=predicates.classify(f.predicate);
  if(kind.relation==='день рождения'&&!ageKnown.has(key(f.subject))){
   const d=parseDate(f.object);if(d&&d.y){let age=now.getFullYear()-d.y;if(now.getMonth()+1<d.m||(now.getMonth()+1===d.m&&now.getDate()<d.d))age--;
    if(age>=0&&age<130){const k=key(f.subject)+'|возраст';if(!seen.has(k)){seen.add(k);out.push({subject:show(f.subject,key(f.subject)),predicate:'возраст',object:age+' '+plural(age,'год','года','лет'),why:'по дню рождения «'+f.object+'»',from:[f.id],confidence:.95,rule:'age'})}}}
  }
  if(kind.relation==='живёт в'&&kind.polarity>0){
   for(const g of list)if(key(g.subject)===key(f.object)&&/^(находится в|находится|расположен в|расположена в|в)$/.test(predicates.clean(g.predicate))){
    const k=key(f.subject)+'|живёт в|'+key(g.object);
    if(seen.has(k)||list.some(x=>key(x.subject)===key(f.subject)&&predicates.classify(x.predicate).relation==='живёт в'&&key(x.object)===key(g.object)))continue;
    seen.add(k);out.push({subject:show(f.subject,key(f.subject)),predicate:'живёт в',object:g.object,why:'потому что «'+line(f)+'» и «'+line(g)+'»',from:[f.id,g.id],confidence:.9,rule:'place'});
   }
  }
 }
 return out.slice(0,limit);
}
function plural(n,one,few,many){const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many}
const MONTHS=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
// «12.03.1990», «12 марта 1990», «1990-03-12», «12 марта» → {d,m,y?}.
function parseDate(text){
 const t=String(text||'').toLocaleLowerCase();let m;
 if((m=t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)))return ok(+m[3],+m[2],+m[1]);
 if((m=t.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/)))return ok(+m[1],+m[2],m[3]?year(+m[3]):null);
 if((m=t.match(/(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?/))){const i=MONTHS.findIndex(x=>m[2].startsWith(x)&&(x!=='ма'||/^ма[яй]/.test(m[2])));if(i>=0)return ok(+m[1],i+1,m[3]?+m[3]:null)}
 return null;
 function year(y){return y<100?(y>(new Date().getFullYear()%100)?1900+y:2000+y):y}
 function ok(d,mo,y){return d>=1&&d<=31&&mo>=1&&mo<=12?{d,m:mo,y}:null}
}
// Выводы вокруг найденного: соседи сущностей из фактов (до двух шагов), только касающиеся этих сущностей.
function around(facts,{limit=6,message=''}={}){
 const seeds=new Set();for(const f of facts||[]){seeds.add(f.subject);seeds.add(f.object)}
 // «Кто моя бабушка?» — о родстве самого человека: начинаем с «Я» и с названных имён.
 const words=String(message||'').split(/[^\p{L}-]+/u).filter(Boolean);
 if(words.some(w=>roleOf(w))){seeds.add('Я');for(const w of words)if(/^\p{Lu}/u.test(w))seeds.add(w)}
 const pool=new Map((facts||[]).map(f=>[f.id,f])),ents=[...seeds].slice(0,6),next=new Set();
 for(const e of ents){let rel=[];try{rel=memory.relations(e,60)}catch{}for(const f of rel){pool.set(f.id,f);next.add(f.subject);next.add(f.object)}}
 for(const e of [...next].filter(x=>!seeds.has(x)).slice(0,8)){let rel=[];try{rel=memory.relations(e,40)}catch{}for(const f of rel)pool.set(f.id,f)}
 const want=new Set(ents.map(key));
 return derive([...pool.values()]).filter(d=>want.has(key(d.subject))||want.has(key(d.object))).slice(0,limit);
}
function text(d){return d.subject+' | '+d.predicate+' | '+d.object+' ('+d.why+')'}
module.exports={derive,around,edge,parseDate,text};
