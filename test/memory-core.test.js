'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const modulePath=path.join(__dirname,'..','memory-core.js');
test('memory core isolated smoke test',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-memory-'));
 try{
  const script=`const m=require(${JSON.stringify(modulePath)});const a=m.addFact({subject:'alpha',predicate:'knows',object:'beta',sourceId:'test'});const b=m.addFact({subject:'alpha',predicate:'knows',object:'beta',sourceId:'test'});const c=m.addFact({subject:'alpha',predicate:'knows',object:'gamma',sourceId:'test'});for(let i=0;i<510;i++)m.addFact({subject:'item-'+i,predicate:'kind',object:'ordinary',sourceId:'test'});if(m.searchFacts('beta').length!==1)process.exit(3);if(a.duplicate||!b.duplicate||c.conflicts!==1||m.relations('alpha').length!==2||m.conflicts().length!==1||m.searchFacts('beta').length!==1||m.diagnostics().integrity!=='ok')process.exit(2);`;
  const result=spawnSync(process.execPath,['-e',script],{cwd:dir,encoding:'utf8',env:{...process.env,TENMAYURIKA_MEMORY_DB:path.join(dir,'test.sqlite')}});
  assert.equal(result.status,0,result.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('extractFacts accepts both FACT line formats',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-extract-'));
 try{
  const script=`const m=require(${JSON.stringify(modulePath)});const r=m.extractFacts('FACT: Кицунэ | любит | матча\\nFACT: | Кицунэ | живёт в | Киото\\nFACT: неполная | строка','note:t');if(r.length!==2||m.queryFacts({subject:'Кицунэ'}).length!==2)process.exit(2);`;
  const result=spawnSync(process.execPath,['-e',script],{cwd:dir,encoding:'utf8',env:{...process.env,TENMAYURIKA_MEMORY_DB:path.join(dir,'test.sqlite')}});
  assert.equal(result.status,0,result.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
