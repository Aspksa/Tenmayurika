'use strict';
// Агенты-помощники Юрики: общий журнал их дел, рост (уровни и титулы) и свои агенты из шаблонов.
// Огоньки в интерфейсе (wisps.js) читают /api/agents и летают по этим событиям.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DIR=process.env.TENMAYURIKA_DATA_DIR?path.resolve(process.env.TENMAYURIKA_DATA_DIR):path.join(__dirname,'data');
const FILE=process.env.TENMAYURIKA_AGENTS_FILE||path.join(DIR,'agents.json');
const BUILTIN=['guardian','reviewer','secretary','researcher'];
const NAMES={guardian:'Хранитель',reviewer:'Разборщик',secretary:'Секретарь',researcher:'Исследователь',yurika:'Юрика'};
// Рост: сколько дел до уровня и как зовут уровень.
const LEVELS=[[0,'Искорка'],[5,'Огонёк'],[15,'Светлячок'],[35,'Звёздочка'],[70,'Хранитель огня'],[120,'Мудрый дух'],[200,'Легенда']];
const SHAPES=['book','moon','star','crystal','flame','leaf','heart','drop'];
const PAGES=['home','planner','brain','facts','library'];
const TEMPLATES=[
 {id:'summary',name:'Летописец',task:'итоги дня',page:'brain',rights:'read',shape:'leaf',color:'#ffd36b',about:'Подводит итоги дня по памяти'},
 {id:'agenda',name:'Глашатай',task:'что на сегодня',page:'planner',rights:'read',shape:'flame',color:'#ff8a5c',about:'Рассказывает, что запланировано'},
 {id:'conflicts',name:'Сыщик',task:'противоречия',page:'facts',rights:'read',shape:'crystal',color:'#9be7ff',about:'Ищет противоречия в фактах'},
 {id:'empty',name:'Новый агент',task:'',page:'home',rights:'read',shape:'heart',color:'#ff9ad5',about:'Своё задание с нуля'}
];
let state=null;
function load(){if(state)return state;try{const s=JSON.parse(fs.readFileSync(FILE,'utf8'));state={stats:s.stats&&typeof s.stats==='object'?s.stats:{},custom:Array.isArray(s.custom)?s.custom:[]}}catch{state={stats:{},custom:[]}}return state}
let saveTimer=null;
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{fs.mkdirSync(path.dirname(FILE),{recursive:true});fs.writeFileSync(FILE+'.tmp',JSON.stringify(load(),null,2),{mode:0o600});fs.renameSync(FILE+'.tmp',FILE)}catch(e){console.error('Agents save failed:',e.code||e.name)}},200);saveTimer.unref?.()}
function known(id){return BUILTIN.includes(id)||load().custom.some(c=>c.id===id)}
function nameOf(id){return NAMES[id]||load().custom.find(c=>c.id===id)?.name||id}
const active=new Map(),recent=[];let next=0;
const short=(t,n)=>String(t||'').replace(/\s+/g,' ').trim().slice(0,n);
function start(agent,task,{from=null}={}){if(!known(agent))return 0;const id=++next;active.set(id,{id,agent,task:short(task,140),from:from&&from!==agent?from:null,startedAt:new Date().toISOString()});return id}
function finish(id,result='',ok=true){const item=active.get(id);if(!item)return null;active.delete(id);
 const s=load(),st=s.stats[item.agent]||={done:0,failed:0};if(ok)st.done++;else st.failed++;st.last=new Date().toISOString();save();
 const ev={...item,finishedAt:st.last,ok:!!ok,result:short(result,240)};recent.unshift(ev);if(recent.length>60)recent.length=60;return ev}
function record(agent,task,result,opts={}){const id=start(agent,task,opts);return id?finish(id,result,opts.ok!==false):null}
async function track(agent,task,fn,{from=null,summary=r=>typeof r==='string'?r:''}={}){const id=start(agent,task,{from});try{const r=await fn();finish(id,summary(r),true);return r}catch(e){finish(id,'Не получилось: '+(e?.message||'ошибка'),false);throw e}}
function level(done=0){let i=0;while(i+1<LEVELS.length&&done>=LEVELS[i+1][0])i++;const nextAt=LEVELS[i+1]?.[0]??null;return {level:i+1,title:LEVELS[i][1],done,next:nextAt,progress:nextAt===null?1:(done-LEVELS[i][0])/(nextAt-LEVELS[i][0])}}
function snapshot(){const s=load(),growth={};for(const id of [...BUILTIN,...s.custom.map(c=>c.id)])growth[id]=level(s.stats[id]?.done||0);
 return {active:[...active.values()],recent:recent.slice(0,30),growth,custom:s.custom,templates:TEMPLATES,shapes:SHAPES,levels:LEVELS.map(([at,title])=>({at,title}))}}
// Свои агенты.
function clean(v,max,label,allowEmpty=false){const t=typeof v==='string'?v.trim():'';if((!t&&!allowEmpty)||t.length>max)throw new TypeError(label);return t}
function saveCustom(input={}){const s=load();
 const item={name:clean(input.name,40,'Имя агента: от 1 до 40 символов'),task:clean(input.task,400,'Задание: от 1 до 400 символов'),about:clean(input.about||'',140,'Описание до 140 символов',true),
  page:PAGES.includes(input.page)?input.page:'home',rights:input.rights==='confirm'?'confirm':'read',shape:SHAPES.includes(input.shape)?input.shape:'star',
  color:/^#[0-9a-f]{6}$/i.test(input.color||'')?input.color:'#ffd36b',template:TEMPLATES.some(t=>t.id===input.template)?input.template:null};
 if(input.id){const c=s.custom.find(x=>x.id===input.id);if(!c)throw new TypeError('Агент не найден');Object.assign(c,item);save();return c}
 if(s.custom.length>=12)throw new TypeError('Своих агентов не больше 12');const c={id:'c_'+crypto.randomUUID().slice(0,8),...item,createdAt:new Date().toISOString()};s.custom.push(c);save();return c}
function deleteCustom(id){const s=load(),c=s.custom.find(x=>x.id===id);if(!c)throw new TypeError('Агент не найден');s.custom=s.custom.filter(x=>x.id!==id);delete s.stats[id];save();return {ok:true}}
// Какие инструменты разрешены своему агенту: «только чтение» не меняет дела, заметки и факты.
const READ_TOOLS=['calendar','search','insights','clock','calc','convert','status'],CONFIRM_TOOLS=[...READ_TOOLS,'notes','tasks','reminders'];
async function runCustom(id,answer){const c=load().custom.find(x=>x.id===id);if(!c)throw new TypeError('Агент не найден');
 return track(c.id,c.task,async()=>{const out=await answer({message:c.task,tools:c.rights==='confirm'?CONFIRM_TOOLS:READ_TOOLS,history:[],avatar:c.name,agentRun:true});return out},{from:'yurika',summary:out=>out?.reply||''})}
// Инструменты чата → кто из помощников сделал дело (Юрика его «отправила»).
const BY_TOOL={calendar:'secretary',tasks:'secretary',reminders:'secretary',notes:'secretary',facts:'researcher',search:'researcher',insights:'researcher'};
function fromTool(owner,label,text,ok=true){const agent=BY_TOOL[owner];if(!agent)return null;return record(agent,label,text,{from:'yurika',ok})}
function reset(){state={stats:{},custom:[]};active.clear();recent.length=0}
module.exports={start,finish,record,track,snapshot,saveCustom,deleteCustom,runCustom,fromTool,level,nameOf,reset,BUILTIN,TEMPLATES,LEVELS,_file:FILE};
