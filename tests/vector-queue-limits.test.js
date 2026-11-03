'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
test('missing vectors are enqueued once; exhausted jobs are excluded',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-queue-'));
 const db=new DatabaseSync(path.join(folder,'queue.sqlite'));
 try{
  db.exec('CREATE TABLE vector_queue(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT)');
  const enqueue=db.prepare('INSERT OR IGNORE INTO vector_queue(id) VALUES(?)');
  assert.equal(enqueue.run('note-a').changes,1);
  assert.equal(enqueue.run('note-a').changes,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_queue').get().n,1);
  db.prepare('UPDATE vector_queue SET attempts=5 WHERE id=?').run('note-a');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vector_queue WHERE attempts<5').get().n,0);
 }finally{db.close();fs.rmSync(folder,{recursive:true,force:true})}
});
