'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('launcher files are present and Windows BAT uses CRLF',()=>{
 const bat=fs.readFileSync(path.join(root,'Tenmayurika.bat'),'utf8');
 assert.match(bat,/\r\n/);
 assert.ok(!bat.replace(/\r\n/g,'').includes('\n'));
 assert.match(bat,/DisableDelayedExpansion/);
 assert.match(bat,/"%~dp0"/);
 assert.ok(!/^title [^\r\n]*[^^]\|/m.test(bat),'title must escape the pipe character');
 assert.ok(bat.split('\r\n').filter(l=>/powershell\.exe/i.test(l)).every(l=>/-ExecutionPolicy Bypass/.test(l)),'PowerShell must ignore restricted policy for this process only');
 assert.match(bat,/chcp %OLDCP%/);
 assert.ok(fs.existsSync(path.join(root,'tools','launcher.js')));
});
test('portable launcher parses correctly',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,['--check',path.join(root,'tools','launcher.js')],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
