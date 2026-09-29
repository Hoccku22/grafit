/* Графит (десктоп) — preload: нативные мостики для страницы приложения.
   - Подменяет File System Access API (showDirectoryPicker и объекты-дескрипторы)
     на работу через IPC: системный диалог + обычные файловые операции.
   - Добавляет фирменную шапку окна (только в десктопе): полоса с логотипом,
     которую можно тянуть мышью; системные кнопки окна рисует Windows в цветах темы. */
'use strict';

const { ipcRenderer } = require('electron');
const path = require('path');

const SHELL_ARG = process.argv.find(function (a) { return a.indexOf('--grafit-shell=') === 0; });
const SHELL = SHELL_ARG ? SHELL_ARG.slice(SHELL_ARG.indexOf('=') + 1) : null;

const SEP = '\\';

function joinPath(a, b) {
  const base = String(a || '').replace(/[\\/]+$/, '');
  return base + SEP + String(b);
}

function baseName(p) {
  const parts = String(p || '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function makeFileHandle(p, name) {
  return {
    kind: 'file',
    name: name || baseName(p),
    __path: p,
    getFile: async function () {
      const r = await ipcRenderer.invoke('fs:readfile', p);
      return {
        text: async function () { return r.content; },
        lastModified: r.mtime,
        size: r.size
      };
    },
    createWritable: async function () {
      return {
        write: async function (data) { await ipcRenderer.invoke('fs:writefile', p, data); },
        close: async function () { return; }
      };
    },
    remove: async function () { await ipcRenderer.invoke('fs:remove', p); }
  };
}

function makeDirHandle(p, name) {
  return {
    kind: 'directory',
    name: name || baseName(p),
    __path: p,
    values: function () {
      let items = null;
      let idx = 0;
      return {
        [Symbol.asyncIterator]: function () { return this; },
        next: async function () {
          if (items === null) {
            const list = await ipcRenderer.invoke('fs:list', p);
            list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ru'); });
            items = list;
          }
          if (idx >= items.length) return { done: true, value: undefined };
          const it = items[idx++];
          const child = joinPath(p, it.name);
          return { done: false, value: it.isDir ? makeDirHandle(child, it.name) : makeFileHandle(child, it.name) };
        }
      };
    },
    getFileHandle: async function (nm, opts) {
      const child = joinPath(p, nm);
      if (opts && opts.create) {
        await ipcRenderer.invoke('fs:touch', child);
      } else {
        const exists = await ipcRenderer.invoke('fs:exists', child);
        if (!exists) throw new Error('NotFound');
      }
      return makeFileHandle(child, nm);
    },
    getDirectoryHandle: async function (nm, opts) {
      const child = joinPath(p, nm);
      if (opts && opts.create) {
        await ipcRenderer.invoke('fs:mkdir', child);
      } else {
        const exists = await ipcRenderer.invoke('fs:exists', child);
        if (!exists) throw new Error('NotFound');
      }
      return makeDirHandle(child, nm);
    },
    queryPermission: async function () { return 'granted'; },
    requestPermission: async function () { return 'granted'; },
    remove: async function () { await ipcRenderer.invoke('fs:remove', p); }
  };
}

let APP_VERSION = '0.2.2';
try {
  APP_VERSION = require(path.join(__dirname, 'package.json')).version || APP_VERSION;
} catch (e) { /* ок */ }

window.__grafitDesktop = {
  isDesktop: true,
  version: APP_VERSION,
  platform: process.platform,
  shell: SHELL,
  makeHandle: function (p) { return makeDirHandle(p); },
  exists: function (p) { return ipcRenderer.invoke('fs:exists', p); },
  engineStatus: function () { return ipcRenderer.invoke('engine:status'); },
  engineRestart: function () { return ipcRenderer.invoke('engine:restart'); }
};

// Подмена File System Access API: системный диалог + IPC-файлы
window.showDirectoryPicker = async function () {
  const picked = await ipcRenderer.invoke('dlg:pickFolder');
  if (!picked) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  return makeDirHandle(picked);
};

/* ---------- Фирменная шапка окна (только в десктопе) ---------- */

function injectShell() {
  if (!SHELL) return;
  const root = document.documentElement;
  root.classList.add('gd-shell');

  const css = [
    'html.gd-shell body{padding-top:34px}',
    'html.gd-shell .app{height:calc(100vh - 34px)}',
    '#gd-titlebar{position:fixed;top:0;left:0;right:0;height:34px;z-index:300;background:var(--panel);border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:9px;padding:0 150px 0 14px;-webkit-app-region:drag;user-select:none}',
    '#gd-titlebar .gd-tb-logo{display:flex;color:var(--accent)}',
    '#gd-titlebar .gd-tb-logo svg{width:15px;height:15px}',
    '#gd-titlebar .gd-tb-title{font-size:12.5px;font-weight:600;letter-spacing:.02em;color:var(--text)}'
  ].join('\n');
  const style = document.createElement('style');
  style.id = 'gd-shell-css';
  style.textContent = css;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'gd-titlebar';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML =
    '<span class="gd-tb-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M12 2.5v19M2.5 12h19"/></svg></span>' +
    '<span class="gd-tb-title">Графит</span>';
  document.body.prepend(bar);

  // Системные кнопки окна перекрашиваются вслед за темой приложения
  try {
    const emit = function () {
      const light = root.getAttribute('data-theme') === 'light';
      ipcRenderer.send('shell:theme', light ? 'light' : 'dark');
    };
    emit();
    new MutationObserver(emit).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* не критично */ }
}

window.addEventListener('DOMContentLoaded', injectShell);
