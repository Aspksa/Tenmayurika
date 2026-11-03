'use strict';
// Запускает npm из того же Node.js, которым выполняется этот скрипт.
// Не использует npm.cmd: при вызове `call "npm.cmd"` cmd.exe подставляет в %~dp0
// текущую папку вместо папки Node.js, и npm ищется в <проект>\node_modules\npm.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NPM_NOT_FOUND = 86;

function npmCliCandidates(execPath = process.execPath, platform = process.platform) {
  const dir = path.dirname(execPath);
  const list = [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  if (platform !== 'win32') list.push(path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  return list;
}

function findNpmCli(execPath = process.execPath, platform = process.platform) {
  return npmCliCandidates(execPath, platform).find(file => fs.existsSync(file)) || null;
}

function runNpm(args, options = {}) {
  const cli = findNpmCli();
  if (!cli) return { status: NPM_NOT_FOUND, error: new Error('npm-cli.js не найден рядом с ' + process.execPath) };
  return spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', windowsHide: true, ...options });
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const result = runNpm(process.argv.slice(2), { cwd: root });
  if (result.error) console.error('[Tenmayurika] ' + result.error.message);
  process.exit(result.status === null ? 1 : result.status);
}

module.exports = { NPM_NOT_FOUND, npmCliCandidates, findNpmCli, runNpm };
