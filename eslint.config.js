'use strict';
// Минимальный конфиг ESLint (flat config, ESLint 9).
// Код проекта — CommonJS для Node и обычные <script> для браузера.
const js=require('@eslint/js');
const globals=require('globals');

module.exports=[
  {ignores:['node_modules/','data/','backups/','runtime/']},
  js.configs.recommended,
  {
    files:['**/*.js'],
    languageOptions:{ecmaVersion:'latest',sourceType:'commonjs',globals:{...globals.node}},
    linterOptions:{reportUnusedDisableDirectives:'error'},
    rules:{
      // «catch{}» — осознанный приём в проекте (best-effort операции), пустые try/if по-прежнему ошибка.
      'no-empty':['error',{allowEmptyCatch:true}],
      // Неиспользуемые переменные пока только предупреждение: старые случаи перечислены в PR и будут убраны отдельно.
      // Отбрасывание полей через rest ({id,...rest}) и имена с «_» — норма.
      'no-unused-vars':['warn',{ignoreRestSiblings:true,argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrors:'none'}],
    },
  },
  {
    // Скрипты, которые грузятся в браузере через <script>.
    files:['app.js','avatar.js','brain.js','wisps.js'],
    languageOptions:{sourceType:'script',globals:{...globals.browser}},
    // Верхнеуровневые const/let в скрипте могут затенять свойства window (например, status) — это не ошибка.
    rules:{'no-redeclare':['error',{builtinGlobals:false}]},
  },
];
