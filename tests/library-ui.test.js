'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.style={};this.className='';this.hidden=false;this.value='';this.files=[];this.classList={toggle:(name,on)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));if(on)s.add(name);else s.delete(name);this.className=[...s].join(' ')}}}
 setAttribute(k,v){this.attrs[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(v)}
 append(...items){for(const child of items){if(typeof child==='string'){this.children.push(child);continue}if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(x=>x!==child);child.parentElement=this;this.children.push(child)}}
 replaceChildren(...items){this.children=[];this.append(...items)}
 insertBefore(child,before){const index=this.children.indexOf(before);child.parentElement=this;this.children.splice(index<0?this.children.length:index,0,child)}
 querySelectorAll(selector){const result=[];function walk(node){for(const x of node.children||[]){if(typeof x==='string')continue;const hit=selector==='button'?x.tagName==='BUTTON':selector==='[data-library-tab]'?'libraryTab'in x.dataset:false;if(hit)result.push(x);walk(x)}}walk(this);return result}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}addEventListener(){}focus(){}remove(){}
}
test('library tabs hide other sections and file actions open the document view',async()=>{
 const root=new Element('section'),status=new Element('span'),document={hidden:false,body:new Element('body'),activeElement:null,querySelector(s){return s==='#content'?root:s==='#status'?status:null},querySelectorAll(){return []},createElement(tag){return new Element(tag)},createElementNS(_ns,tag){return new Element(tag)},addEventListener(){}};
 const storage={getItem(){return null},setItem(){}};const window={dispatchEvent(){},scrollTo(){},localStorage:storage};
 const fetch=async url=>({ok:true,json:async()=>{if(url==='/api/workspace')return {notes:[],tasks:[]};if(url.startsWith('/api/library/list'))return {items:[{name:'тест.txt',path:'тест.txt',type:'file',size:10,modified:'2026-01-01T00:00:00.000Z'}]};if(url.startsWith('/api/library/document'))return {path:'тест.txt',lineCount:1,bytes:10,excerpt:['Пример']};if(url.startsWith('/api/library/summary'))return {summary:['Пример документа']};if(url==='/api/library/queue')return {enabled:true,counts:{queued:0,ready:0,error:0},items:[]};return {items:[]}}});
 const context={document,window,localStorage:storage,fetch,CustomEvent:class{},setInterval(){},setTimeout(){},console,Notification:undefined};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8'),context);
 await new Promise(setImmediate);window.TenmaApp.go('library');await new Promise(setImmediate);
 const sections=root.querySelectorAll('[data-library-tab]');assert.ok(sections.length>=10);assert.ok(sections.filter(x=>x.dataset.libraryTab==='files').every(x=>!x.hidden));assert.ok(sections.filter(x=>x.dataset.libraryTab==='knowledge').every(x=>x.hidden));
 const buttons=root.querySelectorAll('button'),card=buttons.find(x=>x.textContent==='Карточка');assert.ok(card);await card.onclick();assert.ok(sections.filter(x=>x.dataset.libraryTab==='search').every(x=>!x.hidden));assert.ok(sections.filter(x=>x.dataset.libraryTab==='files').every(x=>x.hidden));
 const knowledge=buttons.find(x=>x.dataset.libraryChoice==='knowledge');knowledge.onclick();assert.ok(sections.filter(x=>x.dataset.libraryTab==='knowledge').every(x=>!x.hidden));
});
