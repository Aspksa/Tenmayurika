'use strict';
// Настройки языковой модели для аватара (Cloud.ru Foundation Models или любой OpenAI-совместимый сервис).
// Хранятся локально в data/llm-settings.json (папка data не попадает в git). Ключ никогда не отдаётся в браузер.
// Если файл не настроен, используются переменные .env: CHAT_URL, CHAT_API_KEY, CHAT_MODEL.
const fs=require('node:fs'),path=require('node:path');

const PRESETS={
 cloudru:{label:'Cloud.ru Foundation Models',baseUrl:'https://foundation-models.api.cloud.ru/v1',keyUrl:'https://console.cloud.ru/'},
 openai:{label:'OpenAI',baseUrl:'https://api.openai.com/v1'},
 custom:{label:'Другой OpenAI-совместимый',baseUrl:''}
};
const DEFAULTS={enabled:true,provider:'cloudru',baseUrl:PRESETS.cloudru.baseUrl,apiKey:'',model:'',temperature:0.6,maxTokens:1024,useTools:true,systemPrompt:'',embeddingModel:''};
// Модели эмбеддингов (поиск по смыслу), которые стоит предложить в меню для Cloud.ru.
const EMBEDDING_HINTS={cloudru:['BAAI/bge-m3','Qwen/Qwen3-Embedding-0.6B','Qwen/Qwen3-Embedding-8B'],openai:['text-embedding-3-small','text-embedding-3-large'],custom:[]};

const dataDir=()=>process.env.TENMAYURIKA_DATA_DIR?path.resolve(process.env.TENMAYURIKA_DATA_DIR):path.join(__dirname,'data');
const file=()=>path.join(dataDir(),'llm-settings.json');

function readFile(){try{const raw=JSON.parse(fs.readFileSync(file(),'utf8'));return raw&&typeof raw==='object'?raw:null}catch{return null}}
function stored(){const raw=readFile();return raw?{...DEFAULTS,...raw}:null}

function validBaseUrl(value){
 let u;try{u=new URL(value)}catch{return false}
 if(u.username||u.password)return false;
 if(u.protocol==='https:')return true;
 // Локальные серверы моделей (LM Studio, Ollama) разрешены по http только на этом компьютере.
 return u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);
}
const trimSlash=s=>String(s).replace(/\/+$/,'');

function save(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid settings');
 const current=stored()||{...DEFAULTS};
 const next={...current};
 if('provider' in input){if(!PRESETS[input.provider])throw new TypeError('Unknown provider');next.provider=input.provider;if(!('baseUrl' in input)&&PRESETS[input.provider].baseUrl)next.baseUrl=PRESETS[input.provider].baseUrl}
 if('baseUrl' in input){const b=trimSlash(String(input.baseUrl||'').trim());if(!validBaseUrl(b))throw new TypeError('Адрес API должен начинаться с https:// (или http://127.0.0.1 для локальной модели)');next.baseUrl=b}
 if(typeof input.apiKey==='string'&&input.apiKey.trim()){const k=input.apiKey.trim();if(k.length>1000||/\s/.test(k))throw new TypeError('Некорректный ключ API');next.apiKey=k}
 if(input.clearKey===true)next.apiKey='';
 if('model' in input){const m=String(input.model||'').trim();if(m.length>200)throw new TypeError('Слишком длинное имя модели');next.model=m}
 if('temperature' in input){const t=Number(input.temperature);if(!Number.isFinite(t)||t<0||t>2)throw new TypeError('Температура должна быть от 0 до 2');next.temperature=t}
 if('maxTokens' in input){const n=Number(input.maxTokens);if(!Number.isInteger(n)||n<16||n>32000)throw new TypeError('Длина ответа: от 16 до 32000 токенов');next.maxTokens=n}
 if('embeddingModel' in input){const m=String(input.embeddingModel||'').trim();if(m.length>200)throw new TypeError('Слишком длинное имя модели эмбеддингов');next.embeddingModel=m}
 if('systemPrompt' in input){const s=String(input.systemPrompt||'');if(s.length>4000)throw new TypeError('Характер слишком длинный (до 4000 символов)');next.systemPrompt=s}
 for(const k of ['enabled','useTools'])if(k in input)next[k]=input[k]===true;
 fs.mkdirSync(dataDir(),{recursive:true});
 const tmp=file()+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(next,null,2),{mode:0o600});
 fs.renameSync(tmp,file());
 return view();
}

