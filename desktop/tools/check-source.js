/* Минимальная проверка исходников без запуска окна Electron.
   Подходит для среды сборки, где Chromium нельзя запустить. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = function (file) { return fs.readFileSync(path.join(root, file), 'utf8'); };

// Проверяем парсинг каждого изменяемого скрипта, чтобы не получить пустое окно
// из-за синтаксической ошибки в браузерном коде.
['main.js', 'preload.js', 'app/assets/app.js', 'app/assets/markdown.js', 'app/assets/editor-cm.js', 'app/assets/ai-core.js'].forEach(function (file) {
  new Function(read(file));
});

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert.strictEqual(pkg.version, lock.version, 'версии package.json и package-lock.json должны совпадать');
assert.strictEqual(pkg.version, lock.packages[''].version, 'корневая версия lock-файла должна совпадать');

const markdown = require(path.join(root, 'app/assets/markdown.js'));
const rendered = markdown.render('[Ссылка](https://example.com)');
assert.match(rendered, /rel="noopener noreferrer"/, 'внешняя ссылка должна защищать opener');

const main = read('main.js');
assert.match(main, /setWindowOpenHandler/, 'внешние окна должны обрабатываться главным процессом');
assert.match(main, /will-navigate/, 'внешняя навигация должна блокироваться');

const appCode = read('app/assets/app.js');
assert.match(appCode, /removeMissingDiskItems/, 'синхронизация должна обрабатывать удалённые файлы');
assert.match(appCode, /restoreHistoryVersion/, 'история заметок должна поддерживать восстановление');

console.log('CHECK_OK');
