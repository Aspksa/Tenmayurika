'use strict';
// Проверяет зависимости до запуска, включая локальные языковые пакеты OCR.
const MODULES=['dotenv','@napi-rs/canvas','tesseract.js','@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz'];
async function check(resolve=require.resolve,load=require,importer=specifier=>import(specifier)){
 for(const name of MODULES)resolve(name);
 load('dotenv');load('@napi-rs/canvas');load('tesseract.js');
 await Promise.all([importer('@lancedb/lancedb'),importer('pdfjs-dist/legacy/build/pdf.mjs')]);
 return true;
}
if(require.main===module)check().catch(()=>{process.exitCode=1});
module.exports={check,MODULES};
