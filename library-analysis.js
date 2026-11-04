'use strict';
const library=require('./library');
const docs=require('./library-documents');
const STOP=new Set('это как что для или при где когда если этот эта эти его её его она они как был была были будет также который которая которые свой свои the and for with from that this are was have'.split(' '));
function terms(value){return String(value||'').toLocaleLowerCase('ru').replace(/ё/g,'е').match(/[\p{L}\p{N}]{4,}/gu)?.filter(w=>!STOP.has(w))||[]}
function summarize(text){
 const phrases=String(text||'').split(/(?<=[.!?])\s+|\r?\n/).map(s=>s.trim()).filter(s=>s.length>=20&&!/^\[Страница \d+\]$/.test(s)).slice(0,300);
 const freq=new Map();for(const word of terms(phrases.join(' ')))freq.set(word,(freq.get(word)||0)+1);
 return phrases.map((text,index)=>({text:text.slice(0,400),index,score:terms(text).reduce((n,w)=>n+(freq.get(w)||0),0)/Math.sqrt(Math.max(terms(text).length,1))})).sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.index-b.index).map(x=>x.text);
}
async function analyze(file){const d=await docs.read(file);return {path:d.path,summary:summarize(d.text),method:'extractive'};}
async function similar(file){
 const source=await docs.read(file),words=new Set(terms(source.text).slice(0,6000));if(!words.size)return {items:[],scanned:0,truncated:false,unreadable:0};
 const pending=[''],matches=[];let scanned=0,unreadable=0,truncated=false;
 while(pending.length&&scanned<200){const dir=pending.pop();for(const item of await library.list(dir)){if(item.type==='folder'){pending.push(item.path);continue}if(item.path===file||!/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name))continue;if(++scanned>200){truncated=true;break}
  try{const d=await docs.read(item.path),other=new Set(terms(d.text).slice(0,6000));let common=0;for(const w of words)if(other.has(w))common++;const score=common/Math.max(1,words.size+other.size-common);if(common>=2&&score>=0.08)matches.push({path:item.path,score:Math.round(score*100),common})}catch{unreadable++}
 }}
 return {items:matches.sort((a,b)=>b.score-a.score).slice(0,20),scanned:Math.min(scanned,200),unreadable,truncated:truncated||pending.length>0};
}
function suggestFolder(filename){const name=String(filename||'').toLocaleLowerCase('ru');if(/\.(jpg|jpeg|png|webp|gif)$/.test(name))return 'Изображения';if(/\.(xlsx|xls|csv)$/.test(name))return 'Таблицы';if(/\.(pdf|docx|txt|md)$/.test(name))return 'Документы';return 'Другие файлы'}
module.exports={summarize,analyze,similar,suggestFolder};

// Local extractive answers: only quotes from source files, never model-generated claims.
async function answer(question){
 if(typeof question!=='string'||!question.trim()||question.length>500)throw new TypeError('Введите вопрос до 500 символов');
 const wanted=[...new Set(terms(question))].slice(0,12);if(!wanted.length)throw new TypeError('Добавьте к вопросу несколько содержательных слов');
 const pending=[''],matches=[];let scanned=0,unreadable=0,truncated=false;
 while(pending.length&&scanned<200){const dir=pending.pop();for(const item of await library.list(dir)){
  if(item.type==='folder'){pending.push(item.path);continue}if(!/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name))continue;if(++scanned>200){truncated=true;break}
  try{const d=await docs.read(item.path),lines=d.text.split(/\r?\n/);let page=null,sheet=null,best=null;
   for(let i=0;i<lines.length;i++){const line=lines[i],pageMatch=line.match(/^\[Страница (\d+)\]$/),sheetMatch=line.match(/^\[Лист: (.+)\]$/);if(pageMatch){page=Number(pageMatch[1]);continue}if(sheetMatch){sheet=sheetMatch[1];continue}const found=new Set(terms(line));const score=wanted.filter(w=>found.has(w)).length;if(score&&(!best||score>best.score))best={path:item.path,line:i+1,...(page?{page}:{}),...(sheet?{sheet}:{}),excerpt:line.slice(0,400),score}}
   if(best)matches.push(best);
  }catch{unreadable++}
 }}
 return {items:matches.sort((a,b)=>b.score-a.score).slice(0,10),scanned:Math.min(scanned,200),unreadable,truncated:truncated||pending.length>0,method:'extractive'};
}
module.exports.answer=answer;
