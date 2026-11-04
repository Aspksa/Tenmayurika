'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {check}=require('../tools/check-deps');
test('launcher requires PDF, OCR and both language packs before startup',async()=>{
 const resolved=[],loaded=[],imported=[];await check(name=>resolved.push(name),name=>loaded.push(name),async name=>imported.push(name));
 assert.ok(resolved.some(x=>x.includes('/rus/')));assert.ok(resolved.some(x=>x.includes('/eng/')));assert.ok(loaded.includes('@napi-rs/canvas'));assert.ok(imported.includes('pdfjs-dist/legacy/build/pdf.mjs'));assert.ok(imported.includes('@lancedb/lancedb'));
 await assert.rejects(()=>check(name=>{if(name.includes('/rus/'))throw Error('missing')},()=>{},async()=>{}));
 const bat=fs.readFileSync(path.join(__dirname,'..','Tenmayurika.bat'),'utf8');assert.equal((bat.match(/tools\\check-deps\.js/g)||[]).length,2);
});
