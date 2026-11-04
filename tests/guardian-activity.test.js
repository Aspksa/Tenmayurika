'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const activity=require('../guardian-activity');
test('guardian reports real concurrent work, page progress and outcomes without document contents',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});
 const task=activity.track('read',{file:'книга.txt',phase:'Читаю',content:'секрет',query:'тайный запрос'},()=>gate);
 const ocr=activity.start('ocr',{file:'scan.pdf'});activity.update(ocr,{page:2,total:5,phase:'Распознаю',content:'секрет'});
 let snapshot=activity.snapshot();assert.equal(snapshot.active.length,2);assert.equal(snapshot.active.find(x=>x.id===ocr).page,2);assert.equal(snapshot.active.find(x=>x.id===ocr).total,5);
 assert.doesNotMatch(JSON.stringify(snapshot),/секрет|тайный запрос/);
 activity.finish(ocr);release();await task;assert.equal(activity.snapshot().active.length,0);
 await assert.rejects(activity.track('search',{phase:'Поиск'},async()=>{throw Error('ошибка поиска')}),/ошибка поиска/);
 snapshot=activity.snapshot();assert.equal(snapshot.history[0].result,'error');assert.equal(snapshot.history[0].message,'ошибка поиска');
 const before=snapshot.history.length,scan=activity.start('scan',{quiet:true});activity.finish(scan);assert.equal(activity.snapshot().history.length,before);
 const failed=activity.start('scan',{quiet:true});activity.finish(failed,'error','ошибка');assert.equal(activity.snapshot().history[0].kind,'scan');
 for(let i=0;i<55;i++){const id=activity.start('read');activity.finish(id)}assert.equal(activity.snapshot().history.length,50);
});
