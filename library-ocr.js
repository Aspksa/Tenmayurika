'use strict';
// OCR runs only on explicitly selected local files; language packs come from npm dependencies.
const fs=require('node:fs/promises'),path=require('node:path');
const library=require('./library');
const DATA=process.env.TENMAYURIKA_OCR_DATA||path.join(__dirname,'runtime','ocr-languages');
let busy=false;
async function languages(){
 await fs.mkdir(DATA,{recursive:true});
 for(const lang of ['eng','rus']){
  const source=require.resolve('@tesseract.js-data/'+lang+'/4.0.0_best_int/'+lang+'.traineddata.gz');
  await fs.copyFile(source,path.join(DATA,lang+'.traineddata.gz'));
 }
}
async function recognize(file){
 if(busy)throw new TypeError('Распознавание уже выполняется');
 if(typeof file!=='string'||!/\.(png|jpe?g|webp|pdf)$/i.test(file))throw new TypeError('Поддерживаются PNG, JPEG, WebP и PDF');
 busy=true;let worker,task;
 try{
  const full=await library.filePath(file),stat=await fs.stat(full);if(stat.size>16*1024*1024)throw new TypeError('Файл больше 16 МБ');
  await languages();const {createWorker}=require('tesseract.js');worker=await createWorker('eng+rus',1,{langPath:DATA,cacheMethod:'none'});
  const canvas=require('@napi-rs/canvas'),pages=[];
  async function extract(buffer,page){const result=await worker.recognize(buffer);pages.push({page,text:String(result.data.text||'').slice(0,100000)})}
  if(/\.pdf$/i.test(file)){
   const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),bytes=await fs.readFile(full);task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,stopAtErrors:true});const pdf=await task.promise;if(pdf.numPages>10)throw new TypeError('Для распознавания PDF ограничен 10 страницами');
   for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),viewport=page.getViewport({scale:1.5});if(viewport.width*viewport.height>8000000)throw new TypeError('Страница слишком большая');const surface=canvas.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:surface.getContext('2d'),viewport}).promise;await extract(surface.toBuffer('image/png'),i);page.cleanup()}
  }else{
   const image=await canvas.loadImage(full);if(image.width*image.height>8000000)throw new TypeError('Изображение слишком большое');const surface=canvas.createCanvas(image.width,image.height);surface.getContext('2d').drawImage(image,0,0);await extract(surface.toBuffer('image/png'),1);
  }
  return {path:file,pages};
 }finally{try{if(worker)await worker.terminate()}finally{if(task)await task.destroy();busy=false}}
}
module.exports={recognize};
