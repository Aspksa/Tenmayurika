'use strict';
// Зоны растут постепенно. Раньше темы каждый раз заново считались алгоритмом Лувена, и от одного
// нового факта зоны могли перетасоваться. Теперь зона — постоянное место в памяти:
//  • в первый раз зоны раскладываются Лувеном;
//  • новая сущность встаёт в зону, где больше всего её соседей; если соседей нет — рождается новая зона;
//  • зона, которая разрослась (больше SPLIT_AT фактов), делится: Лувен внутри неё, крупная часть
//    остаётся старой зоной, другие крупные части становятся новыми зонами с пометкой «выросла из …».
// Зоны не сливаются и не перемешиваются, поэтому подписи, сводки тем и места в «Мозге» стабильны.
const {use,tx,state,setState}=require('./brain-db');
const {louvain}=require('./graph-cluster');
const SPLIT_AT=Number(process.env.TENMAYURIKA_ZONE_SPLIT)||40,MIN_PART=6;
function degrees(edges){const d=new Map();for(const [a,b] of edges){d.set(a,(d.get(a)||0)+1);if(a!==b)d.set(b,(d.get(b)||0)+1)}return d}
// Основатель зоны — самый связанный узел (при равенстве — по алфавиту), его ключ даёт id зоны.
function founder(keys,deg){return [...keys].sort((x,y)=>(deg.get(y)||0)-(deg.get(x)||0)||x.localeCompare(y))[0]}
function assign(keys,edges,names){
 const now=new Date().toISOString(),deg=degrees(edges),present=new Set(keys);
 const adj=new Map(keys.map(k=>[k,new Map()]));
 for(const [a,b] of edges){if(a===b||!adj.has(a)||!adj.has(b))continue;adj.get(a).set(b,(adj.get(a).get(b)||0)+1);adj.get(b).set(a,(adj.get(b).get(a)||0)+1)}
 const r=use(db=>tx(db,()=>{
  const stored=new Map(db.prepare('SELECT entity,zone FROM memory_zones').all().map(r=>[r.entity,r.zone]));
  const info=new Map(db.prepare('SELECT * FROM memory_zone_info').all().map(r=>[r.zone,{label:r.label,parent:r.parent,created_at:r.created_at,split_at:r.split_at}]));
  const member=new Map(),events={created:[],split:[]};let init=null;
  for(const [e,z] of stored)if(present.has(e)&&info.has(z))member.set(e,z);
  const newZone=(list,parent=null)=>{let f=founder(list,deg),id='t:'+f,i=2;while(info.has(id))id='t:'+f+'~'+(i++);info.set(id,{label:names.get(f)||f,parent,created_at:now,split_at:null});for(const k of list)member.set(k,id);return id};
  if(!member.size&&keys.length){
   // Первая раскладка — Лувен по всему графу.
   const comm=louvain([...keys].sort(),edges),groups=new Map();
   for(const k of keys){const c=comm.get(k);if(!groups.has(c))groups.set(c,[]);groups.get(c).push(k)}
   for(const list of groups.values())newZone(list);
   init=now;
  }else{
   // Новые сущности — к соседям. Несколько проходов: цепочка новых узлов втягивается в зону постепенно.
   let left=keys.filter(k=>!member.has(k));
   for(let pass=0;pass<6&&left.length;pass++){
    const next=[];
    for(const k of left){const votes=new Map();for(const [n,w] of adj.get(k))if(member.has(n)){const z=member.get(n);votes.set(z,(votes.get(z)||0)+w)}
     if(!votes.size){next.push(k);continue}
     const best=[...votes].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]))[0][0];member.set(k,best)}
    if(next.length===left.length)break;left=next;
   }
   // Остались островки без соседей в старых зонах — каждый связный островок становится новой зоной.
   const rest=new Set(left);
   for(const k of [...rest].sort()){if(!rest.has(k))continue;const comp=[k];rest.delete(k);for(let i=0;i<comp.length;i++)for(const n of adj.get(comp[i]).keys())if(rest.has(n)){rest.delete(n);comp.push(n)}
    events.created.push(newZone(comp))}
  }
  // Деление разросшихся зон.
  const factsIn=new Map();for(const [a] of edges){const z=member.get(a);if(z)factsIn.set(z,(factsIn.get(z)||0)+1)}
  for(const [z,n] of [...factsIn].sort((x,y)=>y[1]-x[1])){
   if(n<=SPLIT_AT)continue;
   const ks=[...member].filter(([,v])=>v===z).map(([k])=>k).sort(),inZ=new Set(ks);
   const sub=edges.filter(([a,b])=>inZ.has(a)&&inZ.has(b)),comm=louvain(ks,sub),parts=new Map();
   for(const k of ks){const c=comm.get(k);if(!parts.has(c))parts.set(c,{keys:[],facts:0});parts.get(c).keys.push(k)}
   for(const [a] of sub){const p=parts.get(comm.get(a));if(p)p.facts++}
   const big=[...parts.values()].filter(p=>p.facts>=MIN_PART).sort((x,y)=>y.facts-x.facts);
   if(big.length<2)continue;
   // Старая зона остаётся за частью, где её основатель; если его там нет — за самой крупной.
   const f=z.slice(2).replace(/~\d+$/,''),home=big.find(p=>p.keys.includes(f))||big[0];
   for(const p of big)if(p!==home){const id=newZone(p.keys,z);events.split.push({from:z,to:id})}
   info.get(z).split_at=now;
  }
  // Подпись зоны, у которой ушёл основатель, — по самому связанному из оставшихся.
  const byZone=new Map();for(const [k,z] of member){if(!byZone.has(z))byZone.set(z,[]);byZone.get(z).push(k)}
  for(const [z,list] of byZone){const f=z.slice(2).replace(/~\d+$/,'');if(!list.includes(f)){const top=founder(list,deg),lbl=names.get(top)||top;if(info.get(z).label!==lbl)info.get(z).label=lbl}}
  // Сохранение: только изменения.
  const put=db.prepare('INSERT INTO memory_zones(entity,zone,at) VALUES(?,?,?) ON CONFLICT(entity) DO UPDATE SET zone=excluded.zone,at=excluded.at');
  for(const [k,z] of member)if(stored.get(k)!==z)put.run(k,z,now);
  const del=db.prepare('DELETE FROM memory_zones WHERE entity=?');for(const k of stored.keys())if(!member.has(k))del.run(k);
  const putI=db.prepare('INSERT INTO memory_zone_info(zone,label,parent,created_at,split_at) VALUES(?,?,?,?,?) ON CONFLICT(zone) DO UPDATE SET label=excluded.label,split_at=excluded.split_at');
  for(const [z,i] of info)if(byZone.has(z))putI.run(z,i.label,i.parent,i.created_at,i.split_at);
  // Опустевшие зоны уходят (все их факты отставлены).
  const delI=db.prepare('DELETE FROM memory_zone_info WHERE zone=?');for(const z of info.keys())if(!byZone.has(z))delI.run(z);
  return {member,info,events,init};
 }));
 // Первая раскладка — не «рост»: дневник не должен писать, что выросли сразу все зоны.
 if(r.init)setState('zones.init',r.init);
 return r;
}
// Что выросло с момента since: новые зоны и деления (для дневника).
function grownSince(since){
 const init=state('zones.init','');
 return use(db=>({created:db.prepare('SELECT zone,label,parent FROM memory_zone_info WHERE created_at>=? AND created_at<>? AND parent IS NULL').all(since,init).map(r=>({...r})),
  split:db.prepare('SELECT z.zone,z.label,p.label AS parent_label FROM memory_zone_info z LEFT JOIN memory_zone_info p ON p.zone=z.parent WHERE z.created_at>=? AND z.parent IS NOT NULL').all(since).map(r=>({...r}))}));
}
module.exports={assign,grownSince,SPLIT_AT};
