'use strict';
const {stdout}=require('node:process');
const stages=['Node.js','Python','Зависимости','Запуск'];
const index=Number(process.argv[2]);
if(!Number.isInteger(index)||index<0||index>4){console.error('Usage: node tools/progress.js <0..4>');process.exitCode=2}
else{
 const total=28,done=Math.round(total*index/4);
 const bar='█'.repeat(done)+'░'.repeat(total-done);
 const label=index===4?'Готово':stages[index]||'Подготовка';
 if(stdout.isTTY){
  const frames=['◐','◓','◑','◒'];
  let step=0;
  const timer=setInterval(()=>{
   stdout.write('\r  '+frames[step++%frames.length]+' ['+bar+'] '+(index*25)+'%  '+label+'   ');
   if(step>=8){clearInterval(timer);stdout.write('\r  ✦ ['+bar+'] '+(index*25)+'%  '+label+'   \n')}
  },65);
 }else stdout.write('  ['+bar+'] '+(index*25)+'%  '+label+'\n');
}
