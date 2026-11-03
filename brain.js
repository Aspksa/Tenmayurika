'use strict';
/* «Мозг» Тэнмаюрики — живая карта памяти в стиле роя частиц.
   Ядро — плотная медно-огненная туманность с горячими пятнами; из него вырастают кластеры-зоны
   (дела, заметки, факты по субъектам, противоречия), вокруг крупных зон — спутники.
   Между ядром и зонами — пучки нитей со штрихами. Каждая запись — нейрон в своей зоне;
   новая запись прилетает импульсом из ядра и вспыхивает. Противоречия — «сбой узла»: серый узел,
   красная подпись, красный график. HUD как у роя: 01 журнал, 02 активность, 03 структура (веер).
   Только canvas 2D, без библиотек. Монтируется в раздел «Мозг»: window.TenmaBrain.mount(element). */
(()=>{
const TAU=Math.PI*2;
const SEEN_KEY='tenma.brain.seen.v1',CFG_KEY='tenma.brain.cfg.v1';
const reduceQuery=matchMedia('(prefers-reduced-motion: reduce)');
const wideQuery=matchMedia('(min-width: 900px)');
const read=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch{return d}};
const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){let a=seed>>>0||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=t=>1-Math.pow(1-clamp(t,0,1),3);
const rgba=(c,a)=>'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';
const MONO='ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';

// Палитры роя. tones — три слоя частиц: тёмные угли, основной цвет, раскалённые искры.
// Медь — как в ролике; лёд и неон — на выбор. Противоречия в любой палитре серые с красным.
const PALETTES={
 copper:{name:'Медь',haze:[150,62,22],tones:[[150,70,30],[226,128,60],[255,214,160]],colors:{personal:[236,140,66],work:[240,118,52],notes:[246,170,96],facts:[232,132,60],done:[150,110,80],core:[236,136,62]},
  spike:[236,140,70],link:[240,150,80],star:[220,120,60],starDot:[255,170,100],glow:['rgba(255,248,230,1)','rgba(255,196,120,.85)','rgba(230,110,40,.2)'],cold:['rgba(170,70,40,.9)','rgba(110,40,20,.6)','rgba(60,20,10,.15)'],accent:'#ee8a3c',hot:'#ffcf9a'},
 ice:{name:'Лёд',haze:[24,64,128],tones:[[36,84,150],[104,176,240],[222,242,255]],colors:{personal:[110,190,255],work:[84,156,255],notes:[150,215,255],facts:[100,180,250],done:[90,110,140],core:[120,190,255]},
  spike:[120,190,250],link:[140,200,255],star:[90,150,230],starDot:[160,210,255],glow:['rgba(240,250,255,1)','rgba(150,210,255,.85)','rgba(40,110,220,.2)'],cold:['rgba(40,80,140,.9)','rgba(20,50,100,.6)','rgba(10,20,50,.15)'],accent:'#6fc3ff',hot:'#cfeaff'},
 neon:{name:'Неон',haze:[88,18,120],tones:[[110,30,160],[236,64,206],[130,255,240]],colors:{personal:[255,70,200],work:[180,90,255],notes:[80,240,230],facts:[255,96,176],done:[120,90,140],core:[230,70,210]},
  spike:[240,80,220],link:[120,240,255],star:[170,80,255],starDot:[120,240,255],glow:['rgba(255,240,255,1)','rgba(255,120,230,.85)','rgba(140,40,220,.2)'],cold:['rgba(100,40,140,.9)','rgba(60,20,90,.6)','rgba(30,10,50,.15)'],accent:'#ff4fd8',hot:'#9ffcff'}
};
const PALE={haze:[95,95,100],tones:[[120,120,128],[200,200,208],[245,245,250]]};
let PAL=PALETTES.copper,EMBER,COLORS;
function usePalette(id){PAL=PALETTES[id]||PALETTES.copper;EMBER={haze:PAL.haze,tones:PAL.tones};COLORS={...PAL.colors,conflicts:[255,72,56]}}
usePalette('copper');
const DAY=86400000;

/* ---------- Частицы: объёмный шар + горячие пятна + завихрения ---------- */
function unit(r){const z=2*r()-1,t=TAU*r(),q=Math.sqrt(1-z*z);return [q*Math.cos(t),z,q*Math.sin(t)]}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function norm(a){const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l]}
function gauss(r){return (r()+r()+r()+r()-2)/2}
function makeParticles(n,seed,mult=1){
 n=Math.round(n*mult);
 const r=rng(seed);
 const spots=Array.from({length:3+Math.floor(r()*3)},()=>{const d=unit(r),k=.15+.45*r();return {c:d.map(x=>x*k),s:.12+.16*r()}});
 const bands=[0,1].map(()=>{const a=unit(r),u=norm(cross(a,Math.abs(a[1])<.9?[0,1,0]:[1,0,0]));return {u,v:cross(a,u)}});
 const out=[];
 for(let i=0;i<n;i++){
  const kind=r();let p,tone,b;
  if(kind<.24){const S=spots[i%spots.length];p=S.c.map(c=>c+gauss(r)*S.s);tone=r()<.55?2:1;b=.55+.45*r()}
  else if(kind<.36){const B=bands[i%2],f=TAU*r(),k=.4+.45*r();p=[0,1,2].map(d=>(B.u[d]*Math.cos(f)+B.v[d]*Math.sin(f))*k+gauss(r)*.07);tone=r()<.4?2:1;b=.4+.5*r()}
  else{const d=unit(r),k=Math.cbrt(r())*(.78+.32*r());p=d.map(x=>x*k);tone=r()<.55?0:1;b=.25+.55*r()}
  out.push({x:p[0],y:p[1],z:p[2],t:tone,s:r()<.06?2:1,b,f:.6+2*r(),ph:TAU*r()});
 }
 // Перемешано: при низком качестве рисуется только начало массива — распределение не ломается.
 for(let i=out.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[out[i],out[j]]=[out[j],out[i]]}
 // На видеокарте частиц в mult раз больше: каждая тусклее и мельче, общая яркость та же.
 out.dens=mult>1?Math.pow(mult,-.82):1;out.size=mult>1?.82:1;
 return out;
}

/* ---------- WebGL: десятки тысяч частиц и свечение (bloom) ---------- */
// Частицы облаков рисует видеокарта: буфер на облако загружается один раз, поворот и мерцание — в шейдере.
// Затем сцена размывается на ½ и ⅛ размера и подмешивается обратно — получается мягкий ореол, как в ролике.
// Нет WebGL — мозг остаётся на canvas 2D, как раньше.
function makeGL(cv){
 let gl=null;try{gl=cv.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,powerPreference:'high-performance'})}catch{gl=null}
 if(!gl)return null;
 const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)||'shader');return s};
 const prog=(vs,fs,attrs)=>{const p=gl.createProgram();gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));attrs.forEach((a,i)=>gl.bindAttribLocation(p,i,a));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)||'link');
  const u={},n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);for(let i=0;i<n;i++){const a=gl.getActiveUniform(p,i);u[a.name.replace(/\[0\]$/,'')]=gl.getUniformLocation(p,a.name)}return {p,u}};
 let P,Q,B,C;
 try{
  P=prog(`attribute vec4 a0;attribute vec4 a1;
uniform vec2 uRes,uC;uniform float uR,uRot,uTilt,uT,uTw,uInten,uPs,uBlur;uniform vec3 uTone0,uTone1,uTone2,uL;
varying vec4 vC;varying float vS;
void main(){
 float ca=cos(uRot),sa=sin(uRot),ct=cos(uTilt),st=sin(uTilt);
 float x1=a0.x*ca+a0.z*sa,z1=-a0.x*sa+a0.z*ca,y1=a0.y*ct-z1*st,z2=a0.y*st+z1*ct;
 float d=(z2+1.3)/2.6,tone=a1.x;
 float a=a1.z*d*uInten*(tone<.5?.75:1.)*(uTw>.5?.75+.25*sin(uT*a1.w+a0.w):1.);
 // Свет от ядра: сторона зоны, обращённая к ядру, ярче; дальняя — в тени.
 vec2 q=vec2(x1,y1);float lq=length(q);a*=1.+uL.z*((lq>.001?dot(q/lq,uL.xy):0.)*min(lq*1.6,1.)*.75-.15);
 vec2 p=uC+vec2(x1,y1)*uR;
 gl_Position=vec4(p.x/uRes.x*2.-1.,1.-p.y/uRes.y*2.,0.,1.);
 float s=a1.y*uPs*(.6+.6*d)*(tone>1.5?1.15:1.),bl=uBlur*(.55+.45*d);
 gl_PointSize=max(1.,s+bl);
 a*=(s*s)/((s+bl)*(s+bl));
 vec3 c=tone<.5?uTone0:tone<1.5?uTone1:uTone2;
 vC=vec4(c/255.,clamp(a,0.,1.));vS=bl>.6?0.:.55;
}`,`precision mediump float;varying vec4 vC;varying float vS;
void main(){float r=length(gl_PointCoord-.5)*2.;float k=1.-smoothstep(vS,1.,r);if(k<=0.)discard;gl_FragColor=vec4(vC.rgb*vC.a*k,1.);}`,['a0','a1']);
  const VQ='attribute vec2 aq;varying vec2 v;void main(){v=aq*.5+.5;gl_Position=vec4(aq,0.,1.);}';
  Q=prog(VQ,`precision mediump float;uniform sampler2D t;uniform vec2 px;uniform float th,k;varying vec2 v;
void main(){vec3 c=(texture2D(t,v+px*vec2(-1.,-1.)).rgb+texture2D(t,v+px*vec2(1.,-1.)).rgb+texture2D(t,v+px*vec2(-1.,1.)).rgb+texture2D(t,v+px).rgb)*.25;gl_FragColor=vec4(max(c-th,0.)*k,1.);}`,['aq']);
  B=prog(VQ,`precision mediump float;uniform sampler2D t;uniform vec2 dir;varying vec2 v;
void main(){vec3 c=texture2D(t,v).rgb*.2270;c+=(texture2D(t,v+dir*1.3846).rgb+texture2D(t,v-dir*1.3846).rgb)*.3162;c+=(texture2D(t,v+dir*3.2308).rgb+texture2D(t,v-dir*3.2308).rgb)*.0703;gl_FragColor=vec4(c,1.);}`,['aq']);
  // Сведение: сцена + два уровня свечения; к краям каналы R и B расходятся (хроматическая аберрация).
  // HDR: сцена копится в half-float без потолка 1.0, а здесь мягко сжимается (тон-маппинг) —
  // самые яркие точки остаются оттенками, а не белыми пятнами. Затем FXAA сглаживает края нитей.
  C=prog(VQ,`precision highp float;uniform sampler2D s,b1,b2;uniform float k1,k2,ab,hdr;uniform vec2 px;varying vec2 v;
vec3 at(vec2 p){vec3 c=texture2D(s,p).rgb+texture2D(b1,p).rgb*k1+texture2D(b2,p).rgb*k2;return hdr>.5?1.-exp(-c*1.5):min(c,1.);}
float lu(vec3 c){return dot(c,vec3(.299,.587,.114));}
vec3 fxaa(vec2 p){vec3 m=at(p),nw=at(p+px*vec2(-1.,-1.)),ne=at(p+px*vec2(1.,-1.)),sw=at(p+px*vec2(-1.,1.)),se=at(p+px);
 float lM=lu(m),lNW=lu(nw),lNE=lu(ne),lSW=lu(sw),lSE=lu(se),mn=min(lM,min(min(lNW,lNE),min(lSW,lSE))),mx=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
 if(mx-mn<max(.03,mx*.125))return m;
 vec2 dir=vec2(-((lNW+lNE)-(lSW+lSE)),(lNW+lSW)-(lNE+lSE));float r=1./(min(abs(dir.x),abs(dir.y))+max((lNW+lNE+lSW+lSE)*.03125,.0078));
 dir=clamp(dir*r,-8.,8.)*px;vec3 a=.5*(at(p-dir/6.)+at(p+dir/6.)),b=a*.5+.25*(at(p-dir*.5)+at(p+dir*.5));float lb=lu(b);return lb<mn||lb>mx?a:b;}
void main(){vec2 d=v-.5;vec2 o=d*dot(d,d)*ab;float k=clamp(length(d)*2.5,0.,1.);vec3 f=fxaa(v);
 gl_FragColor=vec4(mix(f.r,at(v+o).r,k),f.g,mix(f.b,at(v-o).b,k),1.);}`,['aq']);
 }catch(e){console.warn('Мозг: WebGL недоступен, рисую в 2D:',e.message);return null}
 // HDR, если видеокарта умеет рисовать в half-float с линейной фильтрацией.
 const hf=gl.getExtension('OES_texture_half_float'),hfl=gl.getExtension('OES_texture_half_float_linear');gl.getExtension('EXT_color_buffer_half_float');
 let texType=hf&&hfl?hf.HALF_FLOAT_OES:gl.UNSIGNED_BYTE;
 const tri=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,tri);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const targets={};let w=1,h=1;
 function target(name,tw,th){
  let t=targets[name];if(t&&t.w===tw&&t.h===th)return t;
  if(t){gl.deleteTexture(t.tex);gl.deleteFramebuffer(t.fb)}
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,tw,th,0,gl.RGBA,texType,null);
  for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
  if(texType!==gl.UNSIGNED_BYTE&&gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.deleteTexture(tex);gl.deleteFramebuffer(fb);texType=gl.UNSIGNED_BYTE;for(const k in targets){gl.deleteTexture(targets[k].tex);gl.deleteFramebuffer(targets[k].fb);delete targets[k]}return target(name,tw,th)}
  t=targets[name]={tex,fb,w:tw,h:th};return t;
 }
 function bindT(t){gl.bindFramebuffer(gl.FRAMEBUFFER,t?t.fb:null);gl.viewport(0,0,t?t.w:w,t?t.h:h)}
 function quad(pr,tex){gl.useProgram(pr.p);gl.bindBuffer(gl.ARRAY_BUFFER,tri);gl.enableVertexAttribArray(0);gl.disableVertexAttribArray(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  tex.forEach((t,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t.tex)});gl.drawArrays(gl.TRIANGLES,0,3)}
 const bufs=new Set();
 function upload(parts){
  if(parts._gl)return parts._gl;
  const a=new Float32Array(parts.length*8);
  parts.forEach((p,i)=>a.set([p.x,p.y,p.z,p.ph,p.t,p.s,p.b,p.f],i*8));
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,a,gl.STATIC_DRAW);parts._gl=b;bufs.add(b);return b;
 }
 return {
  gl,
  resize(cw,ch){w=cw;h=ch;cv.width=cw;cv.height=ch},
  free(parts){if(parts&&parts._gl){gl.deleteBuffer(parts._gl);bufs.delete(parts._gl);parts._gl=null}},
  begin(){const s=target('scene',w,h);bindT(s);gl.disable(gl.BLEND);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
   gl.useProgram(P.p);gl.uniform2f(P.u.uRes,w,h)},
  hdr:()=>texType!==gl.UNSIGNED_BYTE,
  cloud(parts,x,y,r,rot,tilt,tones,inten,count,blur,ps,tw,t,light){
   const n=Math.min(parts.length,count|0);if(n<1||inten<=0)return;
   // Меньше частиц (адаптивное качество) — каждая ярче, чтобы общая яркость не падала.
   inten*=Math.min(3,Math.pow(parts.length/n,.8));
   gl.useProgram(P.p);gl.bindBuffer(gl.ARRAY_BUFFER,upload(parts));
   gl.enableVertexAttribArray(0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(0,4,gl.FLOAT,false,32,0);gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,16);
   const u=P.u;gl.uniform2f(u.uC,x,y);gl.uniform1f(u.uR,r);gl.uniform1f(u.uRot,rot);gl.uniform1f(u.uTilt,tilt);gl.uniform1f(u.uT,t);gl.uniform1f(u.uTw,tw);
   gl.uniform1f(u.uInten,inten*(parts.dens||1));gl.uniform1f(u.uPs,ps*(parts.size||1));gl.uniform1f(u.uBlur,blur);
   gl.uniform3fv(u.uTone0,tones[0]);gl.uniform3fv(u.uTone1,tones[1]);gl.uniform3fv(u.uTone2,tones[2]);gl.uniform3fv(u.uL,light||[0,0,0]);
   gl.drawArrays(gl.POINTS,0,n);
  },
  end(bloom){
   gl.disable(gl.BLEND);
   const s=targets.scene,h1w=Math.max(1,w>>2),h1h=Math.max(1,h>>2),h2w=Math.max(1,w>>3),h2h=Math.max(1,h>>3);
   const a1=target('a1',h1w,h1h),b1=target('b1',h1w,h1h),a2=target('a2',h2w,h2h),b2=target('b2',h2w,h2h);
   if(bloom>0){
    bindT(a1);gl.useProgram(Q.p);gl.uniform1i(Q.u.t,0);gl.uniform2f(Q.u.px,1/w,1/h);gl.uniform1f(Q.u.th,texType!==gl.UNSIGNED_BYTE?.2:.12);gl.uniform1f(Q.u.k,texType!==gl.UNSIGNED_BYTE?1.1:1.5);quad(Q,[s]);
    gl.useProgram(B.p);gl.uniform1i(B.u.t,0);
    bindT(b1);gl.uniform2f(B.u.dir,1/h1w,0);quad(B,[a1]);bindT(a1);gl.uniform2f(B.u.dir,0,1/h1h);quad(B,[b1]);
    bindT(a2);gl.useProgram(Q.p);gl.uniform2f(Q.u.px,.5/h1w,.5/h1h);gl.uniform1f(Q.u.th,0);gl.uniform1f(Q.u.k,1);quad(Q,[a1]);
    gl.useProgram(B.p);for(let i=0;i<2;i++){bindT(b2);gl.uniform2f(B.u.dir,1/h2w,0);quad(B,[a2]);bindT(a2);gl.uniform2f(B.u.dir,0,1/h2h);quad(B,[b2])}
   }
   bindT(null);gl.useProgram(C.p);gl.uniform1i(C.u.s,0);gl.uniform1i(C.u.b1,1);gl.uniform1i(C.u.b2,2);gl.uniform1f(C.u.k1,.9*bloom);gl.uniform1f(C.u.k2,1.1*bloom);gl.uniform1f(C.u.ab,.028);gl.uniform1f(C.u.hdr,texType!==gl.UNSIGNED_BYTE?1:0);gl.uniform2f(C.u.px,1/w,1/h);quad(C,[s,a1,a2]);
  },
  destroy(){for(const b of bufs)gl.deleteBuffer(b);bufs.clear();for(const k in targets){gl.deleteTexture(targets[k].tex);gl.deleteFramebuffer(targets[k].fb);delete targets[k]}}
 };
}

