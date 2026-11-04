'use strict';
// 10. Свои инструменты: Юрика сама придумывает себе маленькие инструменты — формулу с параметрами
// и шаблон ответа («Скидка {skidka}% от {cena} — это {result}»). Формула считается своим разбором
// выражений, без eval: только числа, параметры, + − × ÷ % ^, скобки и несколько функций.
const {state,setState}=require('./brain-db');
const {looksLikeCommand}=require('./safety');
const MAX_TOOLS=30,MAX_FORMULA=300;
const FUNCS={round:(x,d=0)=>{const k=10**Math.max(0,Math.min(10,Math.trunc(d)));return Math.round(x*k)/k},floor:Math.floor,ceil:Math.ceil,abs:Math.abs,min:Math.min,max:Math.max,sqrt:Math.sqrt,pow:Math.pow,log:Math.log10,ln:Math.log,exp:Math.exp};
const CONSTS={pi:Math.PI,e:Math.E};
const NAME=/^[a-zа-яё_][a-zа-яё0-9_]{0,31}$/i;
function tokenize(src){
 const out=[],s=String(src);let i=0;
 while(i<s.length){
  const c=s[i];
  if(/\s/.test(c)){i++;continue}
  const num=s.slice(i).match(/^\d+(?:[.,]\d+)?/);if(num){out.push({t:'n',v:Number(num[0].replace(',','.'))});i+=num[0].length;continue}
  const id=s.slice(i).match(/^[a-zа-яё_][a-zа-яё0-9_]*/i);if(id){out.push({t:'id',v:id[0].toLocaleLowerCase()});i+=id[0].length;continue}
  if('+-*/%^(),'.includes(c)){out.push({t:c});i++;continue}
  if(c==='×'){out.push({t:'*'});i++;continue}if(c==='÷'){out.push({t:'/'});i++;continue}
  throw new TypeError('В формуле непонятный знак «'+c+'»');
 }
 return out;
}
// Разбор с приоритетами: сложение < умножение < степень < унарный минус < вызов/скобки.
function parse(src){
 const tk=tokenize(src);let p=0;
 const peek=()=>tk[p],eat=t=>{if(tk[p]?.t!==t)throw new TypeError('В формуле ошибка возле '+(tk[p]?'«'+(tk[p].v??tk[p].t)+'»':'конца'));return tk[p++]};
 function add(){let l=mul();while(peek()&&'+-'.includes(peek().t)){const o=tk[p++].t;l={o,a:l,b:mul()}}return l}
 function mul(){let l=pow();while(peek()&&'*/%'.includes(peek().t)){const o=tk[p++].t;l={o,a:l,b:pow()}}return l}
 function pow(){const l=un();if(peek()?.t==='^'){p++;return {o:'^',a:l,b:pow()}}return l}
 function un(){if(peek()?.t==='-'){p++;return {o:'neg',a:un()}}if(peek()?.t==='+'){p++;return un()}return atom()}
 function atom(){
  const x=peek();if(!x)throw new TypeError('Формула оборвалась');
  if(x.t==='n'){p++;return {n:x.v}}
  if(x.t==='('){p++;const e=add();eat(')');return e}
  if(x.t==='id'){p++;
   if(peek()?.t==='('){if(!FUNCS[x.v])throw new TypeError('Нет такой функции «'+x.v+'»');p++;const args=[];if(peek()?.t!==')'){args.push(add());while(peek()?.t===','){p++;args.push(add())}}eat(')');return {f:x.v,args}}
   return {v:x.v}}
  throw new TypeError('В формуле ошибка возле «'+x.t+'»');
 }
 const e=add();if(p<tk.length)throw new TypeError('Лишнее в формуле возле «'+(tk[p].v??tk[p].t)+'»');
 return e;
}
function evaluate(node,vars){
 if('n' in node)return node.n;
 if('v' in node){if(node.v in vars)return vars[node.v];if(node.v in CONSTS)return CONSTS[node.v];throw new TypeError('Не задан параметр «'+node.v+'»')}
 if(node.f)return FUNCS[node.f](...node.args.map(a=>evaluate(a,vars)));
 const a=evaluate(node.a,vars);if(node.o==='neg')return -a;
 const b=evaluate(node.b,vars);
 switch(node.o){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':if(b===0)throw new TypeError('Делить на ноль нельзя');return a/b;case '%':return a%b;case '^':return a**b}
 throw new TypeError('Неизвестная операция');
}
function names(node,out=new Set()){if('v' in node)out.add(node.v);if(node.args)for(const a of node.args)names(a,out);if(node.a)names(node.a,out);if(node.b)names(node.b,out);return out}
function calc(formula,vars={}){const r=evaluate(parse(formula),vars);if(!Number.isFinite(r))throw new TypeError('Получилось не число');return Math.round(r*1e10)/1e10}

function list(){const l=state('self.tools',[]);return Array.isArray(l)?l:[]}
function get(name){const n=String(name||'').trim().toLocaleLowerCase();return list().find(t=>t.name===n)||null}
function make({name,title,description,params,formula,template}={}){
 const n=String(name||'').trim().toLocaleLowerCase();
 if(!NAME.test(n))throw new TypeError('Имя инструмента — одно слово латиницей или кириллицей, без пробелов');
 const f=String(formula||'').trim();if(!f||f.length>MAX_FORMULA)throw new TypeError('Нужна формула до '+MAX_FORMULA+' символов');
 const ps=(Array.isArray(params)?params:String(params||'').split(/[,\s]+/)).map(x=>String(x).trim().toLocaleLowerCase()).filter(Boolean);
 if(ps.length>8||ps.some(x=>!NAME.test(x)||FUNCS[x]||CONSTS[x]))throw new TypeError('Параметры — до 8 слов без пробелов');
 const tree=parse(f),used=[...names(tree)].filter(x=>!(x in CONSTS));
 const missing=used.filter(x=>!ps.includes(x));if(missing.length)throw new TypeError('В формуле есть неизвестные параметры: '+missing.join(', '));
 calc(f,Object.fromEntries(ps.map(x=>[x,1.5]))); // пробный счёт
 const text=[title,description,template].map(x=>String(x||'').trim());
 if(text.some(looksLikeCommand))throw new TypeError('Похоже на команду — такой инструмент не делаю.');
 const tool={name:n,title:text[0].slice(0,60)||n,description:text[1].slice(0,200),params:ps,formula:f,template:text[2].slice(0,300),uses:0,at:new Date().toISOString()};
 const rest=list().filter(t=>t.name!==n);if(rest.length>=MAX_TOOLS)throw new TypeError('У меня уже '+MAX_TOOLS+' своих инструментов');
 setState('self.tools',[tool,...rest]);
 try{require('./thoughts').add('self','Сделала себе инструмент «'+tool.title+'»: '+f)}catch{}
 return tool;
}
function run(name,args={}){
 const t=get(name);if(!t)throw new TypeError('У меня нет инструмента «'+name+'»');
 const vars={};for(const p of t.params){const raw=args?.[p];const v=typeof raw==='number'?raw:Number(String(raw??'').replace(',','.').replace(/\s/g,''));if(raw===undefined||raw===''||!Number.isFinite(v))throw new TypeError('Нужно число для «'+p+'»');vars[p]=v}
 const result=calc(t.formula,vars);
 setState('self.tools',list().map(x=>x.name===t.name?{...x,uses:(x.uses||0)+1}:x));
 const fmt=v=>Number.isInteger(v)?String(v):String(Math.round(v*100)/100);
 const text=t.template?t.template.replace(/\{([\p{L}\p{N}_]+)\}/gu,(m,k)=>{const key=k.toLocaleLowerCase();return key==='result'?fmt(result):key in vars?fmt(vars[key]):m}):t.title+': '+fmt(result);
 return {result,text};
}
function remove(name){const l=list(),n=l.filter(t=>t.name!==String(name||'').toLocaleLowerCase());setState('self.tools',n);return n.length<l.length}
function promptText(){const l=list();return l.length?'\nТвои собственные инструменты (ты сделала их сама, вызывай через use_my_tool): '+l.slice(0,15).map(t=>t.name+'('+t.params.join(', ')+') — '+(t.description||t.title)).join('; ')+'.':''}
module.exports={calc,parse,make,run,list,get,remove,promptText};