// Действующая конфигурация для запросов: файл настроек, иначе .env.
function config(){
 const s=stored();
 if(s&&s.enabled&&s.baseUrl&&s.model)return {url:trimSlash(s.baseUrl)+'/chat/completions',key:s.apiKey,model:s.model,temperature:s.temperature,maxTokens:s.maxTokens,useTools:s.useTools,systemPrompt:s.systemPrompt,source:'settings'};
 if(s&&!s.enabled)return null;
 if(process.env.CHAT_URL)return {url:process.env.CHAT_URL,key:process.env.CHAT_API_KEY||'',model:process.env.CHAT_MODEL||'gpt-4o-mini',temperature:undefined,maxTokens:undefined,useTools:true,systemPrompt:'',source:'env'};
 return null;
}

function view(){
 const s=stored(),c=config();
 const base=s||{...DEFAULTS};
 const e=embedConfig();
 return {embeddingModel:base.embeddingModel||'',embeddingActive:Boolean(e),embeddingSource:e?e.source:'none',embeddingHints:EMBEDDING_HINTS,provider:base.provider,baseUrl:base.baseUrl,model:base.model,enabled:base.enabled,useTools:base.useTools,temperature:base.temperature,maxTokens:base.maxTokens,systemPrompt:base.systemPrompt,
  hasKey:Boolean(base.apiKey),keyHint:base.apiKey?'…'+base.apiKey.slice(-4):'',
  active:Boolean(c),source:c?c.source:'none',activeModel:c?c.model:'',
  presets:Object.fromEntries(Object.entries(PRESETS).map(([k,v])=>[k,{label:v.label,baseUrl:v.baseUrl,keyUrl:v.keyUrl||''}]))};
}

