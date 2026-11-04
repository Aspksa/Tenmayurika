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
function replacePath(oldPath,newPath){return mutate(state=>{for(const item of state.collections)item.files=[...new Set(item.files.map(x=>x===oldPath?newPath:x))];return {ok:true}})}
module.exports={list,create,add,remove,drop,replacePath};
