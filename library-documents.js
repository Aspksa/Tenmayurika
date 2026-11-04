'use strict';
// Содержимое остаётся на диске: не передаём его модели или внешнему сервису.
const fs=require('node:fs/promises');
const library=require('./library');
const LIMIT=2*1024*1024;
async function read(path){
 if(typeof path!=='string'||!/\.(txt|md|csv|json)$/i.test(path))throw new TypeError('Пока поддерживаются TXT, Markdown, CSV и JSON');
 const full=await library.filePath(path),stat=await fs.stat(full);if(stat.size>LIMIT)throw new TypeError('Файл больше 2 МБ');
 const text=await fs.readFile(full,'utf8');return {path,text,bytes:stat.size,modified:stat.mtime.toISOString()};
}
async function describe(path){const doc=await read(path),lines=doc.text.split(/\r?\n/),nonempty=lines.map(s=>s.trim()).filter(Boolean);return {path:doc.path,bytes:doc.bytes,modified:doc.modified,lineCount:lines.length,excerpt:nonempty.slice(0,5).map(x=>x.slice(0,250))}}
async function compare(a,b){
 const [left,right]=await Promise.all([read(a),read(b)]);const one=left.text.split(/\r?\n/),two=right.text.split(/\r?\n/),changes=[];let count=0;
 // Сравнение по номерам строк: явно сообщаем об этом в интерфейсе.
 for(let i=0;i<Math.max(one.length,two.length);i++)if(one[i]!==two[i]){count++;if(changes.length<100)changes.push({line:i+1,left:(one[i]??'').slice(0,500),right:(two[i]??'').slice(0,500)})}
 return {left:a,right:b,identical:count===0,changedLines:count,changes,truncated:count>changes.length};
}
module.exports={read,describe,compare};
