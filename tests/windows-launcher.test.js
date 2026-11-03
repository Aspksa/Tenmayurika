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
test('BAT runs npm through node + npm-cli.js, never via call "npm.cmd"',()=>{
 const bat=fs.readFileSync(path.join(root,'Tenmayurika.bat'),'utf8');
 assert.ok(!/npm\.cmd/i.test(bat),'cmd.exe resolves %~dp0 of a quoted PATH lookup to the current folder');
 assert.match(bat,/"%NODE%" "%~dp0tools\\run-npm\.js" %NPM_MODE%/);
 assert.match(bat,/bootstrap-node\.ps1" -RequireNpm/);
});
test('run-npm finds npm-cli.js next to node.exe, not in the project',()=>{
 const {npmCliCandidates,findNpmCli,NPM_NOT_FOUND}=require('../tools/run-npm.js');
 const win=npmCliCandidates('C:\\Program Files\\nodejs\\node.exe','win32');
 assert.equal(win.length,1);
 assert.equal(path.dirname(path.dirname(path.dirname(path.dirname(win[0])))),path.dirname('C:\\Program Files\\nodejs\\node.exe'));
 assert.ok(win[0].endsWith(path.join('node_modules','npm','bin','npm-cli.js')));
 assert.ok(!win[0].startsWith(root));
 assert.equal(NPM_NOT_FOUND,86);
 assert.ok(findNpmCli(),'current Node.js must ship npm');
 assert.equal(findNpmCli(path.join(root,'Рабочий стол','nope','node.exe'),'win32'),null);
});
test('run-npm executes npm regardless of the current folder',()=>{
 const {spawnSync}=require('node:child_process');
 const r=spawnSync(process.execPath,[path.join(root,'tools','run-npm.js'),'--version'],{encoding:'utf8',cwd:path.join(root,'tools')});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout.trim(),/^\d+\.\d+\.\d+/);
});
