'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tenmayurika-agents-'));
process.env.TENMAYURIKA_AGENTS_FILE=path.join(dir,'agents.json');
process.env.TENMAYURIKA_MEMORY_DB=path.join(dir,'facts.sqlite');
const agents=require('../agents');

test('agent jobs go to the journal and grow the agent',()=>{
 agents.reset();
 const id=agents.start('guardian','читает документ');
 assert.equal(agents.snapshot().active.length,1);
 const ev=agents.finish(id,'Документ прочитан');
 assert.equal(ev.ok,true);
 const s=agents.snapshot();
 assert.equal(s.active.length,0);
 assert.equal(s.recent[0].result,'Документ прочитан');
 assert.equal(s.growth.guardian.done,1);
 assert.equal(agents.start('nobody','x'),0,'unknown agents are ignored');
});

test('levels and titles follow the experience points',()=>{
 assert.deepEqual([agents.level(0).level,agents.level(4).level,agents.level(5).level,agents.level(500).level],[1,1,2,7]);
 assert.equal(agents.level(5).title,'Огонёк');
 assert.equal(agents.level(500).next,null);
});

test('chat tools are attributed to helpers sent by Yurika',()=>{
 agents.reset();
 assert.equal(agents.fromTool('tasks','Дела','Добавила дело').agent,'secretary');
 assert.equal(agents.fromTool('search','Поиск','Нашла').from,'yurika');
 assert.equal(agents.fromTool('calc','Калькулятор','4'),null);
});

test('helpers can hand work to each other',()=>{
 agents.reset();
 const ev=agents.record('researcher','сверяет факты','Противоречий нет',{from:'guardian'});
 assert.equal(ev.from,'guardian');
});

test('custom agents are validated, run with limited tools and can be deleted',async()=>{
 agents.reset();
 assert.throws(()=>agents.saveCustom({name:'',task:'итоги дня'}),TypeError);
 const c=agents.saveCustom({name:'Летописец',task:'итоги дня',page:'brain',rights:'read',shape:'leaf',color:'#ffd36b',template:'summary'});
 assert.match(c.id,/^c_/);
 assert.equal(agents.saveCustom({name:'X',task:'y',page:'nowhere',shape:'blob',color:'red'}).page,'home');
 let seen;
 const out=await agents.runCustom(c.id,async input=>{seen=input;return {reply:'Итоги готовы'}});
 assert.equal(out.reply,'Итоги готовы');
 assert.equal(seen.agentRun,true);
 assert.ok(!seen.tools.includes('tasks'),'read-only agent cannot change tasks');
 assert.equal(seen.agentId,c.id,'the run knows which agent it is (its lessons go to the prompt)');
 assert.equal(agents.snapshot().recent[0].agent,c.id);
 agents.deleteCustom(c.id);
 assert.equal(agents.snapshot().custom.some(x=>x.id===c.id),false);
});
