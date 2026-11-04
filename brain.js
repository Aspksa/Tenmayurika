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
 copper:{name:'Медь',haze:[150,62,22],tones:[[150,70,30],[226,128,60],[255,214,160]],colors:{personal:[236,140,66],work:[240,118,52],notes:[246,170,96],facts:[232,132,60],done:[150,110,80],core:[236,136,62],agents:[255,206,128]},
  spike:[236,140,70],link:[240,150,80],star:[220,120,60],starDot:[255,170,100],glow:['rgba(255,248,230,1)','rgba(255,196,120,.85)','rgba(230,110,40,.2)'],cold:['rgba(170,70,40,.9)','rgba(110,40,20,.6)','rgba(60,20,10,.15)'],accent:'#ee8a3c',hot:'#ffcf9a'},
 ice:{name:'Лёд',haze:[24,64,128],tones:[[36,84,150],[104,176,240],[222,242,255]],colors:{personal:[110,190,255],work:[84,156,255],notes:[150,215,255],facts:[100,180,250],done:[90,110,140],core:[120,190,255],agents:[196,236,255]},
  spike:[120,190,250],link:[140,200,255],star:[90,150,230],starDot:[160,210,255],glow:['rgba(240,250,255,1)','rgba(150,210,255,.85)','rgba(40,110,220,.2)'],cold:['rgba(40,80,140,.9)','rgba(20,50,100,.6)','rgba(10,20,50,.15)'],accent:'#6fc3ff',hot:'#cfeaff'},
 neon:{name:'Неон',haze:[88,18,120],tones:[[110,30,160],[236,64,206],[130,255,240]],colors:{personal:[255,70,200],work:[180,90,255],notes:[80,240,230],facts:[255,96,176],done:[120,90,140],core:[230,70,210],agents:[150,255,200]},
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
// Слова для тем и мыслей: без служебных, с грубой основой («работу» и «работа» → «работ»).
const STOP=new Set('что как где когда это мне меня тебя тебе ты вы про для или если так уже ещё еще есть был была было были мой моя мои моё твой твоя ли же бы на по из от до за не да нет все всё всех кто чем чего почему зачем сколько надо нужно можно какой какая какие каких скажи расскажи знаешь помнишь помни вспомни найди поищи очень тоже только этот эта эти того там тут здесь сейчас сегодня завтра вчера дело дела заметка факт'.split(' '));
const stem=w=>w.slice(0,Math.max(3,Math.min(6,w.length-1)));
function words(text,min=3){const out=[];for(const w of String(text||'').toLocaleLowerCase().replace(/ё/g,'е').match(/[a-zа-я0-9]+/g)||[])if(w.length>=min&&!STOP.has(w)&&!/^\d+$/.test(w))out.push(w);return out}
const stemsOf=it=>it.stems||(it.stems=new Set(words(it.title).map(stem)));
function ts(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function plural(n,a,b,c){const m=n%10,h=n%100;return m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c}
function buildModel(ws,facts,conflicts,exp=[],topics=[],jobs=[]){
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
 // Факты: темы памяти (сообщества связанных сущностей, алгоритм Лувена на сервере) получают свои зоны,
 // остальные — общая зона «факты». Если тем нет (старый сервер), зоны строятся по субъекту.
 let big,rest;
 if(topics.length){const byId=new Map(facts.map(f=>[f.id,f])),used=new Set();
  big=topics.filter(t=>t.size>=2).slice(0,6).map(t=>{const list=t.factIds.map(id=>byId.get(id)).filter(Boolean);list.forEach(f=>used.add(f.id));return {name:t.label,list,topic:t}}).filter(t=>t.list.length);
  rest=facts.filter(f=>!used.has(f.id))}
 else{const bySubject=new Map();for(const f of facts){const k=f.subject.toLocaleLowerCase();if(!bySubject.has(k))bySubject.set(k,{name:f.subject,list:[]});bySubject.get(k).list.push(f)}
  const subjects=[...bySubject.values()].sort((a,b)=>b.list.length-a.list.length);
  big=subjects.filter(s=>s.list.length>=2).slice(0,6);rest=subjects.filter(s=>!big.includes(s)).flatMap(s=>s.list)}
 // Подпись факта: откуда известно, уверенность, время и вид, сила памяти.
 const STAGE={dormant:'спит',fading:'угасает'};
 const factMeta=f=>{const m=f.meta||{};return ['факт',m.origin||f.source_id||'','уверенность '+Math.round((+f.confidence||0)*100)+'%',m.past?'в прошлом':'',m.since?'с '+m.since:'',m.until?'до '+m.until:'',m.opinion?'мнение':'',m.span&&m.span!=='может меняться'?m.span:'',STAGE[f.stage]||''].filter(Boolean).join(' · ')};
 const factItem=f=>({id:'f:'+f.id,title:f.subject+' — '+f.predicate+' → '+f.object,meta:factMeta(f),ts:ts(f.observed_at),weight:.6+.6*(+f.confidence||0),fact:f,open:()=>app()?.go('facts')});
 const factSub=s=>s.topic&&s.topic.parent?'выросла из «'+s.topic.parent+'»':s.topic&&s.topic.entities.length>1?'тема · '+s.topic.entities.slice(1,3).join(', '):[...new Set(s.list.map(f=>f.predicate))].slice(0,2).join(' · ');
 for(const s of big)add('fs:'+s.name.toLocaleLowerCase(),s.name.toLocaleLowerCase(),factSub(s),COLORS.facts,s.list.map(factItem),()=>app()?.go('facts'));
 add('facts','факты',rest.length+' '+plural(rest.length,'факт','факта','фактов'),COLORS.facts,rest.map(factItem),()=>app()?.go('facts'));
 add('conflicts','противоречия','сбой · '+conflicts.length,COLORS.conflicts,conflicts.map(c=>({id:'c:'+c.id,title:c.subject+' — '+c.predicate+': «'+c.earlier+'» или «'+c.newer+'»',meta:'противоречие',ts:ts(c.detected_at),weight:1.3,open:()=>app()?.go('facts')})),()=>app()?.go('facts'));
 // Агенты: их дела — нейроны своей зоны. 👍 — крупнее, 👎 и неудача горят (по ним агент учится).
 const openAgents=()=>window.TenmaAvatar?.openSettings?.('agents');
 const fixN=jobs.filter(j=>j.feedback==='fix').length,okN=jobs.filter(j=>j.feedback==='ok').length;
 add('agents','агенты',jobs.length+' '+plural(jobs.length,'дело','дела','дел')+(okN?' · 👍 '+okN:'')+(fixN?' · 👎 '+fixN:''),COLORS.agents||COLORS.done,jobs.map(j=>({id:'a:'+j.id,title:j.name+': '+j.task,meta:'агент · '+(j.ok?'готово':'не вышло')+(j.result?' · '+j.result.slice(0,90):'')+(j.feedback==='ok'?' · 👍':j.feedback==='fix'?' · 👎'+(j.note?' «'+j.note+'»':''):''),ts:ts(j.finishedAt),hot:j.feedback==='fix'||!j.ok,weight:j.feedback==='ok'?1.4:j.from&&j.from!=='yurika'?1.15:1,open:openAgents})),openAgents);
 for(const j of jobs)events.push({t:ts(j.finishedAt),kind:'агент',color:j.feedback==='fix'||!j.ok?COLORS.conflicts:COLORS.agents||COLORS.done,text:j.name+': '+j.task+(j.result?' → '+j.result.slice(0,80):''),bad:j.feedback==='fix'||!j.ok});
 // Журнал: что мозг узнал и когда.
 for(const t of tasks){events.push({t:ts(t.createdAt),kind:t.category==='work'?'работа':'дело',color:t.category==='work'?COLORS.work:COLORS.personal,text:t.title});if(t.doneAt)events.push({t:ts(t.doneAt),kind:'готово',color:COLORS.done,text:t.title})}
 for(const n of notes)events.push({t:ts(n.createdAt),kind:'заметка',color:COLORS.notes,text:n.title});
 for(const f of facts)events.push({t:ts(f.observed_at),kind:'факт',color:COLORS.facts,text:f.subject+' '+f.predicate+' '+f.object});
 for(const c of conflicts)events.push({t:ts(c.detected_at),kind:'сбой',color:COLORS.conflicts,text:c.subject+': '+c.earlier+' / '+c.newer,bad:true});
 // Опыт аватара: как поняла вопрос и что сделала; поправки пользователя видны отдельно.
 for(const e of exp){if(String(e.source||'').startsWith('agent:'))continue;const did=e.tools.length?e.tools.join(', '):(e.recalled.facts.length+e.recalled.notes.length)?'вспомнила '+(e.recalled.facts.length+e.recalled.notes.length):'не нашла';
  events.push({t:ts(e.at),kind:e.feedback==='fix'?'поправка':e.feedback==='ok'?'поняла':'опыт',color:e.feedback==='fix'?COLORS.conflicts:COLORS.done,text:'«'+e.question+'» → '+(e.feedback==='fix'&&e.correction?e.correction:did)})}
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
const LEARN_MAX=60,LEARN_Q='tenma.learn.queue.v1',LEARN_CHAT='tenma.learn.chat',LEARN_SCANNED='tenma.learn.scanned.v1';
function chunks(text,max){const out=[];let t=String(text);while(t.length>max){let cut=Math.max(t.lastIndexOf('. ',max),t.lastIndexOf('\n',max),t.lastIndexOf('! ',max));if(cut<max*.5)cut=max;else cut++;out.push(t.slice(0,cut));t=t.slice(cut)}if(t.trim())out.push(t);return out}
const TenmaLearn={
 fromChat:()=>read(LEARN_CHAT,true)!==false,
 setFromChat(v){write(LEARN_CHAT,!!v)},
 queue:()=>{const q=read(LEARN_Q,[]);return Array.isArray(q)?q:[]},
 full:()=>TenmaLearn.queue().length>=LEARN_MAX,
 save(q){write(LEARN_Q,q.slice(-LEARN_MAX));window.dispatchEvent(new CustomEvent('tenma:learn'))},
 // Возвращает число новых кандидатов или null, если разобрать не удалось (сеть, ошибка сервера).
 async learn(text,source){
  try{const r=await fetch('/api/learn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,source})});if(!r.ok)return null;
   const data=await r.json(),q=TenmaLearn.queue(),key=f=>(f.subject+'|'+f.predicate+'|'+f.object).toLocaleLowerCase();let added=0,dropped=0;
   // Новые версии известных фактов тоже предлагаются (старая уйдёт в историю как противоречие при разборе).
   for(const f of [...(data.facts||[]),...(data.updates||[]).map(u=>u.fact)]){if(q.some(x=>key(x)===key(f)))continue;if(q.length>=LEARN_MAX){dropped++;continue}q.push({id:'q'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),subject:f.subject,predicate:f.predicate,object:f.object,source,via:data.source,at:Date.now()});added++}
   if(added)TenmaLearn.save(q);
   // Очередь полна: часть кандидатов не поместилась — заметку не помечаем, её разберут снова после чистки очереди.
   return dropped?{added,full:true}:added}catch{return null}
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
  const notes=(window.TenmaApp?.workspace?.notes||[]),done=read(LEARN_SCANNED,{});let n=0,ok=0,found=0,failed=0,full=false;
  for(const note of notes){const ver=note.updatedAt||note.createdAt||'';if(done[note.id]===ver)continue;if(n>=limit)break;if(TenmaLearn.full()){full=true;break}n++;
   // Неудачный разбор не помечаем — заметка останется в очереди на следующую попытку.
   // Сервер разбирает до 8000 символов за раз — длинную заметку отправляем кусками по границам предложений.
   let bad=false,stop=false;
   for(const part of chunks(note.title+'. '+(note.content||''),7500)){const r=await TenmaLearn.learn(part,'note:'+note.id);if(r===null){bad=true;break}if(r.full){found+=r.added;stop=true;break}found+=r}
   if(bad){failed++;continue}if(stop){full=true;break}ok++;done[note.id]=ver}
  write(LEARN_SCANNED,done);return {full,scanned:ok,found,failed,left:notes.filter(x=>done[x.id]!==(x.updatedAt||x.createdAt||'')).length};
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
// Связи с сервера (growth.js): общие для всех браузеров, крепнут от совместных вспоминаний и угасают без дела.
// Заряд сервера +1 сравним со счётчиком этого браузера; берётся большее.
let srvBonds=[];
// Навыки запоминания — «органы» вокруг ядра: чем чаще навык применяется, тем он крупнее; новые на пробе мерцают.
let organs=[];const organFlash=new Map();
function buildCo(){
 const m=new Map(Object.entries(readCo()));
 for(const b of srvBonds){const k=[b.a,b.b].sort().join('|'),c=b.charge+1;if(c>(m.get(k)||0))m.set(k,c)}
 return [...m].filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,200).map(([k,c])=>[...k.split('|'),c]);
}
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
 const cfg=Object.assign({paused:false,mode3d:false,labels:'all',clean:false,palette:'copper',thoughts:null,diaTab:'mind'},read(CFG_KEY,{}));
 usePalette(cfg.palette);
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n};
 const stage=el('div','brain-stage'),canvas=el('canvas','brain-fx'),tip=el('div','brain-tip');tip.hidden=true;
 // Слои: WebGL — частицы и свечение; 2D — нити, нейроны, импульсы (смешиваются «экраном»); сверху — подписи.
 const glc=el('canvas','brain-gl'),lab=el('canvas','brain-lab'),grain=el('div','brain-grain');
 glc.setAttribute('aria-hidden','true');lab.setAttribute('aria-hidden','true');grain.setAttribute('aria-hidden','true');
 const top=el('div','brain-top'),bar=el('div','brain-bar'),ctrl=el('div','brain-ctrl');
 const pauseBtn=el('button','brain-btn');pauseBtn.type='button';
 const resetBtn=el('button','brain-btn','Пробудить');resetBtn.type='button';resetBtn.title='Заново вырастить мозг из ядра';
 const find=el('input','brain-find');find.type='search';find.placeholder='Найти… или «Анна → Казань»';find.setAttribute('aria-label','Найти в мозге: зона, дело, заметка или факт');
 const btn3d=el('button','brain-btn');btn3d.type='button';btn3d.title='Объёмный режим: тяните мышью или пальцем, колесо или щипок — приблизить';
 const labelBtn=el('button','brain-btn');labelBtn.type='button';labelBtn.title='Подписи зон: все, только при наведении или скрыть';
 const cleanBtn=el('button','brain-btn brain-keep');cleanBtn.type='button';cleanBtn.title='Чисто: только рой, без панелей и подписей';
 const fsBtn=el('button','brain-btn brain-keep','⛶');fsBtn.type='button';fsBtn.title='На весь экран (выход — Esc)';fsBtn.setAttribute('aria-label','На весь экран');
 const viewBtn=el('button','brain-btn','⟲ Вид');viewBtn.type='button';viewBtn.title='Вернуть вид по центру (двойной щелчок по зоне — приблизить её)';
 const palBtn=el('button','brain-btn');palBtn.type='button';palBtn.title='Палитра роя: медь, лёд, неон';
 // Вид (3D, подписи, палитра, центр, пробуждение, пауза) — в одном меню, чтобы сверху не было ряда кнопок.
 const menuWrap=el('div','brain-menu-wrap'),menuBtn=el('button','brain-btn','⋯ Вид'),menu=el('div','brain-menu');
 menuBtn.type='button';menuBtn.title='Вид: 3D, подписи, палитра, центр, движение';menuBtn.setAttribute('aria-haspopup','true');menuBtn.setAttribute('aria-expanded','false');menu.hidden=true;
 menu.append(btn3d,labelBtn,palBtn,viewBtn,resetBtn,pauseBtn);menuWrap.append(menuBtn,menu);
 const setMenu=open=>{menu.hidden=!open;menuBtn.setAttribute('aria-expanded',String(open))};
 menuBtn.onclick=e=>{e.stopPropagation();setMenu(menu.hidden)};
 const onDocClick=e=>{if(!menu.hidden&&!menuWrap.contains(e.target))setMenu(false)};document.addEventListener('click',onDocClick);
 // Мысли (живая лента) и время (как мозг рос по дням).
 const thinkBtn=el('button','brain-btn','✧ Мысли');thinkBtn.type='button';thinkBtn.title='Живая лента: о чём я думаю прямо сейчас';
 const timeBtn=el('button','brain-btn','◷ Время');timeBtn.type='button';timeBtn.title='Как мозг рос день за днём';
 ctrl.append(find,thinkBtn,timeBtn,menuWrap,cleanBtn,fsBtn);top.append(bar,ctrl);
 const empty=el('div','brain-empty');empty.hidden=true;
 const fixBox=el('div','brain-fix');fixBox.hidden=true;fixBox.setAttribute('role','dialog');fixBox.setAttribute('aria-label','Разбор противоречий');
 // Почти-дубли и обзор памяти — такие же окна поверх роя.
 const dupBox=el('div','brain-fix brain-calm');dupBox.hidden=true;dupBox.setAttribute('role','dialog');dupBox.setAttribute('aria-label','Похожие факты');
 const ovBox=el('div','brain-fix brain-calm');ovBox.hidden=true;ovBox.setAttribute('role','dialog');ovBox.setAttribute('aria-label','Обзор памяти');
 const diaBox=el('div','brain-fix brain-calm');diaBox.hidden=true;diaBox.setAttribute('role','dialog');diaBox.setAttribute('aria-label','Дневник мозга');
 // Звезда — отображение настоящей работы библиотеки, а не искусственная активность.
 const guardianStar=el('button','brain-guardian-star');guardianStar.type='button';guardianStar.setAttribute('aria-label','Хранитель библиотеки');guardianStar.setAttribute('aria-expanded','false');guardianStar.title='Хранитель библиотеки';guardianStar.dataset.state='unknown';
 const guardianBox=el('div','brain-fix brain-calm brain-guardian-dialog');guardianBox.hidden=true;guardianBox.setAttribute('role','dialog');guardianBox.setAttribute('aria-label','Хранитель библиотеки');
 const diaBtn=el('button','brain-btn','✦ Дневник');diaBtn.type='button';diaBtn.title='О чём мозг думал в простое: выводы, навыки из опыта, ваши предпочтения, сводки тем, причинные связи';
 const ovBtn=el('button','brain-btn','☰ Обзор');ovBtn.type='button';ovBtn.title='Обзор памяти: темы, самые связанные узлы, что менялось за неделю';
 ctrl.prepend(diaBtn);ctrl.prepend(ovBtn);ctrl.prepend(find);
 // Панель «Мысли»: что делаю в голове — план ответа, подвопросы, сверка, догадки, вопросы, забывание.
 const thBox=el('aside','brain-thoughts'),thHead=el('div','brain-k'),thList=el('ul','brain-th-list');thHead.append(el('span','','05 // мысли'),el('span','brain-th-live','● live'));thBox.append(thHead,thList);thBox.setAttribute('aria-label','Мысли');thBox.setAttribute('aria-live','polite');
 // Ползунок времени.
 const tmBox=el('div','brain-time'),tmPlay=el('button','brain-btn','▶'),tmRange=el('input'),tmLabel=el('span','brain-time-l'),tmClose=el('button','brain-btn','✕');
 tmPlay.type=tmClose.type='button';tmPlay.setAttribute('aria-label','Проиграть рост');tmClose.setAttribute('aria-label','Вернуться в сегодня');tmRange.type='range';tmRange.min='0';tmRange.step='1';tmRange.setAttribute('aria-label','День');tmBox.hidden=true;tmBox.append(tmPlay,tmRange,tmLabel,tmClose);
 stage.append(glc,canvas,lab,grain,top,thBox,tmBox,tip,empty,guardianStar,fixBox,dupBox,ovBox,diaBox,guardianBox);
 stage.setAttribute('role','group');
 const teach=el('form','brain-teach'),tIn=el('input'),tBtn=el('button','primary','Научить');
 tIn.placeholder='Научи меня: Анна | любит | зелёный чай';tIn.setAttribute('aria-label','Новый факт: субъект | связь | объект');tIn.maxLength=900;tBtn.type='submit';
 const tHint=el('span','brain-hint','Факт пишется как «субъект | связь | объект». Он сразу станет новым нейроном.');
 teach.append(tIn,tBtn,tHint);
 const learnBox=el('section','brain-learn'),learnHead=el('div','brain-learn-head');
 const learnTitle=el('div','brain-k','04 // предлагаю запомнить');
 const chatToggle=el('label','brain-check'),chatCb=el('input');chatCb.type='checkbox';chatCb.checked=TenmaLearn.fromChat();chatToggle.append(chatCb,el('span','','учиться из чата'));
 chatCb.onchange=()=>TenmaLearn.setFromChat(chatCb.checked);
 // Фоновое обучение на сервере: весь чат хранится, факты из каждого сообщения запоминаются сразу.
 const autoToggle=el('label','brain-check'),autoCb=el('input');autoCb.type='checkbox';autoCb.checked=true;autoToggle.title='Сохранять весь чат и запоминать факты из него сразу, без подтверждения';autoToggle.append(autoCb,el('span','','учиться фоном'));
 const chatStat=el('span','brain-hint brain-chatstat');
 function showChatStat(st){if(!st)return;autoCb.checked=!!st.auto;chatToggle.style.display=st.auto?'none':'';chatStat.textContent='чат: '+st.messages+' сообщ. · выучено фактов: '+st.facts+(st.pending?' · разбираю: '+st.pending:'')}
 async function loadChatStat(){try{const r=await fetch('/api/chatlog?limit=1');if(r.ok)showChatStat(await r.json())}catch{}}
 autoCb.onchange=async()=>{try{const r=await fetch('/api/chatlog/auto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:autoCb.checked})});if(r.ok)showChatStat(await r.json())}catch{}};
 const scanBtn=el('button','brain-btn','Разобрать заметки');scanBtn.type='button';scanBtn.title='Найти факты в заметках (с моделью — её силами, без неё — по простым правилам)';
 const allBtn=el('button','brain-btn','✓ Запомнить всё');allBtn.type='button';
 const learnMsg=el('span','brain-hint'),learnList=el('ul','brain-learn-list');
 const fixBtn=el('button','brain-btn brain-alarm-btn');fixBtn.type='button';fixBtn.hidden=true;
 const dupBtn=el('button','brain-btn');dupBtn.type='button';dupBtn.hidden=true;dupBtn.title='Почти одинаковые факты: «Казань» и «г. Казань» — можно слить';
 learnHead.append(learnTitle,autoToggle,chatToggle,scanBtn,allBtn,fixBtn,dupBtn);learnBox.append(learnHead,chatStat,learnList,learnMsg);
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

 let W=0,H=0,dpr=1,ui=1,quality=1,baseQ=1,fpsT=0,fpsN=0,model={lobes:[],events:[],links:[],facts:0},facts=[],conflicts=[],exp=[],topics=[],jobs=[],dups=[],impactIds=new Set(),impactOf=null,impactInfo=null;
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
 let view0={cx:0,cy:0},focusZ=0,focusN=null,idleT=0,focusQ='',focusLobes=new Set(),focusItems=new Set(),thinking=false,thinkT=0,seeds=[],thought=null;
 // Сила памяти: сколько раз и когда запись вспоминали (хранится в этом браузере).
 let recall=readRecall(),srv={};
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
 // Поиск: по названиям здесь же, затем гибридное вспоминание сервера (слова, смысл, связи) добавляет найденное.
 // «Анна → Казань» — путь между сущностями: цепочка фактов подсвечивается и пробегает импульсом.
 let findT=0,findSeq=0;
 function setFocus(q){
  clearTimeout(findT);const seq=++findSeq,raw=q.trim(),pathM=raw.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
  if(raw.length>=2)findT=setTimeout(async()=>{
   try{
    if(pathM){const r=await fetch('/api/facts/path?from='+encodeURIComponent(pathM[1].trim())+'&to='+encodeURIComponent(pathM[2].trim())+'&depth=4');if(!r.ok||seq!==findSeq)return;const d=await r.json();if(seq!==findSeq)return;
     const ids=d.facts.map(f=>'f:'+f.id).filter(id=>neurons.has(id));focusItems=new Set(ids);focusLobes=new Set(ids.map(id=>neurons.get(id).lobe.id));
     find.classList.toggle('miss',!ids.length);find.title=!d.from||!d.to?'Не знаю «'+(!d.from?pathM[1]:pathM[2]).trim()+'»':ids.length?'Путь: '+d.facts.map(f=>f.subject+' — '+f.predicate+' → '+f.object).join(' · '):'Связи не нашла (до 4 шагов)';
     if(ids.length){coreKind='путь';coreText=d.from+' → '+d.to+' · '+ids.length+' '+plural(ids.length,'шаг','шага','шагов');coreTextT=4;buildChain(ids,d.from+' → '+d.to)}dirty=true;return}
    const r=await fetch('/api/recall?q='+encodeURIComponent(raw));if(!r.ok||seq!==findSeq)return;const d=await r.json();if(seq!==findSeq)return;
    for(const x of [...d.facts.map(f=>'f:'+f.id),...d.notes.map(n=>'n:'+n.id)]){const n=neurons.get(x);if(!n)continue;focusItems.add(x);focusLobes.add(n.lobe.id)}
    find.classList.toggle('miss',!focusLobes.size);dirty=true;
   }catch{}},pathM?150:280);
  if(pathM){focusQ='';focusLobes=new Set();focusItems=new Set();dirty=true;return}
  find.title='';
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
 const GROUP_AT=40,NEURON_BUDGET=700;
 let anyFlash=false,gBoxes=[];
 function grow(n,animate){
  const r=recall[n.item.id],want=n.base+Math.min(10,r?r.n:0);
  while(n.den.length<want){const q=rng(hash(n.item.id)+n.den.length*7919);n.den.push({a:TAU*q(),l:.5+.9*q(),c:(q()-.5)*.9,kids:q()<.5?[{at:.5+.3*q(),a:(q()-.5)*1.4,l:.3+.4*q()}]:[],born:animate?performance.now():0})}
 }
 // Два ближайших соседа — считаются только для нейронов, которые реально рисуются вблизи.
 function nearOf(n){if(n.near)return n.near;const pool=n.group?n.group.ids:n.lobe.items.map(it=>it.id);let a=null,b=null,da=1e9,db=1e9;
  for(const id of pool){const o=neurons.get(id);if(!o||o===n)continue;const d=(o.ox-n.ox)**2+(o.oy-n.oy)**2+(o.oz-n.oz)**2;if(d<da){b=a;db=da;a=o;da=d}else if(d<db){b=o;db=d}}
  return n.near=[a,b].filter(Boolean)}
 function sprout(n){n.pending=false;n.bornT=performance.now();n.den.forEach((b,i)=>{b.born=n.bornT+200+i*110})}
 function strength(it){
  // Сила складывается из вспоминаний в этом браузере и на сервере; польза (👍/👎) добавляет или убавляет.
  const r=recall[it.id],sv=srv[it.id],t=Math.max(it.ts||0,r?r.t:0,sv?sv.t:0),n=Math.max(r?r.n:0,sv?sv.n:0),age=t?(Date.now()-t)/DAY:30;
  if(it.id.startsWith('t:')&&!it.dim)return clamp(.75+(it.hot?.35:0),.75,1.25); // открытое дело всегда «тёплое»
  // Спящие и угасающие факты (сила памяти на сервере) — тусклее.
  const stageK=it.fact?.stage==='dormant'?.7:it.fact?.stage==='fading'?.45:1;
  if(stageK<1)return clamp(stageK*(.12+.88*Math.exp(-age/21)+.12*Math.log2(1+n)),.08,1);
  return clamp(.12+.88*Math.exp(-age/21)+.12*Math.log2(1+n)+(sv?clamp(.08*(sv.ok-sv.fix),-.2,.2):0),.12,1.3);
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
 let timeCut=null,prevCut=null,timeSpan=null;
 function apply(){
  const ws=window.TenmaApp?.workspace||{notes:[],tasks:[]};
  model=buildModel(ws,facts,conflicts,exp,topics,jobs);
  // Ползунок времени: видны только записи, появившиеся до выбранного дня.
  {let lo=Infinity;for(const l of model.lobes)for(const it of l.items)if(it.ts&&it.ts<lo)lo=it.ts;timeSpan=Number.isFinite(lo)?{from:lo,to:Date.now()}:null}
  if(timeCut){for(const l of model.lobes)l.items=l.items.filter(it=>!it.ts||it.ts<=timeCut);model.lobes=model.lobes.filter(l=>l.items.length);model.events=model.events.filter(e=>!e.t||e.t<=timeCut)}
  const nowT=timeCut||Date.now(),alive=new Set();
  for(const l of model.lobes){
   alive.add(l.id);
   let s=lobeState.get(l.id);
   // Зрелость зоны: молодая (мало записей, появилась недавно) — тусклее и реже, зрелая — плотная.
   {let first=Infinity;for(const it of l.items)if(it.ts&&it.ts<first)first=it.ts;const age=Number.isFinite(first)?(nowT-first)/DAY:30;l.mature=clamp(.3+.22*Math.log10(1+l.items.length)+.45*Math.min(1,Math.max(0,age)/30),.3,1);
    if(l.id!=='conflicts')l.sub=l.sub+(l.mature<.5?' · молодая':l.mature>=.85?' · зрелая':'')}
   const n=l.items.length,want=Math.round(clamp(500+560*Math.log10(1+n),600,2400)*(.55+.45*l.mature)); // 10 → ~1100, 100 → ~1600, 1000 → ~2200
   if(!s){s={parts:makeParticles(want,hash(l.id),MULT.lobe),want,pulse:0,x:0,y:0,r:0,fil:[],streaks:[],sats:[],seed:hash(l.id)};lobeState.set(l.id,s);
    if(timeCut&&applied&&!reduceQuery.matches){s.birth=performance.now();s.from=null}
    else if(applied&&!firstVisit&&!reduceQuery.matches&&l.items.some(it=>!seen.has(it.id))){s.birth=performance.now();s.from=l.id.startsWith('fs:')&&lobeState.has('facts')?'facts':null;coreKind='деление';coreText='новая зона «'+l.label+'»';coreTextT=4}}
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
    // Шаг времени вперёд: записи этого дня прилетают импульсами из ядра.
    if(timeCut&&prevCut&&it.ts>prevCut&&it.ts<=timeCut&&impulses.length<30)impulses.push({lobe:l,item:it,u:0,f:Math.floor(Math.random()*l.state.fil.length||0),recall:true});
    // Новая запись: импульс несёт её из ядра, а на месте нейрон распускается (до прилёта он скрыт).
    if(!seen.has(it.id)){seen.add(it.id);if(!firstVisit){if(impulses.length<24){nn.pending=true;impulses.push({lobe:l,item:it,u:0,f:Math.floor(Math.random()*l.state.fil.length),big:true})}else sprout(nn);coreText=it.title;coreKind=l.label;coreTextT=4.5}}
   }
  }
  for(const k of [...lobeState.keys()])if(!alive.has(k)){glr?.free(lobeState.get(k).parts);lobeState.delete(k)}
  for(const k of [...neurons.keys()])if(!alive.has(k))neurons.delete(k);
  // Большие зоны (больше 40 записей) делятся на подзоны по темам — частым словам в названиях.
  // Записи без общей темы собираются в группы по направлению от центра зоны.
  for(const l of model.lobes){const s=l.state,ns=l.items.map(it=>neurons.get(it.id)).filter(Boolean);
   for(const n of ns){n.near=null;n.group=null}
   if(ns.length>GROUP_AT){
    const K=clamp(Math.round(Math.sqrt(ns.length)*.8),6,32),freq=new Map(),form=new Map();
    for(const n of ns){const seenW=new Set();for(const w of words(n.item.title,4)){const k=stem(w);if(seenW.has(k))continue;seenW.add(k);freq.set(k,(freq.get(k)||0)+1);if(!form.has(k))form.set(k,w)}}
    const min=Math.max(3,ns.length*.02),topics=[...freq].filter(([,c])=>c>=min&&c<ns.length*.9).sort((a,b)=>b[1]-a[1]).slice(0,K).map(([k])=>k);
    const dirs=Array.from({length:K},(_,i)=>{const y=1-2*(i+.5)/K,r=Math.sqrt(1-y*y),a=i*2.39996;return [Math.cos(a)*r,y,Math.sin(a)*r]});
    const gs=dirs.map((d,i)=>({ids:[],ox:0,oy:0,oz:0,kinds:{},topic:topics[i]?form.get(topics[i]):'',key:topics[i]||'',d}));
    const tIdx=new Map(topics.map((k,i)=>[k,i]));
    for(const n of ns){let bi=-1,bc=0;for(const k of stemsOf(n.item)){const i=tIdx.get(k);if(i!=null&&freq.get(k)>bc){bc=freq.get(k);bi=i}}
     if(bi<0){let bd=-9;dirs.forEach((d,i)=>{if(gs[i].key)return;const v=d[0]*n.ox+d[1]*n.oy+d[2]*n.oz;if(v>bd){bd=v;bi=i}});if(bi<0)bi=topics.length?dirs.length-1:0}
     const g=gs[bi];g.ids.push(n.item.id);const k=kindOf(n.item.id);g.kinds[k]=(g.kinds[k]||0)+1;n.group=g}
    // Записи темы собираются вокруг её направления — подзоны видно и вблизи.
    for(const g of gs){if(!g.ids.length)continue;const q=rng(hash(l.id+g.key));const R=clamp(.07+.004*Math.sqrt(g.ids.length),.08,.2);
     for(const id of g.ids){const n=neurons.get(id),u=unit(rng(hash(id))),k=Math.cbrt(q());n.moved=true;n.ox=g.d[0]*.58+u[0]*R*k;n.oy=g.d[1]*.58+u[1]*R*k;n.oz=g.d[2]*.58+u[2]*R*k;g.ox+=n.ox;g.oy+=n.oy;g.oz+=n.oz}}
    s.groups=gs.filter(g=>g.ids.length).map(g=>Object.assign(g,{ox:g.ox/g.ids.length,oy:g.oy/g.ids.length,oz:g.oz/g.ids.length,kind:Object.entries(g.kinds).sort((a,b)=>b[1]-a[1])[0][0]}));
   }else{s.groups=null;for(const n of ns)if(n.moved){const q=rng(hash(n.item.id)),d=unit(q),k=.15+.6*Math.cbrt(q());n.ox=d[0]*k;n.oy=d[1]*k;n.oz=d[2]*k;n.moved=false}}
   // Порядок для подписей вблизи: сначала сильные и важные записи (раньше сортировалось каждый кадр).
   l.ranked=[...l.items].sort((a,b)=>(b.str??1)*b.weight-(a.str??1)*a.weight);
  }
  linkCount=new Map();for(const [a,b] of model.links){linkCount.set(a,(linkCount.get(a)||0)+1);linkCount.set(b,(linkCount.get(b)||0)+1)}
  prevCut=timeCut;
  if(seen.size>4000&&!timeCut)seen=new Set([...neurons.keys()]);
  write(SEEN_KEY,[...seen]);
  coList=buildCo();
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
  now=performance.now();anyFlash=false;gBoxes=[];
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
   const lit=focusItems.has(a)||focusItems.has(b)||impactIds.has(a)&&impactIds.has(b)||hl===a||hl===b,base=(focusing||hl?(lit?.85:.05):.28)*G.b*(kind==='obj'?.8:1);
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
  drawThought(G);
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
  drawOrgans(G,dt,dim);
 }
 // Органы: навыки запоминания на орбите ядра. Размер — сколько раз применялся, яркость — польза записанного,
 // мерцание — навык на пробе, вспышка — навык только что появился или уточнился.
 function drawOrgans(G,dt,dim){
  const list=organs.filter(o=>o.status!=='retired');if(!list.length||!sprite)return;
  const n=list.length,turn=still()?0:simT*.04,labels=!cfg.clean&&cfg.labels==='all'&&dim>.5;
  if(labels){lctx.font='600 '+Math.round(8.5*ui*dpr)+'px '+MONO;lctx.textAlign='center';lctx.textBaseline='top'}
  list.forEach((o,i)=>{
   const a=turn+i/n*TAU,d=G.coreR*1.38,x=G.cx+Math.cos(a)*d,y=G.cy+Math.sin(a)*d*.72;
   let fl=organFlash.get(o.name)||0;if(fl>0){fl=Math.max(0,fl-dt*.25);if(fl)organFlash.set(o.name,fl);else organFlash.delete(o.name)}
   const size=G.coreR*(.09+.08*Math.min(1,Math.log1p(o.uses||0)/4))*(1+fl*.8),flick=o.status==='trial'?.65+.35*Math.sin(simT*5+i):1;
   ctx.strokeStyle=rgba(PAL.link,.16*dim*flick);ctx.lineWidth=dpr*.8;ctx.beginPath();ctx.moveTo((G.cx+Math.cos(a)*G.coreR*.9)*dpr,(G.cy+Math.sin(a)*G.coreR*.9*.72)*dpr);ctx.lineTo(x*dpr,y*dpr);ctx.stroke();
   ctx.globalAlpha=clamp((.3+.5*(o.value??.5)+fl*.5)*dim*flick,0,1);ctx.drawImage(sprite,(x-size)*dpr,(y-size)*dpr,size*2*dpr,size*2*dpr);ctx.globalAlpha=1;
   if(labels){lctx.globalAlpha=.7*dim;lctx.fillStyle=PAL.hot;lctx.fillText(trim(o.title,18)+(o.status==='trial'?' ·проба':''),x*dpr,(y+size*.8)*dpr);lctx.globalAlpha=1}
  });
  if(labels)lctx.textBaseline='alphabetic';
  if(organFlash.size)dirty=true;
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
  const rot=s.ang,wob=still()?0:simT,warm=(.55+.45*Math.min(1,l.str??1))*(.6+.4*(l.mature??1)),blur=blurOf(s.depth,G),bz=1+blur*.12,ba=1/(1+blur*.35);
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
  // Огромная зона раскрывается позже: чем больше записей, тем крупнее она должна быть на экране.
  const grouped=s.groups&&(s.det<.55||s.r<G.m*.16*Math.sqrt(l.items.length/(GROUP_AT*8)));s.groupHits=[];
  if(grouped){
   for(const g of s.groups){const [gx,gy,d]=place(g);g.sx=gx;g.sy=gy;
    for(const id of g.ids){const n=neurons.get(id);if(n){n.sx=gx;n.sy=gy;n.vis=0;n.flash=Math.max(0,n.flash-dt*.45);if(n.flash>0)anyFlash=true}}
    const size=ui*dpr*Math.min(7+1.3*Math.sqrt(g.ids.length),34)*(.7+.5*d)*zf*bz*clamp(s.r/G.m*5,.6,2.4),spr=shapes[g.kind].warm;
    ctx.globalAlpha=clamp(.3*d*dim*warm+.12,0,1)*G.b*ba;ctx.drawImage(spr,gx*dpr-size/2,gy*dpr-size/2,size,size);
    ctx.globalAlpha=.25*G.b*dim;ctx.strokeStyle=rgba(l.color,1);ctx.lineWidth=dpr*.8;ctx.setLineDash([2*dpr,3*dpr]);ctx.beginPath();ctx.arc(gx*dpr,gy*dpr,size*.62,0,TAU);ctx.stroke();ctx.setLineDash([]);
    if(dim>.5&&G.b>.8&&!cfg.clean&&s.det>.12){lctx.globalAlpha=G.b*clamp((s.det-.12)/.15,0,1);lctx.font='600 '+Math.round(9*ui*dpr)+'px '+MONO;lctx.textAlign='center';lctx.textBaseline='middle';const tx=(g.topic?trim(g.topic,14)+' · ':'')+g.ids.length,tw2=lctx.measureText(tx).width+6*dpr,th=11*dpr*ui,bx=gx*dpr-tw2/2,by=gy*dpr+size*.62+7*dpr*ui-th/2;
     if(!gBoxes.some(b=>bx<b[0]+b[2]&&bx+tw2>b[0]&&by<b[1]+b[3]&&by+th>b[1])){gBoxes.push([bx,by,tw2,th]);lctx.fillStyle='rgba(255,246,230,.85)';lctx.fillText(tx,gx*dpr,gy*dpr+size*.62+7*dpr*ui)}lctx.globalAlpha=1}
    if(dim>.5)s.groupHits.push(g)}
   ctx.globalAlpha=1;return;
  }
  for(const it of l.items){const n=neurons.get(it.id);if(!n)continue;n.flash=Math.max(0,n.flash-dt*.45);
   const [nx,ny,d]=place(n),str=Math.min(1.2,it.str??1),lit=focusItems.has(it.id)||impactIds.has(it.id);
   n.sx=nx;n.sy=ny;n.d=d;n.vis=!n.pending&&onScreen(nx,ny)?G.b*(dim>.5||lit?1:0):0;if(!n.vis&&!lit||n.pending)continue;
   // Прорастание: свежий нейрон распускается из точки за ~0.9 с; угасание: забытый сжимается.
   const bloom=n.bornT?ease((now-n.bornT)/900):1,fade=str<.3?.55+1.5*str:1;
   n.size=ui*dpr*(5+3*it.weight+(it.hot?3:0)+n.flash*22)*(.7+.5*d)*(.65+.45*str)*(hover&&hover.id===it.id?1.6:1)*(lit?1.5:1)*(focusN===n?1.8:1)*zf*bz*bloom*fade;
   if(bloom<1){ctx.strokeStyle=rgba(l.color,.6*(1-bloom));ctx.lineWidth=dpr*1.2;ctx.beginPath();ctx.moveTo(s.x*dpr,s.y*dpr);ctx.lineTo(nx*dpr,ny*dpr);ctx.stroke()}
   n.alpha=clamp(((it.dim?.3:.65)*d*(.35+.65*str)+n.flash)*(lit?1.6:dim),0,1)*G.b*(lit?1:ba);if(n.flash>0)anyFlash=true;list.push([n,it,str,lit])}
  // Тысячи записей вблизи: целиком (с отростками) рисуются ближайшие к центру кадра, остальные — светящимися точками.
  // Бюджет по площади зоны на экране: на нейрон с отростками нужно ~30×30 px, иначе они сливаются в белое пятно.
  const budget=Math.round(clamp(Math.PI*s.r*s.r/900,60,NEURON_BUDGET));
  if(list.length>budget){const cx=W/2,cy=H/2,key=e=>(e[3]||e[0]===focusN||hover?.id===e[1].id?-1e9:0)+(e[0].sx-cx)**2+(e[0].sy-cy)**2;for(const e of list)e[4]=key(e);list.sort((a,b)=>a[4]-b[4]);
   const rest=list.splice(budget),da=clamp(Math.PI*s.r*s.r/(rest.length*60),.12,.9);ctx.fillStyle=rgba(l.bad?[210,210,220]:l.color,1);for(const [n] of rest){const z=Math.max(1.5*dpr,n.size*.18);ctx.globalAlpha=n.alpha*da;ctx.fillRect(n.sx*dpr-z/2,n.sy*dpr-z/2,z,z)}ctx.globalAlpha=1}
  // Подзоны вблизи: тема подписана у своего скопления.
  if(s.groups&&dim>.5&&!cfg.clean&&cfg.labels!=='off'){lctx.font='600 '+Math.round(9.5*ui*dpr)+'px '+MONO;lctx.textAlign='center';lctx.textBaseline='middle';
   for(const g of s.groups){if(!g.topic)continue;const [gx,gy]=place(g);if(!onScreen(gx,gy))continue;const tx='· '+g.topic+' ·',tw2=lctx.measureText(tx).width,th=12*dpr*ui,bx=gx*dpr-tw2/2,by=gy*dpr-th/2;if(gBoxes.some(b=>bx<b[0]+b[2]&&bx+tw2>b[0]&&by<b[1]+b[3]&&by+th>b[1]))continue;gBoxes.push([bx,by,tw2,th]);lctx.globalAlpha=.55*G.b;lctx.fillStyle=rgba(l.color,1);lctx.fillText(tx,gx*dpr,gy*dpr)}lctx.globalAlpha=1;lctx.textBaseline='alphabetic'}
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
  if(s.det>0){ctx.strokeStyle=rgba(col,.3*s.det*G.b);ctx.lineWidth=dpr*.8;ctx.beginPath();for(const [n] of list)for(const o of nearOf(n)){if(o.lobe!==l||!o.vis)continue;ctx.moveTo(n.sx*dpr,n.sy*dpr);ctx.lineTo(o.sx*dpr,o.sy*dpr)}ctx.stroke()}
  for(const [n,it,str,lit] of list){
   const rj=n.rej&&now-n.rej<2200,spr=l.bad||rj?spriteBad:shapes[kindOf(it.id)][str<.35?'cold':'warm'],size=n.size;
   ctx.globalAlpha=n.alpha*(rj?.55:1);ctx.drawImage(spr,n.sx*dpr-size/2,n.sy*dpr-size/2,size,size);
   if(n.flash>0){ctx.globalAlpha=n.flash*.8;ctx.strokeStyle=rgba(l.color,1);ctx.lineWidth=dpr*1.2;ctx.beginPath();ctx.arc(n.sx*dpr,n.sy*dpr,dpr*(6+(1-n.flash)*40),0,TAU);ctx.stroke()}
   if(n.rej){const k=1-(now-n.rej)/2200;if(k<=0)n.rej=0;else{ctx.globalAlpha=.7*k;ctx.strokeStyle='rgba(150,150,160,1)';ctx.lineWidth=dpr;ctx.beginPath();ctx.arc(n.sx*dpr,n.sy*dpr,size*(.4+.5*k),0,TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(n.sx*dpr-size*.3,n.sy*dpr);ctx.lineTo(n.sx*dpr+size*.3,n.sy*dpr);ctx.stroke();anyFlash=true}}
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
  if(impactOf===it.id&&impactInfo)rows.push(...wrap(c,impactText(impactInfo),w-pad*2,3));
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
   for(const it of l.ranked||l.items){if(n>=48)break;const nn=neurons.get(it.id);if(!nn||!nn.vis)continue;
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
 // Что затронет факт: соседи по графу, заметки и дела с теми же именами, противоречия, ответы аватара.
 async function loadImpact(it){
  const fid=it.fact?.id;if(!fid)return null;impactOf=it.id;
  try{const r=await fetch('/api/facts/impact?id='+encodeURIComponent(fid));if(!r.ok||impactOf!==it.id)return null;const d=await r.json();if(impactOf!==it.id)return null;
   impactInfo=d;impactIds=new Set([...d.facts.map(f=>'f:'+f.id),...d.notes.map(n=>'n:'+n.id),...d.tasks.map(t=>'t:'+t.id)]);dirty=true;return d}catch{return null}
 }
 function clearImpact(){if(!impactIds.size&&!impactOf)return;impactIds=new Set();impactOf=null;impactInfo=null;dirty=true}
 function impactText(d){
  if(!d)return '';const parts=[];
  if(d.facts.length)parts.push(d.facts.length+' '+plural(d.facts.length,'факт','факта','фактов')+(d.hop1<d.facts.length?' ('+d.hop1+' напрямую)':''));
  if(d.notes.length)parts.push(d.notes.length+' '+plural(d.notes.length,'заметку','заметки','заметок')+(d.notes.some(n=>n.source)?' (из одной взят факт)':''));
  if(d.tasks.length)parts.push(d.tasks.length+' '+plural(d.tasks.length,'дело','дела','дел'));
  if(d.conflicts.length)parts.push('противоречий '+d.conflicts.length);
  if(d.episodes)parts.push('вспоминала в ответах '+d.episodes+' '+plural(d.episodes,'раз','раза','раз'));
  return parts.length?'Затронет: '+parts.join(', ')+'.':'Ни с чем больше не связан.';
 }
 // Карточка сущности (growth.js) для подсказки над фактом; ответы кешируются на время открытой страницы.
 const cardCache=new Map();
 function loadCard(name){const k=String(name||'').toLocaleLowerCase();if(!k)return Promise.resolve(null);if(cardCache.has(k))return cardCache.get(k);
  const p=fetch('/api/brain/card?name='+encodeURIComponent(name)).then(r=>r.ok?r.json():null).catch(()=>null);cardCache.set(k,p);setTimeout(()=>cardCache.delete(k),60000);return p}
 function showTip(hit,x,y,withButton){
  if(!(hit&&hit.type==='neuron'&&withButton)&&!(focusN&&hit?.n===focusN))clearImpact();
  if(!hit){tip.hidden=true;return}
  tip.replaceChildren();
  if(hit.type==='seed'){const f=hit.sd.f;tip.append(el('div','brain-tip-k','предлагаю запомнить'),el('div','brain-tip-t',f.subject+' — '+f.predicate+' → '+f.object),el('div','brain-tip-m',(String(f.source||'').startsWith('note:')?'из заметки':'из чата')+(f.via==='model'?' · нашла модель':' · по правилам')));
   if(withButton){const row=el('div','brain-row'),ok=el('button','brain-btn','✓ Запомнить'),no=el('button','brain-btn','✗');ok.type=no.type='button';ok.onclick=()=>acceptSeed(f.id);no.onclick=()=>{TenmaLearn.reject(f.id);tip.hidden=true;pinned=null};row.append(ok,no);tip.append(row)}}
  else if(hit.type==='neuron'){const it=hit.n.item,r=recall[it.id];tip.append(el('div','brain-tip-k',hit.n.lobe.label),el('div','brain-tip-t',trim(it.title,140)),el('div','brain-tip-m',it.meta+' · сила памяти '+Math.round(Math.min(1,it.str??1)*100)+'%'+(r?' · вспоминала '+r.n+' '+plural(r.n,'раз','раза','раз'):'')+(linkCount.get(it.id)?' · связей '+linkCount.get(it.id):'')));
   if(withButton&&it.fact){const cd=el('div','brain-tip-m brain-card');cd.hidden=true;tip.append(cd);loadCard(it.fact.subject).then(c=>{if(!c||tip.hidden)return;cd.textContent='карточка'+(c.type?' · '+c.type:'')+(c.aliases.length?' · она же '+c.aliases.join(', '):'')+': '+trim(c.description,220)+(c.grew?' · дописана '+c.grew+' '+plural(c.grew,'фактом','фактами','фактами'):'');cd.hidden=false})}
   if(withButton&&it.fact){const im=el('div','brain-tip-m brain-impact','Смотрю, что связано…');tip.append(im);loadImpact(it).then(d=>{if(d&&impactOf===it.id)im.textContent=impactText(d)+(impactIds.size?' Подсвечено.':'');else if(!d)im.remove()})}
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
  if(hit&&hit.type==='neuron'&&(l.state.det>.3||focusN)){focusN=hit.n;camT.zoom=Math.max(camT.zoom,9);recordRecall([hit.n.item.id]);recall=readRecall();grow(hit.n,true);if(hit.n.item.fact)void loadImpact(hit.n.item);else clearImpact()}
  else if(l){focusN=null;zoomLobe(l)}else{focusN=null;Object.assign(camT,{zoom:1,px:0,py:0})}idleT=0;dirty=true});
 function zoomLobe(l){camT.zoom=clamp(Math.min(W,H)*.32/Math.max(8,l.state.r/cam.zoom),2,5);camT.px=-l.state.qx;camT.py=-l.state.qy}
 canvas.addEventListener('click',e=>{if(moved){moved=false;return}const [x,y]=local(e),hit=pick(x,y);pinned=hit;hover=hit&&hit.type==='neuron'?hit.n.item:null;showTip(hit,x,y,true);if(hit&&hit.type==='lobe'){hit.l.state.pulse=1;if(hit.l.bad){tip.hidden=true;pinned=null;fixBox.hidden=false;renderFix()}}dirty=true});
 document.addEventListener('keydown',onKey);
 function onKey(e){if(e.key!=='Escape')return;if(!guardianBox.hidden){guardianBox.hidden=true;guardianStar.setAttribute('aria-expanded','false');guardianStar.focus();return}if(!menu.hidden){setMenu(false);menuBtn.focus();return}if(!fixBox.hidden){fixBox.hidden=true;return}if(!diaBox.hidden){diaBox.hidden=true;return}if(!dupBox.hidden){dupBox.hidden=true;return}if(!ovBox.hidden){ovBox.hidden=true;return}if(focusN){const l=focusN.lobe;focusN=null;clearImpact();zoomLobe(l);dirty=true;return}if(isFs()){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});stage.classList.remove('fs');setFs();return}if(pinned){pinned=null;tip.hidden=true;hover=null;clearImpact();dirty=true}}

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
 let factSig='';
 async function loadFacts(){
  try{const [f,c,x,tp,dp]=await Promise.all([fetch('/api/facts?limit=2000').then(r=>r.ok?r.json():r.status===400?fetch('/api/facts?limit=500').then(r2=>r2.ok?r2.json():[]):[]),fetch('/api/facts/conflicts?limit=100').then(r=>r.ok?r.json():[]),fetch('/api/experience?limit=40').then(r=>r.ok?r.json():{items:[]}),fetch('/api/facts/communities').then(r=>r.ok?r.json():[]).catch(()=>[]),fetch('/api/facts/duplicates').then(r=>r.ok?r.json():[]).catch(()=>[])]);facts=Array.isArray(f)?f.filter(x=>!x.valid_to):[];conflicts=Array.isArray(c)?c:[];exp=Array.isArray(x?.items)?x.items:[];topics=Array.isArray(tp)?tp:[];dups=Array.isArray(dp)?dp:[];renderDup()}catch{}
  // Опрос раз в 20 с: если факты и противоречия не менялись, мозг не пересобирается (на 10 тыс. записей это заметно).
  void loadChatStat();
  // Журнал агентов (зона «агенты»): имена встроенных и своих помощников.
  try{const r=await fetch('/api/agents?journal=120');if(r.ok){const d=await r.json();const names={guardian:'Хранитель',reviewer:'Разборщик',secretary:'Секретарь',researcher:'Исследователь',teacher:'Учитель'};for(const c of d.custom||[])names[c.id]=c.name;jobs=(Array.isArray(d.journal)?d.journal:[]).map(j=>({...j,name:names[j.agent]||'Агент'}))}}catch{}
  try{const r=await fetch('/api/brain/strength');if(r.ok){const d=await r.json();if(d&&typeof d==='object')srv=d}}catch{}
  try{const r=await fetch('/api/brain/memskills/organs');if(r.ok){const d=await r.json();if(Array.isArray(d)){const had=new Set(organs.map(o=>o.name+':'+o.version));if(organs.length)for(const o of d)if(!had.has(o.name+':'+o.version))organFlash.set(o.name,1);organs=d;dirty=true}}}catch{}
  try{const r=await fetch('/api/brain/bonds?limit=400');if(r.ok){const d=await r.json();if(Array.isArray(d)){srvBonds=d;coList=buildCo();dirty=true}}}catch{}
  const sig=facts.length+':'+facts.map(f=>f.id).join(',')+'|'+conflicts.map(c=>c.id).join(',')+'|'+exp.map(e=>e.id+(e.feedback||'')).join(',')+'|'+topics.map(t=>t.id+':'+t.size).join(',')+'|'+jobs.map(j=>j.id+(j.feedback||'')).join(',');
  if(sig===factSig&&applied)return;factSig=sig;
  if(host.isConnected)apply();
  firstVisit=false;
 }
 /* ---------- Думает вслух, вспоминает, учится ---------- */
 const onThinking=e=>{const on=!!e.detail?.on;if(on&&!thinking)startThought(e.detail?.text);if(!on&&thought)thought.end=performance.now();thinking=on;thinkT=0;if(thinking){chatter=0;idleT=0}dirty=true};
 /* ---------- Видно, как думает ---------- */
 // 1) вопрос распадается на слова, каждое летит к зоне, где оно встречается чаще всего;
 // 2) от ядра расходятся волны поиска, задетые кандидаты мерцают; после ответа найденное вспыхивает, отброшенное гаснет серым;
 // 3) цепочка мысли: ядро → зона → запись → связанные записи, с подписями шагов.
 function startThought(text){
  const t0=performance.now(),ws=[...new Set(words(text,3))].slice(0,6),cand=new Set();
  const list=ws.map((w,i)=>{const k=stem(w);let best=null,bc=0;
   for(const l of model.lobes){let c=0;for(const it of l.items)if(stemsOf(it).has(k)){c++;if(cand.size<160)cand.add(it.id)}if(c>bc){bc=c;best=l}}
   return {w,k,lobe:best,n:bc,delay:i*170,a:-Math.PI/2+(i-(ws.length-1)/2)*.55,hit:false}});
  thought={t0,text:String(text||''),words:list,cand,waveR:0,chain:null,end:0};
 }
 function drawThought(G){
  const T=thought;if(!T)return;const t=now-T.t0,c=lctx;
  // Волны поиска: кольцо от ядра; когда кольцо проходит зону, она вздрагивает, а её кандидаты мерцают.
  if(thinking||now-T.end<600){const per=1500,u=(t%per)/per,maxR=Math.hypot(W,H)*.6,R=G.coreR+u*maxR,prev=T.waveR;T.waveR=R;
   ctx.globalCompositeOperation='lighter';ctx.strokeStyle=rgba(PAL.tones[2],.22*(1-u));ctx.lineWidth=dpr*(1.2+3*(1-u));ctx.beginPath();ctx.arc(G.cx*dpr,G.cy*dpr,R*dpr,0,TAU);ctx.stroke();
   ctx.strokeStyle=rgba(PAL.tones[1],.08*(1-u));ctx.lineWidth=dpr*14*(1-u);ctx.stroke();ctx.globalCompositeOperation='source-over';
   for(const l of model.lobes){const s=l.state,d=Math.hypot(s.x-G.cx,s.y-G.cy);if(prev<d&&R>=d||R<prev&&d<=R){s.pulse=Math.max(s.pulse,T.words.some(w=>w.lobe===l)?.7:.25);for(const it of l.items)if(T.cand.has(it.id)){const n=neurons.get(it.id);if(n)n.flash=Math.max(n.flash,.3)}}}}
  // Слова вопроса летят к своим зонам; слово без совпадений уходит в сторону и гаснет.
  const fs=Math.round(10*ui*dpr);c.font='600 '+fs+'px '+MONO;c.textAlign='center';c.textBaseline='middle';
  for(const w of T.words){const tt=t-w.delay;if(tt<0)continue;const u=ease(tt/1200),life=T.chain?clamp(1-(now-T.chain.t0)/1500,0,1):1;if(life<=0)continue;
   let x,y,a;if(w.lobe){const s=w.lobe.state;x=G.cx+(s.x-G.cx)*u;y=G.cy+(s.y-G.cy)*u;a=life;if(u>=.999&&!w.hit){w.hit=true;s.pulse=1}}
   else{const r=G.coreR*(1+u*1.6);x=G.cx+Math.cos(w.a)*r;y=G.cy+Math.sin(w.a)*r;a=life*clamp(1.6-tt/1100,0,1)}
   if(a<=.01)continue;const label=w.lobe?w.w+' · '+w.n:w.w+' ?',bw=c.measureText(label).width+10*dpr,bh=fs+6*dpr;
   ctx.globalAlpha=a*.9;const z=dpr*ui*22;ctx.drawImage(w.lobe?spriteSeed:spriteBad,x*dpr-z/2,y*dpr-z/2,z,z);ctx.globalAlpha=1;
   c.globalAlpha=a;c.fillStyle='rgba(0,0,0,.7)';c.fillRect(x*dpr-bw/2,y*dpr-bh/2-14*dpr*ui,bw,bh);c.strokeStyle=w.lobe?rgba(w.lobe.color,.8):'rgba(160,160,170,.6)';c.lineWidth=dpr;c.strokeRect(x*dpr-bw/2+.5,y*dpr-bh/2-14*dpr*ui+.5,bw-1,bh-1);
   c.fillStyle=w.lobe?'#fff3e0':'#a8a8b0';c.fillText(label,x*dpr,y*dpr-14*dpr*ui)}
  c.globalAlpha=1;
  // Цепочка мысли.
  const C=T.chain;if(C){const ct=now-C.t0,life=clamp((8000-ct)/1000,0,1);if(life<=0){thought=null;return}
   const pts=C.steps.map(st=>st.at());let shown=Math.min(pts.length,1+ct/650);
   ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
   for(let i=1;i<Math.ceil(shown);i++){const k=clamp(shown-i,0,1),[x0,y0]=pts[i-1],[x1,y1]=pts[i],xe=x0+(x1-x0)*k,ye=y0+(y1-y0)*k;
    ctx.strokeStyle=rgba(PAL.tones[2],.75*life);ctx.lineWidth=dpr*2.2;ctx.setLineDash([6*dpr,4*dpr]);ctx.lineDashOffset=-ct*.02*dpr;ctx.beginPath();ctx.moveTo(x0*dpr,y0*dpr);ctx.lineTo(xe*dpr,ye*dpr);ctx.stroke();ctx.setLineDash([]);
    const z=dpr*ui*18;ctx.globalAlpha=life;ctx.drawImage(spriteSeed,xe*dpr-z/2,ye*dpr-z/2,z,z);ctx.globalAlpha=1}
   ctx.globalCompositeOperation='source-over';
   const f2=Math.round(9.5*ui*dpr);c.font='600 '+f2+'px '+MONO;c.textAlign='left';c.textBaseline='middle';
   const cb=[];for(let i=0;i<Math.floor(shown);i++){const [x,y]=pts[i],t1=(i+1)+' · '+C.steps[i].label,bw=c.measureText(t1).width+10*dpr,bh=f2+7*dpr;
    let bx=x*dpr+12*dpr,by=y*dpr+(i%2?10:-10)*dpr-bh/2;if(bx+bw>lab.width-4*dpr)bx=x*dpr-12*dpr-bw;by=clamp(by,4*dpr,lab.height-bh-4*dpr);
    for(let k=0;k<6&&cb.some(b=>bx<b[0]+b[2]&&bx+bw>b[0]&&by<b[1]+b[3]&&by+bh>b[1]);k++)by+=bh+3*dpr;cb.push([bx,by,bw,bh]);
    c.globalAlpha=life;c.fillStyle='rgba(8,5,2,.82)';c.fillRect(bx,by,bw,bh);c.fillStyle=PAL.hot;c.fillRect(bx,by,2*dpr,bh);c.fillStyle='#f6eee2';c.fillText(t1,bx+6*dpr,by+bh/2)}
   c.globalAlpha=1}
  else if(!thinking&&T.end&&now-T.end>2500)thought=null;
  c.textBaseline='alphabetic';
 }
 // Цепочка после ответа: что вспомнила и через какие связи.
 function buildChain(ids,text){
  const T=thought||(thought={t0:performance.now(),text,words:[],cand:new Set(),waveR:0,end:performance.now()});
  const ns=ids.map(id=>neurons.get(id)).filter(Boolean);if(!ns.length)return;
  const first=ns[0],L=first.lobe,G0=()=>[view0.cx+cam.px*cam.zoom,view0.cy+cam.py*cam.zoom];
  const steps=[{label:'вопрос «'+trim(T.text||'…',22)+'»',at:G0},{label:'зона «'+trim(L.label,18)+'»',at:()=>[L.state.x,L.state.y]},{label:'запись «'+trim(first.item.title,24)+'»',at:()=>[first.sx,first.sy]}];
  const next=new Set([first.item.id]);
  const linked=model.links.filter(([a,b])=>a===first.item.id||b===first.item.id).map(([a,b])=>a===first.item.id?b:a);
  const co=coList.filter(([a,b])=>a===first.item.id||b===first.item.id).map(([a,b])=>a===first.item.id?b:a);
  for(const id of [...linked,...co,...ns.slice(1).map(n=>n.item.id)]){if(steps.length>=5)break;if(next.has(id))continue;const n=neurons.get(id);if(!n)continue;next.add(id);
   steps.push({label:(linked.includes(id)?'связь':co.includes(id)?'вместе':'ещё')+' «'+trim(n.item.title,22)+'»',at:()=>[n.sx,n.sy]})}
  // Кандидаты, которые не пригодились, гаснут серым.
  const found=new Set(ids);for(const id of T.cand)if(!found.has(id)){const n=neurons.get(id);if(n)n.rej=performance.now()}
  T.chain={t0:performance.now(),steps};
 }
 // Импульс из ядра к каждому вспомненному нейрону; запись становится «теплее».
 const onRecall=e=>{
  // Счётчики уже записал общий слушатель выше — здесь только перечитываем и анимируем.
  recall=readRecall();const ids=recallIds(e.detail).filter(id=>neurons.has(id));
  if(!ids.length)return;
  for(const id of ids)grow(neurons.get(id),true);
  coList=buildCo();
  ids.slice(0,12).forEach((id,i)=>{const n=neurons.get(id);setTimeout(()=>{if(n.lobe.state)impulses.push({lobe:n.lobe,item:n.item,u:0,f:Math.floor(Math.random()*n.lobe.state.fil.length),recall:true})},i*140)});
  const first=neurons.get(ids[0]);coreKind=e.detail?.experience?.used?.length?'вспоминаю опыт':'вспоминаю';coreText=first.item.title;coreTextT=3.5;
  buildChain(ids,e.detail?.text);
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
  try{const r=await TenmaLearn.scanNotes(5);learnMsg.textContent=r.full?'Очередь кандидатов заполнена ('+LEARN_MAX+'). Подтвердите или отклоните часть, потом нажмите ещё раз'+(r.found?' (найдено сейчас: '+r.found+')':'')+'.':r.failed?'Не удалось разобрать заметок: '+r.failed+' — сервер не ответил. Попробуйте ещё раз.':r.scanned?'Прочитала заметок: '+r.scanned+', нашла фактов: '+r.found+(r.left?'. Осталось заметок: '+r.left+' — нажмите ещё раз.':'.'):'Новых заметок нет — все уже разобраны.';learnMsg.classList.toggle('err',!!r.failed)}catch(e){learnMsg.textContent=e.message;learnMsg.classList.add('err')}
  scanBtn.disabled=false};
 const onLearn=()=>renderLearn();
 // Новый эпизод опыта или оценка ответа — журнал перечитывается.
 const onExperience=()=>{void loadFacts()};
 window.addEventListener('tenma:thinking',onThinking);window.addEventListener('tenma:recall',onRecall);window.addEventListener('tenma:learn',onLearn);window.addEventListener('tenma:experience',onExperience);
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
   // Под вариантом — что уйдёт вместе с отвергнутым фактом.
   card.lastChild.children[0].append(impactLine(c.newer_id,'«'+trim(c.newer,18)+'» связан с: '));card.lastChild.children[1].append(impactLine(c.earlier_id,'«'+trim(c.earlier,18)+'» связан с: '));
   return card}));
 }
 async function resolveFix(c,keep,b){
  b.disabled=true;
  try{const r=await fetch('/api/facts/conflicts/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id,keep})});if(!r.ok&&r.status!==404)throw Error((await r.json().catch(()=>({}))).error||'Не удалось');
   coreKind='память';coreText=keep==='both'?'оба факта верны':'оставила «'+(keep==='earlier'?c.earlier:c.newer)+'»';coreTextT=3.5;core.pulse=1;await loadFacts()}
  catch(e){b.disabled=false;learnMsg.textContent=e.message;learnMsg.classList.add('err')}
 }
 fixBtn.onclick=()=>{fixBox.hidden=false;renderFix()};
 /* ---------- Почти-дубли ---------- */
 const fline=f=>f.subject+' — '+f.predicate+' → '+f.object;
 function dialogHead(title,box){const head=el('div','brain-fix-head'),close=el('button','brain-btn','✕');close.type='button';close.setAttribute('aria-label','Закрыть');close.onclick=()=>{box.hidden=true};head.append(el('div','brain-k',title),close);return head}
 // Строка «что затронет» под вариантом: подгружается, когда окно открыто.
 function impactLine(fid,prefix){const m=el('small','brain-fix-impact','…');fetch('/api/facts/impact?id='+encodeURIComponent(fid)).then(r=>r.ok?r.json():null).then(d=>{m.textContent=d?prefix+impactText(d).replace(/^Затронет: /,'').replace(/^Ни с чем больше не связан\./,'ничем'):''}).catch(()=>{m.textContent=''});return m}
 function renderDup(){
  dupBtn.hidden=!dups.length;dupBtn.textContent='≈ Похожие ('+dups.length+')';
  if(dupBox.hidden)return;
  const head=dialogHead('похожие факты // слить дубли',dupBox);
  if(!dups.length){dupBox.replaceChildren(head,el('p','brain-fix-ok','Дублей нет ✓'));return}
  dupBox.replaceChildren(head,el('p','brain-fix-ok','Один и тот же факт сказан по-разному. Выберите, какой оставить: второй уйдёт в историю.'),...dups.slice(0,20).map(d=>{
   const card=el('div','brain-fix-card');card.append(el('div','brain-fix-q','сходство '+Math.round(d.score*100)+'%'));
   const row=el('div','brain-fix-row');
   const opt=(keep,drop,adv)=>{const b=el('button','brain-fix-opt'+(adv?' advised':''));b.type='button';b.append(el('span','','Оставить «'+fline(keep)+'»'),el('small','',(keep.source_id||'')+(adv?' · совет':'')),impactLine(drop.id,'«'+trim(drop.object,18)+'» связан с: '));b.onclick=()=>mergeDup(keep,drop,b);return b};
   const no=el('button','brain-fix-opt');no.type='button';no.append(el('span','','Это разные'),el('small','','больше не предлагать'));no.onclick=()=>dismissDup(d,no);
   row.append(opt(d.keep,d.drop,true),opt(d.drop,d.keep,false),no);card.append(row);return card}));
 }
 async function mergeDup(keep,drop,b){b.disabled=true;
  try{const r=await fetch('/api/facts/duplicates/merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keep:keep.id,drop:drop.id})});if(!r.ok&&r.status!==404)throw Error('Не удалось');
   coreKind='память';coreText='слила: «'+trim(fline(keep),40)+'»';coreTextT=3.5;core.pulse=1;await loadFacts();renderDup()}
  catch(e){b.disabled=false;learnMsg.textContent=e.message;learnMsg.classList.add('err')}}
 async function dismissDup(d,b){b.disabled=true;try{await fetch('/api/facts/duplicates/dismiss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:d.keep.id,b:d.drop.id})});dups=dups.filter(x=>x!==d);renderDup()}catch{b.disabled=false}}
 dupBtn.onclick=()=>{dupBox.hidden=false;renderDup()};
 /* ---------- Обзор памяти ---------- */
 async function renderOverview(){
  const head=dialogHead('обзор памяти',ovBox);ovBox.replaceChildren(head,el('p','brain-fix-ok','Собираю…'));
  let o;try{const r=await fetch('/api/facts/overview');if(!r.ok)throw 0;o=await r.json()}catch{ovBox.replaceChildren(head,el('p','brain-fix-ok','Не удалось получить обзор.'));return}
  const sec=(title,...kids)=>{const c=el('div','brain-fix-card');c.append(el('div','brain-fix-q',title),...kids);return c};
  const chips=(list,label,go)=>{const r=el('div','brain-ov-chips');for(const x of list){const b=el('button','brain-btn',label(x));b.type='button';if(go)b.onclick=()=>{ovBox.hidden=true;find.value=go(x);setFocus(find.value)};r.append(b)}return r};
  const w=o.week||{};
  ovBox.replaceChildren(head,
   el('p','brain-fix-ok',o.facts+' '+plural(o.facts,'факт','факта','фактов')+' о '+o.entities+' '+plural(o.entities,'сущности','сущностях','сущностях')+' · заметок '+o.notes+' · открытых дел '+o.openTasks),
   ...(o.topics.length?[sec('темы (связанные группы)',chips(o.topics,t=>t.label+' · '+t.size,t=>t.label))]:[]),
   ...(o.hubs.length?[sec('больше всего связей',chips(o.hubs,h=>h.name+' · '+h.degree,h=>h.name))]:[]),
   ...(o.relations.length?[sec('чаще всего',el('div','brain-fix-ok',o.relations.map(r=>r.relation+' ('+r.count+')').join(' · ')))]:[]),
   sec('за неделю',el('div','brain-fix-ok','новых фактов '+((w.created||0)+(w.restored||0))+(w.retired?' · убрано при разборе '+w.retired:'')+(w.merged?' · слито дублей '+w.merged:'')),...o.recent.slice(0,4).map(f=>el('div','brain-fix-ok','+ '+fline(f)))),
   ...(o.conflicts||o.duplicates?[sec('ждут разбора',...[o.conflicts?Object.assign(el('button','brain-btn brain-alarm-btn','⚠ противоречий: '+o.conflicts),{type:'button',onclick:()=>{ovBox.hidden=true;fixBox.hidden=false;renderFix()}}):null,o.duplicates?Object.assign(el('button','brain-btn','≈ похожих: '+o.duplicates),{type:'button',onclick:()=>{ovBox.hidden=true;dupBox.hidden=false;renderDup()}}):null].filter(Boolean))]:[]));
 }
 ovBtn.onclick=()=>{ovBox.hidden=false;void renderOverview()};
 /* ---------- Дневник: размышления в простое, выводы, навыки, предпочтения, сводки, причины ---------- */
 const postJson=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 const atText=iso=>{try{return new Date(iso).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}catch{return ''}};
 async function renderDiary(){
  const head=dialogHead('дневник мозга',diaBox);diaBox.replaceChildren(head,el('p','brain-fix-ok','Собираю…'));
  let m;try{const r=await fetch('/api/brain/mind');if(!r.ok)throw 0;m=await r.json()}catch{diaBox.replaceChildren(head,el('p','brain-fix-ok','Не удалось открыть дневник.'));return}
  const sec=(title,...kids)=>{const c=el('div','brain-fix-card');c.append(el('div','brain-fix-q',title),...kids);return c};
  const row=(text,onRemove,label)=>{const r=el('div','brain-dia-row');r.append(el('span','brain-fix-ok',text));if(onRemove){const b=el('button','brain-btn','✕');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.onclick=async()=>{b.disabled=true;try{await onRemove()}finally{void renderDiary()}};r.append(b)}return r};
  const st=m.reflect||{},idleMin=Math.floor((st.idleMs||0)/60000),needMin=Math.round((st.idleNeedMs||600000)/60000);
  const think=el('button','brain-btn',st.running?'Размышляю…':'Поразмышлять сейчас');think.type='button';think.disabled=!!st.running;
  think.onclick=async()=>{think.disabled=true;think.textContent='Размышляю…';try{await postJson('/api/brain/reflect',{})}catch{}void renderDiary();window.dispatchEvent(new CustomEvent('tenma:memory'))};
  const status=el('div','brain-dia-row');status.append(el('span','brain-fix-ok',(st.last?'Последний раз: '+atText(st.last)+'. ':'Ещё не размышляла. ')+'Думаю сама, когда со мной '+needMin+' мин ничего не делают'+(idleMin?' (тихо уже '+idleMin+' мин)':'')+'.'),think);
  const prefIn=el('input','brain-find');prefIn.placeholder='Например: отвечай короче';prefIn.maxLength=200;prefIn.setAttribute('aria-label','Новое предпочтение');
  const prefForm=el('form','brain-dia-row');const prefAdd=el('button','brain-btn','+');prefAdd.type='submit';prefAdd.title='Добавить предпочтение';prefForm.append(prefIn,prefAdd);
  prefForm.onsubmit=async e=>{e.preventDefault();const t=prefIn.value.trim();if(!t)return;prefAdd.disabled=true;try{await postJson('/api/brain/preferences',{text:t})}catch{}void renderDiary()};
  const kindName={fact:'факт',note:'заметка',task:'дело'};
  const end=x=>(kindName[x.kind]||x.kind)+' «'+(x.title||'…')+'»';
  const hot=(m.working?.facts?.length||0)+(m.working?.notes?.length||0);
  // Дневник по вкладкам: мышление, душа, сердцевина, память, навыки, рост.
  const TABS={mind:'мышление',soul:'душа',self:'сердцевина',memory:'память',skills:'навыки',growth:'рост',ties:'связи'},tab=TABS[cfg.diaTab]?cfg.diaTab:'mind';
  const tabBar=el('div','brain-tabs');tabBar.setAttribute('role','tablist');
  for(const [k,v] of Object.entries(TABS)){const b=el('button','brain-tab'+(k===tab?' on':''),v);b.type='button';b.setAttribute('role','tab');b.setAttribute('aria-selected',String(k===tab));b.onclick=()=>{cfg.diaTab=k;write(CFG_KEY,cfg);void renderDiary()};tabBar.append(b)}
  let body=[];
  if(tab==='mind')body=[status,...await mindSecs(sec,row)];
  else if(tab==='soul')body=await psycheSecs(sec,row);
  else if(tab==='ties')body=await tiesSecs(sec,row);
  else if(tab==='self')body=[...(m.core?[coreSec(m.core,sec)]:[]),...(m.onboarding?.active?[onboardSec(m.onboarding,sec,row)]:[]),...(m.review?[reviewRow(m.review)]:[]),
   sec('как вы просили отвечать',...m.preferences.map(p=>row(p.text,()=>postJson('/api/brain/preferences/remove',{id:p.id}),'Убрать предпочтение')),prefForm)];
  else if(tab==='memory')body=[sec('дневник',...(m.diary.length?m.diary.slice(0,8).map(d=>row(atText(d.at)+' · '+d.text)):[el('div','brain-fix-ok','Пока пусто.')])),
   ...(m.insights.length?[sec('выводы',...m.insights.slice(0,6).map(i=>row(i.text)))]:[]),
   ...(m.summaries.length?[sec('сводки тем',...m.summaries.slice(0,8).map(t=>row(t.summary.startsWith(t.label)?t.summary:t.label+' · '+t.summary)))]:[]),
   ...(m.links.count?[sec('причинные связи ('+m.links.count+')',...m.links.recent.slice(0,10).map(l=>row(end(l.a)+' → '+l.type+' → '+end(l.b))))]:[]),
   ...(hot?[el('p','brain-fix-ok','В рабочей памяти разговора сейчас '+hot+' '+plural(hot,'запись','записи','записей')+'.')]:[])];
  else if(tab==='skills')body=[...(m.memskills?[await examSec(sec),mskillSec(m.memskills,sec,row)]:[]),
   sec('навыки из опыта',...(m.skills.length?m.skills.slice(0,10).map(k=>row((k.status==='retired'?'(на покое) ':'')+k.rule+' · ✓'+k.ok+' ✎'+k.fix,()=>postJson('/api/brain/skills/remove',{id:k.id}),'Убрать навык')):[el('div','brain-fix-ok','Появятся, когда вы подтвердите 👍 несколько похожих ответов.')]))];
  else body=[...(m.growth?[growthSec(m.growth,sec,row)]:[]),matureSec(sec)];
  if(diaBox.hidden)return;
  diaBox.replaceChildren(head,tabBar,...body);
 }
 // Мышление: настройки, догадки, вопросы о вас, забытое и предложения по своей инициативе.
 async function mindSecs(sec,row){
  let t;try{const r=await fetch('/api/brain/thinking');if(!r.ok)throw 0;t=await r.json()}catch{return [el('p','brain-fix-ok','Не удалось открыть мышление.')]}
  const btn=(text,label,fn)=>{const b=el('button','brain-btn',text);b.type='button';b.title=label;b.setAttribute('aria-label',label);b.onclick=async()=>{b.disabled=true;try{await fn()}catch{}void renderDiary();window.dispatchEvent(new CustomEvent('tenma:memory'))};return b};
  const out=[];
  const set=el('div','brain-mind-set');
  for(const [k,label] of Object.entries(t.labels||{})){const lb=el('label','brain-check'),cb=el('input');cb.type='checkbox';cb.checked=t.settings[k]!==false;cb.onchange=async()=>{try{await postJson('/api/brain/settings',{key:k,value:cb.checked})}catch{}};lb.append(cb,el('span','',label));set.append(lb)}
  out.push(sec('как я думаю',el('div','brain-fix-ok','Всё это я делаю сама. Лишнее можно выключить.'),set));
  const open=(t.guesses||[]).filter(g=>g.status==='open'),gs=t.guessStats||{};
  const gk=[el('div','brain-fix-ok','Предполагаю то, чего мне не говорили, и проверяю: новыми фактами или вопросом. Подтвердилось '+(gs.confirmed||0)+', не подтвердилось '+(gs.rejected||0)+'.')];
  for(const g of open.slice(0,8)){const r=el('div','brain-dia-row');r.append(el('span','brain-fix-ok','💡 '+g.subject+' — '+g.predicate+' → '+g.object+' · '+Math.round(g.confidence*100)+'%'+(g.why?' ('+trim(g.why,90)+')':'')),btn('✓','Верно',()=>postJson('/api/brain/guesses/answer',{id:g.id,yes:true})),btn('✗','Неверно',()=>postJson('/api/brain/guesses/answer',{id:g.id,yes:false})));gk.push(r)}
  if(!open.length)gk.push(el('div','brain-fix-ok','Открытых догадок нет — новые появятся, когда я поразмышляю.'));
  out.push(sec('догадки',...gk));
  const qs=(t.questions||[]).filter(q=>q.status==='open'||q.status==='asked'),done=(t.questions||[]).filter(q=>q.status==='answered').slice(0,3);
  const qk=[el('div','brain-fix-ok','Спрашиваю в разговоре по одному, не чаще раза в несколько сообщений.')];
  for(const q of qs.slice(0,8)){const r=el('div','brain-dia-row');r.append(el('span','brain-fix-ok','❓ '+q.text+(q.status==='asked'?' (спросила)':'')+(q.reason?' — '+trim(q.reason,80):'')),btn('✕','Не спрашивать',()=>postJson('/api/brain/questions/dismiss',{id:q.id})));qk.push(r)}
  for(const q of done)qk.push(row('✓ «'+trim(q.text,60)+'» → '+trim(q.answer||'',80)));
  if(!qs.length&&!done.length)qk.push(el('div','brain-fix-ok','Пока ни о чём не хочу спросить.'));
  out.push(sec('что хочу узнать о вас',...qk));
  const st=t.strength||{},fk=[el('div','brain-fix-ok','Сила памяти: действуют '+(st.active||0)+', спят '+(st.dormant||0)+', угасают '+(st.fading||0)+'. Что давно не вспоминали, сначала засыпает, потом угасает и забывается. Людей, вас и то, чему вы научили вручную, я не забываю.')];
  for(const f of (t.forgotten||[]).slice(0,8)){const r=el('div','brain-dia-row');r.append(el('span','brain-fix-ok','🌫 '+f.subject+' — '+f.predicate+' → '+f.object),btn('Вернуть','Вспомнить снова',()=>postJson('/api/brain/forgotten/restore',{ids:[f.id]})));fk.push(r)}
  out.push(sec('забывание',...fk));
  const SN={new:'ещё не показала',shown:'предложила',accepted:'вы согласились',dismissed:'не надо'};
  const sg=(t.suggestions||[]).slice(0,6);
  out.push(sec('предлагаю сама',...(sg.length?sg.map(x=>row('💡 '+x.text+' · '+(SN[x.status]||x.status))):[el('div','brain-fix-ok','Смотрю на дела и даты: просроченное, важное на завтра, дни рождения. Пока предложить нечего.')])));
  return out;
 }
 // График самоэкзамена: доля вопросов, на которые нашла ответ, по дням.
 async function examSec(sec){
  let tests=[];try{const r=await fetch('/api/brain/memskills');if(r.ok)tests=(await r.json()).selftests||[]}catch{}
  if(!tests.length)return sec('самоэкзамен по дням',el('div','brain-fix-ok','Ещё не сдавала. Начну в простое, когда в переписке будет о чём себя спросить.'));
  const days=new Map();for(const x of tests){const d=String(x.at).slice(0,10);const v=days.get(d)||{n:0,ok:0};v.n++;if(x.passed)v.ok++;days.set(d,v)}
  const list=[...days].sort((a,b)=>a[0].localeCompare(b[0])).slice(-14),W2=320,H2=90,P=8;
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 '+W2+' '+H2);svg.setAttribute('class','brain-exam');svg.setAttribute('role','img');
  const x=i=>P+(list.length<2?(W2-2*P)/2:i*(W2-2*P)/(list.length-1)),y=v=>H2-P-v*(H2-2*P);
  for(const v of [0,.5,1]){const l=document.createElementNS(NS,'line');l.setAttribute('x1',P);l.setAttribute('x2',W2-P);l.setAttribute('y1',y(v));l.setAttribute('y2',y(v));l.setAttribute('class','grid');svg.append(l)}
  const pts=list.map(([,v],i)=>x(i)+','+y(v.ok/v.n)).join(' ');const pl=document.createElementNS(NS,'polyline');pl.setAttribute('points',pts);pl.setAttribute('class','line');svg.append(pl);
  list.forEach(([d,v],i)=>{const c=document.createElementNS(NS,'circle');c.setAttribute('cx',x(i));c.setAttribute('cy',y(v.ok/v.n));c.setAttribute('r',3);const tt=document.createElementNS(NS,'title');tt.textContent=d+': '+v.ok+' из '+v.n;c.append(tt);svg.append(c)});
  const lastV=list[list.length-1][1],firstV=list[0][1],delta=Math.round((lastV.ok/lastV.n-firstV.ok/firstV.n)*100);
  svg.setAttribute('aria-label','Самоэкзамен: последний день '+Math.round(lastV.ok/lastV.n*100)+'%');
  return sec('самоэкзамен по дням',svg,el('div','brain-fix-ok','Последний день: '+Math.round(lastV.ok/lastV.n*100)+'% ('+lastV.ok+' из '+lastV.n+')'+(list.length>1?', '+(delta>=0?'+':'')+delta+' п. с '+list[0][0].slice(5).split('-').reverse().join('.'):'')+'.'));
 }
 // Зрелость зон: молодые тусклее и реже, зрелые плотнее.
 function matureSec(sec){
  const ls=[...model.lobes].filter(l=>!l.bad).sort((a,b)=>(b.mature||0)-(a.mature||0));
  return sec('зрелость зон',...(ls.length?ls.slice(0,10).map(l=>{const r=el('div','brain-mature');const bar=el('i');bar.style.width=Math.round((l.mature||0)*100)+'%';bar.style.background=rgba(l.color,.85);r.append(el('span','',l.label),el('b','',''),el('small','',l.items.length+' · '+Math.round((l.mature||0)*100)+'%'));r.children[1].append(bar);return r}):[el('div','brain-fix-ok','Зон пока нет.')]));
 }
 /* ---------- Мысли: живая лента ---------- */
 let thLast=0,thFirst=true;
 function showThoughts(){const on=cfg.thoughts??wideQuery.matches;thBox.hidden=!on;thinkBtn.setAttribute('aria-pressed',String(on));thinkBtn.classList.toggle('on',on)}
 thinkBtn.onclick=()=>{cfg.thoughts=thBox.hidden;write(CFG_KEY,cfg);showThoughts();if(!thBox.hidden)void pollThoughts()};
 async function pollThoughts(){
  if(thBox.hidden||document.hidden||!host.isConnected)return;
  let d;try{const r=await fetch('/api/brain/thoughts?since='+thLast+'&limit=30');if(!r.ok)return;d=await r.json()}catch{return}
  const items=d.items||[];
  if(!items.length){if(!thList.children.length)thList.append(el('li','brain-muted','Пока тихо. Мысли появятся, когда я отвечу или поразмышляю.'));thFirst=false;return}
  thList.querySelector('.brain-muted')?.remove();
  for(const t of items){thLast=Math.max(thLast,t.id);const li=el('li','th-'+t.kind);li.append(el('span','brain-th-k',t.label),el('span','brain-th-t',t.text),el('time','',when(Date.parse(t.at))));li.title=t.text;thList.prepend(li);
   if(!thFirst&&!reduceQuery.matches){li.classList.add('new');coreKind=t.label;coreText=trim(t.text,42);coreTextT=3;core.pulse=Math.max(core.pulse,.6);if(model.lobes.length&&impulses.length<30){const l=model.lobes[Math.floor(Math.random()*model.lobes.length)];impulses.push({lobe:l,u:0,f:Math.floor(Math.random()*l.state.fil.length)})}dirty=true}}
  while(thList.children.length>12)thList.lastChild.remove();
  thFirst=false;
 }
 const thTimer=setInterval(()=>void pollThoughts(),4000);
 /* ---------- Время: как мозг рос день за днём ---------- */
 const dayOf=t=>{const d=new Date(t);d.setHours(0,0,0,0);return d.getTime()};
 let tmTimer=0;
 function setDay(i){
  if(!timeSpan)return;const max=+tmRange.max,end=dayOf(timeSpan.from)+i*DAY+DAY-1;
  timeCut=i>=max?null:end;apply();
  const n=model.lobes.reduce((a,l)=>a+l.items.length,0);
  tmLabel.textContent=new Date(Math.min(end,Date.now())).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'2-digit'})+' · '+n+' '+plural(n,'нейрон','нейрона','нейронов')+' · '+model.lobes.length+' '+plural(model.lobes.length,'зона','зоны','зон');
 }
 function stopPlay(){clearInterval(tmTimer);tmTimer=0;tmPlay.textContent='▶';tmPlay.setAttribute('aria-label','Проиграть рост')}
 function openTime(){
  if(!timeSpan){tmLabel.textContent='Пока нечего показывать';tmBox.hidden=false;return}
  const days=Math.max(0,Math.round((dayOf(Date.now())-dayOf(timeSpan.from))/DAY));tmRange.max=String(days);tmRange.value=String(days);tmBox.hidden=false;timeBtn.setAttribute('aria-pressed','true');timeBtn.classList.add('on');setDay(days);
 }
 function closeTime(){stopPlay();tmBox.hidden=true;timeBtn.setAttribute('aria-pressed','false');timeBtn.classList.remove('on');if(timeCut){timeCut=null;apply()}}
 timeBtn.onclick=()=>tmBox.hidden?openTime():closeTime();
 tmClose.onclick=closeTime;
 tmRange.oninput=()=>{stopPlay();setDay(+tmRange.value)};
 tmPlay.onclick=()=>{
  if(tmTimer){stopPlay();return}
  const max=+tmRange.max;if(+tmRange.value>=max)tmRange.value='0';setDay(+tmRange.value);
  const step=Math.max(1,Math.ceil(max/60));tmPlay.textContent='❚❚';tmPlay.setAttribute('aria-label','Пауза');
  tmTimer=setInterval(()=>{const v=Math.min(max,+tmRange.value+step);tmRange.value=String(v);setDay(v);if(v>=max)stopPlay()},reduceQuery.matches?900:420);
 };
 // Внутренний мир и рост себя: якоря, письмо, мечты, вкусы, летопись, сны, свои правила, самонастройка,
 // свои инструменты и правки своего кода (применяются только по кнопке).
 // Связи роста: кто кого чему научил (ties.js) и экзамен поведения Учителя.
 async function tiesSecs(sec,row){
  let t;try{const r=await fetch('/api/brain/ties');if(!r.ok)throw 0;t=await r.json()}catch{return [el('p','brain-fix-ok','Не удалось открыть связи.')]}
  const K=t.kinds||{},icon={agent:'✦',episode:'◈',lesson:'✎',goal:'☆',question:'?',exam:'✓',miss:'↺',rule:'§',owner:'♥'};
  const node=x=>{const n=el('span','brain-tie-node brain-tie-'+x.kind);n.append(el('b','',(icon[x.kind]||'·')+' '+(K[x.kind]||x.kind)),el('span','',x.label));return n};
  const chain=x=>{const r=el('div','brain-tie');r.append(node(x.from),el('span','brain-tie-arrow','→'),node(x.to));const m=el('div','brain-tie-meta',atText(x.at)+(x.why?' · '+x.why:'')+(x.n>1?' · ×'+x.n:''));r.append(m);return r};
  const out=[];
  out.push(sec('кто кого учит',...(t.summary.length?t.summary.map(s=>{const r=el('div','brain-dia-row');r.append(el('span','brain-fix-ok',s.label),el('span','brain-tie-n',String(s.n)));return r}):[el('div','brain-fix-ok','Пока связей нет. Они появятся, когда агенты поработают, ты оценишь их дела, а у души будут мечты.')])));
  if(t.items.length)out.push(sec('цепочки',...t.items.slice(0,40).map(chain)));
  if(t.exams?.length)out.push(sec('экзамен поведения',el('div','brain-fix-ok','Учитель проверяет, держатся ли уроки агентов и правила Юрики. Что не держится — уходит на покой.'),...t.exams.slice(0,8).map(e=>row(atText(e.at)+' · уроки '+e.lessons.passed+'/'+e.lessons.n+' · правила '+e.rules.passed+'/'+e.rules.n))));
  return out;
 }
 async function psycheSecs(sec,row){
  let p;try{const r=await fetch('/api/brain/psyche');if(!r.ok)throw 0;p=await r.json()}catch{return [el('p','brain-fix-ok','Не удалось открыть душу.')]}
  const act=(name,body)=>()=>postJson('/api/brain/psyche/'+name,body);
  const btn=(text,title,fn)=>{const b=el('button','brain-btn',text);b.type='button';if(title){b.title=title;b.setAttribute('aria-label',title)}b.onclick=async()=>{b.disabled=true;let msg='';try{const r=await fn();if(r&&!r.ok){const e=await r.json().catch(()=>({}));msg=e.error||'Не получилось'}}catch{msg='Нет связи'}if(msg){b.disabled=false;b.textContent=msg;return}void renderDiary()};return b};
  const out=[soulSec(p.soul,sec)];
  // Якоря: правит только хозяин, по одному в строке.
  const ta=el('textarea','brain-find brain-core-edit');ta.rows=3;ta.value=p.anchors.join('\n');ta.setAttribute('aria-label','Якоря');
  out.push(sec('якоря — то, что рост не стирает',el('div','brain-fix-ok','По одному в строке. Это всегда у меня перед глазами, никакой пересмотр их не уберёт.'),ta,
   (()=>{const r=el('div','brain-dia-row');r.append(btn('Сохранить','Сохранить якоря',()=>postJson('/api/brain/psyche/anchors',{anchors:ta.value.split('\n')})),btn('Вернуть исходные','Вернуть исходные якоря',()=>postJson('/api/brain/psyche/anchors',{anchors:[]})));return r})()));
  const mail=p.letters[0];
  if(mail){const kids=[el('div','brain-fix-ok brain-core-text',mail.text),el('div','brain-fix-ok',atText(mail.at)+(mail.read?' · прочитано':' · новое'))];if(!mail.read){const r=el('div','brain-dia-row');r.append(btn('Прочитал','Отметить письмо прочитанным',act('letter-read',{id:mail.id})));kids.push(r)}out.push(sec('письмо хозяину',...kids))}
  const open=p.goals.filter(g=>!g.done),done=p.goals.filter(g=>g.done);
  out.push(sec('мечты',...(open.length?open.map(g=>row('✧ '+g.text,act('goal-remove',{id:g.id}),'Убрать мечту')):[el('div','brain-fix-ok','Мечты появятся, когда я поразмышляю.')]),...done.slice(0,5).map(g=>row('✓ '+g.text+' · '+atText(g.done_at)))));
  if(p.tastes.length)out.push(sec('мои вкусы',...p.tastes.slice(0,12).map(t=>row((t.kind==='like'?'♡ нравится: ':'✕ не нравится: ')+t.text,act('taste-remove',{id:t.id}),'Убрать'))));
  if(p.chronicle.length)out.push(sec('летопись',...p.chronicle.slice(0,6).map(c=>row(atText(c.at)+' · '+c.text))));
  if(p.dreams.length)out.push(sec('сны',...p.dreams.slice(0,4).map(d=>row(atText(d.at)+' · '+d.text+(d.thought?' Мысль: '+d.thought:'')))));
  const rules=p.rules.filter(r=>r.status==='active'),off=p.rules.filter(r=>r.status!=='active');
  out.push(sec('мои правила',...(rules.length?rules.map(r=>row(r.text+' · ✓'+r.ok+' ✎'+r.fix,act('rule-remove',{id:r.id}),'Убрать правило')):[el('div','brain-fix-ok','Правила я пишу себе сама — из ваших поправок.')]),...off.slice(0,3).map(r=>row('(отложено) '+r.text,act('rule-remove',{id:r.id}),'Убрать правило'))));
  const t=p.tune;
  out.push(sec('самонастройка'+(t.on?'':' (выключена)'),el('div','brain-fix-ok','Пробую разные варианты и смотрю на ваши 👍/👎. Сейчас лучше всего: креативность — '+t.temperature.best+', длина — '+t.length.best+'.'),
   ...['temperature','length'].map(k=>row((k==='temperature'?'креативность: ':'длина: ')+t[k].arms.map(a=>a.label+' '+a.score+'% ('+a.tries+')').join(' · ')))));
  if(p.tools.length)out.push(sec('мои инструменты',...p.tools.map(x=>row(x.title+' — '+x.name+'('+x.params.join(', ')+') = '+x.formula+' · '+x.uses+'×',act('tool-remove',{name:x.name}),'Убрать инструмент'))));
  // Правки своего кода: применяются только по кнопке, после проверки тестами в песочнице.
  const STATUS={testing:'проверяю тестами…',ready:'тесты прошли — ждёт вашего решения',failed:'не прошла проверку',applied:'применена (заработает после перезапуска)',rejected:'отклонена',rolledback:'откачена'};
  const code=p.code.proposals;
  out.push(sec('правки моего кода'+(p.code.on?'':' (выключено)'),...(code.length?code.slice(0,6).map(c=>{
   const card=el('div','brain-core-block');
   card.append(el('div','brain-fix-q',c.edits.map(e=>e.file).join(', ')+' · '+(STATUS[c.status]||c.status)+' · '+atText(c.at)),el('div','brain-fix-ok',c.reason));
   if(c.result?.failed?.length)card.append(el('div','brain-fix-ok','Сломались: '+c.result.failed.slice(0,3).join(', ')));
   if(c.result?.error)card.append(el('div','brain-fix-ok',c.result.error));
   for(const e of c.edits){const d=el('details','brain-code');d.append(el('summary','',e.file),el('pre','brain-code-old',e.find),el('pre','brain-code-new',e.replace));card.append(d)}
   const r=el('div','brain-dia-row');
   if(c.status==='ready')r.append(btn('Применить','Применить правку кода',()=>confirm('Применить правку к '+c.edits.map(e=>e.file).join(', ')+'? Прежний файл сохранится, откатить можно одной кнопкой.')?postJson('/api/brain/psyche/code-apply',{id:c.id}):null));
   if(['testing','ready','failed'].includes(c.status))r.append(btn('Отклонить','Отклонить правку',act('code-reject',{id:c.id})));
   if(c.status==='applied')r.append(btn('Откатить','Вернуть прежний код',act('code-rollback',{id:c.id})));
   if(r.childNodes.length)card.append(r);
   return card;
  }):[el('div','brain-fix-ok','Пока я ничего не предлагала. Правку кода я придумываю сама при размышлении или в разговоре, проверяю тестами, а применяете её вы.')])));
  return out;
 }
 // Душа: ступень роста, черты характера, настроение и дорогие моменты (soul.js).
 function soulSec(v,sec){
  const kids=[];
  if(!v.on)kids.push(el('div','brain-fix-ok','Рост души выключен в настройках мышления.'));
  const lv=el('div','brain-soul-level');lv.append(el('span','brain-soul-name','«'+v.level+'» · ступень '+(v.levelIndex+1)+' из '+v.levels),
   el('span','brain-fix-ok',v.next?'до «'+v.next.name+'»: '+Math.max(0,Math.ceil(v.next.at-v.xp))+' опыта':'высшая ступень'));
  const bar=el('div','brain-soul-bar');const fill=el('i','');fill.style.width=Math.round(v.progress*100)+'%';bar.append(fill);bar.setAttribute('role','progressbar');bar.setAttribute('aria-valuenow',String(Math.round(v.progress*100)));bar.setAttribute('aria-label','Рост души');
  kids.push(lv,bar,el('div','brain-fix-ok','Настроение: '+v.mood.label+(v.mood.why?' · после «'+trim(v.mood.why,60)+'»':'')));
  const traits=el('div','brain-soul-traits');
  for(const t of v.traits){const r=el('div','brain-soul-trait');const b=el('div','brain-soul-bar small');const f=el('i','');f.style.width=t.value+'%';b.append(f);r.append(el('span','',t.label),b,el('span','brain-fix-ok',String(t.value)));traits.append(r)}
  kids.push(traits);
  if(v.moments.length)kids.push(el('div','brain-fix-q','дорогие моменты'),...v.moments.slice(0,5).map(x=>el('div','brain-fix-ok','♡ '+atText(x.at)+' · «'+trim(x.text,120)+'»')));
  const reset=el('button','brain-btn','Начать рост заново');reset.type='button';
  reset.onclick=async()=>{if(!confirm('Сбросить ступень, черты и моменты души? Блок «Моя душа» останется.'))return;reset.disabled=true;try{await postJson('/api/brain/soul/reset',{})}catch{}void renderDiary()};
  const row=el('div','brain-dia-row');row.append(reset);kids.push(row);
  return sec('душа',...kids);
 }
 // Сердцевина: блоки, которые всегда в подсказке. Можно поправить руками и вернуть прежнюю версию.
 const srcName={persona:'стартовая личность',seed:'начальное',chat:'сама в разговоре',reflect:'пересмотрела',review:'из разбора',user:'вы',rules:'из фактов'};
 function coreSec(blocks,sec){
  const kids=[el('div','brain-fix-ok','Это всегда у меня перед глазами. Я переписываю это сама, когда узнаю важное; поправить можно и вам.')];
  for(const b of blocks){
   const card=el('div','brain-core-block');
   const title=el('div','brain-fix-q',b.title+' · v'+b.version+(srcName[b.source]?' · '+srcName[b.source]:''));
   const text=el('div','brain-fix-ok brain-core-text',b.body);
   const edit=el('button','brain-btn','✎');edit.type='button';edit.title='Поправить «'+b.title+'»';edit.setAttribute('aria-label',edit.title);
   const back=el('button','brain-btn','↶');back.type='button';back.title='Прежние версии';back.setAttribute('aria-label',back.title);
   const bar=el('div','brain-dia-row');bar.append(title,edit,back);
   card.append(bar,text);
   edit.onclick=()=>{
    const ta=el('textarea','brain-find brain-core-edit');ta.value=b.body;ta.maxLength=b.limit||1500;ta.rows=5;ta.setAttribute('aria-label',b.title);
    const save=el('button','brain-btn','Сохранить'),cancel=el('button','brain-btn','Отмена'),count=el('span','brain-fix-ok','');save.type=cancel.type='button';
    const upd=()=>{count.textContent=ta.value.length+' / '+(b.limit||1500)};ta.oninput=upd;upd();
    const row2=el('div','brain-dia-row');row2.append(count,save,cancel);
    save.onclick=async()=>{save.disabled=true;try{const r=await postJson('/api/brain/core',{name:b.name,body:ta.value});if(!r.ok){const e=await r.json().catch(()=>({}));count.textContent=e.error||'Не сохранилось';save.disabled=false;return}}catch{save.disabled=false;return}void renderDiary()};
    cancel.onclick=()=>void renderDiary();
    text.replaceWith(ta);card.append(row2);ta.focus();
   };
   back.onclick=async()=>{
    back.disabled=true;let list=[];try{const r=await fetch('/api/brain/core');list=(await r.json()).find(x=>x.name===b.name)?.history||[]}catch{}
    const box=el('div','brain-core-hist');
    if(!list.length)box.append(el('div','brain-fix-ok','Прежних версий нет.'));
    for(const h of list.slice(0,5)){const r=el('div','brain-dia-row');r.append(el('span','brain-fix-ok','v'+h.version+' · '+atText(h.at)+' · '+trim(h.body,140)));const ret=el('button','brain-btn','Вернуть');ret.type='button';ret.onclick=async()=>{ret.disabled=true;try{await postJson('/api/brain/core/restore',{name:b.name,version:h.version})}catch{}void renderDiary()};r.append(ret);box.append(r)}
    card.append(box);
   };
   kids.push(card);
  }
  return sec('сердцевина',...kids);
 }
 // Знакомство: что я ещё хочу узнать о вас (вопросы задаю в чате, по одному и не часто).
 function onboardSec(ob,sec,row){
  const kids=[el('div','brain-fix-ok','Знакомимся: узнала '+ob.done+' из '+ob.total+'. Спрашиваю в разговоре по одному вопросу, когда это к месту.')];
  for(const it of ob.items.filter(i=>!i.done&&!i.skipped))kids.push(row('○ '+it.q,()=>postJson('/api/brain/onboarding',{action:'skip',item:it.id}),'Не спрашивать об этом'));
  const end=el('button','brain-btn','Закончить знакомство');end.type='button';end.onclick=async()=>{end.disabled=true;try{await postJson('/api/brain/onboarding',{action:'finish'})}catch{}void renderDiary()};
  kids.push(end);
  return sec('знакомство',...kids);
 }
 // Разбор разговора на ходу: каждые N сообщений и при сжатии длинного разговора.
 function reviewRow(rv){
  const r=el('div','brain-dia-row');
  r.append(el('span','brain-fix-ok','Разбираю разговор каждые '+rv.every+' сообщений'+(rv.last?' (последний раз '+atText(rv.last)+')':'')+'. С тех пор: '+rv.since+'.'));
  const b=el('button','brain-btn',rv.running?'Разбираю…':'Разобрать сейчас');b.type='button';b.disabled=!!rv.running;
  b.onclick=async()=>{b.disabled=true;b.textContent='Разбираю…';try{await postJson('/api/brain/review',{})}catch{}void renderDiary();window.dispatchEvent(new CustomEvent('tenma:memory'))};
  r.append(b);return r;
 }
 // Чему я научилась запоминать: навыки запоминания, самоэкзамен, промахи, история изменений и просьба о подсказке.
 function mskillSec(ms,sec,row){
  const kids=[];
  const sc=ms.score||{},cur=sc.current;
  const cause={not_stored:'не записано',not_found:'не нашлось',vague:'размыто'};
  if(ms.help){
   const box=el('div','brain-fix-card');box.append(el('div','brain-fix-q','нужна подсказка'),el('div','brain-fix-ok',ms.help.text));
   const f=el('form','brain-dia-row'),inp=el('input','brain-find'),ok=el('button','brain-btn','Подсказать'),no=el('button','brain-btn','Не сейчас');
   inp.placeholder='Например: запоминай клички животных';inp.maxLength=600;inp.setAttribute('aria-label','Подсказка');ok.type='submit';no.type='button';
   f.onsubmit=async e=>{e.preventDefault();const t=inp.value.trim();if(t.length<5)return;ok.disabled=true;try{await postJson('/api/brain/memskills/hint',{text:t})}catch{}void renderDiary()};
   no.onclick=async()=>{no.disabled=true;try{await postJson('/api/brain/memskills/help/dismiss',{})}catch{}void renderDiary()};
   f.append(inp,ok,no);box.append(f);kids.push(box);
  }
  kids.push(el('div','brain-fix-ok','Самоэкзамен: '+(sc.n?'нашла ответ в '+Math.round((sc.rate||0)*100)+'% из '+sc.n+' '+plural(sc.n,'вопроса','вопросов','вопросов')+(cur?.n?' (с нынешними навыками '+Math.round((cur.rate||0)*100)+'% из '+cur.n+')':''):'ещё не сдавала, начну в простое')+'.'));
  const mst=ms.missStats||{};const open=(mst.not_stored||0)+(mst.not_found||0)+(mst.vague||0);
  if(open)kids.push(el('div','brain-fix-ok','Промахи: не записано '+(mst.not_stored||0)+', не нашлось '+(mst.not_found||0)+', размыто '+(mst.vague||0)+'.'));
  for(const m of (ms.misses||[]).slice(0,3))kids.push(row('✗ «'+trim(m.question,60)+'»'+(m.expected?' → '+trim(m.expected,30):'')+' · '+(cause[m.cause]||m.cause)+(m.count>1?' ×'+m.count:'')));
  const live=(ms.skills||[]).filter(s=>s.status!=='retired');
  kids.push(el('div','brain-fix-ok','Навыки: '+live.map(s=>s.title+(s.status==='trial'?' (проба)':'')+(s.uses?' ·'+s.uses:'')).join(', ')+'.'));
  const chg={add:'научилась',refine:'уточнила',rollback:'вернула прежнее',retire:'на покой'};
  for(const h of (ms.history||[]).slice(0,6))kids.push(row(atText(h.at)+' · '+(chg[h.change]||h.change)+' «'+h.title+'» v'+h.version+(h.reason?' — '+trim(h.reason,120):'')));
  return sec('чему я научилась запоминать',...kids);
 }
 // Рост: связи, свои типы, карточки сущностей и псевдонимы (снять псевдоним можно здесь же).
 function growthSec(g,sec,row){
  const b=g.bonds||{},types=(g.types||[]).filter(t=>t.kind==='entity'),rels=(g.types||[]).filter(t=>t.kind==='relation');
  const kids=[el('div','brain-fix-ok','Связи: сильных '+(b.strong||0)+', средних '+(b.medium||0)+', слабых '+(b.weak||0)+'. Карточек '+(g.cardCount||0)+(g.grew?', дописано '+g.grew:'')+'.')];
  if(types.length)kids.push(el('div','brain-fix-ok','Типы: '+types.map(t=>t.name+' '+t.count+(t.source==='model'?' ✦':'')).join(', ')+'.'));
  if(rels.length)kids.push(el('div','brain-fix-ok','Свои связи: '+rels.map(t=>t.name+(t.multi?' (много значений)':'')).join(', ')+'.'));
  for(const c of (g.cards||[]).slice(0,5))kids.push(row((c.type?c.type+' · ':'')+trim(c.description,180)));
  for(const a of (g.aliases||[]).slice(0,8))kids.push(row('«'+a.alias+'» = «'+a.canonical+'»',()=>postJson('/api/brain/aliases/remove',{alias:a.alias}),'Это разные'));
  return sec('рост',...kids);
 }
 diaBtn.onclick=()=>{diaBox.hidden=false;void renderDiary()};
 // Только фактические события процесса: OCR, чтение, индексирование и поиск.
 const guardianHead=el('div','brain-fix-head'),guardianClose=el('button','brain-btn','✕');guardianClose.type='button';guardianClose.setAttribute('aria-label','Закрыть Хранителя');
 guardianHead.append(el('div','brain-k','✦ Хранитель библиотеки'),guardianClose);
 const guardianStatus=el('p','brain-guardian-status','Проверяю состояние…'),guardianCurrent=el('div','brain-guardian-current'),guardianCounts=el('p','brain-fix-ok'),guardianHistory=el('div','brain-guardian-history'),guardianJournal=el('div','brain-guardian-history'),guardianMemoryInfo=el('div','brain-guardian-history');
 const guardianOpen=el('button','brain-btn','Открыть память Хранителя');guardianOpen.type='button';guardianOpen.onclick=()=>window.TenmaApp?.openGuardian();
 guardianBox.append(guardianHead,guardianStatus,guardianCurrent,guardianCounts,guardianMemoryInfo,guardianHistory,guardianJournal,guardianOpen);
 guardianClose.onclick=()=>{guardianBox.hidden=true;guardianStar.setAttribute('aria-expanded','false');guardianStar.focus()};
 guardianStar.onclick=()=>{guardianBox.hidden=!guardianBox.hidden;guardianStar.setAttribute('aria-expanded',String(!guardianBox.hidden));if(!guardianBox.hidden){guardianClose.focus();void pollGuardian()}};
 let guardianPending=false,guardianDisposed=false;
 const guardianKinds={scan:'Проверка библиотеки',read:'Чтение документа',ocr:'Распознавание',search:'Поиск'};
 const guardianJournalLabels={folder_created:'Создана папка',file_uploaded:'Загружен файл',file_replaced:'Заменён файл',file_renamed:'Файл переименован',file_moved:'Файл перемещён',ocr_completed:'Распознан документ',collection_created:'Создана подборка',collection_added:'Добавлен файл в подборку',collection_removed:'Файл убран из подборки',collection_deleted:'Подборка удалена'};
 async function pollGuardian(){
  if(guardianPending||guardianDisposed)return;guardianPending=true;
  try{const response=await fetch('/api/brain/guardian'+(guardianBox.hidden?'':'?journal=1'),{cache:'no-store'});if(!response.ok)throw Error('Нет связи');const data=await response.json();if(guardianDisposed)return;
   const all=Array.isArray(data.active)?data.active:[],priority={ocr:0,read:1,search:2,scan:3},current=all.slice().sort((a,b)=>(priority[a.kind]??9)-(priority[b.kind]??9))[0];
   const queue=data.queue||{},counts=queue.counts||{},recent=Array.isArray(data.history)?data.history:[],latest=recent[0];
   const state=current?'working':(counts.error||latest?.result==='error')?'error':queue.enabled===false?'paused':counts.queued?'waiting':'idle';guardianStar.dataset.state=state;
   const text=current?(current.phase||guardianKinds[current.kind]||'Работаю'):state==='error'?(counts.error?'Есть ошибки обработки':'Последняя операция завершилась ошибкой'):state==='paused'?'Фоновая обработка выключена':state==='waiting'?'Документы ожидают обработки':'Ожидает';
   guardianStatus.textContent=text;guardianStar.title='Хранитель библиотеки · '+text;
   guardianCurrent.replaceChildren();if(current){if(current.file)guardianCurrent.append(el('p','brain-fix-ok','Файл: '+current.file));if(current.page&&current.total)guardianCurrent.append(el('p','brain-fix-ok','Страница '+current.page+' из '+current.total));if(all.length>1)guardianCurrent.append(el('p','brain-fix-ok','Одновременно процессов: '+all.length))}
   guardianCounts.textContent='Очередь: '+(counts.queued||0)+' · обработано: '+(counts.ready||0)+' · ошибки: '+(counts.error||0);
   for(const waiting of (queue.waiting||[]))guardianCurrent.append(el('p','brain-fix-ok','Ожидает: '+waiting));const errors=Array.isArray(queue.errors)?queue.errors:[];for(const error of errors)guardianCurrent.append(el('p','brain-guardian-error',(error.path||'Файл')+': '+(error.error||'ошибка')));
   guardianHistory.replaceChildren(el('div','brain-k','Последние действия с момента запуска'),...(recent.length?recent.slice(0,6).map(event=>el('p','brain-fix-ok',new Date(event.finishedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+' · '+(guardianKinds[event.kind]||'Операция')+(event.file?' · '+event.file:'')+' — '+(event.result==='error'?'ошибка'+(event.message?': '+event.message:''):event.result==='deferred'?'повторю после изменения':'готово'))):[el('p','brain-fix-ok','Пока действий не было.')]));
   const memory=data.memory;guardianMemoryInfo.replaceChildren(...(memory?[el('div','brain-k','Память Хранителя'),el('p','brain-fix-ok','Правил: '+memory.rules+' · фактов: '+memory.facts+' · предложений: '+memory.proposals+' · решений: '+(memory.decisions||0)+' · обработано: '+(memory.processed||0)),el('p','brain-fix-ok','Источников требуют проверки: '+memory.needsReview),...(memory.factsPreview||[]).map(f=>{const row=el('div','brain-guardian-history'),link=el('a','brain-fix-ok',f.source+(f.page?' · страница '+f.page:f.line?' · строка '+f.line:''));link.href='/api/library/download?path='+encodeURIComponent(f.source);row.append(el('p','brain-fix-ok',f.subject+' — '+f.predicate+' → '+f.object+(f.sourceState==='current'?'':' · источник требует проверки')),link);if(f.quote)row.append(el('p','brain-fix-ok',f.quote));return row})]:[]));const journal=Array.isArray(data.journal)?data.journal:[];guardianJournal.replaceChildren(el('div','brain-k','Журнал библиотеки'),...(journal.length?journal.slice(0,6).map(event=>el('p','brain-fix-ok',new Date(event.at).toLocaleString('ru-RU')+' · '+(guardianJournalLabels[event.action]||'Действие')+(event.path?' · '+event.path:''))):[el('p','brain-fix-ok','Записей пока нет.')]));
  }catch{if(!guardianDisposed){guardianStar.dataset.state='unknown';guardianStar.title='Хранитель библиотеки · нет связи';guardianStatus.textContent='Нет связи с локальным сервером';guardianCurrent.replaceChildren();guardianCounts.textContent='';guardianHistory.replaceChildren();guardianJournal.replaceChildren();guardianMemoryInfo.replaceChildren()}}finally{guardianPending=false}
 }
 const guardianPoll=setInterval(()=>{if(!document.hidden)void pollGuardian()},2000);void pollGuardian();
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
 let onView=true;const io=typeof IntersectionObserver==='function'?new IntersectionObserver(es=>{onView=es[es.length-1].isIntersecting;if(onView)dirty=true}):null;io?.observe(stage);
 function checkSleep(){const o=read('tenma.brain.sleep','auto'),h=new Date().getHours(),was=asleep;asleep=o==='on'||(o!=='off'&&(h>=23||h<6));if(was!==asleep)renderHud()}
 function frame(now){
  if(!host.isConnected){destroy();return}
  raf=requestAnimationFrame(frame);
  // Мозг не виден (прокручен за край, вкладка скрыта) — не рисуем вовсе.
  if(!onView||document.hidden){last=now;return}
  const dt=Math.min(.05,(now-last)/1000||0);
  const blooming=!reduceQuery.matches&&now-bloomStart<2700,busy=impulses.length||blooming||thinking||coreTextT>0||core.pulse>0||Math.abs(camT.zoom-cam.zoom)+Math.abs(camT.yaw-cam.yaw)+Math.abs(camT.px-cam.px)+Math.abs(camT.py-cam.py)+Math.abs((cfg.mode3d?1:0)-cam.depth)>.002||anyFlash;
  // В покое (лишь фоновая «болтовня», курсор не трогает) хватает ~30 кадров/с, во сне ~20: меньше нагрева и батареи.
  const calm=!thought&&!dirty&&!drag&&!hover&&!pinned&&!thinking&&!blooming&&coreTextT<=0&&!anyFlash&&!impulses.some(p=>p.big||p.recall&&!p.soft)&&Math.abs(camT.zoom-cam.zoom)+Math.abs(camT.yaw-cam.yaw)+Math.abs(camT.px-cam.px)+Math.abs(camT.py-cam.py)<.002;
  if(calm&&now-last<(asleep?48:31))return;
  if(!still()){simT+=dt;chatter-=dt;if(chatter<=0&&model.lobes.length){
   if(asleep&&!thinking){const day=[];for(const l of model.lobes)for(const it of l.items)if(Date.now()-Math.max(it.ts||0,recall[it.id]?.t||0)<DAY)day.push([l,it]);
    const pick=day.length?day[Math.floor(Math.random()*day.length)]:null;if(pick){impulses.push({lobe:pick[0],item:pick[1],u:0,f:Math.floor(Math.random()*pick[0].state.fil.length),recall:true,soft:true});if(Math.random()<.15){coreKind='сон';coreText=trim(pick[1].title,24);coreTextT=2.5}}
    chatter=1.2+Math.random()*1.4}
   else{const l=model.lobes[Math.floor(Math.random()*model.lobes.length)];impulses.push({lobe:l,u:0,f:Math.floor(Math.random()*l.state.fil.length)});chatter=thinking?.08+Math.random()*.15:.4+Math.random()*1.1}}}
  else if(!busy&&!dirty){last=now;return}
  last=now;dirty=false;draw(dt);
  // Адаптивное качество: на слабой видеокарте частиц становится меньше, на сильной — возвращаются.
  fpsT+=dt;fpsN++;if(fpsT>=1.2){const fps=fpsN/fpsT;if(fps<(calm?22:42)&&quality>.25)quality*=.8;else if(fps>(calm?27:56)&&quality<baseQ)quality=Math.min(baseQ,quality*1.1);
   slowN=glr&&glMode!=='force'&&quality<=.26&&fps<20?slowN+1:0;if(slowN>=3){console.warn('Мозг: WebGL слишком медленный, перехожу на 2D');dropGL()}fpsT=0;fpsN=0}
 }
 function destroy(){guardianDisposed=true;clearInterval(guardianPoll);io?.disconnect();cancelAnimationFrame(raf);clearInterval(poll);clearInterval(thTimer);clearInterval(tmTimer);document.removeEventListener('click',onDocClick);ro.disconnect();hudRo.disconnect();window.removeEventListener('tenma:workspace',onWorkspace);window.removeEventListener('tenma:memory',onMemory);wideQuery.removeEventListener('change',onWide);document.removeEventListener('keydown',onKey);document.removeEventListener('fullscreenchange',onFsChange);document.documentElement.classList.remove('brain-fs-lock');window.removeEventListener('tenma:thinking',onThinking);window.removeEventListener('tenma:recall',onRecall);window.removeEventListener('tenma:learn',onLearn);window.removeEventListener('tenma:experience',onExperience);glr?.destroy()}
 checkSleep();setPalette();placeHud();resize();apply();renderLearn();loadFacts();showThoughts();void pollThoughts();raf=requestAnimationFrame(frame);
 return {destroy};
}
window.TenmaBrain={mount};
})();