/* ---------- Данные: workspace + факты → зоны и нейроны ---------- */
function ts(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c}
function buildModel(ws,facts,conflicts){
 const app=()=>window.TenmaApp;
 const lobes=[],events=[];
 const add=(id,label,sub,color,items,open)=>{if(items.length)lobes.push({id,label,sub,color,items,open})};
 const today=new Date();today.setHours(0,0,0,0);const t0=today.getTime();
 const taskItem=t=>({id:'t:'+t.id,title:t.title,meta:(t.done?'выполнено':t.due?'срок '+t.due+(t.time?' '+t.time:''):'без срока')+(t.priority==='high'?' · важное':''),ts:ts(t.createdAt),hot:!t.done&&t.due&&ts(t.due+'T00:00:00')<=t0,dim:!!t.done,weight:t.priority==='high'?1.5:1,open:()=>app()?.select?app().select('task',t.id):app()?.go('planner')});
 const tasks=ws.tasks||[],notes=ws.notes||[];
 const taskSub=list=>{const open=list.filter(t=>!t.done),hot=open.filter(t=>t.due&&ts(t.due+'T00:00:00')<=t0).length;return open.length+' открыто'+(hot?' · '+hot+' сегодня':'')};
 const personal=tasks.filter(t=>t.category!=='work'),work=tasks.filter(t=>t.category==='work');
 add('personal','личные дела',taskSub(personal),COLORS.personal,personal.map(taskItem),()=>app()?.go('tasks'));
 add('work','рабочие дела',taskSub(work),COLORS.work,work.map(taskItem),()=>app()?.go('tasks'));
 const pinned=notes.filter(n=>n.pinned).length;
 add('notes','заметки',notes.length+' '+plural(notes.length,'заметка','заметки','заметок')+(pinned?' · '+pinned+' закреп.':''),COLORS.notes,notes.map(n=>({id:'n:'+n.id,title:n.title,meta:(n.category==='work'?'рабочая':'личная')+' заметка'+(n.pinned?' · закреплена':''),ts:ts(n.createdAt),weight:n.pinned?1.4:1,open:()=>app()?.select?app().select('note',n.id):app()?.go('notes')})),()=>app()?.go('notes'));
 // Факты: крупные субъекты получают свою зону, остальные — общая зона «факты».
 const bySubject=new Map();for(const f of facts){const k=f.subject.toLocaleLowerCase();if(!bySubject.has(k))bySubject.set(k,{name:f.subject,list:[]});bySubject.get(k).list.push(f)}
 const subjects=[...bySubject.values()].sort((a,b)=>b.list.length-a.list.length);
 const big=subjects.filter(s=>s.list.length>=2).slice(0,6),rest=subjects.filter(s=>!big.includes(s)).flatMap(s=>s.list);
 const factItem=f=>({id:'f:'+f.id,title:f.subject+' — '+f.predicate+' → '+f.object,meta:'факт · '+(f.source_id||'')+' · уверенность '+f.confidence,ts:ts(f.observed_at),weight:.6+.6*(+f.confidence||0),fact:f,open:()=>app()?.go('facts')});
 const factSub=list=>[...new Set(list.map(f=>f.predicate))].slice(0,2).join(' · ');
 for(const s of big)add('fs:'+s.name.toLocaleLowerCase(),s.name.toLocaleLowerCase(),factSub(s.list),COLORS.facts,s.list.map(factItem),()=>app()?.go('facts'));
 add('facts','факты',rest.length+' '+plural(rest.length,'факт','факта','фактов'),COLORS.facts,rest.map(factItem),()=>app()?.go('facts'));
 add('conflicts','противоречия','сбой · '+conflicts.length,COLORS.conflicts,conflicts.map(c=>({id:'c:'+c.id,title:c.subject+' — '+c.predicate+': «'+c.earlier+'» или «'+c.newer+'»',meta:'противоречие',ts:ts(c.detected_at),weight:1.3,open:()=>app()?.go('facts')})),()=>app()?.go('facts'));
 // Журнал: что мозг узнал и когда.
 for(const t of tasks){events.push({t:ts(t.createdAt),kind:t.category==='work'?'работа':'дело',color:t.category==='work'?COLORS.work:COLORS.personal,text:t.title});if(t.doneAt)events.push({t:ts(t.doneAt),kind:'готово',color:COLORS.done,text:t.title})}
 for(const n of notes)events.push({t:ts(n.createdAt),kind:'заметка',color:COLORS.notes,text:n.title});
 for(const f of facts)events.push({t:ts(f.observed_at),kind:'факт',color:COLORS.facts,text:f.subject+' '+f.predicate+' '+f.object});
 for(const c of conflicts)events.push({t:ts(c.detected_at),kind:'сбой',color:COLORS.conflicts,text:c.subject+': '+c.earlier+' / '+c.newer,bad:true});
 events.sort((a,b)=>b.t-a.t);
 // Связи между фактами: объект одного факта — субъект другого.
 const firstOf=new Map();for(const l of lobes)for(const it of l.items)if(it.fact){const k=it.fact.subject.toLocaleLowerCase();if(!firstOf.has(k))firstOf.set(k,it.id)}
 const links=[];for(const l of lobes)for(const it of l.items)if(it.fact){const to=firstOf.get(it.fact.object.toLocaleLowerCase());if(to&&to!==it.id&&links.length<240)links.push([it.id,to,'subj'])}
 // …и общий объект у разных субъектов: «Анна живёт в Казань» — «Пётр работает в Казань».
 const byObject=new Map();for(const l of lobes)for(const it of l.items)if(it.fact){const k=it.fact.object.toLocaleLowerCase();if(!byObject.has(k))byObject.set(k,[]);byObject.get(k).push(it)}
 for(const list of byObject.values())for(let i=1;i<list.length&&links.length<320;i++)if(list[i].fact.subject.toLocaleLowerCase()!==list[0].fact.subject.toLocaleLowerCase())links.push([list[0].id,list[i].id,'obj'])
 return {lobes,events,links,facts:facts.length};
}

/* ---------- Самообучение: кандидаты в факты из чата и заметок ---------- */
// Очередь хранится в этом браузере; факт попадает в память только после «✓».
const LEARN_Q='tenma.learn.queue.v1',LEARN_CHAT='tenma.learn.chat',LEARN_SCANNED='tenma.learn.scanned.v1';
const TenmaLearn={
 fromChat:()=>read(LEARN_CHAT,true)!==false,
 setFromChat(v){write(LEARN_CHAT,!!v)},
 queue:()=>{const q=read(LEARN_Q,[]);return Array.isArray(q)?q:[]},
 save(q){write(LEARN_Q,q.slice(-60));window.dispatchEvent(new CustomEvent('tenma:learn'))},
 // Возвращает число новых кандидатов или null, если разобрать не удалось (сеть, ошибка сервера).
 async learn(text,source){
  try{const r=await fetch('/api/learn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,source})});if(!r.ok)return null;
   const data=await r.json(),q=TenmaLearn.queue(),key=f=>(f.subject+'|'+f.predicate+'|'+f.object).toLocaleLowerCase();let added=0;
   for(const f of data.facts||[]){if(q.some(x=>key(x)===key(f)))continue;q.push({id:'q'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),subject:f.subject,predicate:f.predicate,object:f.object,source,via:data.source,at:Date.now()});added++}
   if(added)TenmaLearn.save(q);return added}catch{return null}
 },
 async accept(id){
  const q=TenmaLearn.queue(),f=q.find(x=>x.id===id);if(!f)return;
  const r=await fetch('/api/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:f.subject,predicate:f.predicate,object:f.object,sourceId:'learn:'+(f.source||'chat'),confidence:f.via==='model'?.8:.7})});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'Не удалось запомнить')}
  // Берём свежую очередь: пока шёл запрос, её могли изменить другие кнопки.
  TenmaLearn.save(TenmaLearn.queue().filter(x=>x.id!==id));window.dispatchEvent(new CustomEvent('tenma:memory'));
 },
 reject(id){TenmaLearn.save(TenmaLearn.queue().filter(x=>x.id!==id))},
 // Заметки, изменённые после прошлого разбора; за раз — не больше limit.
 async scanNotes(limit=5){
  const notes=(window.TenmaApp?.workspace?.notes||[]),done=read(LEARN_SCANNED,{});let n=0,found=0,failed=0;
  for(const note of notes){const ver=note.updatedAt||note.createdAt||'';if(done[note.id]===ver)continue;if(n>=limit)break;n++;
   // Неудачный разбор не помечаем — заметка останется в очереди на следующую попытку.
   const r=await TenmaLearn.learn(note.title+'. '+(note.content||''),'note:'+note.id);if(r===null){failed++;continue}found+=r;done[note.id]=ver}
  write(LEARN_SCANNED,done);return {scanned:n-failed,found,failed,left:notes.filter(x=>done[x.id]!==(x.updatedAt||x.createdAt||'')).length};
 }
};
window.TenmaLearn=TenmaLearn;

/* ---------- Сила памяти: что и когда вспоминал чат (хранится в этом браузере) ---------- */
// Слушатель живёт всё время, а не только на странице «Мозг»: чат на любой странице «согревает» записи.
const RECALL_KEY='tenma.brain.recall.v1';
function readRecall(){const r=read(RECALL_KEY,{});return r&&typeof r==='object'&&!Array.isArray(r)?r:{}}
// Совместные вспоминания: пары записей, которые чат вспоминал вместе. Нить между ними крепнет.
const CO_KEY='tenma.brain.co.v1';
function readCo(){const c=read(CO_KEY,{});return c&&typeof c==='object'&&!Array.isArray(c)?c:{}}
function recordCo(ids){
 const list=[...new Set(ids)].slice(0,12);if(list.length<2)return;const co=readCo();
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const k=[list[i],list[j]].sort().join('|');co[k]=(co[k]||0)+1}
 const keys=Object.keys(co);if(keys.length>2000)for(const k of keys.sort((a,b)=>co[a]-co[b]).slice(0,keys.length-2000))delete co[k];
 write(CO_KEY,co);
}
function recordRecall(ids){
 if(!ids.length)return;const recall=readRecall(),now=Date.now();
 for(const id of ids){const r=recall[id]||{n:0,t:0};r.n++;r.t=now;recall[id]=r}
 const keys=Object.keys(recall);if(keys.length>3000)for(const k of keys.sort((a,b)=>recall[a].t-recall[b].t).slice(0,keys.length-3000))delete recall[k];
 write(RECALL_KEY,recall);
}
const recallIds=d=>[...(d?.facts||[]).map(x=>'f:'+x),...(d?.notes||[]).map(x=>'n:'+x)];
window.addEventListener('tenma:recall',e=>{const ids=recallIds(e.detail);recordRecall(ids);recordCo(ids)});

