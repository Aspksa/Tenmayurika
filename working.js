'use strict';
// Рабочая память темы разговора. Записи, которые были в ходу последние сообщения, остаются «горячими»:
// на следующий вопрос они подаются модели без нового поиска («а когда у неё день рождения?» после
// вопроса об Анне). Тепло остывает с каждым сообщением и со временем; новый разговор начинается с нуля.
const HALF_LIFE_MS=15*60*1000,TURN_DECAY=.6,MIN_HEAT=.2,MAX_ITEMS=40;
const items=new Map();// 'fact:id' | 'note:id' → {kind,id,heat,at}
function cool(now=Date.now()){
 for(const [k,e] of items){const h=e.heat*Math.pow(.5,(now-e.at)/HALF_LIFE_MS);if(h<MIN_HEAT)items.delete(k);else{e.heat=h;e.at=now}}
}
// Новый ход разговора: всё остывает на шаг, затем вспомненное сейчас и использованное в ответе согревается.
function turn(recalled,{weight=1}={}){
 const now=Date.now();cool(now);
 for(const e of items.values())e.heat*=TURN_DECAY;
 for(const [list,kind] of [[recalled?.facts,'fact'],[recalled?.notes,'note']])for(const id of (list||[]).slice(0,20)){
  if(typeof id!=='string'||!id)continue;const k=kind+':'+id,e=items.get(k)||{kind,id,heat:0,at:now};e.heat=Math.min(3,e.heat+weight);e.at=now;items.set(k,e);
 }
 if(items.size>MAX_ITEMS)for(const k of [...items].sort((a,b)=>a[1].heat-b[1].heat).slice(0,items.size-MAX_ITEMS).map(x=>x[0]))items.delete(k);
}
// Горячие записи, самые тёплые первыми.
function hot(kind,limit=6){cool();return [...items.values()].filter(e=>e.kind===kind&&e.heat>=MIN_HEAT*2).sort((a,b)=>b.heat-a.heat).slice(0,limit).map(e=>({id:e.id,heat:Math.round(e.heat*100)/100}))}
function clear(){items.clear()}
function snapshot(){cool();return {facts:hot('fact',20),notes:hot('note',20)}}
module.exports={turn,hot,clear,snapshot};
