'use strict';
// Размышление на новой базе, где к фактам ещё ни разу не обращались, не падает.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-fresh-'));
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'fresh.sqlite');
process.env.TENMAYURIKA_DATA_DIR=dir;
delete process.env.CHAT_URL;
test('reflection works on a fresh database',async()=>{
 const reflect=require('../reflect');
 const r=await reflect.run({ws:{notes:[{id:'n1',title:'Ремонт машины',content:''}],tasks:[]}});
 assert.match(r.text,/^Пока было тихо/);
 assert.equal(reflect.diary(5).length,1);
});