function headers(key){return {'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})}}

async function listModels(){
 const s=stored()||{...DEFAULTS};
 if(!s.baseUrl)throw new TypeError('Сначала укажите адрес API');
 const r=await fetch(trimSlash(s.baseUrl)+'/models',{headers:headers(s.apiKey),signal:AbortSignal.timeout(15000)});
 if(r.status===401||r.status===403)throw new TypeError('Ключ не подошёл (HTTP '+r.status+')');
 if(!r.ok)throw new TypeError('Сервис моделей ответил HTTP '+r.status);
 const data=await r.json(),list=Array.isArray(data.data)?data.data:Array.isArray(data)?data:[];
 return list.map(m=>typeof m==='string'?m:m&&m.id).filter(id=>typeof id==='string'&&id).sort((a,b)=>a.localeCompare(b));
}

// Текст ответа: строка или массив частей; размышления <think>…</think> (Qwen3, DeepSeek-R1) отбрасываются.
function messageText(msg){
 const c=msg&&msg.content;
 const raw=typeof c==='string'?c:Array.isArray(c)?c.map(p=>typeof p==='string'?p:p&&typeof p.text==='string'?p.text:'').join(''):'';
 return raw.replace(/<think>[\s\S]*?(<\/think>|$)/gi,'').trim();
}
// Сколько ждать модель: долгий ответ лучше честной ошибки, чем вечные «три точки».
const TIMEOUT_MS=60000;
const staleSocket=e=>e instanceof TypeError&&['ECONNRESET','EPIPE','UND_ERR_SOCKET','UND_ERR_CLOSED'].includes(e.cause?.code);
async function complete({messages,tools}){
 const c=config();if(!c)throw Error('Model not configured');
 const body={model:c.model,messages,...(c.temperature!==undefined?{temperature:c.temperature}:{}),...(c.maxTokens?{max_tokens:c.maxTokens}:{})};
 const once=withTools=>fetch(c.url,{method:'POST',headers:headers(c.key),body:JSON.stringify({...body,...(withTools&&tools?.length?{tools}:{})}),signal:AbortSignal.timeout(TIMEOUT_MS)});
 // Соединение из пула могло закрыться на той стороне, пока простаивало (keep-alive): один повтор на свежем.
 const send=async withTools=>{try{return await once(withTools)}catch(e){if(!staleSocket(e))throw e;return once(withTools)}};
 const useTools=c.useTools&&tools?.length;
 let r=await send(useTools);
 // Не все модели поддерживают инструменты: при ошибке запроса повторяем без них.
 if(useTools&&[400,404,422,500].includes(r.status))r=await send(false);
 if(!r.ok)throw Error('Chat API HTTP '+r.status);
 const data=await r.json(),choice=data.choices?.[0],msg=choice?.message;
 if(!msg)throw Error('Empty chat reply');
 const text=messageText(msg);
 if(!text&&!(Array.isArray(msg.tool_calls)&&msg.tool_calls.length)){const e=Error(choice.finish_reason==='length'?'Reply cut by token limit':'Empty chat reply');e.code=choice.finish_reason==='length'?'LENGTH':'EMPTY';throw e}
 return {...msg,content:text};
}

// Эмбеддинги для поиска по смыслу: модель из «Модель ИИ» (тот же адрес и ключ), иначе EMBEDDING_URL из .env.
function embedConfig(){
 const s=stored();
 if(s&&s.embeddingModel&&s.baseUrl)return {url:trimSlash(s.baseUrl)+'/embeddings',key:s.apiKey,model:s.embeddingModel,source:'settings'};
 if(process.env.EMBEDDING_URL)return {url:process.env.EMBEDDING_URL,key:process.env.EMBEDDING_API_KEY||'',model:process.env.EMBEDDING_MODEL||'text-embedding-3-small',source:'env'};
 return null;
}
// Строка → вектор, массив строк → массив векторов (в том же порядке). Без настройки — null.
async function embed(input,{timeoutMs=15000}={}){
 const c=embedConfig();if(!c)return null;
 const many=Array.isArray(input),list=(many?input:[input]).map(t=>String(t||'').slice(0,4000));
 if(!list.length)return many?[]:null;
 const r=await fetch(c.url,{method:'POST',headers:headers(c.key),body:JSON.stringify({model:c.model,input:many?list:list[0]}),signal:AbortSignal.timeout(timeoutMs)});
 if(!r.ok)throw Error('Embedding API HTTP '+r.status);
 const data=await r.json(),rows=Array.isArray(data.data)?[...data.data].sort((a,b)=>(a.index??0)-(b.index??0)):[];
 const out=rows.map(x=>x&&x.embedding);
 if(out.length!==list.length||!out.every(v=>Array.isArray(v)&&v.length&&v.every(Number.isFinite)))throw Error('Invalid embedding vector');
 return many?out:out[0];
}
async function embedTest(){
 const c=embedConfig();if(!c)throw new TypeError('Модель эмбеддингов не выбрана');
 const started=Date.now();
 let v;try{v=await embed('проверка связи')}catch(e){throw new TypeError(/HTTP 40[13]/.test(e.message)?'Ключ не подошёл для эмбеддингов':/HTTP 404/.test(e.message)?'Модель эмбеддингов не найдена (HTTP 404)':'Эмбеддинги не ответили: '+e.message)}
 return {ok:true,model:c.model,dim:v.length,ms:Date.now()-started};
}
async function test(){
 const c=config();if(!c)throw new TypeError('Модель не выбрана или выключена');
 const started=Date.now();
 const msg=await complete({messages:[{role:'user',content:'Ответь одним коротким предложением по-русски: ты на связи?'}]});
 return {ok:true,model:c.model,ms:Date.now()-started,reply:String(msg.content||'').slice(0,300)};
}

module.exports={PRESETS,save,view,config,listModels,complete,test,messageText,embedConfig,embed,embedTest};
