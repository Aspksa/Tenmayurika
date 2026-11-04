'use strict';
// Подборки содержат ссылки на файлы, сами файлы не перемещаются.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const library=require('./library');
const FILE=process.env.TENMAYURIKA_LIBRARY_COLLECTIONS||path.join(__dirname,'data','library-collections.json');
let chain=Promise.resolve();
async function read(){try{const data=JSON.parse(await fs.readFile(FILE,'utf8'));if(!Array.isArray(data.collections))throw Error('Повреждены данные подборок');return data}catch(e){if(e.code==='ENOENT')return {collections:[]};throw e}}
function mutate(fn){const job=chain.catch(()=>{}).then(async()=>{const state=await read(),result=await fn(state);await fs.mkdir(path.dirname(FILE),{recursive:true});await fs.writeFile(FILE+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await fs.rename(FILE+'.tmp',FILE);return result});chain=job;return job}
function title(value){if(typeof value!=='string'||!value.trim()||value.trim().length>100)throw new TypeError('Укажите название до 100 символов');return value.trim()}
function get(state,id){const item=state.collections.find(x=>x.id===id);if(!item)throw new TypeError('Подборка не найдена');return item}
async function list(){await chain.catch(()=>{});return (await read()).collections}
function create(name){return mutate(state=>{const nameSafe=title(name);if(state.collections.some(x=>x.name.toLocaleLowerCase()===nameSafe.toLocaleLowerCase()))throw new TypeError('Подборка с таким названием уже есть');const item={id:crypto.randomUUID(),name:nameSafe,files:[]};state.collections.push(item);return item})}
function add(id,file){return mutate(async state=>{const item=get(state,id);await library.filePath(file);if(!item.files.includes(file))item.files.push(file);return item})}
function remove(id,file){return mutate(state=>{const item=get(state,id);item.files=item.files.filter(x=>x!==file);return item})}
function drop(id){return mutate(state=>{get(state,id);state.collections=state.collections.filter(x=>x.id!==id);return {ok:true}})}
function replacePath(oldPath,newPath){return mutate(state=>{for(const item of state.collections)item.files=[...new Set(item.files.map(x=>x===oldPath?newPath:x))];for(const link of state.links||[]){if(link.a===oldPath)link.a=newPath;if(link.b===oldPath)link.b=newPath}for(const item of state.memos||[])if(item.source===oldPath)item.source=newPath;return {ok:true}})}
async function links(){await chain.catch(()=>{});return (await read()).links||[]}
function connect(a,b,label){return mutate(async state=>{if(typeof a!=='string'||typeof b!=='string'||a===b)throw new TypeError('Выберите два разных файла');await library.filePath(a);await library.filePath(b);const name=typeof label==='string'?label.trim():'';if(name.length>100)throw new TypeError('Описание связи слишком длинное');state.links??=[];const existing=state.links.find(x=>(x.a===a&&x.b===b)||(x.a===b&&x.b===a));if(existing)return existing;const link={id:crypto.randomUUID(),a,b,label:name};state.links.push(link);return link})}
function disconnect(id){return mutate(state=>{state.links??=[];if(!state.links.some(x=>x.id===id))throw new TypeError('Связь не найдена');state.links=state.links.filter(x=>x.id!==id);return {ok:true}})}
async function memos(){await chain.catch(()=>{});return (await read()).memos||[]}
function addMemo(source,kind,text,due){return mutate(async state=>{await library.filePath(source);if(!['note','task'].includes(kind))throw new TypeError('Неизвестный тип записи');if(typeof text!=='string'||!text.trim()||text.trim().length>2000)throw new TypeError('Введите текст до 2000 символов');let date=null;if(due){if(typeof due!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(due)||Number.isNaN(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due)throw new TypeError('Дата должна быть в формате ГГГГ-ММ-ДД');date=due}state.memos??=[];const item={id:crypto.randomUUID(),source,kind,text:text.trim(),due:date,done:false,createdAt:new Date().toISOString()};state.memos.unshift(item);return item})}
function changeMemo(id,action){return mutate(state=>{state.memos??=[];const item=state.memos.find(x=>x.id===id);if(!item)throw new TypeError('Запись не найдена');if(action==='delete'){state.memos=state.memos.filter(x=>x.id!==id);return {ok:true}}if(action==='toggle'&&item.kind==='task'){item.done=!item.done;return item}throw new TypeError('Неизвестное действие')})}
module.exports={list,create,add,remove,drop,replacePath,links,connect,disconnect,memos,addMemo,changeMemo};
