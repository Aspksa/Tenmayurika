'use strict';
// Содержимое остаётся на диске: не передаём его модели или внешнему сервису.
const fs=require('node:fs/promises');
const library=require('./library');
const office=require('./library-office');
const LIMIT=2*1024*1024;
async function read(path){
 if(typeof path!=='string'||!/\.(txt|md|csv|json|docx|xlsx)$/i.test(path))throw new TypeError('Формат пока не поддерживается');
 const isOffice=/\.(docx|xlsx)$/i.test(path),full=await library.filePath(path),stat=await fs.stat(full);if(stat.size>(isOffice?16*1024*1024:LIMIT))throw new TypeError('Файл слишком большой');
 const data=await fs.readFile(full),text=isOffice?office.parse(data,path.split('.').pop().toLowerCase()):data.toString('utf8');return {path,text,bytes:stat.size,modified:stat.mtime.toISOString()};
}
async function describe(path){const doc=await read(path),lines=doc.text.split(/\r?\n/),nonempty=lines.map(s=>s.trim()).filter(Boolean);return {path:doc.path,bytes:doc.bytes,modified:doc.modified,lineCount:lines.length,excerpt:nonempty.slice(0,5).map(x=>x.slice(0,250))}}
async function compare(a,b){
 const [left,right]=await Promise.all([read(a),read(b)]);const one=left.text.split(/\r?\n/),two=right.text.split(/\r?\n/),changes=[];let count=0;
 // Сравнение по номерам строк: явно сообщаем об этом в интерфейсе.
 for(let i=0;i<Math.max(one.length,two.length);i++)if(one[i]!==two[i]){count++;if(changes.length<100)changes.push({line:i+1,left:(one[i]??'').slice(0,500),right:(two[i]??'').slice(0,500)})}
 return {left:a,right:b,identical:count===0,changedLines:count,changes,truncated:count>changes.length};
}
module.exports={read,describe,compare};