/* ---------- Монтирование ---------- */
function mount(host){
 const cfg=Object.assign({paused:false,mode3d:false,labels:'all',clean:false,palette:'copper'},read(CFG_KEY,{}));
 usePalette(cfg.palette);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const stage=el('div','brain-stage'),canvas=el('canvas','brain-fx'),tip=el('div','brain-tip');tip.hidden=true;
 // Слои: WebGL — частицы и свечение; 2D — нити, нейроны, импульсы (смешиваются «экраном»); сверху — подписи.
 const glc=el('canvas','brain-gl'),lab=el('canvas','brain-lab'),grain=el('div','brain-grain');
 glc.setAttribute('aria-hidden','true');lab.setAttribute('aria-hidden','true');grain.setAttribute('aria-hidden','true');
 const top=el('div','brain-top'),bar=el('div','brain-bar'),ctrl=el('div','brain-ctrl');
 const pauseBtn=el('button','brain-btn');pauseBtn.type='button';
 const resetBtn=el('button','brain-btn','Пробудить');resetBtn.type='button';resetBtn.title='Заново вырастить мозг из ядра';
 const find=el('input','brain-find');find.type='search';find.placeholder='Найти в мозге…';find.setAttribute('aria-label','Найти в мозге: зона, дело, заметка или факт');
 const btn3d=el('button','brain-btn');btn3d.type='button';btn3d.title='Объёмный режим: тяните мышью или пальцем, колесо или щипок — приблизить';
 const labelBtn=el('button','brain-btn');labelBtn.type='button';labelBtn.title='Подписи зон: все, только при наведении или скрыть';
 const cleanBtn=el('button','brain-btn brain-keep');cleanBtn.type='button';cleanBtn.title='Чисто: только рой, без панелей и подписей';
 const fsBtn=el('button','brain-btn brain-keep','⛶');fsBtn.type='button';fsBtn.title='На весь экран (выход — Esc)';fsBtn.setAttribute('aria-label','На весь экран');
 const viewBtn=el('button','brain-btn','⟲ Вид');viewBtn.type='button';viewBtn.title='Вернуть вид по центру (двойной щелчок по зоне — приблизить её)';
 const palBtn=el('button','brain-btn');palBtn.type='button';palBtn.title='Палитра роя: медь, лёд, неон';
 ctrl.append(find,btn3d,labelBtn,palBtn,viewBtn,resetBtn,pauseBtn,cleanBtn,fsBtn);top.append(bar,ctrl);
 const empty=el('div','brain-empty');empty.hidden=true;
 const fixBox=el('div','brain-fix');fixBox.hidden=true;fixBox.setAttribute('role','dialog');fixBox.setAttribute('aria-label','Разбор противоречий');
 stage.append(glc,canvas,lab,grain,top,tip,empty,fixBox);
 stage.setAttribute('role','img');
 const teach=el('form','brain-teach'),tIn=el('input'),tBtn=el('button','primary','Научить');
 tIn.placeholder='Научи меня: Анна | любит | зелёный чай';tIn.setAttribute('aria-label','Новый факт: субъект | связь | объект');tIn.maxLength=900;tBtn.type='submit';
 const tHint=el('span','brain-hint','Факт пишется как «субъект | связь | объект». Он сразу станет новым нейроном.');
 teach.append(tIn,tBtn,tHint);
 const learnBox=el('section','brain-learn'),learnHead=el('div','brain-learn-head');
 const learnTitle=el('div','brain-k','04 // предлагаю запомнить');
 const chatToggle=el('label','brain-check'),chatCb=el('input');chatCb.type='checkbox';chatCb.checked=TenmaLearn.fromChat();chatToggle.append(chatCb,el('span','','учиться из чата'));
 chatCb.onchange=()=>TenmaLearn.setFromChat(chatCb.checked);
 const scanBtn=el('button','brain-btn','Разобрать заметки');scanBtn.type='button';scanBtn.title='Найти факты в заметках (с моделью — её силами, без неё — по простым правилам)';
 const allBtn=el('button','brain-btn','✓ Запомнить всё');allBtn.type='button';
 const learnMsg=el('span','brain-hint'),learnList=el('ul','brain-learn-list');
 const fixBtn=el('button','brain-btn brain-alarm-btn');fixBtn.type='button';fixBtn.hidden=true;
 learnHead.append(learnTitle,chatToggle,scanBtn,allBtn,fixBtn);learnBox.append(learnHead,learnList,learnMsg);
 const hud=el('div','brain-hud');
 const pLog=el('section','brain-panel'),pAct=el('section','brain-panel'),pTree=el('section','brain-panel');
 const logHead=el('div','brain-k'),logAlert=el('span','brain-alert','сбой узла');logAlert.hidden=true;logHead.append(el('span','','01 // журнал событий'),logAlert);
 const logList=el('ul','brain-log');pLog.append(logHead,logList);
 const actNum=el('div','brain-num'),actCap=el('div','brain-cap'),spark=el('canvas','brain-spark');
 pAct.append(el('div','brain-k','02 // записей / сутки'),actNum,spark,actCap);
 const treeHead=el('div','brain-k'),treeN=el('span','brain-n');treeHead.append(el('span','','03 // структура'),treeN);
 const fan=el('canvas','brain-fan'),fanFoot=el('div','brain-cap'),tree=el('ul','brain-tree');
 pTree.append(treeHead,fan,fanFoot,tree);
 hud.append(pLog,pAct,pTree);
 // На широком экране HUD лежит поверх холста внизу, как в рое; на телефоне — под ним.
 function placeHud(){if(wideQuery.matches){hud.classList.add('over');stage.append(hud);host.replaceChildren(stage,teach,learnBox)}else{hud.classList.remove('over');host.replaceChildren(stage,teach,learnBox,hud)}drawSpark();drawFan();dirty=true}
 const ctx=canvas.getContext('2d'),lctx=lab.getContext('2d');
 // tenma.brain.gl: 'auto' (по умолчанию), 'off' — всегда 2D, 'force' — WebGL даже на медленной машине.
 const glMode=read('tenma.brain.gl','auto');
 let glr=null;if(glMode!=='off')try{glr=makeGL(glc)}catch(e){console.warn('Мозг: WebGL',e);glr=null}
 // На видеокарте частиц в несколько раз больше: ядро ~50 тыс., всего до ~100 тыс.
 let MULT=glr?{core:5.5,lobe:4,sat:3}:{core:1,lobe:1,sat:1},slowN=0;
 // Если видеокарта не тянет (программный WebGL), возвращаемся к 2D с обычным числом частиц.
 function dropGL(){glr?.destroy();glr=null;stage.classList.remove('gl');MULT={core:1,lobe:1,sat:1};core.parts=makeParticles(9000,7);satParts=makeParticles(220,31);for(const st of lobeState.values())st.want=-1e9;quality=baseQ;apply()}
 stage.classList.toggle('gl',!!glr);
 glc.addEventListener('webglcontextlost',e=>{e.preventDefault();glr=null;dropGL()});

 let W=0,H=0,dpr=1,ui=1,quality=1,baseQ=1,fpsT=0,fpsN=0,model={lobes:[],events:[],links:[],facts:0},facts=[],conflicts=[];
 const core={parts:makeParticles(9000,7,MULT.core),pulse:0};
 let satParts=makeParticles(220,31,MULT.sat);
 // Пыль в объёме: редкие тусклые частицы во всём пространстве между зонами, медленно дрейфуют.
 function makeDust(n,seed){const r=rng(seed),out=[];for(let i=0;i<n;i++){const d=unit(r),k=Math.cbrt(r());out.push({x:d[0]*k,y:d[1]*k*.7,z:d[2]*k,t:r()<.7?0:1,s:r()<.1?2:1,b:.2+.5*r(),f:.3+.8*r(),ph:TAU*r()})}out.dens=MULT.core>1?.5:1;out.size=1;return out}
 const dustFar=makeDust(MULT.core>1?6000:1200,201),dustNear=makeDust(MULT.core>1?2500:500,202);
 const lobeState=new Map();
 const neurons=new Map();
 let impulses=[],seen=new Set(read(SEEN_KEY,[])),firstVisit=!seen.size,bloomStart=performance.now(),coreText='',coreKind='',coreTextT=0;
 let simT=0,last=performance.now(),raf=0,dirty=true,pinned=null,hover=null,stars=[],spikes=[],linkCount=new Map(),coList=[];
 // Камера: поворот (yaw/pitch), приближение и сдвиг. В плоском режиме всё стремится к нулю.
 const cam={yaw:0,pitch:0,zoom:1,px:0,py:0,depth:0},camT={yaw:0,pitch:0,zoom:1,px:0,py:0};
 let view0={cx:0,cy:0},focusZ=0,focusN=null,idleT=0,focusQ='',focusLobes=new Set(),focusItems=new Set(),thinking=false,thinkT=0,seeds=[];
 // Сила памяти: сколько раз и когда запись вспоминали (хранится в этом браузере).
 let recall=readRecall();
 const still=()=>cfg.paused||reduceQuery.matches;

 function setPause(){pauseBtn.textContent=cfg.paused?'▶ Движение':'❚❚ Пауза';pauseBtn.setAttribute('aria-pressed',String(cfg.paused))}
 setPause();
 pauseBtn.onclick=()=>{cfg.paused=!cfg.paused;write(CFG_KEY,cfg);setPause();dirty=true};
 resetBtn.onclick=()=>{bloomStart=performance.now();dirty=true};
 function set3d(){btn3d.textContent=cfg.mode3d?'◉ 3D':'○ 3D';btn3d.setAttribute('aria-pressed',String(cfg.mode3d));stage.classList.toggle('mode3d',cfg.mode3d);if(!cfg.mode3d){camT.yaw=0;camT.pitch=0}dirty=true}
 set3d();
 // Подписи: все → при наведении (видна только зона под курсором или найденная) → скрыты.
 const LABELS={all:'Аа Подписи',hover:'Аа При наведении',off:'Аа Скрыты'};
 function setLabels(){labelBtn.textContent=LABELS[cfg.labels]||LABELS.all;labelBtn.setAttribute('aria-label','Подписи: '+(LABELS[cfg.labels]||'').replace('Аа ',''));dirty=true}
 setLabels();
 labelBtn.onclick=()=>{cfg.labels=cfg.labels==='all'?'hover':cfg.labels==='hover'?'off':'all';write(CFG_KEY,cfg);setLabels()};
 // Палитра: медь → лёд → неон. Цвета HUD (--ember) следуют за роем.
 const PAL_ORDER=['copper','ice','neon'];
 function setPalette(){usePalette(cfg.palette);palBtn.textContent='◐ '+PAL.name;palBtn.setAttribute('aria-label','Палитра: '+PAL.name);host.style.setProperty('--ember',PAL.accent);host.style.setProperty('--ember-hot',PAL.hot);sprite=null;dirty=true}
 palBtn.onclick=()=>{cfg.palette=PAL_ORDER[(PAL_ORDER.indexOf(cfg.palette)+1)%PAL_ORDER.length];write(CFG_KEY,cfg);setPalette();apply()};
 // «Чисто»: только рой — панели, подписи и кнопки прячутся (остаются «Чисто» и «На весь экран»).
 function setClean(){cleanBtn.textContent=cfg.clean?'◉ Чисто':'○ Чисто';cleanBtn.setAttribute('aria-pressed',String(cfg.clean));host.classList.toggle('clean',cfg.clean);stage.classList.toggle('clean',cfg.clean);requestAnimationFrame(()=>{drawSpark();drawFan()});dirty=true}
 setClean();
 cleanBtn.onclick=()=>{cfg.clean=!cfg.clean;write(CFG_KEY,cfg);setClean()};
 // На весь экран: Fullscreen API, а где его нет (iPhone) — растягиваем поверх страницы.
 const isFs=()=>document.fullscreenElement===stage||stage.classList.contains('fs');
 function setFs(){fsBtn.textContent=isFs()?'✕':'⛶';fsBtn.title=isFs()?'Выйти из полноэкранного режима (Esc)':'На весь экран (выход — Esc)';document.documentElement.classList.toggle('brain-fs-lock',stage.classList.contains('fs'));dirty=true}
 fsBtn.onclick=async()=>{
  if(isFs()){if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});stage.classList.remove('fs');setFs();return}
  if(stage.requestFullscreen){try{await stage.requestFullscreen();setFs();return}catch{}}
  stage.classList.add('fs');setFs();
 };
 const onFsChange=()=>setFs();document.addEventListener('fullscreenchange',onFsChange);
 btn3d.onclick=()=>{cfg.mode3d=!cfg.mode3d;write(CFG_KEY,cfg);if(cfg.mode3d){camT.pitch=-.35;camT.yaw=.5}set3d()};
 viewBtn.onclick=()=>{focusN=null;find.value='';setFocus('');Object.assign(camT,{yaw:cfg.mode3d?.5:0,pitch:cfg.mode3d?-.35:0,zoom:1,px:0,py:0});dirty=true};
 find.addEventListener('input',()=>setFocus(find.value));
 find.addEventListener('keydown',e=>{if(e.key==='Escape'){find.value='';setFocus('');e.stopPropagation()}if(e.key==='Enter'&&focusItems.size===1){const n=neurons.get([...focusItems][0]);if(n){pinned={type:'neuron',n};showTip(pinned,n.sx,n.sy,true)}}});
 function setFocus(q){
  focusQ=q.trim().toLocaleLowerCase();focusLobes=new Set();focusItems=new Set();
  if(focusQ){
   // Совпало название зоны — летим к ней; иначе к зонам, где нашлись записи (нейроны подсвечиваются везде).
   const named=model.lobes.filter(l=>l.label.toLocaleLowerCase().includes(focusQ));
   for(const l of model.lobes)for(const it of l.items)if(named.includes(l)||String(it.title).toLocaleLowerCase().includes(focusQ)){focusItems.add(it.id);if(!named.length)focusLobes.add(l.id)}
   for(const l of named)focusLobes.add(l.id);
  }
  if(!focusLobes.size){camT.zoom=1;camT.px=0;camT.py=0}
  find.classList.toggle('miss',!!focusQ&&!focusLobes.size);dirty=true;
 }
 // Рост: каждое вспоминание добавляет нейрону ветку (до +10). animate — новая ветка прорастает на глазах.
 const GROUP_AT=40;
 function grow(n,animate){
  const r=recall[n.item.id],want=n.base+Math.min(10,r?r.n:0);
  while(n.den.length<want){const q=rng(hash(n.item.id)+n.den.length*7919);n.den.push({a:TAU*q(),l:.5+.9*q(),c:(q()-.5)*.9,kids:q()<.5?[{at:.5+.3*q(),a:(q()-.5)*1.4,l:.3+.4*q()}]:[],born:animate?performance.now():0})}
 }
 function sprout(n){n.pending=false;n.bornT=performance.now();n.den.forEach((b,i)=>{b.born=n.bornT+200+i*110})}
 function strength(it){
  const r=recall[it.id],t=Math.max(it.ts||0,r?r.t:0),age=t?(Date.now()-t)/DAY:30;
  if(it.id.startsWith('t:')&&!it.dim)return clamp(.75+(it.hot?.35:0),.75,1.25); // открытое дело всегда «тёплое»
  return clamp(.12+.88*Math.exp(-age/21)+.12*Math.log2(1+(r?r.n:0)),.12,1.3);
 }

 function resize(){
  const r=stage.getBoundingClientRect();W=Math.max(1,r.width);H=Math.max(1,r.height);
  dpr=Math.min(2,window.devicePixelRatio||1);if(W*H*dpr*dpr>9e6)dpr=Math.sqrt(9e6/(W*H)); // 4K: не больше ~9 Мп
  ui=clamp(parseFloat(getComputedStyle(document.documentElement).fontSize)/16,.85,1.9); // подписи растут вместе с интерфейсом (4K)
  baseQ=clamp(W*H/(1500*800),.45,1);quality=Math.min(quality,baseQ); // на телефоне частиц меньше
  canvas.width=lab.width=Math.round(W*dpr);canvas.height=lab.height=Math.round(H*dpr);if(glr)glr.resize(canvas.width,canvas.height);
  // Фон: далёкие созвездия — маленькие рои-графы, как в финале ролика.
  const r2=rng(99),nc=Math.round(clamp(W*H/60000,8,40));
  stars=Array.from({length:nc},()=>{const cx=r2(),cy=r2(),k=4+Math.floor(r2()*9),pts=[];for(let i=0;i<k;i++)pts.push([cx+(r2()-.5)*.08,cy+(r2()-.5)*.08*W/H]);return {pts,a:.08+.18*r2(),ph:TAU*r2()}});
  drawSpark();drawFan();dirty=true;
 }
 const ro=new ResizeObserver(resize);ro.observe(stage);
 const hudRo=new ResizeObserver(()=>{drawSpark();drawFan()});hudRo.observe(spark);hudRo.observe(fan);

 /* Обновление модели с сохранением уже живущих зон и нейронов. */
 let applied=false;
 function apply(){
  const ws=window.TenmaApp?.workspace||{notes:[],tasks:[]};
  model=buildModel(ws,facts,conflicts);
  const alive=new Set();
  for(const l of model.lobes){
   alive.add(l.id);
   let s=lobeState.get(l.id);
   const n=l.items.length,want=Math.round(clamp(500+560*Math.log10(1+n),600,2400)); // 10 → ~1100, 100 → ~1600, 1000 → ~2200
   if(!s){s={parts:makeParticles(want,hash(l.id),MULT.lobe),want,pulse:0,x:0,y:0,r:0,fil:[],streaks:[],sats:[],seed:hash(l.id)};lobeState.set(l.id,s);
    if(applied&&!firstVisit&&!reduceQuery.matches&&l.items.some(it=>!seen.has(it.id))){s.birth=performance.now();s.from=l.id.startsWith('fs:')&&lobeState.has('facts')?'facts':null;coreKind='деление';coreText='новая зона «'+l.label+'»';coreTextT=4}}
   else if(Math.abs(s.want-want)>120){glr?.free(s.parts);s.parts=makeParticles(want,hash(l.id),MULT.lobe);s.want=want}
   const r=rng(s.seed^0x9e37);
   const nf=Math.round(clamp(30+n*4,30,90));
   if(s.fil.length!==nf)s.fil=Array.from({length:nf},()=>({a:TAU*r(),bend:(r()-.5)*.7,off:(r()-.5)*.9}));
   const ns=Math.round(clamp(60+n*10,60,240));
   if(s.streaks.length!==ns)s.streaks=Array.from({length:ns},(_,i)=>({f:i%nf,u:r(),v:.05+.12*r(),len:.025+.07*r(),a:.2+.45*r()}));
   const nsat=n>=4?Math.min(4,Math.floor(Math.sqrt(n))):0;
   if(s.sats.length!==nsat)s.sats=Array.from({length:nsat},()=>({a:TAU*r(),d:1.55+.6*r(),k:.28+.18*r(),sp:(r()-.5)*.3}));
   l.state=s;l.bad=l.id==='conflicts';l.str=l.items.length?l.items.reduce((a,it)=>a+strength(it),0)/l.items.length:1;
   for(const it of l.items){
    let nn=neurons.get(it.id);
    if(!nn){const q=rng(hash(it.id)),d=unit(q),k=.15+.6*Math.cbrt(q());nn={ox:d[0]*k,oy:d[1]*k,oz:d[2]*k,flash:0,sx:0,sy:0,vis:0,ph:TAU*q(),
      // Отростки: 3–6 ветвей-дендритов, у части — по 1–2 веточки, на концах синапсы.
      den:Array.from({length:3+Math.floor(q()*4)},()=>({a:TAU*q(),l:.7+.9*q(),c:(q()-.5)*.9,kids:Array.from({length:Math.floor(q()*3)},()=>({at:.45+.35*q(),a:(q()-.5)*1.6,l:.3+.4*q()}))}))};nn.base=nn.den.length;neurons.set(it.id,nn)}
    nn.item=it;nn.lobe=l;alive.add(it.id);it.str=strength(it);grow(nn,false);
    // Новая запись: импульс несёт её из ядра, а на месте нейрон распускается (до прилёта он скрыт).
    if(!seen.has(it.id)){seen.add(it.id);if(!firstVisit){if(impulses.length<24){nn.pending=true;impulses.push({lobe:l,item:it,u:0,f:Math.floor(Math.random()*l.state.fil.length),big:true})}else sprout(nn);coreText=it.title;coreKind=l.label;coreTextT=4.5}}
   }
  }
  for(const k of [...lobeState.keys()])if(!alive.has(k)){glr?.free(lobeState.get(k).parts);lobeState.delete(k)}
  for(const k of [...neurons.keys()])if(!alive.has(k))neurons.delete(k);
  // Большие зоны (больше 40 записей) делятся на группы по направлению от центра зоны.
  for(const l of model.lobes){const s=l.state,ns=l.items.map(it=>neurons.get(it.id)).filter(Boolean);
   if(ns.length>GROUP_AT){const K=clamp(Math.round(Math.sqrt(ns.length)),8,24),dirs=Array.from({length:K},(_,i)=>{const y=1-2*(i+.5)/K,r=Math.sqrt(1-y*y),a=i*2.39996;return [Math.cos(a)*r,y,Math.sin(a)*r]});
    const gs=dirs.map(()=>({ids:[],ox:0,oy:0,oz:0,kinds:{}}));
    for(const n of ns){let bi=0,bd=-9;dirs.forEach((d,i)=>{const v=d[0]*n.ox+d[1]*n.oy+d[2]*n.oz;if(v>bd){bd=v;bi=i}});const g=gs[bi];g.ids.push(n.item.id);g.ox+=n.ox;g.oy+=n.oy;g.oz+=n.oz;const k=kindOf(n.item.id);g.kinds[k]=(g.kinds[k]||0)+1;n.group=g}
    s.groups=gs.filter(g=>g.ids.length).map(g=>Object.assign(g,{ox:g.ox/g.ids.length,oy:g.oy/g.ids.length,oz:g.oz/g.ids.length,kind:Object.entries(g.kinds).sort((a,b)=>b[1]-a[1])[0][0]}));
   }else{s.groups=null;for(const n of ns)n.group=null}
   // Соседи внутри зоны (или группы — чтобы тысячи записей не считались вечность) — для связей «вблизи».
   for(const n of ns){const pool=n.group?n.group.ids.map(id=>neurons.get(id)):ns;n.near=pool.filter(o=>o&&o!==n).map(o=>[o,(o.ox-n.ox)**2+(o.oy-n.oy)**2+(o.oz-n.oz)**2]).sort((a,b)=>a[1]-b[1]).slice(0,2).map(x=>x[0])}}
  linkCount=new Map();for(const [a,b] of model.links){linkCount.set(a,(linkCount.get(a)||0)+1);linkCount.set(b,(linkCount.get(b)||0)+1)}
  if(seen.size>4000)seen=new Set([...neurons.keys()]);
  write(SEEN_KEY,[...seen]);
  coList=Object.entries(readCo()).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,200).map(([k,c])=>[...k.split('|'),c]);
  applied=true;renderHud();dirty=true;
 }

 const recentBad=()=>model.events.some(e=>e.bad&&e.t>=Date.now()-DAY);
 function renderHud(){
  const total=model.lobes.reduce((s,l)=>s+l.items.length,0),links=model.facts+model.links.length;
  const day=model.events.filter(e=>e.t>=Date.now()-DAY).length,week=model.events.filter(e=>e.t>=Date.now()-7*DAY).length;
  bar.textContent='● TENMAYURIKA // МОЗГ · нейронов '+total+' · связей '+links+' · записей '+day+'/сутки · зон '+model.lobes.length+(asleep?' · ☾ сон':'');
  stage.setAttribute('aria-label','Карта памяти: '+total+' записей в '+model.lobes.length+' зонах');
  empty.hidden=total>0;empty.textContent=total?'':'Пока только ядро. Научи меня первому факту ниже, или добавь дело в Планере, и мозг начнёт расти.';
  const bad=recentBad();logAlert.hidden=!bad;actNum.classList.toggle('bad',bad);
  logList.replaceChildren(...(model.events.slice(0,5).map(e=>{const li=el('li');if(e.bad)li.className='bad';const k=el('span','brain-tag',e.kind);k.style.color=rgba(e.color,1);const t=el('span','brain-ev',e.text);const d=el('time','',when(e.t));li.append(k,t,d);return li})));
  if(!model.events.length)logList.append(el('li','brain-muted','событий пока нет'));
  actNum.textContent=day.toLocaleString('ru-RU');actCap.textContent='за 7 дней: '+week+' · L1:'+model.lobes.length+' L2:'+total+' L3:'+links;
  treeN.textContent='N='+total;fanFoot.textContent='ядро → '+model.lobes.length+' '+plural(model.lobes.length,'зона','зоны','зон')+' → '+total+' '+plural(total,'нейрон','нейрона','нейронов');
  tree.replaceChildren(...model.lobes.map(l=>{const li=el('li');const dot=el('i');dot.style.background=rgba(l.color,1);dot.style.boxShadow='0 0 8px '+rgba(l.color,.8);const b=el('button','brain-link',l.label);b.type='button';b.onclick=l.open;li.append(dot,b,el('span','brain-count',String(l.items.length)));return li}));
  drawSpark();drawFan();renderFix();
 }
 function when(t){if(!t)return '';const d=new Date(t),now=new Date();const hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');return d.toDateString()===now.toDateString()?hm:d.getDate()+'.'+String(d.getMonth()+1).padStart(2,'0')}
 function prep(c){const w=c.clientWidth||200,h=c.clientHeight||48,sd=Math.min(2,window.devicePixelRatio||1);c.width=Math.round(w*sd);c.height=Math.round(h*sd);const g=c.getContext('2d');g.scale(sd,sd);return [g,w,h]}
 // 02: волнистая линия по часам за последние 48 ч; при сбое — красная и рваная, как в ролике.
 function drawSpark(){
  const [c,w,h]=prep(spark),bins=48,base=Date.now()-bins*3600000,counts=new Array(bins).fill(0);
  for(const e of model.events){const i=Math.floor((e.t-base)/3600000);if(i>=0&&i<bins)counts[i]+=e.bad?3:1}
  const bad=recentBad(),max=Math.max(1,...counts);
  const pts=counts.map((v,i)=>{const x=3+i*(w-6)/(bins-1),wave=Math.sin(i*.55)*.18+Math.sin(i*1.7)*.06;return [x,h/2-(v/max-.35)*(h*.55)-wave*h*(bad?.9:.5)+(bad&&i%2?(Math.random()-.5)*h*.35:0)]});
  c.lineWidth=1.6;c.lineJoin='round';c.strokeStyle=bad?'#ff4a38':PAL.accent;c.shadowColor=c.strokeStyle;c.shadowBlur=6;c.beginPath();c.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++){const [x0,y0]=pts[i-1],[x1,y1]=pts[i];if(bad)c.lineTo(x1,y1);else c.quadraticCurveTo(x0,y0,(x0+x1)/2,(y0+y1)/2)}c.stroke();
 }
 // 03: веер — ядро → зоны → колонки нейронов.
 function drawFan(){
  const [c,w,h]=prep(fan),L=model.lobes,n=Math.max(1,L.length),x0=8,y0=h/2,x1=w*.42,x2=w*.6;
  c.lineWidth=1;L.forEach((l,i)=>{const y=n>1?8+i*(h-16)/(n-1):h/2;
   c.strokeStyle=rgba(l.color,.55);c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y);c.stroke();
   const k=Math.min(l.items.length,24);for(let j=0;j<k;j++){const xx=x2+(j%12)*((w-x2-4)/12),yy=y+(Math.floor(j/12)-.5)*4;c.fillStyle=rgba(l.color,.85);c.fillRect(xx,yy,2,2)}
   c.strokeStyle=rgba(l.color,.25);c.beginPath();c.moveTo(x1,y);c.lineTo(x2-3,y);c.stroke();
   c.fillStyle=l.bad?'#ff4a38':rgba(l.color,1);c.beginPath();c.arc(x1,y,2.4,0,TAU);c.fill()});
  c.fillStyle='#ffe2b8';c.shadowColor='#ffb060';c.shadowBlur=8;c.beginPath();c.arc(x0,y0,3.4,0,TAU);c.fill();
 }

 /* ---------- Геометрия ---------- */
 function layout(t,dt=0){
  const topH=(top.offsetHeight||0)+(W<640?28:16),botH=hud.classList.contains('over')?(hud.offsetHeight||0)+8:0;
  const inset=Math.min(H*.3,topH),h=Math.max(H*.4,H-inset-botH),m=Math.min(W,h),cx=W/2,cy=inset+h/2;
  const rx=W>=h?Math.min(W*.36,m*.82):W*.32,ry=W>=h?h*.36:Math.min(h*.36,W*.75);
  // Рост как в ролике: сначала одно ядро, затем кластеры «отпочковываются» и уходят по местам.
  const b=reduceQuery.matches?1:ease(((performance.now()-bloomStart)/1000-.5)/2);
  const N=model.lobes.length;
  // Камера плавно догоняет цель; в 3D без касаний мозг медленно вращается сам.
  idleT+=dt;if(cfg.mode3d&&!drag&&idleT>4&&!still())camT.yaw+=dt*.07;
  const k=reduceQuery.matches?1:Math.min(1,dt*5);
  for(const key of ['yaw','pitch','zoom','px','py'])cam[key]+=(camT[key]-cam[key])*k;
  cam.depth+=((cfg.mode3d?1:0)-cam.depth)*k;
  const cyw=Math.cos(cam.yaw),syw=Math.sin(cam.yaw),cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch),D=m*2.4;
  const proj=(x,y,z)=>{z*=cam.depth;const x1=x*cyw+z*syw,z1=-x*syw+z*cyw,y1=y*cp-z1*sp,z2=y*sp+z1*cp,kk=D/Math.max(D*.3,D-z2);return [x1*kk,y1*kk,kk,z2]};
  const Z=cam.zoom,ox=cx+cam.px*Z,oy=cy+cam.py*Z;
  const coreR=m*(N?.2:.26)*(1.15-.15*b)*Z;
  let fx0=1e9,fy0=1e9,fx1=-1e9,fy1=-1e9,fn=0;
  model.lobes.forEach((l,i)=>{
   const s=l.state,a=-Math.PI/2+TAU*i/Math.max(N,1)+(N%2?0:Math.PI/N/2)+(s.seed%100-50)/100*.25;
   const wob=still()?0:1;
   const wx=Math.cos(a)*rx*b+Math.sin(t*.27+s.seed%7)*m*.012*wob,wy=Math.sin(a)*ry*b+Math.cos(t*.21+s.seed%5)*m*.012*wob,wz=((s.seed%997)/997-.5)*m*1.1*b;
   const [qx,qy,kk,z2]=proj(wx,wy,wz);
   s.x=ox+qx*Z;s.y=oy+qy*Z;s.qx=qx;s.qy=qy;s.k=kk;s.depth=z2;s.a=Math.atan2(qy,qx);
   // Размер по логарифмической шкале: 10 записей → ~0.07, 100 → ~0.09, 1000 → ~0.11 от кадра.
   s.r=m*clamp(.047+.021*Math.log10(1+l.items.length),.055,.13)*(.35+.65*b)*kk*Z;
   // Деление: новая зона выходит из родительской (факты) или из ядра и растёт.
   if(s.birth){const t=(now-s.birth)/2600;if(t>=1){s.birth=0;s.split=0}else{const e=ease(t),src=s.from&&lobeState.get(s.from),fx=src&&src.x?src.x:ox,fy=src&&src.y?src.y:oy;s.split=1-t;s.fx=fx;s.fy=fy;s.x=fx+(s.x-fx)*e;s.y=fy+(s.y-fy)*e;s.r*=.25+.75*e}}
   if(focusLobes.has(l.id)){const rr=s.r/Z*1.6;fx0=Math.min(fx0,qx-rr);fx1=Math.max(fx1,qx+rr);fy0=Math.min(fy0,qy-rr);fy1=Math.max(fy1,qy+rr);fn++}
  });
  // Поиск-фокус: камера подлетает к найденным зонам.
  // Поиск-фокус: камера подлетает так, чтобы найденные зоны заняли кадр.
  if(fn){camT.px=-(fx0+fx1)/2;camT.py=-(fy0+fy1)/2;camT.zoom=clamp(Math.min(W*.75/(fx1-fx0),h*.75/(fy1-fy0)),1,2.4)}
  view0={cx,cy};
  return {cx:ox,cy:oy,coreR,m,b,Z};
 }
 // Нить ядро→зона: квадратичная кривая; f.off раздвигает нити в пучок.
 function curve(G,s,f,u){
  const sx=G.cx+Math.cos(f.a)*G.coreR*.7,sy=G.cy+Math.sin(f.a)*G.coreR*.7;
  const ex=s.x+Math.cos(f.a*1.7)*s.r*.55,ey=s.y+Math.sin(f.a*1.7)*s.r*.55;
  const mx=(sx+ex)/2,my=(sy+ey)/2,dx=ex-sx,dy=ey-sy;
  const qx=mx-dy*(f.bend*.3+f.off*.12),qy=my+dx*(f.bend*.3+f.off*.12),v=1-u;
  return [v*v*sx+2*v*u*qx+u*u*ex,v*v*sy+2*v*u*qy+u*u*ey];
 }

 /* ---------- Отрисовка ---------- */
 let sprite=null,spriteBad=null,spriteSeed=null,shapes=null;
 // Формы нейронов: дело — звезда, заметка — капля, факт — кристалл. Свечение вокруг + сама форма.
 function shapeSprite(kind,glow,core,edge){
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');
  const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,glow[1]);gr.addColorStop(.45,glow[2]);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);
  g.beginPath();
  if(kind==='star'){for(let i=0;i<8;i++){const a=-Math.PI/2+i*Math.PI/4,r=i%2?5:15;g.lineTo(32+Math.cos(a)*r,32+Math.sin(a)*r)}}
  else if(kind==='drop'){g.moveTo(32,16);g.bezierCurveTo(38,25,43,31,43,37);g.arc(32,37,11,0,Math.PI);g.bezierCurveTo(21,31,26,25,32,16)}
  else{for(let i=0;i<6;i++){const a=-Math.PI/2+i*TAU/6,r=i%3?11:15;g.lineTo(32+Math.cos(a)*r,32+Math.sin(a)*r)}}
  g.closePath();const fg=g.createRadialGradient(32,30,0,32,32,16);fg.addColorStop(0,glow[0]);fg.addColorStop(1,core);g.fillStyle=fg;g.fill();g.lineWidth=1.4;g.strokeStyle=edge;g.stroke();
  if(kind==='crystal'){g.beginPath();g.moveTo(32,17);g.lineTo(32,47);g.moveTo(22,26);g.lineTo(42,38);g.moveTo(42,26);g.lineTo(22,38);g.strokeStyle='rgba(255,255,255,.35)';g.lineWidth=.8;g.stroke()}
  return c;
 }
 const kindOf=id=>id.startsWith('t:')?'star':id.startsWith('n:')?'drop':'crystal';
 function glowSprite(c1,c2,c3){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,c1);gr.addColorStop(.2,c2);gr.addColorStop(.55,c3);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return c}
 function cloud(parts,x,y,r,rot,pal,inten,hazeA,count,blur=0,light=null){
  rot+=cam.yaw;const tilt=.38+cam.pitch*cam.depth;
  const R=r*dpr,X=x*dpr,Y=y*dpr;
  const hz=ctx.createRadialGradient(X,Y,0,X,Y,R*1.3);hz.addColorStop(0,rgba(pal.haze,.55*hazeA));hz.addColorStop(.55,rgba(pal.haze,.22*hazeA));hz.addColorStop(1,rgba(pal.haze,0));
  ctx.globalAlpha=1;ctx.fillStyle=hz;ctx.fillRect(X-R*1.35,Y-R*1.35,R*2.7,R*2.7);
  // При приближении частицы крупнее и ярче, чтобы облако не рассыпалось в редкую пыль.
  if(glr){const zk=clamp(Math.sqrt(cam.zoom),1,2.2);glr.cloud(parts,X,Y,R,rot,tilt,pal.tones,inten*Math.sqrt(zk),count,blur*dpr,Math.max(1,dpr*1.15*ui)*zk,still()?0:1,simT,light);return}
  const ca=Math.cos(rot),sa=Math.sin(rot),ct=Math.cos(tilt),st=Math.sin(tilt),tw=still()?0:1;
  const ps=Math.max(1,dpr*1.15*ui),lim=Math.min(parts.length,count||parts.length);
  for(let tone=0;tone<3;tone++){
   ctx.fillStyle=rgba(pal.tones[tone],1);
   for(let i=0;i<lim;i++){const p=parts[i];if(p.t!==tone)continue;
    const x1=p.x*ca+p.z*sa,z1=-p.x*sa+p.z*ca,y1=p.y*ct-z1*st,z2=p.y*st+z1*ct,lq=Math.hypot(x1,y1)||1;
    const d=(z2+1.3)/2.6,a=p.b*d*inten*(tone===0?.75:1)*(tw?.75+.25*Math.sin(simT*p.f+p.ph):1)*(light?1+light[2]*((x1*light[0]+y1*light[1])/lq*Math.min(lq*1.6,1)*.75-.15):1);
    if(a<.03)continue;
    const s=p.s*ps*(.6+.6*d)*(tone===2?1.15:1);ctx.globalAlpha=Math.min(1,a);ctx.fillRect(X+x1*R-s/2,Y+y1*R-s/2,s,s);
   }
  }
  ctx.globalAlpha=1;
 }
 let now=0;
 function draw(dt){
  if(!sprite){sprite=glowSprite(...PAL.glow);spriteBad=glowSprite('rgba(255,255,255,1)','rgba(230,230,240,.7)','rgba(180,180,190,.15)');spriteSeed=glowSprite('rgba(255,255,255,1)','rgba(255,230,190,.6)','rgba(255,200,140,.12)');
   shapes={};for(const k of ['star','drop','crystal'])shapes[k]={warm:shapeSprite(k,PAL.glow,PAL.accent,PAL.hot),cold:shapeSprite(k,PAL.cold,PAL.cold[1],PAL.cold[0])}}
  now=performance.now();
  const G=layout(simT,dt),pal=l=>l.bad?PALE:EMBER,focusing=focusLobes.size>0,dimOf=l=>focusing&&!focusLobes.has(l.id)?.16:1;
  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';
  if(glr){ctx.clearRect(0,0,canvas.width,canvas.height);glr.begin()}else{ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height)}
  lctx.setTransform(1,0,0,1,0,0);lctx.clearRect(0,0,lab.width,lab.height);
  ctx.globalCompositeOperation='lighter';
  // Глубина резкости (3D): резко — ядро или найденная зона, остальное размывается по удалённости.
  const fl=model.lobes.filter(l=>focusLobes.has(l.id));focusZ=fl.length?fl.reduce((a,l)=>a+l.state.depth,0)/fl.length:0;
  // Далёкие созвездия (в 3D слегка смещаются — параллакс).
  const shx=-cam.yaw*W*.04*dpr,shy=cam.pitch*H*.04*dpr;
  ctx.lineWidth=dpr*.6;for(const c of stars){const a=c.a*(still()?1:.7+.3*Math.sin(simT*.4+c.ph))*(focusing?.5:1);ctx.strokeStyle=rgba(PAL.star,a*.5);ctx.beginPath();c.pts.forEach(([x,y],i)=>{const X=x*canvas.width+shx,Y=y*canvas.height+shy;i?ctx.lineTo(X,Y):ctx.moveTo(X,Y)});ctx.stroke();
   ctx.fillStyle=rgba(PAL.starDot,a);for(const [x,y] of c.pts)ctx.fillRect(x*canvas.width+shx,y*canvas.height+shy,1.4*dpr,1.4*dpr)}
  // Пучки нитей.
  for(const l of model.lobes){const s=l.state,col=l.bad?[200,200,210]:l.color;ctx.strokeStyle=rgba(col,.045*G.b*dimOf(l));ctx.lineWidth=dpr*.6;
   for(const f of s.fil){ctx.beginPath();for(let k=0;k<=14;k++){const [x,y]=curve(G,s,f,k/14);k?ctx.lineTo(x*dpr,y*dpr):ctx.moveTo(x*dpr,y*dpr)}ctx.stroke()}}
  // Штрихи-«волокна»: факты текут в ядро (обучение), дела — из ядра наружу (действия).
  ctx.lineCap='round';
  for(const l of model.lobes){const s=l.state,inward=l.id==='facts'||l.id.startsWith('fs:'),col=l.bad?[220,220,230]:l.color,lim=Math.ceil(s.streaks.length*quality),dim=dimOf(l)*(thinking?1.5:1);
   ctx.lineWidth=dpr*.7;
   for(let i=0;i<lim;i++){const p=s.streaks[i];if(!still())p.u=(p.u+p.v*dt*(thinking?2.2:1))%1;const u=inward?1-p.u:p.u,f=s.fil[p.f%s.fil.length];if(!f)continue;
    const [x,y]=curve(G,s,f,u),[x0,y0]=curve(G,s,f,clamp(inward?u+p.len:u-p.len,0,1));
    ctx.strokeStyle=rgba(col,Math.min(1,p.a*.45*G.b*dim*Math.sin(Math.PI*u)));ctx.beginPath();ctx.moveTo(x0*dpr,y0*dpr);ctx.lineTo(x*dpr,y*dpr);ctx.stroke()}}
  // «Думает»: ядро пульсирует, пока аватар готовит ответ.
  // Пыль: дальний слой мягко размыт, ближний крупнее и дрейфует навстречу.
  cloud(dustFar,G.cx,G.cy,G.m*1.25,simT*.012,EMBER,.32*G.b*(focusing?.6:1),0,Math.round(dustFar.length*quality),cam.depth*3+1.2);
  cloud(dustNear,G.cx+Math.sin(simT*.05)*G.m*.03,G.cy,G.m*.95,-simT*.02,EMBER,.28*G.b*(focusing?.6:1),0,Math.round(dustNear.length*quality),.6);
  core.pulse=Math.max(0,core.pulse-dt*1.2);
  // Сон: ночью ядро медленно дышит (период ~10 с).
  if(asleep)core.pulse=Math.max(core.pulse,.12+.12*Math.sin(simT*TAU/10));
  if(thinking){thinkT+=dt;core.pulse=Math.max(core.pulse,.3+.25*Math.sin(thinkT*6))}
  // Дальние зоны рисуются за ядром, ближние — перед ним.
  const order=[...model.lobes].sort((a,b)=>a.state.depth-b.state.depth);
  for(const l of order)if(l.state.depth<0)drawLobe(l,G,pal(l),dimOf(l),dt);
  drawCore(G,dt,focusing);
  for(const l of order)if(l.state.depth>=0)drawLobe(l,G,pal(l),dimOf(l),dt);
  // Уровень 3: камера держит выбранный нейрон в центре, хотя зона вращается.
  if(focusN){if(!neurons.has(focusN.item.id)||!focusN.lobe.state)focusN=null;else{camT.px=-((focusN.sx-view0.cx)/cam.zoom-cam.px);camT.py=-((focusN.sy-view0.cy)/cam.zoom-cam.py)}}
  ctx.globalAlpha=1;
  // Связи факт→факт.
  // Связи между фактами через зоны: «объект → субъект» сплошной нитью, общий объект — пунктиром.
  // По каждой бежит искра; при наведении на нейрон его связи загораются, остальные гаснут.
  const hl=hover?.id||(pinned?.type==='neuron'?pinned.n.item.id:null);
  for(const [a,b,kind] of model.links){const A=neurons.get(a),B=neurons.get(b);if(!A||!B)continue;
   const lit=focusItems.has(a)||focusItems.has(b)||hl===a||hl===b,base=(focusing||hl?(lit?.85:.05):.28)*G.b*(kind==='obj'?.8:1);
   const mx=(A.sx+B.sx)/2,my=(A.sy+B.sy)/2,qx=mx+(G.cx-mx)*.3,qy=my+(G.cy-my)*.3;
   ctx.lineWidth=dpr*(lit?1.5:.9);ctx.strokeStyle=rgba(PAL.link,base);if(kind==='obj')ctx.setLineDash([4*dpr,3*dpr]);
   ctx.beginPath();ctx.moveTo(A.sx*dpr,A.sy*dpr);ctx.quadraticCurveTo(qx*dpr,qy*dpr,B.sx*dpr,B.sy*dpr);ctx.stroke();ctx.setLineDash([]);
   const u=(simT*.22+(hash(a+b)%1000)/1000)%1,v=1-u,px=v*v*A.sx+2*v*u*qx+u*u*B.sx,py=v*v*A.sy+2*v*u*qy+u*u*B.sy,z=dpr*ui*(lit?15:9);
   ctx.globalAlpha=Math.min(1,base*2.6);ctx.drawImage(sprite,px*dpr-z/2,py*dpr-z/2,z,z);ctx.globalAlpha=1}
  // Укреплённые связи: записи, которые часто вспоминались вместе, соединены толстеющей светлой нитью.
  for(const [a,b,c] of coList){const A=neurons.get(a),B=neurons.get(b);if(!A||!B||!(A.vis||B.vis))continue;const w=Math.log2(c);
   ctx.strokeStyle=rgba(PAL.tones[2],Math.min(.75,(.1+.09*w)*G.b*(focusing?.4:1)));ctx.lineWidth=dpr*(.6+.75*w);ctx.lineCap='round';
   ctx.beginPath();ctx.moveTo(A.sx*dpr,A.sy*dpr);const mx=(A.sx+B.sx)/2,my=(A.sy+B.sy)/2;ctx.quadraticCurveTo((mx+(G.cx-mx)*.15)*dpr,(my+(G.cy-my)*.15)*dpr,B.sx*dpr,B.sy*dpr);ctx.stroke()}
  // Зародыши: факты, которые мозг предлагает запомнить, кружат вокруг ядра.
  for(const sd of seeds){const a=sd.a+(still()?0:simT*.25),rr=G.coreR*(1.25+.2*Math.sin(simT*.7+sd.a*3));sd.sx=G.cx+Math.cos(a)*rr;sd.sy=G.cy+Math.sin(a)*rr*.8;
   const z=dpr*ui*(16+4*Math.sin(simT*3+sd.a));ctx.globalAlpha=.95*G.b;ctx.drawImage(spriteSeed,sd.sx*dpr-z/2,sd.sy*dpr-z/2,z,z);
   ctx.globalAlpha=.35*G.b;ctx.strokeStyle='rgba(255,230,190,.8)';ctx.lineWidth=dpr*.8;ctx.setLineDash([3*dpr,3*dpr]);ctx.beginPath();ctx.arc(sd.sx*dpr,sd.sy*dpr,z*.75,0,TAU);ctx.stroke();ctx.setLineDash([])}
  ctx.globalAlpha=1;
  // Импульсы: новые записи (крупные), воспоминания (белые), фоновая «болтовня».
  impulses=impulses.filter(p=>{const s=p.lobe.state,f=s&&s.fil[p.f];if(!f)return false;p.u+=dt*(reduceQuery.matches?4:p.big?.55:p.recall?.8:.9);
   if(p.u>=1){if(p.item){const n=neurons.get(p.item.id);if(n){n.flash=p.soft?.35:p.recall?.75:1;if(n.pending)sprout(n)}s.pulse=p.soft?.25:p.recall?.6:1}return false}
   const [x,y]=curve(G,s,f,ease(p.u)),z=dpr*(p.big?26:p.recall?18:12);
   // Хвост: гаснущий след вдоль волокна.
   const col=p.recall?[255,255,255]:p.big?PAL.tones[2]:PAL.tones[1],N=p.big?16:p.recall?12:8,step=p.big?.014:.018;let tx=x,ty=y;ctx.lineCap='round';
   for(let k=1;k<=N;k++){const uu=p.u-k*step;if(uu<=0)break;const [x2,y2]=curve(G,s,f,ease(uu)),fade=1-k/(N+1);ctx.globalAlpha=1;ctx.strokeStyle=rgba(col,(p.big||p.recall?.8:.4)*fade*fade);ctx.lineWidth=dpr*((p.big?3.4:p.recall?2.6:1.6)*fade+.4);ctx.beginPath();ctx.moveTo(tx*dpr,ty*dpr);ctx.lineTo(x2*dpr,y2*dpr);ctx.stroke();tx=x2;ty=y2}
   ctx.globalAlpha=p.soft?.45:p.big||p.recall?1:.55;ctx.drawImage(p.recall?spriteSeed:sprite,x*dpr-z/2,y*dpr-z/2,z,z);return true});
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
  if(glr)glr.end(1);
  details(G,dimOf);
  labels(G,dimOf);
  levelUi();
  // Подпись внутри ядра — как «тикет → решён» в ролике.
  const txt=coreTextT>0?trim(coreKind,16)+' → '+trim(coreText,W<520?18:30):thinking?'думаю…':'';
  if(coreTextT>0)coreTextT-=dt;
  if(txt){const c=lctx,a=thinking&&coreTextT<=0?.6+.4*Math.sin(thinkT*4):clamp(coreTextT,0,1);c.font='600 '+Math.round(11.5*ui*dpr)+'px '+MONO;c.textAlign='center';c.textBaseline='middle';c.shadowColor='rgba(0,0,0,.9)';c.shadowBlur=6*dpr;c.fillStyle='rgba(255,246,230,'+a+')';c.fillText(txt,G.cx*dpr,G.cy*dpr);c.shadowBlur=0;c.textBaseline='alphabetic'}
 }
 // Направление на ядро (в экранных координатах) и сила освещения — для объёма и тени зон.
 function lightTo(x,y,G){const dx=G.cx-x,dy=G.cy-y,l=Math.hypot(dx,dy)||1;return [dx/l,dy/l,.9*(1+core.pulse*.4)]}
 function drawCore(G,dt,focusing){
  if(spikes.length!==160){const r=rng(5);spikes=Array.from({length:160},()=>({a:TAU*r(),u:r(),v:.05+.1*r(),len:.15+.35*r()}))}
  const dim=focusing?.35:1;
  ctx.lineWidth=dpr*.8;for(const p of spikes){if(!still())p.u=(p.u+p.v*dt)%1;const r0=G.coreR*(.85+p.u*.6),r1=r0+G.coreR*p.len*.4;ctx.strokeStyle=rgba(PAL.spike,.22*dim*Math.sin(Math.PI*p.u));ctx.beginPath();ctx.moveTo((G.cx+Math.cos(p.a)*r0)*dpr,(G.cy+Math.sin(p.a)*r0)*dpr);ctx.lineTo((G.cx+Math.cos(p.a)*r1)*dpr,(G.cy+Math.sin(p.a)*r1)*dpr);ctx.stroke()}
  cloud(core.parts,G.cx,G.cy,G.coreR*(1+core.pulse*.05),simT*.1,EMBER,(1.3+core.pulse*.6)*dim,(1.6+core.pulse)*dim,Math.round(core.parts.length*quality),blurOf(0,G));
  const hot=G.coreR*dpr*(.5+core.pulse*.3);ctx.globalAlpha=(.3+.4*core.pulse)*dim;ctx.drawImage(sprite,G.cx*dpr-hot,G.cy*dpr-hot,hot*2,hot*2);ctx.globalAlpha=1;
 }
 // Зона: спутники, облако и нейроны. Яркость зоны и нейронов зависит от силы памяти.
 const blurOf=(depth,G)=>cam.depth*clamp(Math.abs(depth-focusZ)/G.m*9-.35,0,7);
 function drawLobe(l,G,P,dim,dt){
  const s=l.state;s.pulse=Math.max(0,s.pulse-dt*1.4);
  // Вращение зоны замедляется при приближении, чтобы запись можно было поймать курсором.
  if(s.ang==null)s.ang=s.seed%1000;if(!still())s.ang+=dt*(.18+(s.seed%5)*.02)/(1+(s.det||0)*6+(focusN&&focusN.lobe===l?20:0));
  const light=lightTo(s.x,s.y,G);
  // Деление: перемычка из волокон между родительской зоной и новой, тает по мере отхода.
  if(s.split>0){ctx.strokeStyle=rgba(l.color,.5*s.split*G.b);ctx.lineWidth=dpr*(1+s.r*.15*s.split);ctx.beginPath();ctx.moveTo(s.fx*dpr,s.fy*dpr);ctx.lineTo(s.x*dpr,s.y*dpr);ctx.stroke();
   const z=s.r*2.2*dpr*s.split;ctx.globalAlpha=.6*s.split;ctx.drawImage(sprite,(s.fx+s.x)/2*dpr-z/2,(s.fy+s.y)/2*dpr-z/2,z,z);ctx.globalAlpha=1}
  const rot=s.ang,wob=still()?0:simT,warm=.55+.45*Math.min(1,l.str??1),blur=blurOf(s.depth,G),bz=1+blur*.12,ba=1/(1+blur*.35);
  for(const sat of s.sats){const a=sat.a+wob*sat.sp,sx=s.x+Math.cos(a)*s.r*sat.d,sy=s.y+Math.sin(a)*s.r*sat.d;
   ctx.strokeStyle=rgba(l.bad?[200,200,210]:l.color,.18*G.b*dim*ba);ctx.lineWidth=dpr*.7;ctx.beginPath();ctx.moveTo(s.x*dpr,s.y*dpr);ctx.lineTo(sx*dpr,sy*dpr);ctx.stroke();
   cloud(satParts,sx,sy,s.r*sat.k,rot*1.3+sat.a,P,.95*G.b*dim*warm,.9*G.b*dim*warm,Math.round(satParts.length*quality),blur,lightTo(sx,sy,G))}
  cloud(s.parts,s.x,s.y,s.r*(1+s.pulse*.15),rot,P,((l.bad?1.05:1)*warm+s.pulse)*dim,(1+s.pulse*1.5)*dim*warm,Math.round(s.parts.length*quality),blur,light);
  // Детализация: чем крупнее зона на экране, тем больше видно (связи соседей, названия записей).
  s.det=dim<.5?0:clamp((s.r/G.m-.11)/.09,0,1);
  const ca=Math.cos(rot+cam.yaw),sa=Math.sin(rot+cam.yaw),list=[],zf=Math.min(1.6,Math.sqrt(s.k||1)*Math.sqrt(G.Z));
  const place=o=>{const x1=o.ox*ca+o.oz*sa,z1=-o.ox*sa+o.oz*ca;return [s.x+x1*s.r,s.y+o.oy*s.r,(z1+1.2)/2.4]};
  const margin=60,onScreen=(x,y)=>x>-margin&&x<W+margin&&y>-margin&&y<H+margin;
  // Тысячи записей: пока зона далеко, записи собраны в группы; при приближении группы раскрываются.
  const grouped=s.groups&&s.det<.55;s.groupHits=[];
  if(grouped){
   for(const g of s.groups){const [gx,gy,d]=place(g);g.sx=gx;g.sy=gy;
    for(const id of g.ids){const n=neurons.get(id);if(n){n.sx=gx;n.sy=gy;n.vis=0;n.flash=Math.max(0,n.flash-dt*.45)}}
    const size=ui*dpr*(7+2.2*Math.sqrt(g.ids.length))*(.7+.5*d)*zf*bz,spr=shapes[g.kind].warm;
    ctx.globalAlpha=clamp(.3*d*dim*warm+.12,0,1)*G.b*ba;ctx.drawImage(spr,gx*dpr-size/2,gy*dpr-size/2,size,size);
    ctx.globalAlpha=.25*G.b*dim;ctx.strokeStyle=rgba(l.color,1);ctx.lineWidth=dpr*.8;ctx.setLineDash([2*dpr,3*dpr]);ctx.beginPath();ctx.arc(gx*dpr,gy*dpr,size*.62,0,TAU);ctx.stroke();ctx.setLineDash([]);
    if(dim>.5&&G.b>.8&&!cfg.clean&&s.det>.12){lctx.globalAlpha=G.b*clamp((s.det-.12)/.15,0,1);lctx.font='600 '+Math.round(9*ui*dpr)+'px '+MONO;lctx.textAlign='center';lctx.textBaseline='middle';lctx.fillStyle='rgba(255,246,230,.85)';lctx.fillText(String(g.ids.length),gx*dpr,gy*dpr+size*.62+7*dpr*ui);lctx.globalAlpha=1}
    if(dim>.5)s.groupHits.push(g)}
   ctx.globalAlpha=1;return;
  }
  for(const it of l.items){const n=neurons.get(it.id);if(!n)continue;n.flash=Math.max(0,n.flash-dt*.45);
   const [nx,ny,d]=place(n),str=Math.min(1.2,it.str??1),lit=focusItems.has(it.id);
   n.sx=nx;n.sy=ny;n.d=d;n.vis=!n.pending&&onScreen(nx,ny)?G.b*(dim>.5||lit?1:0):0;if(!n.vis&&!lit||n.pending)continue;
   // Прорастание: свежий нейрон распускается из точки за ~0.9 с; угасание: забытый сжимается.
   const bloom=n.bornT?ease((now-n.bornT)/900):1,fade=str<.3?.55+1.5*str:1;
   n.size=ui*dpr*(5+3*it.weight+(it.hot?3:0)+n.flash*22)*(.7+.5*d)*(.65+.45*str)*(hover&&hover.id===it.id?1.6:1)*(lit?1.5:1)*(focusN===n?1.8:1)*zf*bz*bloom*fade;
   if(bloom<1){ctx.strokeStyle=rgba(l.color,.6*(1-bloom));ctx.lineWidth=dpr*1.2;ctx.beginPath();ctx.moveTo(s.x*dpr,s.y*dpr);ctx.lineTo(nx*dpr,ny*dpr);ctx.stroke()}
   n.alpha=clamp(((it.dim?.3:.65)*d*(.35+.65*str)+n.flash)*(lit?1.6:dim),0,1)*G.b*(lit?1:ba);list.push([n,it,str,lit])}
  // Отростки нейронов — одной кистью на зону; на концах синапсы. Новые ветки (от вспоминаний) прорастают.
  // У нейрона под курсором (или выбранного) по отросткам бегут микроимпульсы.
  const col=l.bad?[210,210,220]:l.color,denA=.34*G.b*dim*warm*ba,tw=still()?0:1,tips=[],sparks=[];
  const act=n=>(hover&&hover.id===n.item.id)||focusN===n||(pinned?.type==='neuron'&&pinned.n===n);
  if(denA>.02&&list.length){ctx.strokeStyle=rgba(col,denA);ctx.lineWidth=dpr*(.6+.25*s.det);ctx.beginPath();
   for(const [n,,str] of list){const L=Math.max(5*dpr*ui,n.size*(.62+.5*s.det))*clamp(.3+2.3*str,.3,1),X=n.sx*dpr,Y=n.sy*dpr,on=act(n); // забытые — отростки втянуты
    for(const b of n.den){const gr=b.born?ease((now-b.born)/1600):1;if(gr<=0)continue;
     const a=b.a+tw*Math.sin(simT*.5+n.ph+b.a)*.07,len=b.l*L*gr,ex=X+Math.cos(a)*len,ey=Y+Math.sin(a)*len,qx=(X+ex)/2-Math.sin(a)*b.c*len*.45,qy=(Y+ey)/2+Math.cos(a)*b.c*len*.45;
     ctx.moveTo(X,Y);ctx.quadraticCurveTo(qx,qy,ex,ey);tips.push(ex,ey,gr<1?1:0);
     if(on){for(let j=0;j<2;j++){const u=(simT*.9+b.a+j*.5)%1,v=1-u;sparks.push(v*v*X+2*v*u*qx+u*u*ex,v*v*Y+2*v*u*qy+u*u*ey)}}
     for(const k of b.kids){const sx=X+(ex-X)*k.at+(qx-(X+ex)/2)*.5,sy=Y+(ey-Y)*k.at+(qy-(Y+ey)/2)*.5,ka=a+k.a,kl=k.l*len,kx=sx+Math.cos(ka)*kl,ky=sy+Math.sin(ka)*kl;ctx.moveTo(sx,sy);ctx.lineTo(kx,ky);tips.push(kx,ky,0);
      if(on){const u=(simT*1.1+k.a+b.a)%1;sparks.push(sx+(kx-sx)*u,sy+(ky-sy)*u)}}}}
   ctx.stroke();
   const ts=Math.max(1,dpr*ui*(1+.6*s.det));ctx.fillStyle=rgba(col,Math.min(1,denA*1.8));for(let i=0;i<tips.length;i+=3)ctx.fillRect(tips[i]-ts/2,tips[i+1]-ts/2,ts,ts);
   // Кончик растущей ветки светится.
   for(let i=0;i<tips.length;i+=3)if(tips[i+2]){const z=dpr*ui*10;ctx.globalAlpha=.9;ctx.drawImage(spriteSeed,tips[i]-z/2,tips[i+1]-z/2,z,z)}
   ctx.globalAlpha=1;for(let i=0;i<sparks.length;i+=2){const z=dpr*ui*(7+3*s.det);ctx.drawImage(sprite,sparks[i]-z/2,sparks[i+1]-z/2,z,z)}}
  // Вблизи: синаптические связи с двумя ближайшими соседями.
  if(s.det>0){ctx.strokeStyle=rgba(col,.3*s.det*G.b);ctx.lineWidth=dpr*.8;ctx.beginPath();for(const [n] of list)for(const o of n.near||[]){if(o.lobe!==l||!o.vis)continue;ctx.moveTo(n.sx*dpr,n.sy*dpr);ctx.lineTo(o.sx*dpr,o.sy*dpr)}ctx.stroke()}
  for(const [n,it,str,lit] of list){
   const spr=l.bad?spriteBad:shapes[kindOf(it.id)][str<.35?'cold':'warm'],size=n.size;
   ctx.globalAlpha=n.alpha;ctx.drawImage(spr,n.sx*dpr-size/2,n.sy*dpr-size/2,size,size);
   if(n.flash>0){ctx.globalAlpha=n.flash*.8;ctx.strokeStyle=rgba(l.color,1);ctx.lineWidth=dpr*1.2;ctx.beginPath();ctx.arc(n.sx*dpr,n.sy*dpr,dpr*(6+(1-n.flash)*40),0,TAU);ctx.stroke()}
   if(lit||focusN===n){ctx.globalAlpha=.6+.3*Math.sin(simT*4);ctx.strokeStyle='#ffe2b8';ctx.lineWidth=dpr;ctx.beginPath();ctx.arc(n.sx*dpr,n.sy*dpr,size*.7,0,TAU);ctx.stroke()}
  }
  ctx.globalAlpha=1;
 }
 // Уровень и «хлебные крошки» под панелью кнопок; на уровне 3 — карточка записи прямо в сцене.
 function wrap(c,text,maxW,maxLines){const words=String(text).split(/\s+/),out=[];let line='';for(const w of words){const t=line?line+' '+w:w;if(c.measureText(t).width>maxW&&line){out.push(line);line=w;if(out.length>=maxLines)break}else line=t}if(out.length<maxLines&&line)out.push(line);if(out.length===maxLines&&words.join(' ').length>out.join(' ').length)out[maxLines-1]=out[maxLines-1].slice(0,-1)+'…';return out}
 function levelUi(){
  const c=lctx,zl=focusN?3:cam.zoom>1.6?2:1;if(cfg.clean)return;
  const d2=l=>(l.state.x-W/2)**2+(l.state.y-H/2)**2,zone=focusN?focusN.lobe:model.lobes.filter(l=>l.state.det>.3).sort((a,b)=>d2(a)-d2(b))[0];
  if(zl>1){const crumbs=['мозг',zone?trim(zone.label,18):'',focusN?trim(focusN.item.title,26):''].filter(Boolean).join(' › ');
   const y=((top.offsetTop||0)+(top.offsetHeight||0)+10)*dpr;c.font='600 '+Math.round(9.5*ui*dpr)+'px '+MONO;c.textAlign='left';c.textBaseline='top';
   c.fillStyle='rgba(0,0,0,.55)';const t='УРОВЕНЬ '+zl+'/3 · '+crumbs,w=c.measureText(t).width+12*dpr;c.fillRect(12*dpr,y,w,16*dpr*ui);c.fillStyle=PAL.hot;c.fillText(t,18*dpr,y+3*dpr*ui)}
  if(!focusN||cam.zoom<4)return;
  const n=focusN,it=n.item,r=recall[it.id],a=clamp((cam.zoom-4)/3,0,1),lk=model.links.filter(([x,y])=>x===it.id||y===it.id).map(([x,y])=>neurons.get(x===it.id?y:x)?.item?.title).filter(Boolean).slice(0,4);
  const fs=Math.round(11*ui*dpr),fm=Math.round(9.5*ui*dpr),pad=12*dpr,w=Math.min(340*dpr*ui,lab.width*.42);
  c.font='600 '+fs+'px '+MONO;const lines=wrap(c,it.title,w-pad*2,3);
  const rows=[it.meta,'сила памяти '+Math.round(Math.min(1,it.str??1)*100)+'%'+(r?' · вспоминала '+r.n+' '+plural(r.n,'раз','раза','раз'):''),'отростков '+n.den.length+(lk.length?' · связей '+(linkCount.get(it.id)||lk.length):'')];
  const h=pad*2+lines.length*fs*1.35+rows.length*fm*1.5+(lk.length?(lk.length+1)*fm*1.45:0)+fm;
  let x=n.sx*dpr+n.size*1.2+24*dpr,y=n.sy*dpr-h/2;if(x+w>lab.width-8*dpr)x=n.sx*dpr-n.size*1.2-24*dpr-w;y=clamp(y,8*dpr,lab.height-h-8*dpr);
  c.globalAlpha=a;c.fillStyle='rgba(6,4,2,.86)';c.fillRect(x,y,w,h);c.strokeStyle=rgba(n.lobe.bad?[255,74,56]:n.lobe.color,.6);c.lineWidth=dpr;c.strokeRect(x+.5,y+.5,w-1,h-1);
  c.strokeStyle='rgba(255,255,255,.5)';c.beginPath();c.moveTo(x,y+10*dpr);c.lineTo(x,y);c.lineTo(x+10*dpr,y);c.moveTo(x+w,y+h-10*dpr);c.lineTo(x+w,y+h);c.lineTo(x+w-10*dpr,y+h);c.stroke();
  c.beginPath();c.moveTo(n.sx*dpr,n.sy*dpr);c.lineTo(x<n.sx*dpr?x+w:x,y+h/2);c.strokeStyle=rgba(n.lobe.color,.5);c.stroke();
  let yy=y+pad;c.textAlign='left';c.textBaseline='top';c.font=Math.round(8.5*ui*dpr)+'px '+MONO;c.fillStyle=PAL.accent;c.fillText(('нейрон // '+n.lobe.label).toUpperCase(),x+pad,yy);yy+=fm*1.3;
  c.font='600 '+fs+'px '+MONO;c.fillStyle='#f4efe6';for(const t of lines){c.fillText(t,x+pad,yy);yy+=fs*1.35}
  c.font=fm+'px '+MONO;c.fillStyle='rgba(200,190,175,.85)';for(const t of rows){c.fillText(trim(t,46),x+pad,yy);yy+=fm*1.5}
  if(lk.length){c.fillStyle=PAL.accent;c.fillText('связи:',x+pad,yy);yy+=fm*1.45;c.fillStyle='rgba(230,222,208,.9)';for(const t of lk){c.fillText('→ '+trim(t,40),x+pad,yy);yy+=fm*1.45}}
  c.globalAlpha=1;c.textBaseline='alphabetic';
 }
 // Названия записей у крупных (приближенных) зон; без наложений, не больше 48 на кадр.
 function details(G,dimOf){
  const c=lctx,boxes=[],fs=Math.round(9.5*ui*dpr);let n=0;
  if(cfg.clean||cfg.labels==='off'||G.b<.9)return;
  c.font=fs+'px '+MONO;c.textBaseline='middle';c.textAlign='left';
  for(const l of model.lobes){const s=l.state;if(!s.det||dimOf(l)<.5)continue;
   const items=[...l.items].sort((a,b)=>(b.str??1)*b.weight-(a.str??1)*a.weight);
   for(const it of items){if(n>=48)break;const nn=neurons.get(it.id);if(!nn||!nn.vis)continue;
    const t=trim(it.title,W<640?18:30),w=c.measureText(t).width+8*dpr,h=fs+6*dpr,x=nn.sx*dpr+nn.size*.4+4*dpr,y=nn.sy*dpr-h/2;
    if(x+w>lab.width-2||boxes.some(b=>x<b[0]+b[2]&&x+w>b[0]&&y<b[1]+b[3]&&y+h>b[1]))continue;boxes.push([x,y,w,h]);n++;
    c.globalAlpha=s.det*clamp(nn.alpha*1.4,.35,1);c.fillStyle='rgba(0,0,0,.62)';c.fillRect(x,y,w,h);c.fillStyle=l.bad?'#ff8a7c':'#efe6d6';c.fillText(t,x+4*dpr,y+h/2)}}
  c.globalAlpha=1;c.textBaseline='alphabetic';
 }
 function trim(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s}
 // Подписи кластеров: рамка с названием и подзаголовком, точка на краю кластера и выноска.
 function labels(G,dimOf){
  const ctx=lctx;
  const small=W<520,fs1=(small?9.5:10.5)*ui,fs2=(small?8.5:9)*ui;
  for(const l of model.lobes){const s=l.state;if(G.b<.55)continue;
   if(s.x<0||s.x>W||s.y<0||s.y>H)continue; // зона за краем кадра (приближение) — без подписи
   const dim=dimOf(l);if(dim<.5&&W<640)continue;
   if(cfg.clean||cfg.labels==='off'||cfg.labels==='hover'&&hoverLobe!==l.id&&!focusLobes.has(l.id)&&!(pinned&&(pinned.l===l||pinned.n?.lobe===l)))continue;
   const right=Math.cos(s.a)>=-.15,title=trim(l.label,small?16:26),sub=trim(l.sub,small?20:30);
   ctx.font='600 '+Math.round(fs1*dpr)+'px '+MONO;const w1=ctx.measureText(title).width;ctx.font=Math.round(fs2*dpr)+'px '+MONO;const w2=ctx.measureText(sub).width;
   const pad=5*dpr,bw=Math.max(w1,w2)+pad*2,bh=(fs1+fs2)*dpr+pad*2.4;
   const ax=(s.x+(right?1:-1)*s.r*.62)*dpr,ay=(s.y-s.r*.62)*dpr;
   let bx=right?ax+10*dpr:ax-10*dpr-bw,by=ay-bh-6*dpr;
   const yMin=((top.offsetTop||0)+(top.offsetHeight||0)+4)*dpr,yMax=(hud.classList.contains('over')&&!cfg.clean?H-(hud.offsetHeight||0)-12:H-4)*dpr-bh;
   bx=clamp(bx,4*dpr,canvas.width-bw-4*dpr);by=clamp(by,yMin,Math.max(yMin,yMax));
   ctx.globalAlpha=clamp((G.b-.55)/.45,0,1)*(dim<.5?.3:1);
   ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(bx,by,bw,bh);ctx.strokeStyle=l.bad?'rgba(255,80,60,.6)':'rgba(255,255,255,.16)';ctx.lineWidth=dpr;ctx.strokeRect(bx+.5,by+.5,bw-1,bh-1);
   ctx.textAlign='left';ctx.textBaseline='top';
   ctx.font='600 '+Math.round(fs1*dpr)+'px '+MONO;ctx.fillStyle=l.bad?'#ff5a44':'#f4efe6';ctx.fillText(title,bx+pad,by+pad);
   ctx.font=Math.round(fs2*dpr)+'px '+MONO;ctx.fillStyle=l.bad?'rgba(255,120,100,.85)':'rgba(190,180,165,.75)';ctx.fillText(sub,bx+pad,by+pad*1.4+fs1*dpr);
   const lx=right?bx:bx+bw;ctx.strokeStyle=l.bad?'rgba(255,90,70,.6)':'rgba(255,255,255,.35)';ctx.beginPath();ctx.moveTo(lx,by+bh);ctx.lineTo(ax,ay);ctx.stroke();
   ctx.fillStyle=l.bad?'#ff5a44':'#fff';ctx.beginPath();ctx.arc(ax,ay,2*dpr,0,TAU);ctx.fill();
   if(l.bad){ctx.font='600 '+Math.round(fs1*dpr)+'px '+MONO;ctx.fillStyle='#ff4a38';ctx.textAlign='center';ctx.fillText('сбой · '+trim(l.items[0]?.title.split(' — ')[0]||'',14),s.x*dpr,(s.y+s.r*1.15)*dpr)}
  }
  ctx.globalAlpha=1;ctx.textBaseline='alphabetic';
 }

 /* ---------- Наведение и клик ---------- */
 function pick(x,y){
  let best=null,bd=(W<640?22:14)**2;
  for(const sd of seeds){if(sd.sx==null)continue;const d=(sd.sx-x)**2+(sd.sy-y)**2;if(d<bd)return {type:'seed',sd}}
  for(const n of neurons.values()){if(!n.vis)continue;const d=(n.sx-x)**2+(n.sy-y)**2;if(d<bd){bd=d;best=n}}
  if(best)return {type:'neuron',n:best};
  for(const l of model.lobes)for(const g of l.state.groupHits||[]){const d=(g.sx-x)**2+(g.sy-y)**2;if(d<(W<640?26:20)**2)return {type:'group',g,l}}
  for(const l of model.lobes){const s=l.state;if((s.x-x)**2+(s.y-y)**2<(s.r*1.1)**2)return {type:'lobe',l}}
  return null;
 }
 function showTip(hit,x,y,withButton){
  if(!hit){tip.hidden=true;return}
  tip.replaceChildren();
  if(hit.type==='seed'){const f=hit.sd.f;tip.append(el('div','brain-tip-k','предлагаю запомнить'),el('div','brain-tip-t',f.subject+' — '+f.predicate+' → '+f.object),el('div','brain-tip-m',(String(f.source||'').startsWith('note:')?'из заметки':'из чата')+(f.via==='model'?' · нашла модель':' · по правилам')));
   if(withButton){const row=el('div','brain-row'),ok=el('button','brain-btn','✓ Запомнить'),no=el('button','brain-btn','✗');ok.type=no.type='button';ok.onclick=()=>acceptSeed(f.id);no.onclick=()=>{TenmaLearn.reject(f.id);tip.hidden=true;pinned=null};row.append(ok,no);tip.append(row)}}
  else if(hit.type==='neuron'){const it=hit.n.item,r=recall[it.id];tip.append(el('div','brain-tip-k',hit.n.lobe.label),el('div','brain-tip-t',trim(it.title,140)),el('div','brain-tip-m',it.meta+' · сила памяти '+Math.round(Math.min(1,it.str??1)*100)+'%'+(r?' · вспоминала '+r.n+' '+plural(r.n,'раз','раза','раз'):'')+(linkCount.get(it.id)?' · связей '+linkCount.get(it.id):'')));
   if(withButton){const b=el('button','brain-btn','Открыть');b.type='button';b.onclick=()=>{recordRecall([it.id]);recall=readRecall();grow(hit.n,true);it.open()};tip.append(b)}}
  else if(hit.type==='group'){const g=hit.g,ks={star:'дел',drop:'заметок',crystal:'фактов'};tip.append(el('div','brain-tip-k',hit.l.label+' · группа'),el('div','brain-tip-t',g.ids.length+' '+plural(g.ids.length,'запись','записи','записей')),el('div','brain-tip-m',Object.entries(g.kinds).map(([k,v])=>v+' '+ks[k]).join(' · ')+' · двойной щелчок — раскрыть'))}
  else{const l=hit.l;tip.append(el('div','brain-tip-k','зона'),el('div','brain-tip-t',l.label),el('div','brain-tip-m',l.items.length+' '+plural(l.items.length,'запись','записи','записей')));
   if(withButton){const b=el('button','brain-btn','Открыть раздел');b.type='button';b.onclick=()=>l.open();tip.append(b)}}
  tip.hidden=false;tip.classList.toggle('pinned',!!withButton);
  const tw=tip.offsetWidth,th=tip.offsetHeight;tip.style.left=clamp(x+14,8,W-tw-8)+'px';tip.style.top=clamp(y+14,8,H-th-8)+'px';
 }
 const local=e=>{const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
 // Указатель: наведение — подсказка, клик — карточка; в 3D перетаскивание вращает, колесо и щипок приближают.
 const ptrs=new Map();let drag=null,moved=false,pinch=0,hoverLobe=null;
 canvas.addEventListener('pointerdown',e=>{ptrs.set(e.pointerId,local(e));moved=false;idleT=0;
  if(cfg.mode3d){drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId)}
  if(ptrs.size===2){const [a,b]=[...ptrs.values()];pinch=Math.hypot(a[0]-b[0],a[1]-b[1])}});
 canvas.addEventListener('pointermove',e=>{
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,local(e));
  if(cfg.mode3d&&ptrs.size===2&&pinch){const [a,b]=[...ptrs.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);camT.zoom=clamp(camT.zoom*d/pinch,.45,5);pinch=d;moved=true;idleT=0;dirty=true;return}
  if(drag&&ptrs.has(e.pointerId)){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;
   if(moved){camT.yaw+=dx*.008;camT.pitch=clamp(camT.pitch+dy*.006,-1.2,1.2);cam.yaw=camT.yaw;cam.pitch=camT.pitch;drag={x:e.clientX,y:e.clientY};idleT=0;tip.hidden=true;canvas.style.cursor='grabbing';dirty=true;return}}
  if(e.pointerType!=='mouse'||pinned)return;const [x,y]=local(e),hit=pick(x,y);hover=hit&&hit.type==='neuron'?hit.n.item:null;hoverLobe=hit?(hit.l||hit.n?.lobe)?.id||null:null;canvas.style.cursor=hit?'pointer':cfg.mode3d?'grab':'default';showTip(hit,x,y,false);dirty=true});
 const up=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=0;if(!ptrs.size)drag=null};
 canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
 canvas.addEventListener('pointerleave',()=>{if(!pinned){tip.hidden=true;hover=null;dirty=true}});
 // Приближение к точке под курсором: в 3D, на весь экран или с Ctrl (щипок на тачпаде); иначе колесо листает страницу.
 function zoomAt(x,y,z){if(focusN&&z<6){focusN=null}const Z0=camT.zoom,Z1=clamp(z,.45,focusN?12:5),qx=(x-view0.cx)/Z0-camT.px,qy=(y-view0.cy)/Z0-camT.py;camT.zoom=Z1;camT.px=(x-view0.cx)/Z1-qx;camT.py=(y-view0.cy)/Z1-qy;if(Z1<=1.001&&!cfg.mode3d){camT.px=0;camT.py=0}idleT=0;dirty=true}
 canvas.addEventListener('wheel',e=>{if(!cfg.mode3d&&!isFs()&&!e.ctrlKey)return;e.preventDefault();const [x,y]=local(e);zoomAt(x,y,camT.zoom*Math.exp(-e.deltaY*.0015))},{passive:false});
 // Двойной щелчок по зоне — подлететь к ней и рассмотреть записи; по пустому месту — вернуть вид.
 canvas.addEventListener('dblclick',e=>{const [x,y]=local(e),hit=pick(x,y),l=hit&&(hit.l||hit.n?.lobe);tip.hidden=true;pinned=null;
  // Три уровня: мозг → зона (двойной щелчок по зоне или группе) → нейрон (двойной щелчок по записи в приближенной зоне).
  if(hit&&hit.type==='neuron'&&(l.state.det>.3||focusN)){focusN=hit.n;camT.zoom=Math.max(camT.zoom,9);recordRecall([hit.n.item.id]);recall=readRecall();grow(hit.n,true)}
  else if(l){focusN=null;zoomLobe(l)}else{focusN=null;Object.assign(camT,{zoom:1,px:0,py:0})}idleT=0;dirty=true});
 function zoomLobe(l){camT.zoom=clamp(Math.min(W,H)*.32/Math.max(8,l.state.r/cam.zoom),2,5);camT.px=-l.state.qx;camT.py=-l.state.qy}
 canvas.addEventListener('click',e=>{if(moved){moved=false;return}const [x,y]=local(e),hit=pick(x,y);pinned=hit;hover=hit&&hit.type==='neuron'?hit.n.item:null;showTip(hit,x,y,true);if(hit&&hit.type==='lobe'){hit.l.state.pulse=1;if(hit.l.bad){tip.hidden=true;pinned=null;fixBox.hidden=false;renderFix()}}dirty=true});
 document.addEventListener('keydown',onKey);
 function onKey(e){if(e.key!=='Escape')return;if(!fixBox.hidden){fixBox.hidden=true;return}if(focusN){const l=focusN.lobe;focusN=null;zoomLobe(l);dirty=true;return}if(isFs()){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});stage.classList.remove('fs');setFs();return}if(pinned){pinned=null;tip.hidden=true;hover=null;dirty=true}}

 /* ---------- Обучение: новый факт прямо отсюда ---------- */
 teach.onsubmit=async e=>{
  e.preventDefault();const parts=tIn.value.split('|').map(x=>x.trim());
  if(parts.length!==3||parts.some(x=>!x)){tHint.textContent='Нужно три части через «|»: субъект | связь | объект.';tHint.classList.add('err');tIn.focus();return}
  tBtn.disabled=true;
  try{const r=await fetch('/api/facts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:parts[0],predicate:parts[1],object:parts[2],sourceId:'brain'})});const data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка');
   tIn.value='';tHint.classList.remove('err');tHint.textContent=data.duplicate?'Это я уже знаю.':data.conflicts?'Запомнила, но это противоречит прежним фактам ('+data.conflicts+').':'Запомнила. Смотри, как вспыхнул новый нейрон.';core.pulse=1;await loadFacts()}
  catch(err){tHint.textContent=err.message;tHint.classList.add('err')}finally{tBtn.disabled=false}
 };

 /* ---------- Данные и цикл ---------- */
 async function loadFacts(){
  try{const [f,c]=await Promise.all([fetch('/api/facts?limit=500').then(r=>r.ok?r.json():[]),fetch('/api/facts/conflicts?limit=100').then(r=>r.ok?r.json():[])]);facts=Array.isArray(f)?f.filter(x=>!x.valid_to):[];conflicts=Array.isArray(c)?c:[]}catch{}
  if(host.isConnected)apply();
  firstVisit=false;
 }
 /* ---------- Думает вслух, вспоминает, учится ---------- */
 const onThinking=e=>{thinking=!!e.detail?.on;thinkT=0;if(thinking){chatter=0;idleT=0}dirty=true};
 // Импульс из ядра к каждому вспомненному нейрону; запись становится «теплее».
 const onRecall=e=>{
  // Счётчики уже записал общий слушатель выше — здесь только перечитываем и анимируем.
  recall=readRecall();const ids=recallIds(e.detail).filter(id=>neurons.has(id));
  if(!ids.length)return;
  for(const id of ids)grow(neurons.get(id),true);
  coList=Object.entries(readCo()).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,200).map(([k,c])=>[...k.split('|'),c]);
  ids.slice(0,12).forEach((id,i)=>{const n=neurons.get(id);setTimeout(()=>{if(n.lobe.state)impulses.push({lobe:n.lobe,item:n.item,u:0,f:Math.floor(Math.random()*n.lobe.state.fil.length),recall:true})},i*140)});
  const first=neurons.get(ids[0]);coreKind='вспоминаю';coreText=first.item.title;coreTextT=3.5;
  for(const l of model.lobes)for(const it of l.items)it.str=strength(it);dirty=true;
 };
 function renderLearn(){
  const q=TenmaLearn.queue();
  seeds=q.slice(-24).map((f,i,arr)=>{const old=seeds.find(x=>x.f.id===f.id);return old?Object.assign(old,{f}):{f,a:TAU*i/Math.max(1,arr.length)+Math.random()*.3}});
  allBtn.hidden=q.length<2;learnBox.classList.toggle('empty',!q.length);
  learnList.replaceChildren(...q.slice(-12).reverse().map(f=>{const li=el('li');
   const t=el('span','brain-ev',f.subject+' — '+f.predicate+' → '+f.object),src=el('span','brain-learn-src',String(f.source||'').startsWith('note:')?'заметка':'чат');
   const ok=el('button','brain-btn','✓'),no=el('button','brain-btn','✗');ok.type=no.type='button';ok.title='Запомнить';no.title='Не то';
   ok.onclick=()=>acceptSeed(f.id);no.onclick=()=>TenmaLearn.reject(f.id);li.append(src,t,ok,no);return li}));
  if(!q.length)learnList.append(el('li','brain-muted',TenmaLearn.fromChat()?'Пока нечего предложить. Пишите аватару или нажмите «Разобрать заметки».':'Нажмите «Разобрать заметки», и я поищу в них факты.'));
  dirty=true;
 }
 async function acceptSeed(id){try{await TenmaLearn.accept(id);learnMsg.textContent='Запомнила.';learnMsg.classList.remove('err');tip.hidden=true;pinned=null;core.pulse=1}catch(e){learnMsg.textContent=e.message;learnMsg.classList.add('err')}}
 allBtn.onclick=async()=>{allBtn.disabled=true;for(const f of TenmaLearn.queue())await acceptSeed(f.id);allBtn.disabled=false};
 scanBtn.onclick=async()=>{scanBtn.disabled=true;learnMsg.classList.remove('err');learnMsg.textContent='Читаю заметки…';
  try{const r=await TenmaLearn.scanNotes(5);learnMsg.textContent=r.failed?'Не удалось разобрать заметок: '+r.failed+' — сервер не ответил. Попробуйте ещё раз.':r.scanned?'Прочитала заметок: '+r.scanned+', нашла фактов: '+r.found+(r.left?'. Осталось заметок: '+r.left+' — нажмите ещё раз.':'.'):'Новых заметок нет — все уже разобраны.';learnMsg.classList.toggle('err',!!r.failed)}catch(e){learnMsg.textContent=e.message;learnMsg.classList.add('err')}
  scanBtn.disabled=false};
 const onLearn=()=>renderLearn();
 window.addEventListener('tenma:thinking',onThinking);window.addEventListener('tenma:recall',onRecall);window.addEventListener('tenma:learn',onLearn);
 /* ---------- Разбор противоречий ---------- */
 // Совет: предпочтения («любит», «умеет») могут быть верны оба; остальное обычно меняется — новее вернее.
 const MULTI=/любит|обожает|нравит|умеет|говорит на|увлекается|играет|занимается|пьёт|пьет|ест|знает/i;
 const advice=c=>MULTI.test(c.predicate)?'both':'newer';
 function renderFix(){
  fixBtn.hidden=!conflicts.length;fixBtn.textContent='⚠ Разобрать противоречия ('+conflicts.length+')';
  if(fixBox.hidden)return;
  const head=el('div','brain-fix-head'),close=el('button','brain-btn','✕');close.type='button';close.setAttribute('aria-label','Закрыть');close.onclick=()=>{fixBox.hidden=true};
  head.append(el('div','brain-k','сбой узла // разбор противоречий'),close);
  if(!conflicts.length){fixBox.replaceChildren(head,el('p','brain-fix-ok','Противоречий нет — память согласована ✓'));return}
  fixBox.replaceChildren(head,...conflicts.map(c=>{
   const card=el('div','brain-fix-card'),adv=advice(c);
   card.append(el('div','brain-fix-q',c.subject+' — '+c.predicate+':'));
   const opt=(keep,label,meta)=>{const b=el('button','brain-fix-opt'+(adv===keep?' advised':''));b.type='button';b.append(el('span','',label),el('small','',meta+(adv===keep?' · совет':'')));b.onclick=()=>resolveFix(c,keep,b);return b};
   const t=x=>x?when(Date.parse(x)):'';
   card.append(el('div','brain-fix-row'));
   card.lastChild.append(opt('earlier','«'+c.earlier+'»','раньше · '+t(c.earlier_at)),opt('newer','«'+c.newer+'»','новее · '+t(c.newer_at)),opt('both','Оба верны','это не противоречие'));
   return card}));
 }
 async function resolveFix(c,keep,b){
  b.disabled=true;
  try{const r=await fetch('/api/facts/conflicts/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id,keep})});if(!r.ok&&r.status!==404)throw Error((await r.json().catch(()=>({}))).error||'Не удалось');
   coreKind='память';coreText=keep==='both'?'оба факта верны':'оставила «'+(keep==='earlier'?c.earlier:c.newer)+'»';coreTextT=3.5;core.pulse=1;await loadFacts()}
  catch(e){b.disabled=false;learnMsg.textContent=e.message;learnMsg.classList.add('err')}
 }
 fixBtn.onclick=()=>{fixBox.hidden=false;renderFix()};
 const onWorkspace=()=>apply();
 const onMemory=()=>loadFacts();
 const onWide=()=>placeHud();
 window.addEventListener('tenma:workspace',onWorkspace);window.addEventListener('tenma:memory',onMemory);wideQuery.addEventListener('change',onWide);
 const poll=setInterval(()=>{checkSleep();if(!document.hidden)loadFacts()},20000);
 // Фоновая «болтовня» синапсов: редкие слабые импульсы, чтобы мозг выглядел живым.
 let chatter=0;
 // Сон мозга: ночью (23:00–6:00) дыхание медленное, а импульсы тихо «переигрывают» записи за день.
 // tenma.brain.sleep: 'on' / 'off' — включить или выключить принудительно.
 let asleep=false;
 function checkSleep(){const o=read('tenma.brain.sleep','auto'),h=new Date().getHours(),was=asleep;asleep=o==='on'||(o!=='off'&&(h>=23||h<6));if(was!==asleep)renderHud()}
 function frame(now){
  if(!host.isConnected){destroy();return}
  raf=requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000||0);last=now;
  const blooming=!reduceQuery.matches&&now-bloomStart<2700,busy=impulses.length||blooming||thinking||coreTextT>0||core.pulse>0||Math.abs(camT.zoom-cam.zoom)+Math.abs(camT.yaw-cam.yaw)+Math.abs(camT.px-cam.px)+Math.abs(camT.py-cam.py)+Math.abs((cfg.mode3d?1:0)-cam.depth)>.002||[...neurons.values()].some(n=>n.flash>0);
  if(!still()){simT+=dt;chatter-=dt;if(chatter<=0&&model.lobes.length){
   if(asleep&&!thinking){const day=[];for(const l of model.lobes)for(const it of l.items)if(Date.now()-Math.max(it.ts||0,recall[it.id]?.t||0)<DAY)day.push([l,it]);
    const pick=day.length?day[Math.floor(Math.random()*day.length)]:null;if(pick){impulses.push({lobe:pick[0],item:pick[1],u:0,f:Math.floor(Math.random()*pick[0].state.fil.length),recall:true,soft:true});if(Math.random()<.15){coreKind='сон';coreText=trim(pick[1].title,24);coreTextT=2.5}}
    chatter=1.2+Math.random()*1.4}
   else{const l=model.lobes[Math.floor(Math.random()*model.lobes.length)];impulses.push({lobe:l,u:0,f:Math.floor(Math.random()*l.state.fil.length)});chatter=thinking?.08+Math.random()*.15:.4+Math.random()*1.1}}}
  else if(!busy&&!dirty)return;
  dirty=false;draw(dt);
  // Адаптивное качество: на слабой видеокарте частиц становится меньше, на сильной — возвращаются.
  fpsT+=dt;fpsN++;if(fpsT>=1.2){const fps=fpsN/fpsT;if(fps<42&&quality>.25)quality*=.8;else if(fps>56&&quality<baseQ)quality=Math.min(baseQ,quality*1.1);
   slowN=glr&&glMode!=='force'&&quality<=.26&&fps<20?slowN+1:0;if(slowN>=3){console.warn('Мозг: WebGL слишком медленный, перехожу на 2D');dropGL()}fpsT=0;fpsN=0}
 }
 function destroy(){cancelAnimationFrame(raf);clearInterval(poll);ro.disconnect();hudRo.disconnect();window.removeEventListener('tenma:workspace',onWorkspace);window.removeEventListener('tenma:memory',onMemory);wideQuery.removeEventListener('change',onWide);document.removeEventListener('keydown',onKey);document.removeEventListener('fullscreenchange',onFsChange);document.documentElement.classList.remove('brain-fs-lock');window.removeEventListener('tenma:thinking',onThinking);window.removeEventListener('tenma:recall',onRecall);window.removeEventListener('tenma:learn',onLearn);glr?.destroy()}
 checkSleep();setPalette();placeHud();resize();apply();renderLearn();loadFacts();raf=requestAnimationFrame(frame);
 return {destroy};
}
window.TenmaBrain={mount};
})();
