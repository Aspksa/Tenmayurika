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
async function suggestFileFolder(file){await library.filePath(file);let text=file.toLocaleLowerCase('ru');if(/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(file)){try{text+=' '+(await docs.read(file)).text.slice(0,8000).toLocaleLowerCase('ru')}catch{}}
 const topics=[[/договор|контракт|соглашени/iu,'Договоры'],[/инструкц|руководств|инсталляц/iu,'Инструкции'],[/отч[её]т|реестр|ведомост/iu,'Отчёты']];for(const [pattern,folder] of topics)if(pattern.test(text))return {folder,reason:'По словам в названии или начале документа'};return {folder:suggestFolder(file),reason:'По типу файла'};
}
async function suggestName(file){const d=await docs.read(file),extension=file.split('.').pop().toLowerCase(),original=file.split('/').pop();const first=d.text.split(/\r?\n/).map(x=>x.trim()).find(x=>x.length>=6&&!/^\[.*\]$/.test(x));if(!first)return {name:original,reason:'Не удалось выделить заголовок'};let name=[...first].map(c=>c.charCodeAt(0)<32?' ':c).join('').replace(/[<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').trim().slice(0,70).replace(/[. ]+$/,'');if(!name||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))name='Документ';return {name:name+'.'+extension,reason:'По первой содержательной строке'};}
module.exports={summarize,analyze,similar,suggestFolder,suggestName,suggestFileFolder};

// Local extractive answers: only quotes from source files, never model-generated claims.
async function answer(question,selectedFile=''){
 if(typeof question!=='string'||!question.trim()||question.length>500)throw new TypeError('Введите вопрос до 500 символов');
 const wanted=[...new Set(terms(question))].slice(0,12);if(!wanted.length)throw new TypeError('Добавьте к вопросу несколько содержательных слов');
 if(typeof selectedFile!=='string')throw new TypeError('Некорректный путь');
 const pending=selectedFile?[]:[''],matches=[];let scanned=0,unreadable=0,truncated=false;
 async function inspect(file){const d=await docs.read(file),lines=d.text.split(/\r?\n/);let page=null,sheet=null,best=null;
  for(let i=0;i<lines.length;i++){const line=lines[i],pageMatch=line.match(/^\[Страница (\d+)\]$/),sheetMatch=line.match(/^\[Лист: (.+)\]$/);if(pageMatch){page=Number(pageMatch[1]);continue}if(sheetMatch){sheet=sheetMatch[1];continue}const found=new Set(terms(line));const score=wanted.filter(w=>found.has(w)).length;if(score&&(!best||score>best.score))best={path:file,line:i+1,...(page?{page}:{}),...(sheet?{sheet}:{}),excerpt:line.slice(0,400),score}}
  if(best)matches.push(best);
 }
 if(selectedFile){scanned=1;await inspect(selectedFile)}
 while(pending.length&&scanned<200){const dir=pending.pop();for(const item of await library.list(dir)){
  if(item.type==='folder'){pending.push(item.path);continue}if(!/\.(txt|md|csv|json|docx|xlsx|pdf)$/i.test(item.name))continue;if(++scanned>200){truncated=true;break}
  try{await inspect(item.path)}catch{unreadable++}
 }}
 return {items:matches.sort((a,b)=>b.score-a.score).slice(0,10),scanned:Math.min(scanned,200),unreadable,truncated:truncated||pending.length>0,method:'extractive'};
}
module.exports.answer=answer;

async function proposeFacts(file){
 const d=await docs.read(file),out=[],seen=new Set();let lineNo=0;
 for(const raw of d.text.slice(0,16000).split(/\r?\n/)){lineNo++;for(const sentence of raw.match(/[^.!?;]+[.!?;]?/g)||[]){if(sentence.includes('?'))continue;const value=sentence.trim().replace(/[.!;]+$/,'').trim();const m=value.match(/^(.{1,70}?)\s+(не любит|любит|жив[её]т в|работает в|находится в|состоит из|содержит|принадлежит|предпочитает|создан[ао]? в)\s+(.{2,160})$/iu);if(!m)continue;const item={subject:m[1].trim(),predicate:m[2].toLocaleLowerCase('ru'),object:m[3].trim(),quote:value.slice(0,500),line:lineNo},key=[item.subject,item.predicate,item.object].join('|').toLocaleLowerCase('ru');if(!seen.has(key)){seen.add(key);out.push(item)}if(out.length>=8)return {source:file,items:out,truncated:true}}}
 return {source:file,items:out,truncated:d.text.length>16000};
}
module.exports.proposeFacts=proposeFacts;

// Excel preview is extractive: stored/cached values are shown with file, sheet and cell addresses.
async function tables(files){
 if(!Array.isArray(files)||!files.length||files.length>5||files.some(x=>typeof x!=='string'||!/\.xlsx$/i.test(x)))throw new TypeError('Выберите от одной до пяти книг XLSX');
 const books=[];let totalRows=0;
 for(const file of [...new Set(files)]){const doc=await docs.read(file),sheets=[];let sheet=null;
  for(const line of doc.text.split(/\r?\n/)){const match=line.match(/^\[Лист: (.+)\]$/);if(match){sheet={name:match[1],rows:0,preview:[]};sheets.push(sheet);continue}if(!sheet||!line.trim())continue;sheet.rows++;totalRows++;if(sheet.preview.length<20)sheet.preview.push(line.slice(0,2000))}
  books.push({path:file,sheets});
 }
 return {books,totalRows,limitPerSheet:20};
}
module.exports.tables=tables;
