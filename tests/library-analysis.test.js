'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const dir=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'tenma-analysis-'));process.env.TENMAYURIKA_LIBRARY_DIR=path.join(dir,'library');
const analysis=require('../library-analysis');
test('summaries quote source and similarity does not change files',async()=>{try{
 await fs.mkdir(process.env.TENMAYURIKA_LIBRARY_DIR,{recursive:true});const a='Договор перевозки щебня. Перевозка щебня выполняется автомобилем каждый рабочий день.';const b='Перевозка щебня осуществляется автомобилем. Договор предусматривает рабочий день.';
 await fs.writeFile(path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'договор.txt'),a);await fs.writeFile(path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'версия.txt'),b);await fs.writeFile(path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'другое.txt'),'Совсем другие несвязанные сведения о музыкальных инструментах.');
 const summary=await analysis.analyze('договор.txt');assert.ok(summary.summary.length);assert.ok(a.includes(summary.summary[0]));const related=await analysis.similar('договор.txt');assert.equal(related.items[0].path,'версия.txt');assert.equal(await fs.readFile(path.join(process.env.TENMAYURIKA_LIBRARY_DIR,'договор.txt'),'utf8'),a);assert.equal(analysis.suggestFolder('фото.jpg'),'Изображения');await assert.rejects(()=>analysis.analyze('../file.txt'));
 const answer=await analysis.answer('перевозка щебня');assert.ok(answer.items.some(x=>x.path==='договор.txt'));assert.ok(answer.items[0].excerpt);assert.equal(answer.method,'extractive');await assert.rejects(()=>analysis.answer('  '));
 }finally{await fs.rm(dir,{recursive:true,force:true})}});
