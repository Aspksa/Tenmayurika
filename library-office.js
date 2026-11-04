'use strict';
// Ограниченный разбор документов OOXML без извлечения ZIP на диск и запуска макросов.
const zlib=require('node:zlib');
const MAX_PART=8*1024*1024,MAX_TOTAL=16*1024*1024,MAX_ENTRIES=2000;
function entries(buffer){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break}
 if(end<0)throw Error('Неверный архив документа');
 const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);if(count>MAX_ENTRIES||offset>=buffer.length)throw Error('Архив документа слишком большой');
 const out=new Map();let pos=offset,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw Error('Повреждённый архив');
  const flags=buffer.readUInt16LE(pos+8),method=buffer.readUInt16LE(pos+10),compressed=buffer.readUInt32LE(pos+20),size=buffer.readUInt32LE(pos+24),n=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32),local=buffer.readUInt32LE(pos+42);
  if(pos+46+n+extra+comment>buffer.length)throw Error('Повреждённый архив');
  const name=buffer.subarray(pos+46,pos+46+n).toString('utf8');pos+=46+n+extra+comment;
  if(!/^(word\/document\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(name))continue;
  if(flags&1||![0,8].includes(method)||size>MAX_PART||(total+=size)>MAX_TOTAL||local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)throw Error('Неподдерживаемый или слишком большой документ');
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);if(start+compressed>buffer.length)throw Error('Повреждённый архив');
  const bytes=buffer.subarray(start,start+compressed),data=method===8?zlib.inflateRawSync(bytes,{maxOutputLength:MAX_PART}):bytes;
  if(data.length!==size)throw Error('Неверный размер документа');out.set(name,data.toString('utf8'));
 }
 return out;
}
function decode(text){return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>{const map={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(map[v])return map[v];const n=v[1]?.toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);return Number.isInteger(n)&&n<=0x10ffff&&n>=0?String.fromCodePoint(n):'�'})}
function xmlText(xml){return decode(xml.replace(/<[^>]*>/g,''))}
function parse(buffer,extension){
 const files=entries(buffer);
 if(extension==='docx'){
  const xml=files.get('word/document.xml');if(!xml)throw Error('Документ Word не содержит текста');
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>[...m[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(x=>xmlText(x[1])).join('')).filter(Boolean).join('\n');
 }
 const strings=[...(files.get('xl/sharedStrings.xml')||'').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>xmlText(x[1])).join(''));
 const sheets=[...files.entries()].filter(([name])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));if(!sheets.length)throw Error('В книге не найдены листы');
 return sheets.map(([name,xml])=>{const rows=[...xml.matchAll(/<row(?:\s[^>]*)?>[\s\S]*?<\/row>/g)].map(row=>[...row[0].matchAll(/<c(?:\s[^>]*)?>[\s\S]*?<\/c>/g)].map(cell=>{const x=cell[0],v=x.match(/<v>([\s\S]*?)<\/v>/),inline=x.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);if(/\bt="s"/.test(x)&&v)return strings[Number(v[1])]||'';return xmlText(v?.[1]||inline?.[1]||'')}).join('\t'));return '['+name+']\n'+rows.join('\n')}).join('\n\n');
}
module.exports={parse};
