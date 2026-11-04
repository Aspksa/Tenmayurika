'use strict';
// Сообщества в графе фактов (алгоритм Лувена): узлы — сущности («Анна», «Казань»),
// рёбра — факты между ними. Плотно связанные сущности собираются в одну тему.
// Две фазы повторяются: узлы переходят к соседнему сообществу, пока растёт модулярность,
// потом сообщества склеиваются в узлы, и всё снова. Порядок обхода фиксирован — результат стабилен.
function louvain(nodeIds,edges,{maxLevels=6}={}){
 const index=new Map(nodeIds.map((id,i)=>[id,i]));
 let n=nodeIds.length,adj=Array.from({length:n},()=>new Map());
 for(const [a,b,w=1] of edges){const i=index.get(a),j=index.get(b);if(i===undefined||j===undefined)continue;adj[i].set(j,(adj[i].get(j)||0)+w);if(i!==j)adj[j].set(i,(adj[j].get(i)||0)+w)}
 // member[i] — сообщество исходного узла i на текущем уровне.
 let member=nodeIds.map((_,i)=>i);
 for(let level=0;level<maxLevels;level++){
  const deg=adj.map(m=>{let s=0;for(const w of m.values())s+=w;return s});
  const m2=deg.reduce((a,b)=>a+b,0);if(!m2)break;
  const comm=Array.from({length:n},(_,i)=>i),tot=deg.slice();
  let moved=true,any=false,rounds=0;
  while(moved&&rounds++<20){
   moved=false;
   for(let i=0;i<n;i++){
    const ci=comm[i],ki=deg[i],links=new Map();
    for(const [j,w] of adj[i])if(j!==i)links.set(comm[j],(links.get(comm[j])||0)+w);
    tot[ci]-=ki;
    let best=ci,gain=(links.get(ci)||0)-tot[ci]*ki/m2;
    for(const [c,w] of links){const g=w-tot[c]*ki/m2;if(g>gain+1e-12){gain=g;best=c}}
    tot[best]+=ki;if(best!==ci){comm[i]=best;moved=true;any=true}
   }
  }
  if(!any)break;
  // Склейка: сообщества становятся узлами следующего уровня.
  const ids=[...new Set(comm)],re=new Map(ids.map((c,k)=>[c,k]));
  const next=Array.from({length:ids.length},()=>new Map());
  for(let i=0;i<n;i++)for(const [j,w] of adj[i]){const a=re.get(comm[i]),b=re.get(comm[j]);next[a].set(b,(next[a].get(b)||0)+w)}
  member=member.map(c=>re.get(comm[c]));adj=next;n=ids.length;
 }
 const out=new Map();nodeIds.forEach((id,i)=>out.set(id,member[i]));return out;
}
module.exports={louvain};
