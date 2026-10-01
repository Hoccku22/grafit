/* =========================================================================
   app.js — логика «Графита»: заметки, дерево, редактор, поиск, граф.
   Работает полностью локально; без внешних запросов.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------- утилиты ---------- */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var escapeHtml = MD.escapeHtml;

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter++;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + uidCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function countWords(text) { return text && text.trim() ? text.trim().split(/\s+/).length : 0; }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function safeName(name) { return String(name || '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Заметка'; }
  function downloadBlob(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function toast(msg, kind) {
    var box = $('#toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 2700);
    setTimeout(function () { el.remove(); }, 3200);
  }

  /* ---------- перехват ошибок (для отладки) ---------- */
  window.addEventListener('error', function (e) { window.__lastError = String(e.message || e.error || 'error'); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__lastError = 'promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason);
  });
  window.__lastError = null;

  /* ---------- иконки для дерева ---------- */
  var ICONS = {
    chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    chevD: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L8 20l-5 1 1-5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V4.5h5V7M7 7l1 13h8l1-13"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };

  /* ---------- состояние ---------- */

  var LS_KEY = 'vault.obsidian.style.v1';
  var LS_THEME = 'vault.theme';
  var LS_VIEW = 'vault.view';
  var LS_RIGHT = 'vault.right';
  var LS_SESSION = 'vault.session';
  var LS_SPLIT = 'vault.split';

  var FSA_OK = typeof window.showDirectoryPicker === 'function';

  var vault = null;
  var vaultMode = 'browser';   // 'browser' | 'disk'
  var disk = null;             // { root, handles: Map<itemId, FileSystemHandle> }
  var currentId = null;
  var viewMode = 'split';
  var rightOpen = true;
  var savedAt = 0;
  var collapsed = {};
  var dirty = {};
  var lastDiskCheck = 0;
  var cloudChoice = 'yandex';
  var aiCfg = null;
  var aiBusy = false;
  var aiTimer = null;
  var aiLastHash = {};
  var aiSuggestions = {};
  var aiLastRun = 0;
  var aiLastRaw = {};
  var aiHadError = {};
  var aiDecoRanges = [];
  var aiPopupIdx = null;
  var aiLastRawContent = '';
  var ED = null;
  var ghostMode = null;
  var aiContinueBusy = false;

  /* ---------- IndexedDB (для хранения дескриптора папки) ---------- */

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open('vault-app', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }
  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('kv', 'readonly');
        var rq = tx.objectStore('kv').get(key);
        rq.onsuccess = function () { db.close(); resolve(rq.result); };
        rq.onerror = function () { db.close(); reject(rq.error); };
      });
    });
  }
  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); resolve(); };
      });
    });
  }

  /* ---------- хранилище: загрузка и сохранение ---------- */

  function seedVault() {
    var items = {};
    var now = Date.now();
    SEEDS.folders.forEach(function (f) {
      items[f.id] = { id: f.id, type: 'folder', name: f.name, parent: f.parent || null, created: now, updated: now };
    });
    SEEDS.notes.forEach(function (n) {
      items[n.id] = { id: n.id, type: 'note', name: n.name, parent: n.parent || null, content: n.content, created: now, updated: now };
    });
    vault = { version: 1, items: items, trash: [] };
    if (vaultMode !== 'disk') saveLocal();
    return vault;
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || typeof data.items !== 'object' || !data.items) return false;
      vault = { version: 1, items: data.items, trash: Array.isArray(data.trash) ? data.trash : [] };
      return true;
    } catch (e) { return false; }
  }

  function saveLocal() {
    if (vaultMode === 'disk' || !vault) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ version: 1, items: vault.items, trash: vault.trash }));
      setSaved();
    } catch (e) {
      toast('Не удалось сохранить: возможно, переполнено хранилище браузера', 'error');
    }
  }
  var saveLocalDebounced = debounce(saveLocal, 350);

  function persist() {
    if (vaultMode === 'disk') saveDiskDebounced();
    else saveLocalDebounced();
  }

  function setSaved() { savedAt = Date.now(); updateStatus(); }

  function markDirty(id) { dirty[id] = true; }

  /* ---------- облако: провайдеры и мастер подключения ---------- */

  var PROVIDERS = [
    { id: 'yandex', label: 'Яндекс.Диск', re: /яндекс|yandex/i },
    { id: 'google', label: 'Google Drive', re: /google|my drive|мой диск/i },
    { id: 'dropbox', label: 'Dropbox', re: /dropbox/i },
    { id: 'onedrive', label: 'OneDrive', re: /onedrive/i },
    { id: 'nextcloud', label: 'Nextcloud', re: /nextcloud/i },
    { id: 'mailru', label: 'Облако Mail.ru', re: /mail\.ru|облако/i },
    { id: 'mega', label: 'MEGA', re: /mega/i },
    { id: 'icloud', label: 'iCloud Drive', re: /icloud/i },
    { id: 'pcloud', label: 'pCloud', re: /pcloud/i }
  ];

  function detectProvider(name) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].re.test(String(name || ''))) return PROVIDERS[i];
    }
    return null;
  }

  var CLOUD_STEPS = {
    yandex: [
      'Установите приложение «Яндекс.Диск для компьютера» — в проводнике появится папка «Яндекс.Диск».',
      'Создайте в ней папку для заметок, например «Заметки».',
      'Нажмите «Выбрать папку на компьютере» и укажите её.'
    ],
    google: [
      'Установите «Google Диск для компьютера» — появится диск «Мой диск» (My Drive).',
      'Создайте на нём папку «Заметки».',
      'Нажмите «Выбрать папку на компьютере» и укажите её.'
    ],
    dropbox: [
      'Установите приложение Dropbox — появится папка «Dropbox».',
      'Создайте внутри папку «Заметки».',
      'Нажмите «Выбрать папку на компьютере» и укажите её.'
    ],
    onedrive: [
      'OneDrive уже встроен в Windows — войдите в него, папка появится в проводнике.',
      'Создайте внутри папку «Заметки».',
      'Нажмите «Выбрать папку на компьютере» и укажите её.'
    ],
    nextcloud: [
      'Установите клиент Nextcloud и включите синхронизацию папки.',
      'Создайте внутри папку «Заметки».',
      'Нажмите «Выбрать папку на компьютере» и укажите её.'
    ],
    other: [
      'Подойдёт любая папка, которую синхронизирует облачный клиент: MEGA, pCloud, Облако Mail.ru, WebDAV-диск и другие.',
      'Нажмите «Выбрать папку на компьютере» и укажите папку синхронизации.'
    ]
  };

  function openCloudWizard() {
    var m = $('#cloud-modal');
    if (!m) return;
    selectCloud(cloudChoice);
    m.classList.add('open');
  }

  function selectCloud(id) {
    cloudChoice = CLOUD_STEPS[id] ? id : 'other';
    $$('#cloud-modal .cloud-card').forEach(function (c) {
      c.classList.toggle('active', c.dataset.cloud === cloudChoice);
    });
    var box = $('#cloud-steps');
    if (!box) return;
    box.innerHTML = '';
    (CLOUD_STEPS[cloudChoice] || CLOUD_STEPS.other).forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'cloud-step';
      var b = document.createElement('b');
      b.textContent = (i + 1) + '.';
      var span = document.createElement('span');
      span.textContent = s;
      row.appendChild(b);
      row.appendChild(span);
      box.appendChild(row);
    });
    var btn = document.createElement('button');
    btn.className = 'primary-btn cloud-cta';
    btn.textContent = 'Выбрать папку на компьютере…';
    btn.addEventListener('click', function () {
      closeModal('#cloud-modal');
      openDiskVault({ expect: cloudChoice });
    });
    box.appendChild(btn);
  }

  /* ---------- хранилище на диске (File System Access API) ---------- */

  async function scanDiskDir(dirHandle, parentId, depth) {
    if (depth > 6) return;
    var entries = [];
    for await (var entry of dirHandle.values()) entries.push(entry);
    entries.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ru');
    });
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.name.charAt(0) === '.') continue;
      if (e.kind === 'directory') {
        var folder = { id: uid('d'), type: 'folder', name: e.name, parent: parentId, created: Date.now(), updated: Date.now() };
        vault.items[folder.id] = folder;
        disk.handles.set(folder.id, e);
        await scanDiskDir(e, folder.id, depth + 1);
      } else if (e.kind === 'file' && /\.(md|markdown|txt)$/i.test(e.name)) {
        var content = '';
        var lm = Date.now();
        try {
          var f = await e.getFile();
          content = await f.text();
          lm = f.lastModified || lm;
        } catch (err) { /* пустой файл или ошибка чтения — пропускаем содержимое */ }
        var note = { id: uid('n'), type: 'note', name: e.name.replace(/\.(md|markdown|txt)$/i, ''), parent: parentId, content: content, created: lm, updated: lm };
        vault.items[note.id] = note;
        disk.handles.set(note.id, e);
      }
    }
  }

  async function activateDisk(root, opts) {
    opts = opts || {};
    vaultMode = 'disk';
    disk = { root: root, handles: new Map(), provider: detectProvider(root.name) };
    vault = { version: 1, items: {}, trash: [] };
    collapsed = {};
    dirty = {};
    await scanDiskDir(root, null, 0);
    $('#st-reconnect').classList.add('hidden');
    renderTree();
    renderTagsPanel();
    var note = currentId && getItem(currentId) ? currentId : firstNoteId();
    if (note) openNote(note); else showPlaceholder(true);
    savedAt = Date.now();
    lastDiskCheck = Date.now();
    startDiskWatch();
    updateStatus();
    var prov = disk.provider;
    toast(prov
      ? '☁️ ' + prov.label + ': папка «' + root.name + '» подключена'
      : '📁 Папка «' + root.name + '» подключена — правки сохраняются в файлы', 'ok');
    if (opts.userInitiated) offerMigration();
  }

  async function openDiskVault(opts) {
    opts = opts || {};
    if (!FSA_OK) {
      toast('Этот браузер не умеет открывать папки. Попробуйте Chrome или Edge.', 'error');
      return;
    }
    try {
      var root = await window.showDirectoryPicker({ mode: 'readwrite' });
      await activateDisk(root, { userInitiated: true });
      if (opts.expect && opts.expect !== 'other' && !disk.provider) {
        var exp = null;
        for (var i = 0; i < PROVIDERS.length; i++) {
          if (PROVIDERS[i].id === opts.expect) exp = PROVIDERS[i];
        }
        if (exp) toast('Папка «' + root.name + '» не похожа на ' + exp.label + ' — проверьте, что выбрали папку облака', 'error');
      }
      try { await idbSet('diskRoot', root); } catch (e) { /* не критично */ }
      try { if (root && root.__path) localStorage.setItem('vault.diskPath', root.__path); } catch (e2) { /* не критично */ }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('Не удалось открыть папку: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  async function tryRestoreDisk() {
    if (!FSA_OK) return;
    var root = null;
    try { root = await idbGet('diskRoot'); } catch (e) { root = null; }
    if (!root && window.__grafitDesktop) {
      var savedPath = null;
      try { savedPath = localStorage.getItem('vault.diskPath'); } catch (e2) {}
      if (savedPath) {
        try {
          if (await window.__grafitDesktop.exists(savedPath)) root = window.__grafitDesktop.makeHandle(savedPath);
        } catch (e3) {}
      }
    }
    if (!root) return;
    try {
      var perm = 'granted';
      if (root.queryPermission) perm = await root.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') await activateDisk(root);
      else showReconnect(root);
    } catch (e) { /* игнорируем */ }
  }

  function showReconnect(root) {
    var btn = $('#st-reconnect');
    if (!btn) return;
    btn.classList.remove('hidden');
    btn.textContent = (detectProvider(root.name) ? '☁️ ' : '📁 ') + 'Подключить «' + root.name + '»';
    btn.onclick = async function () {
      try {
        var p = await root.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') { btn.classList.add('hidden'); await activateDisk(root); }
        else toast('Доступ к папке не выдан', 'error');
      } catch (e) { toast('Не удалось получить доступ: ' + (e && e.message ? e.message : e), 'error'); }
    };
  }

  function detachDisk() {
    disk = null;
    vaultMode = 'browser';
    stopDiskWatch();
    idbDel('diskRoot').catch(function () {});
    try { localStorage.removeItem('vault.diskPath'); } catch (e) {}
    updateStatus();
  }

  async function diskCreateNoteFile(item) {
    if (!disk) return;
    try {
      var parentH = item.parent ? disk.handles.get(item.parent) : disk.root;
      if (!parentH || typeof parentH.getFileHandle !== 'function') return;
      var fh = await parentH.getFileHandle(safeName(item.name) + '.md', { create: true });
      disk.handles.set(item.id, fh);
      markDirty(item.id);
      saveDiskDebounced();
    } catch (e) { toast('Не удалось создать файл: ' + (e && e.message ? e.message : e), 'error'); }
  }

  async function diskCreateFolder(item) {
    if (!disk) return;
    try {
      var parentH = item.parent ? disk.handles.get(item.parent) : disk.root;
      if (!parentH || typeof parentH.getDirectoryHandle !== 'function') return;
      var dh = await parentH.getDirectoryHandle(safeName(item.name), { create: true });
      disk.handles.set(item.id, dh);
    } catch (e) { toast('Не удалось создать папку: ' + (e && e.message ? e.message : e), 'error'); }
  }

  async function saveDiskNow() {
    if (!disk) return;
    var ids = Object.keys(dirty);
    dirty = {};
    var failed = false;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var n = vault.items[id];
      var h = disk.handles.get(id);
      if (!n || n.type !== 'note' || !h || typeof h.createWritable !== 'function') continue;
      try {
        var w = await h.createWritable();
        await w.write(n.content || '');
        await w.close();
      } catch (e) { failed = true; dirty[id] = true; }
    }
    if (failed) toast('Часть файлов не удалось записать на диск', 'error');
    else setSaved();
  }
  var saveDiskDebounced = debounce(function () { saveDiskNow(); }, 650);

  /* ---------- синхронизация с облачной папкой ---------- */

  /* ----- Мгновенный отклик папки (десктоп): следим за файлами ----- */

  function startDiskWatch() {
    try {
      if (window.__grafitDesktop && window.__grafitDesktop.watchStart && disk && disk.root && disk.root.__path) {
        var pr = window.__grafitDesktop.watchStart(disk.root.__path);
        if (pr && pr.catch) pr.catch(function () { /* нет обработчика — не критично */ });
      }
    } catch (e) { /* не критично */ }
  }

  function stopDiskWatch() {
    try {
      if (window.__grafitDesktop && window.__grafitDesktop.watchStop) {
        var pr2 = window.__grafitDesktop.watchStop();
        if (pr2 && pr2.catch) pr2.catch(function () { /* не критично */ });
      }
    } catch (e) { /* не критично */ }
  }

  var lastWatchSync = 0;
  function watchDiskSync() {
    if (vaultMode !== 'disk' || !disk) return;
    var now = Date.now();
    if (now - lastWatchSync < 900) return;
    lastWatchSync = now;
    lightDiskSync('watch');
  }

  window.addEventListener('grafit-disk-changed', function () { watchDiskSync(); });

  async function lightDiskSync(manual) {
    if (vaultMode !== 'disk' || !disk) {
      if (manual === true) {
        toast('Сначала подключите облако или папку на диске');
        openCloudWizard();
      }
      return;
    }
    var isAuto = (manual !== true && manual !== 'watch');
    var now = Date.now();
    if (isAuto && (now - lastDiskCheck < 30000)) return;
    if (isAuto && document.hidden) return;
    lastDiskCheck = now;

    var changed = 0;
    var added = 0;
    var notes = noteItems();
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (dirty[n.id]) continue;
      var h = disk.handles.get(n.id);
      if (!h || typeof h.getFile !== 'function') continue;
      try {
        var f = await h.getFile();
        if (Math.abs((f.lastModified || 0) - (n.updated || 0)) > 2000) {
          var text = await f.text();
          if (text !== n.content) {
            n.content = text;
            n.updated = f.lastModified || Date.now();
            changed++;
            if (n.id === currentId) {
              if (ED) ED.setValue(text);
              renderPreview();
              renderOutline();
              renderMeta();
              renderBacklinks();
              updateStatus();
            }
          }
        }
      } catch (e) { /* файл недоступен — пропускаем */ }
    }
    try { added = await scanDiskNew(disk.root, null, 0); } catch (e) { /* ничего */ }

    if (changed || added) {
      renderTree();
      renderTagsPanel();
      updateStatus();
      toast('☁️ Из папки подтянуто: изменено ' + changed + ', добавлено ' + added, 'ok');
    } else if (manual === true) {
      toast('Изменений нет — всё уже синхронизировано', 'ok');
    }
  }

  async function scanDiskNew(dirHandle, parentId, depth) {
    if (depth > 6 || !dirHandle || typeof dirHandle.values !== 'function') return 0;
    var entries = [];
    try {
      for await (var e of dirHandle.values()) entries.push(e);
    } catch (err) { return 0; }
    var added = 0;
    for (var i = 0; i < entries.length; i++) {
      var ent = entries[i];
      if (ent.name.charAt(0) === '.') continue;
      var kids = childrenOf(parentId);
      if (ent.kind === 'directory') {
        var folder = null;
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].type === 'folder' && kids[k].name.toLowerCase() === ent.name.toLowerCase()) { folder = kids[k]; break; }
        }
        if (!folder) {
          folder = { id: uid('f'), type: 'folder', name: ent.name, parent: parentId, created: Date.now(), updated: Date.now() };
          vault.items[folder.id] = folder;
          disk.handles.set(folder.id, ent);
          added++;
        }
        added += await scanDiskNew(ent, folder.id, depth + 1);
      } else if (ent.kind === 'file' && /\.(md|markdown|txt)$/i.test(ent.name)) {
        var base = ent.name.replace(/\.(md|markdown|txt)$/i, '');
        var known = false;
        for (var k2 = 0; k2 < kids.length; k2++) {
          if (kids[k2].type === 'note' && kids[k2].name.toLowerCase() === base.toLowerCase()) { known = true; break; }
        }
        if (known) continue;
        var content = '';
        var lm = Date.now();
        try {
          var f = await ent.getFile();
          content = await f.text();
          lm = f.lastModified || lm;
        } catch (err2) { /* пустой или занятый файл */ }
        var note = { id: uid('n'), type: 'note', name: base, parent: parentId, content: content, created: lm, updated: lm };
        vault.items[note.id] = note;
        disk.handles.set(note.id, ent);
        added++;
      }
    }
    return added;
  }

  async function refreshDiskVault(manual) {
    if (vaultMode !== 'disk' || !disk) {
      if (manual) {
        toast('Сначала подключите облако или папку на диске');
        openCloudWizard();
      }
      return;
    }
    if (!manual) return;
    var reloadOk = await gdConfirm({
      title: 'Перечитать папку?',
      lines: ['Содержимое папки будет считано из файлов заново.', 'Несохранённые правки сначала сохранятся.'],
      okLabel: 'Перечитать'
    });
    if (!reloadOk) return;
    await saveDiskNow();
    if (Object.keys(dirty).length) {
      toast('Часть правок не сохранилась — обновление отменено', 'error');
      return;
    }
    var curName = currentId && getItem(currentId) ? getItem(currentId).name : null;
    vault = { version: 1, items: {}, trash: [] };
    disk.handles = new Map();
    collapsed = {};
    await scanDiskDir(disk.root, null, 0);
    renderTree();
    renderTagsPanel();
    var target = curName ? findNoteByTitle(curName) : null;
    if (target) openNote(target.id);
    else {
      var fn = firstNoteId();
      if (fn) openNote(fn); else selectFallbackNote();
    }
    lastDiskCheck = Date.now();
    toast('Папка перечитана: ' + noteItems().length + ' заметок', 'ok');
  }

  async function offerMigration() {
    if (!disk || vaultMode !== 'disk') return;
    var local = null;
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) local = JSON.parse(raw);
    } catch (e) { /* нет локального хранилища */ }
    if (!local || !local.items || typeof local.items !== 'object') return;
    var items = Object.keys(local.items).map(function (k) { return local.items[k]; })
      .filter(function (i) { return i && (i.type === 'note' || i.type === 'folder'); });
    var localNotes = items.filter(function (i) { return i.type === 'note'; });
    if (!localNotes.length) return;
    var migrateOk = await gdConfirm({
      title: 'Перенести локальные заметки?',
      lines: ['В локальном хранилище есть заметки: ' + localNotes.length + '.', 'Перенести их в подключённую папку? Существующие файлы не перезапишутся.'],
      okLabel: 'Перенести'
    });
    if (!migrateOk) return;

    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });
    function depthOf(it) {
      var d = 0; var cur = it; var guard = 0;
      while (cur && cur.parent && byId[cur.parent] && guard < 30) { cur = byId[cur.parent]; d++; guard++; }
      return d;
    }
    var folders = items.filter(function (i) { return i.type === 'folder'; });
    folders.sort(function (a, b) { return depthOf(a) - depthOf(b); });

    var idMap = {};
    var copied = 0;
    for (var fi = 0; fi < folders.length; fi++) {
      var f = folders[fi];
      if (f.parent && !idMap[f.parent]) continue;
      var mappedParent = f.parent ? idMap[f.parent] : null;
      var parentH = mappedParent ? disk.handles.get(mappedParent) : disk.root;
      if (!parentH || typeof parentH.getDirectoryHandle !== 'function') continue;
      var siblings = childrenOf(mappedParent || null);
      var exists = null;
      for (var si = 0; si < siblings.length; si++) {
        if (siblings[si].type === 'folder' && siblings[si].name.toLowerCase() === f.name.toLowerCase()) { exists = siblings[si]; break; }
      }
      if (exists) { idMap[f.id] = exists.id; continue; }
      try {
        var dh = await parentH.getDirectoryHandle(safeName(f.name), { create: true });
        var nf = { id: uid('f'), type: 'folder', name: f.name, parent: mappedParent || null, created: Date.now(), updated: Date.now() };
        vault.items[nf.id] = nf;
        disk.handles.set(nf.id, dh);
        idMap[f.id] = nf.id;
      } catch (e) { /* пропускаем */ }
    }

    for (var ni = 0; ni < localNotes.length; ni++) {
      var n = localNotes[ni];
      if (n.parent && !idMap[n.parent]) continue;
      var newParent = n.parent ? idMap[n.parent] : null;
      var ph = newParent ? disk.handles.get(newParent) : disk.root;
      if (!ph || typeof ph.getFileHandle !== 'function') continue;
      var noteName = uniqueNoteName(n.name || 'Заметка', newParent);
      try {
        var fh = await ph.getFileHandle(safeName(noteName) + '.md', { create: true });
        var w = await fh.createWritable();
        await w.write(n.content || '');
        await w.close();
        var nn = { id: uid('n'), type: 'note', name: noteName, parent: newParent, content: n.content || '', created: n.created || Date.now(), updated: Date.now() };
        vault.items[nn.id] = nn;
        disk.handles.set(nn.id, fh);
        copied++;
      } catch (e) { /* пропускаем файл */ }
    }

    renderTree();
    renderTagsPanel();
    if (copied) toast('Перенесено заметок: ' + copied + ' — теперь они синхронизируются через облако', 'ok');
    else toast('Переносить было нечего или нет доступа к папке', 'error');
  }

  /* ---------- ИИ-помощник ---------- */

  var AI_PRESETS = {
    openrouter: { base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    ollama: { base: 'http://localhost:11434/v1', model: 'qwen2.5:1.5b' },
    custom: { base: '', model: '' }
  };

  var AI_TYPE_LABELS = { typo: 'Орфография', format: 'Форматирование', structure: 'Структура', definition: 'Определение', style: 'Формулировка', tip: 'Совет' };

  function defaultAiCfg() {
    return { enabled: false, auto: true, provider: 'openrouter', base: AI_PRESETS.openrouter.base, model: AI_PRESETS.openrouter.model, key: '' };
  }

  function loadAiCfg() {
    aiCfg = defaultAiCfg();
    try {
      var raw = localStorage.getItem('vault.ai');
      if (raw) {
        var data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          if (typeof data.enabled === 'boolean') aiCfg.enabled = data.enabled;
          if (typeof data.auto === 'boolean') aiCfg.auto = data.auto;
          if (data.provider) aiCfg.provider = String(data.provider);
          if (data.base) aiCfg.base = String(data.base);
          if (data.model) aiCfg.model = String(data.model);
          if (data.key) aiCfg.key = String(data.key);
        }
      }
    } catch (e) { /* нет сохранённых настроек */ }
    return aiCfg;
  }

  function saveAiCfg() {
    try { localStorage.setItem('vault.ai', JSON.stringify(aiCfg)); } catch (e) {}
  }

  function setAiStatus(kind, text) {
    var el = $('#ai-status-line');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ai-status-line' + (kind ? ' ' + kind : '');
  }

  function setAiFormStatus(kind, text) {
    var el = $('#ai-form-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ai-status-line' + (kind ? ' ' + kind : '');
  }

  function openAiSettings() {
    if (!aiCfg) loadAiCfg();
    $('#ai-enabled').checked = !!aiCfg.enabled;
    $('#ai-provider').value = aiCfg.provider || 'openrouter';
    $('#ai-base').value = aiCfg.base || '';
    $('#ai-model').value = aiCfg.model || '';
    $('#ai-key').value = aiCfg.key || '';
    setAiFormStatus('', '');
    $('#ai-modal').classList.add('open');
    aiOllamaToggle();
    if ($('#ai-provider').value === 'ollama') aiOllamaRefresh(true);
  }

  function readAiForm() {
    return {
      enabled: $('#ai-enabled').checked,
      auto: aiCfg ? !!aiCfg.auto : true,
      provider: $('#ai-provider').value || 'custom',
      base: $('#ai-base').value.trim(),
      model: $('#ai-model').value.trim(),
      key: $('#ai-key').value.trim()
    };
  }

  function aiIsLocal() {
    return !!(aiCfg && (aiCfg.provider === 'ollama' || /localhost|127\.0\.0\.1/i.test(aiCfg.base || '')));
  }

  function aiApplyPreset(id) {
    var p = AI_PRESETS[id];
    if (!p) return;
    if (p.base) $('#ai-base').value = p.base;
    if (p.model) $('#ai-model').value = p.model;
  }

  function aiItemTitle(s) {
    return s.title || AI_TYPE_LABELS[s.type] || 'Совет';
  }

  function renderAiPanel() {
    var block = $('#ai-block');
    if (!block) return;
    if (!aiCfg) loadAiCfg();
    block.classList.toggle('hidden', !aiCfg.enabled);
    var autoBtn = $('#ai-auto');
    if (autoBtn) {
      autoBtn.textContent = aiCfg.auto ? 'Авто: вкл' : 'Авто: выкл';
      autoBtn.classList.toggle('on', !!aiCfg.auto);
    }
    var list = $('#ai-suggestions');
    if (!list) return;
    list.innerHTML = '';
    if (!aiCfg.enabled) return;

    var note = currentId && getItem(currentId);
    var items = (note && aiSuggestions[note.id]) || [];
    var cnt = $('#ai-count');
    if (cnt) {
      cnt.textContent = String(items.length);
      cnt.classList.toggle('hidden', !items.length);
    }

    if (aiBusy) {
      list.innerHTML = '<div class="empty">Анализирую текст…</div>';
      return;
    }
    if (!note) {
      list.innerHTML = '<div class="empty">Откройте заметку — помогу с текстом.</div>';
      return;
    }
    if (!items.length) {
      var rawText = note ? aiLastRaw[note.id] : '';
      if (note && aiHadError[note.id] && rawText) {
        var det = document.createElement('div');
        var dlink = document.createElement('button');
        dlink.className = 'link-btn';
        dlink.textContent = 'Показать ответ модели';
        var dpre = document.createElement('pre');
        dpre.className = 'ai-raw hidden';
        dpre.textContent = truncate(rawText, 1500);
        dlink.addEventListener('click', function () { dpre.classList.toggle('hidden'); });
        det.appendChild(dlink);
        det.appendChild(dpre);
        list.appendChild(det);
      } else {
        list.innerHTML = '<div class="empty">Пока всё чисто. Пишите — подсказки появятся сами.</div>';
      }
      return;
    }

    items.forEach(function (s, i) {
      var card = document.createElement('div');
      card.className = 'ai-item';

      var head = document.createElement('div');
      head.className = 'ai-item-head';
      var badge = document.createElement('span');
      var typeKey = AI_TYPE_LABELS[s.type] ? s.type : 'tip';
      badge.className = 'ai-badge ' + typeKey;
      badge.textContent = AI_TYPE_LABELS[typeKey] || 'Совет';
      var title = document.createElement('span');
      title.className = 'ai-title';
      title.textContent = aiItemTitle(s);
      head.appendChild(badge);
      head.appendChild(title);
      card.appendChild(head);

      if (s.explanation) {
        var exp = document.createElement('div');
        exp.className = 'ai-exp';
        exp.textContent = s.explanation;
        card.appendChild(exp);
      }

      if (s.find) {
        var prev = document.createElement('div');
        prev.className = 'ai-preview';
        var del = document.createElement('del');
        del.textContent = truncate(s.find, 90);
        var arrow = document.createElement('span');
        arrow.textContent = ' → ';
        var ins = document.createElement('ins');
        ins.textContent = truncate(s.replace || '…', 120);
        prev.appendChild(del);
        prev.appendChild(arrow);
        prev.appendChild(ins);
        card.appendChild(prev);
      }

      var actions = document.createElement('div');
      actions.className = 'ai-actions';
      if (s.find) {
        var applyBtn = document.createElement('button');
        applyBtn.className = 'ai-btn';
        applyBtn.textContent = 'Применить';
        applyBtn.addEventListener('click', function () { aiApply(note.id, i); });
        actions.appendChild(applyBtn);
      }
      var skipBtn = document.createElement('button');
      skipBtn.className = 'ai-btn';
      skipBtn.textContent = 'Скрыть';
      skipBtn.addEventListener('click', function () { aiDismiss(note.id, i); });
      actions.appendChild(skipBtn);
      card.appendChild(actions);

      list.appendChild(card);
    });
  }

  function scheduleAiCheck() {
    if (!aiCfg || !aiCfg.enabled || !aiCfg.auto) return;
    if (!aiCfg.key && !aiIsLocal()) return;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(function () { aiAnalyze(false); }, 3500);
  }

  function buildAiPrompt() {
    return [
      'Ты — аккуратный ассистент-редактор заметок в приложении «Графит» (Markdown, русский язык).',
      'Проанализируй текст ниже и предложи точечные улучшения.',
      '',
      'Отвечай только валидным JSON: первый символ { , последний } . Без пояснений и без markdown-обёрток:',
      '{"suggestions":[{"type":"typo|format|structure|definition|style|tip","title":"короткий заголовок","explanation":"1 предложение — зачем","find":"точный фрагмент исходного текста","replace":"чем заменить"}]}',
      'Пример: {"suggestions":[{"type":"typo","title":"Дефис вместо тире","explanation":"В определении ставится длинное тире","find":"Определение - совокупность","replace":"Определение — совокупность"},{"type":"definition","title":"Дополнить определение","explanation":"Можно дать точную формулировку","find":"Определение —","replace":"Определение — совокупность взаимосвязанных элементов"}]}',
      '',
      'Правила:',
      '- find — ТОЧНАЯ короткая подстрока исходного текста (скопируй как есть); replace — готовая замена.',
      '- typo — орфография, опечатки, пунктуация; только реальные ошибки.',
      '- format — оформление Markdown: пробелы после #, - или цифр, списки, выделение, лишние пустые строки.',
      '- structure — структура: добавить заголовок, разбить текст, превратить перечисление в список — конкретной правкой.',
      '- definition — если видишь незаконченное определение («Слово — », «Слово:» или «Слово —» в конце строки), предложи короткое точное определение: find — этот фрагмент, replace — «Слово — определение».',
      '- tip — совет без правки (find и replace — пустые строки).',
      '- style — неудачная формулировка: предложи более гладкий вариант той же мысли (find — фраза, replace — переформулировка).',
      '- Максимум 4 предложения, самое важное — первым. Не переписывай весь текст и не меняй смысл. explanation — не длиннее 15 слов. Если всё хорошо — {"suggestions":[]}.'
    ].join('\n');
  }

  async function aiCall(cfg, userText, strict) {
    var base = String(cfg.base || '').replace(/\/+$/, '');
    if (!base) throw new Error('не указан адрес API');
    var url = base + '/chat/completions';
    var model = cfg.model || 'gpt-4o-mini';
    var userContent = userText;
    if (/qwen3/i.test(model)) userContent += '\n/no_think';
    if (strict) userContent += '\n\nВАЖНО: предыдущий ответ не был распознан. Ответь ТОЛЬКО валидным JSON, начиная с { и заканчивая } , без пояснений.';
    var payload = {
      model: model,
      messages: [
        { role: 'system', content: buildAiPrompt() },
        { role: 'user', content: userContent }
      ],
      temperature: 0.2,
      max_tokens: 1200
    };
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
    var res = null;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('нет связи с сервисом (проверьте адрес и CORS; на превью AutoClaw внешние запросы блокируются)');
    }
    if (!res.ok) {
      var errText = '';
      try { errText = (await res.text()).slice(0, 160); } catch (e2) {}
      throw new Error('сервис ответил ' + res.status + (errText ? ' — ' + errText : ''));
    }
    var data = null;
    try { data = await res.json(); } catch (e3) { throw new Error('ответ сервиса не является JSON'); }
    var content = '';
    try { content = data.choices[0].message.content || ''; } catch (e4) {}
    if (!content) throw new Error('пустой ответ сервиса');
    aiLastRawContent = content;
    return parseAiSuggestions(content, userText);
  }

  function tryParseJsonLoose(text) {
    if (!text) return null;
    var attempts = [text, text.replace(/,\s*([\]}])/g, '$1')];
    for (var i = 0; i < attempts.length; i++) {
      try { return JSON.parse(attempts[i]); } catch (e) {}
    }
    return null;
  }

  function extractJsonObjects(text) {
    var out = [];
    var depth = 0;
    var start = -1;
    var inStr = false;
    var esc = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}') {
        if (depth > 0) depth--;
        if (depth === 0 && start !== -1) { out.push(text.slice(start, i + 1)); start = -1; }
      }
    }
    return out;
  }

  function parseAiSuggestions(content, sourceText) {
    var s = String(content || '').trim();
    var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1].trim();

    var candidates = [s];
    var i = s.indexOf('{');
    var j = s.lastIndexOf('}');
    if (i !== -1 && j > i) candidates.push(s.slice(i, j + 1));

    var objs = extractJsonObjects(s);
    var list = null;
    for (var c = 0; c < candidates.length && !list; c++) {
      var data = tryParseJsonLoose(candidates[c]);
      if (data && Array.isArray(data.suggestions)) list = data.suggestions;
      else if (data && typeof data === 'object' && (data.find !== undefined || data.replace !== undefined)) list = [data];
    }
    if (!list && objs.length) {
      var merged = [];
      objs.forEach(function (o) {
        var d = tryParseJsonLoose(o);
        if (d && Array.isArray(d.suggestions)) merged = merged.concat(d.suggestions);
        else if (d && typeof d === 'object' && (d.find !== undefined || d.replace !== undefined || d.title)) merged.push(d);
      });
      if (merged.length) list = merged;
    }
    if (!list) {
      var err = new Error('не удалось разобрать ответ ИИ');
      err.aiParse = true;
      throw err;
    }

    var out = [];
    list.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var type = String(it.type || (it.find ? 'format' : 'tip'));
      var find = String(it.find || '');
      var replace = String(it.replace || '');
      if (type !== 'tip' && find && sourceText.indexOf(find) === -1) return;
      out.push({ type: type, title: String(it.title || ''), explanation: String(it.explanation || ''), find: find, replace: replace });
    });
    return out.slice(0, 8);
  }

  async function aiAnalyze(manual) {
    if (!aiCfg) loadAiCfg();
    if (!aiCfg.enabled) { if (manual) openAiSettings(); return; }
    if (!aiCfg.key && !aiIsLocal()) { if (manual) openAiSettings(); return; }
    var note = currentId && getItem(currentId);
    if (!note) { if (manual) toast('Сначала откройте заметку'); return; }
    var text = (note.content || '').trim();
    if (text.length < 20) { if (manual) toast('Слишком короткий текст для проверки'); return; }
    if (aiBusy) { if (manual) toast('ИИ уже анализирует…'); return; }
    if (!manual && (Date.now() - aiLastRun < 20000)) return;
    if (!manual && aiLastHash[note.id] === text) return;
    aiLastRun = Date.now();
    aiBusy = true;
    setAiStatus('', 'Анализирую…');
    renderAiPanel();
    var result = null;
    var lastErr = null;
    var attemptsLeft = 2;
    while (attemptsLeft > 0 && !result) {
      attemptsLeft--;
      try {
        result = await aiCall({ base: aiCfg.base, model: aiCfg.model, key: aiCfg.key }, text.slice(0, 8000), attemptsLeft === 0);
      } catch (e) {
        lastErr = e;
        if (!e || !e.aiParse) break;
        setAiStatus('', 'Ответ не распознан — пробую ещё раз…');
        renderAiPanel();
      }
    }
    if (result) {
      aiLastHash[note.id] = text;
      aiSuggestions[note.id] = result;
      aiLastRaw[note.id] = aiLastRawContent;
      aiHadError[note.id] = false;
      setAiStatus('ok', result.length ? ('Найдено подсказок: ' + result.length) : 'Замечаний нет — отлично!');
    } else {
      aiLastRaw[note.id] = aiLastRawContent;
      aiHadError[note.id] = true;
      var msg = (lastErr && lastErr.message) ? lastErr.message : 'неизвестная ошибка';
      setAiStatus('error', msg);
      if (manual) toast('ИИ: ' + msg, 'error');
    }
    aiBusy = false;
    renderAiPanel();
    renderEditorOverlay();
    updateAiPopup();
  }

  function aiApply(noteId, idx) {
    var note = getItem(noteId);
    var list = aiSuggestions[noteId] || [];
    var s = list[idx];
    if (!note || !s) return;
    if (!s.find) { toast('Это совет — правки не требуются'); return; }
    if ((note.content || '').indexOf(s.find) === -1) {
      list.splice(idx, 1);
      renderAiPanel();
      toast('Фрагмент уже изменился — подсказка снята', 'error');
      return;
    }
    note.content = note.content.replace(s.find, s.replace);
    note.updated = Date.now();
    markDirty(note.id);
    persist();
    if (note.id === currentId) {
      if (ED) ED.setValue(note.content);
      renderPreview();
      renderOutline();
      renderMeta();
      renderBacklinks();
      updateStatus();
    }
    list.splice(idx, 1);
    setAiStatus('ok', 'Применено: ' + aiItemTitle(s));
    renderAiPanel();
    renderEditorOverlay();
    hideAiPopup();
  }

  function aiDismiss(noteId, idx) {
    var list = aiSuggestions[noteId] || [];
    list.splice(idx, 1);
    renderAiPanel();
    renderEditorOverlay();
    hideAiPopup();
  }

  /* ----- призрачные подсказки (Tab — принять) ----- */

  function acceptGhost() {
    if (!ghostMode) return;
    var g = ghostMode;
    ghostMode = null;
    if (g.kind === 'fix' && g.idx != null) { aiApply(g.noteId, g.idx); return; }
    if (g.kind === 'continue' && g.text && ED) {
      var t = g.text;
      var sel = ED.getSel();
      var before = ED.getValue().slice(0, sel.from);
      if (before && !/\s$/.test(before) && !/^\s/.test(t)) t = ' ' + t;
      ED.insertAt(t, sel.from, sel.to);
      toast('Продолжение добавлено', 'ok');
    }
  }

  async function aiChatRaw(messages, maxTokens) {
    var base = String((aiCfg && aiCfg.base) || '').replace(/\/+$/, '');
    if (!base) throw new Error('не указан адрес API');
    var model = (aiCfg && aiCfg.model) || 'gpt-4o-mini';
    var msgs = messages.slice();
    if (/qwen3/i.test(model) && msgs.length) {
      var li = msgs.length - 1;
      msgs[li] = { role: msgs[li].role, content: msgs[li].content + '\n/no_think' };
    }
    var headers = { 'Content-Type': 'application/json' };
    if (aiCfg && aiCfg.key) headers['Authorization'] = 'Bearer ' + aiCfg.key;
    var res = null;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ model: model, messages: msgs, temperature: 0.6, max_tokens: maxTokens || 220 })
      });
    } catch (e) { throw new Error('нет связи с сервисом (проверьте адрес и CORS)'); }
    if (!res.ok) throw new Error('сервис ответил ' + res.status);
    var data = null;
    try { data = await res.json(); } catch (e2) { throw new Error('ответ сервиса не является JSON'); }
    var content = '';
    try { content = data.choices[0].message.content || ''; } catch (e3) {}
    content = String(content).replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/\/no_think/g, '').trim();
    if (!content) throw new Error('пустой ответ сервиса');
    return content;
  }

  async function aiContinue(manual) {
    if (!aiCfg) loadAiCfg();
    if (!aiCfg.enabled) { if (manual) openAiSettings(); return; }
    if (!aiCfg.key && !aiIsLocal()) { if (manual) openAiSettings(); return; }
    var note = currentId && getItem(currentId);
    if (!note || !ED) { if (manual) toast('Сначала откройте заметку'); return; }
    if (viewMode === 'read') { if (manual) toast('Продолжение доступно в режиме редактирования (Ctrl+E)'); return; }
    if (aiContinueBusy || aiBusy) { if (manual) toast('ИИ уже думает…'); return; }
    var text = ED.getValue();
    if (!text.trim()) { if (manual) toast('Пустая заметка — продолжать нечего'); return; }
    var sel = ED.getSel();
    var tail = text.slice(0, sel.from).slice(-1400);
    aiContinueBusy = true;
    setAiStatus('', 'Придумываю продолжение…');
    try {
      var reply = await aiChatRaw([
        { role: 'system', content: 'Ты помогаешь дописывать заметки. Продолжи текст сразу после курсора: 1–2 коротких предложения в том же стиле. Верни только само продолжение, без кавычек, пояснений и markdown-обёрток. Пиши на языке текста.' },
        { role: 'user', content: 'Заметка «' + note.name + '» (фрагмент до курсора):\n\n' + tail + '\n\n[КУРСОР ЗДЕСЬ] Продолжи с этой точки:' }
      ], 220);
      var lines = reply.split('\n').filter(function (l) { return l.trim(); }).slice(0, 3).join('\n');
      if (!lines) { setAiStatus('', 'Пустой ответ'); return; }
      ghostMode = { kind: 'continue', text: lines };
      ED.showGhost(lines);
      setAiStatus('', 'Серое продолжение в тексте — Tab, чтобы принять');
    } catch (e) {
      setAiStatus('error', (e && e.message) || 'не получилось');
      if (manual) toast('ИИ: ' + ((e && e.message) || 'ошибка'), 'error');
    } finally {
      aiContinueBusy = false;
    }
  }

  /* ----- подсветка подсказок прямо в тексте ----- */

  function renderEditorOverlay() {
    if (!ED) return;
    var text = ED.getValue() || '';
    var note = currentId && getItem(currentId);
    var items = (aiCfg && aiCfg.enabled && note && aiSuggestions[note.id]) || [];
    aiDecoRanges = [];
    var ranges = [];
    items.forEach(function (s, k) {
      if (!s.find) return;
      var idx = text.indexOf(s.find);
      if (idx === -1) return;
      ranges.push({ start: idx, end: idx + s.find.length, k: k });
    });
    ranges.sort(function (a, b) { return a.start - b.start; });
    var marks = [];
    var pos = 0;
    ranges.forEach(function (r) {
      if (r.start < pos) return;
      var sType = AI_TYPE_LABELS[items[r.k].type] ? items[r.k].type : 'tip';
      marks.push({ from: r.start, to: r.end, cls: sType });
      aiDecoRanges.push(r);
      pos = r.end;
    });
    ED.setMarks(marks);
  }

  function hideAiPopup() {
    var pop = $('#ai-popup');
    if (pop) pop.classList.add('hidden');
    aiPopupIdx = null;
  }

  function findDecoAt(pos) {
    for (var i = 0; i < aiDecoRanges.length; i++) {
      var r = aiDecoRanges[i];
      if (pos >= r.start && pos <= r.end) return r;
    }
    for (var j = 0; j < aiDecoRanges.length; j++) {
      var r2 = aiDecoRanges[j];
      if (Math.abs(pos - r2.start) <= 1 || Math.abs(pos - r2.end) <= 1) return r2;
    }
    return null;
  }

  function showAiPopupForRange(r) {
    var pop = $('#ai-popup');
    var wrap = $('#editor-wrap');
    var note = currentId && getItem(currentId);
    if (!pop || !wrap || !note) return;
    var s = (aiSuggestions[note.id] || [])[r.k];
    if (!s) { hideAiPopup(); return; }
    aiPopupIdx = r.k;
    pop.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'ai-popup-head';
    var badge = document.createElement('span');
    var typeKey = AI_TYPE_LABELS[s.type] ? s.type : 'tip';
    badge.className = 'ai-badge ' + typeKey;
    badge.textContent = AI_TYPE_LABELS[typeKey] || 'Совет';
    var title = document.createElement('span');
    title.className = 'ai-popup-title';
    title.textContent = aiItemTitle(s);
    head.appendChild(badge);
    head.appendChild(title);
    pop.appendChild(head);
    if (s.explanation) {
      var exp = document.createElement('div');
      exp.className = 'ai-exp';
      exp.textContent = s.explanation;
      pop.appendChild(exp);
    }
    if (s.find) {
      var sug = document.createElement('div');
      sug.className = 'ai-popup-sug';
      var lab = document.createElement('span');
      lab.className = 'ai-popup-label';
      lab.textContent = 'Предлагается: ';
      var ghost = document.createElement('span');
      ghost.className = 'ai-ghost';
      ghost.textContent = truncate(s.replace, 160);
      sug.appendChild(lab);
      sug.appendChild(ghost);
      pop.appendChild(sug);
      var acts = document.createElement('div');
      acts.className = 'ai-popup-actions';
      var okBtn = document.createElement('button');
      okBtn.className = 'ai-btn on';
      okBtn.textContent = 'Применить';
      okBtn.addEventListener('click', function () { aiApply(note.id, r.k); hideAiPopup(); });
      var noBtn = document.createElement('button');
      noBtn.className = 'ai-btn';
      noBtn.textContent = 'Скрыть';
      noBtn.addEventListener('click', function () { aiDismiss(note.id, r.k); hideAiPopup(); });
      acts.appendChild(okBtn);
      acts.appendChild(noBtn);
      pop.appendChild(acts);
    }
    pop.classList.remove('hidden');
    var wrect = wrap.getBoundingClientRect();
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = 12;
    var top = 12;
    var c1 = ED && ED.coordsAtPos(r.start);
    var c2 = ED && ED.coordsAtPos(r.end);
    if (c1 && c2) {
      left = Math.max(8, Math.min(c1.left - wrect.left, wrect.width - pw - 8));
      top = c2.bottom - wrect.top + 6;
      if (top + ph > wrect.height - 8 && (c1.top - wrect.top - ph - 6) > 0) {
        top = c1.top - wrect.top - ph - 6;
      }
    }
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  function updateAiPopup() {
    var pop = $('#ai-popup');
    if (!pop || !ED) return;
    if (!aiCfg || !aiCfg.enabled || viewMode === 'read') { hideAiPopup(); return; }
    var sel = ED.getSel();
    var r = findDecoAt(sel.from);
    if (!r) { hideAiPopup(); return; }
    var note = currentId && getItem(currentId);
    var s = note && (aiSuggestions[note.id] || [])[r.k];
    if (s && s.find && s.replace) {
      ghostMode = { kind: 'fix', noteId: note.id, idx: r.k };
      ED.showGhost('  → ' + truncate(s.replace, 100));
    }
    showAiPopupForRange(r);
  }

  async function aiTestConnection() {
    var cfgForm = readAiForm();
    if (!cfgForm.base) { setAiFormStatus('error', 'Укажите адрес API'); return; }
    setAiFormStatus('', 'Проверяю соединение…');
    try {
      var base = cfgForm.base.replace(/\/+$/, '');
      var headers = { 'Content-Type': 'application/json' };
      if (cfgForm.key) headers['Authorization'] = 'Bearer ' + cfgForm.key;
      var res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: cfgForm.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Ответь одним словом: ок' }],
          max_tokens: 10
        })
      });
      if (!res.ok) {
        var t = '';
        try { t = (await res.text()).slice(0, 120); } catch (e) {}
        setAiFormStatus('error', 'Сервис ответил ' + res.status + (t ? ' — ' + t : ''));
        return;
      }
      var data = await res.json();
      var reply = '';
      try { reply = data.choices[0].message.content || ''; } catch (e) {}
      setAiFormStatus('ok', 'Соединение работает ' + (reply ? '(' + reply.slice(0, 40) + ')' : ''));
    } catch (e) {
      if (/localhost|127\.0\.0\.1/i.test(cfgForm.base)) {
        setAiFormStatus('error', 'Нет связи с Ollama. Проверьте, что она запущена, и разрешите браузеру доступ: OLLAMA_ORIGINS=* (подсказка ниже), затем перезапустите Ollama.');
      } else {
        setAiFormStatus('error', 'Нет связи: возможен CORS или блокировка сети. Попробуйте OpenRouter, Ollama или версию на GitHub Pages.');
      }
    }
  }

  function aiOllamaRoot() {
    var base = String((($('#ai-base') && $('#ai-base').value) || (aiCfg && aiCfg.base) || '')).replace(/\/+$/, '');
    return base.replace(/\/v1$/i, '');
  }

  function aiOllamaToggle() {
    var section = $('#ai-local-section');
    if (!section) return;
    var provider = ($('#ai-provider') && $('#ai-provider').value) || '';
    var base = ($('#ai-base') && $('#ai-base').value) || '';
    var show = provider === 'ollama' || /localhost|127\.0\.0\.1/i.test(base);
    section.classList.toggle('hidden', !show);
  }

  function setAiOllamaStatus(kind, text) {
    var el = $('#ai-ollama-progress');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ai-status-line' + (kind ? ' ' + kind : '');
  }

  function aiOllamaSetProgress(pct, text) {
    var bar = $('#ai-pull-bar');
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    var wrap = $('#ai-pull-wrap');
    if (wrap) wrap.classList.toggle('hidden', !(pct > 0 && pct < 100));
    if (text) setAiOllamaStatus('', text);
  }

  async function aiOllamaRefresh(silent) {
    var root = aiOllamaRoot();
    var sel = $('#ai-ollama-models');
    if (!sel || !root) return;
    if (!silent) setAiOllamaStatus('', 'Смотрю список моделей…');
    try {
      var res = await fetch(root + '/api/tags');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var models = (data.models || []).map(function (m) { return m.name; }).sort();
      sel.innerHTML = '';
      if (!models.length) {
        var opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = '— пока ничего не скачано —';
        sel.appendChild(opt0);
      }
      models.forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      var cur = $('#ai-model').value.trim();
      if (cur && models.indexOf(cur) !== -1) sel.value = cur;
      setAiOllamaStatus('ok', 'Моделей в Ollama: ' + models.length);
    } catch (e) {
      setAiOllamaStatus('error', 'Ollama недоступна — проверьте, что она запущена и задан OLLAMA_ORIGINS (см. подсказку ниже).');
    }
  }

  async function aiOllamaPull() {
    var root = aiOllamaRoot();
    if (!root) { setAiOllamaStatus('error', 'Укажите адрес API: http://localhost:11434/v1'); return; }
    var custom = (($('#ai-ollama-custom') && $('#ai-ollama-custom').value) || '').trim();
    var tag = custom || (($('#ai-ollama-catalog') && $('#ai-ollama-catalog').value) || 'qwen2.5:1.5b');
    setAiOllamaStatus('', 'Скачиваю ' + tag + '… это может занять несколько минут');
    aiOllamaSetProgress(3, '');
    try {
      var res = await fetch(root + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tag, stream: true })
      });
      if (!res.ok) {
        var t = '';
        try { t = (await res.text()).slice(0, 160); } catch (e2) {}
        throw new Error('HTTP ' + res.status + (t ? ' ' + t : ''));
      }
      if (res.body && res.body.getReader) {
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            if (!line) continue;
            var obj = null;
            try { obj = JSON.parse(line); } catch (e3) {}
            if (!obj) continue;
            if (obj.error) throw new Error(obj.error);
            if (obj.total && obj.completed) {
              var pct = Math.round((obj.completed / obj.total) * 100);
              aiOllamaSetProgress(pct, 'Скачивание: ' + pct + '%');
            } else if (obj.status) {
              aiOllamaSetProgress(10, obj.status);
            }
          }
        }
      } else {
        await res.json().catch(function () {});
      }
      aiOllamaSetProgress(0, '');
      $('#ai-model').value = tag;
      await aiOllamaRefresh(true);
      setAiOllamaStatus('ok', 'Модель ' + tag + ' готова — не забудьте сохранить настройки');
    } catch (e) {
      aiOllamaSetProgress(0, '');
      setAiOllamaStatus('error', 'Не удалось скачать: ' + (e && e.message ? e.message : e) + '. Проверьте, что Ollama запущена и задан OLLAMA_ORIGINS.');
    }
  }

  /* ---------- операции над элементами ---------- */

  function allItems() { return Object.keys(vault.items).map(function (k) { return vault.items[k]; }); }
  function noteItems() { return allItems().filter(function (i) { return i.type === 'note'; }); }
  function getItem(id) { return vault.items[id]; }

  function childrenOf(parentId) {
    var p = parentId || null;
    return allItems().filter(function (i) { return (i.parent || null) === p; })
      .sort(function (a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'ru');
      });
  }

  function notePath(id) {
    var parts = [];
    var it = getItem(id);
    while (it) {
      parts.unshift(it.name);
      it = it.parent ? getItem(it.parent) : null;
    }
    return parts.join(' / ');
  }

  function findNoteByTitle(title) {
    var t = String(title || '').trim().toLowerCase();
    if (!t) return null;
    var notes = noteItems();
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].name.trim().toLowerCase() === t) return notes[i];
    }
    return null;
  }

  function uniqueNoteName(base, parent) {
    var name = base;
    var k = 2;
    var exists = function (nm) {
      return allItems().some(function (i) {
        return (i.parent || null) === (parent || null) && i.name.toLowerCase() === nm.toLowerCase();
      });
    };
    while (exists(name)) { name = base + ' ' + k; k++; }
    return name;
  }

  function descendantsOf(id) {
    var out = [];
    (function walk(pid) {
      childrenOf(pid).forEach(function (c) { out.push(c); walk(c.id); });
    })(id);
    return out;
  }

  function firstNoteId() {
    var notes = noteItems();
    for (var i = 0; i < notes.length; i++) {
      if (notes[i].name === 'Добро пожаловать') return notes[i].id;
    }
    return notes.length ? notes[0].id : null;
  }

  function createNote(opts) {
    opts = opts || {};
    var base = (opts.name || '').trim() || 'Новая заметка';
    var name = uniqueNoteName(base, opts.parent || null);
    var it = {
      id: uid('n'), type: 'note', name: name, parent: opts.parent || null,
      content: opts.content || '', created: Date.now(), updated: Date.now()
    };
    vault.items[it.id] = it;
    if (vaultMode === 'disk') diskCreateNoteFile(it);
    persist();
    renderTree();
    renderTagsPanel();
    if (opts.open !== false) {
      openNote(it.id);
      if (!opts.name) { $('#note-title').focus(); $('#note-title').select(); }
    }
    if (!opts.silent) toast('Создана заметка «' + name + '»', 'ok');
    return it;
  }

  function createFolder(parent) {
    var name = uniqueNoteName('Новая папка', parent);
    var it = { id: uid('f'), type: 'folder', name: name, parent: parent || null, created: Date.now(), updated: Date.now() };
    vault.items[it.id] = it;
    if (vaultMode === 'disk') diskCreateFolder(it);
    persist();
    renderTree();
    toast('Создана папка «' + name + '»', 'ok');
    var row = $('#file-tree').querySelector('.tree-row[data-id="' + it.id + '"]');
    if (row) startRename(row, it.id);
    return it;
  }

  function updateWikilinks(oldName, newName) {
    var re = new RegExp('\\[\\[' + escapeReg(oldName.trim()) + '(?=\\||\\]\\])', 'gi');
    var changedCurrent = false;
    noteItems().forEach(function (n) {
      if (!n.content || n.content.indexOf('[[') === -1) return;
      var next = n.content.replace(re, '[[' + newName);
      if (next !== n.content) {
        n.content = next;
        n.updated = Date.now();
        markDirty(n.id);
        if (n.id === currentId) changedCurrent = true;
      }
    });
    if (changedCurrent) {
      var cur = getItem(currentId);
      if (cur) { if (ED) ED.setValue(cur.content); renderPreview(); }
    }
    persist();
  }

  function renameItem(id, newName) {
    var it = getItem(id);
    if (!it) return;
    newName = String(newName || '').trim();
    if (!newName || newName === it.name) return;
    var old = it.name;
    it.name = newName;
    it.updated = Date.now();
    if (it.type === 'note') {
      updateWikilinks(old, newName);
      markDirty(it.id);
      if (vaultMode === 'disk') toast('Переименовано. Имя файла на диске не изменилось — при необходимости переименуйте его в проводнике.', 'ok');
      else toast('Переименовано в «' + newName + '»', 'ok');
    } else {
      toast('Папка переименована', 'ok');
    }
    if (currentId === id) {
      $('#note-title').value = newName;
      $('#note-path').textContent = notePath(id);
      renderBacklinks();
      renderMeta();
    }
    persist();
    renderTree();
    renderTagsPanel();
  }

  async function deleteItem(id) {
    var it = getItem(id);
    if (!it) return;
    var kids = descendantsOf(id);
    var dlgTitle = it.type === 'folder'
      ? ('Удалить папку «' + it.name + '»' + (kids.length ? ' вместе с содержимым (' + kids.length + ')?' : '?'))
      : ('Удалить заметку «' + it.name + '»?');
    var okDel = await gdConfirm({
      title: dlgTitle,
      lines: [vaultMode === 'disk'
        ? 'Файлы будут удалены с диска без возможности восстановления.'
        : 'Объекты попадут в корзину — их можно будет восстановить.'],
      okLabel: 'Удалить',
      danger: true
    });
    if (!okDel) return;
    it = getItem(id);
    if (!it) return;
    kids = descendantsOf(id);

    var items = [it].concat(kids);
    if (vaultMode === 'disk') {
      items.forEach(function (x) {
        var h = disk.handles.get(x.id);
        if (h && typeof h.remove === 'function') { h.remove().catch(function () {}); }
        if (disk.handles.delete) disk.handles.delete(x.id);
        delete vault.items[x.id];
        delete dirty[x.id];
      });
      toast('Удалено с диска');
    } else {
      items.forEach(function (x) {
        vault.trash.push({ item: x, deletedAt: Date.now() });
        delete vault.items[x.id];
        delete dirty[x.id];
      });
      toast('Перемещено в корзину');
    }
    persist();
    if (items.some(function (x) { return x.id === currentId; })) {
      currentId = null;
      selectFallbackNote();
    }
    renderTree();
    renderTagsPanel();
    updateStatus();
  }

  function restoreTrash(index) {
    var entry = vault.trash[index];
    if (!entry) return;
    var it = entry.item;
    if (it.parent && !getItem(it.parent)) it.parent = null;
    vault.items[it.id] = it;
    vault.trash.splice(index, 1);
    persist();
    renderTree();
    renderTagsPanel();
    toast('Восстановлено: «' + it.name + '»', 'ok');
  }

  /* ---------- дерево ---------- */

  function renderTree() {
    var root = $('#file-tree');
    if (!root) return;
    root.innerHTML = '';
    var level = buildTreeLevel(null);
    if (!level.children.length) {
      root.innerHTML = '<div class="tree-empty">Пока пусто — создайте заметку</div>';
    } else {
      root.appendChild(level);
    }
    renderTrash();
    updateActiveRow();
  }

  function buildTreeLevel(parentId) {
    var ul = document.createElement('ul');
    ul.className = 'tree';
    childrenOf(parentId).forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'tree-item';
      li.dataset.id = it.id;
      var row = document.createElement('div');
      row.className = 'tree-row' + (it.id === currentId ? ' active' : '');
      row.dataset.id = it.id;

      var twisty = document.createElement('span');
      twisty.className = 'twisty';
      if (it.type === 'folder') twisty.innerHTML = collapsed[it.id] ? ICONS.chevR : ICONS.chevD;
      row.appendChild(twisty);

      var ic = document.createElement('span');
      ic.className = 'item-icon';
      ic.innerHTML = it.type === 'folder' ? ICONS.folder : ICONS.file;
      row.appendChild(ic);

      var label = document.createElement('span');
      label.className = 'item-label';
      label.textContent = it.name;
      row.appendChild(label);

      var actions = document.createElement('span');
      actions.className = 'row-actions';
      function mini(act, title, iconHtml) {
        var b = document.createElement('button');
        b.className = 'mini-btn';
        b.dataset.act = act;
        b.title = title;
        b.innerHTML = iconHtml;
        actions.appendChild(b);
      }
      if (it.type === 'folder') mini('new', 'Новая заметка в папке', ICONS.plus);
      mini('rename', 'Переименовать', ICONS.pencil);
      mini('delete', 'Удалить', ICONS.trash);
      row.appendChild(actions);

      li.appendChild(row);
      if (it.type === 'folder' && !collapsed[it.id]) li.appendChild(buildTreeLevel(it.id));
      ul.appendChild(li);
    });
    return ul;
  }

  function updateActiveRow() {
    $$('#file-tree .tree-row').forEach(function (r) {
      r.classList.toggle('active', r.dataset.id === currentId);
    });
  }

  function renderTrash() {
    var zone = $('#trash-zone');
    var list = $('#trash-list');
    var cnt = $('#trash-count');
    if (!zone) return;
    zone.classList.toggle('hidden', !vault.trash.length);
    cnt.textContent = String(vault.trash.length);
    list.innerHTML = '';
    vault.trash.forEach(function (entry, i) {
      var row = document.createElement('div');
      row.className = 'trash-item';
      var nm = document.createElement('span');
      nm.textContent = entry.item.name;
      var rs = document.createElement('span');
      rs.className = 'restore';
      rs.textContent = 'восстановить';
      row.appendChild(nm);
      row.appendChild(rs);
      row.title = 'Нажмите, чтобы восстановить';
      row.addEventListener('click', function () { restoreTrash(i); });
      list.appendChild(row);
    });
  }

  function startRename(rowEl, id) {
    var it = getItem(id);
    if (!it) return;
    var label = $('.item-label', rowEl);
    if (!label) return;
    var inp = document.createElement('input');
    inp.className = 'rename-input';
    inp.value = it.name;
    inp.setAttribute('aria-label', 'Новое имя');
    label.replaceWith(inp);
    inp.focus();
    inp.select();
    var done = false;
    function commit(ok) {
      if (done) return;
      done = true;
      var v = inp.value.trim();
      if (inp.parentNode) inp.replaceWith(label);
      if (ok && v && v !== it.name) renameItem(id, v);
    }
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    inp.addEventListener('blur', function () { commit(false); });
  }

  /* ---------- заметка: открытие и панели ---------- */

  function showPlaceholder(show) {
    var el = $('#placeholder');
    if (el) el.classList.toggle('hidden', !show);
  }

  function openNote(id) {
    var note = getItem(id);
    if (!note || note.type !== 'note') return;
    currentId = id;
    showPlaceholder(false);
    $('#note-title').value = note.name;
    $('#note-path').textContent = notePath(id);
    if (ED) ED.setValue(note.content || '');
    ghostMode = null;
    renderPreview();
    renderOutline();
    renderBacklinks();
    renderMeta();
    updateStatus();
    updateActiveRow();
    renderAiPanel();
    renderEditorOverlay();
    hideAiPopup();
    try { localStorage.setItem(LS_SESSION, id); } catch (e) {}
  }

  function selectFallbackNote() {
    var n = firstNoteId();
    if (n) {
      openNote(n);
    } else {
      currentId = null;
      showPlaceholder(true);
      $('#note-title').value = '';
      $('#note-path').textContent = '';
      if (ED) ED.setValue('');
      $('#preview').innerHTML = '';
      renderOutline();
      renderBacklinks();
      renderMeta();
      updateStatus();
    }
  }

  function renderPreview() {
    var note = currentId && getItem(currentId);
    var preview = $('#preview');
    if (!note) { preview.innerHTML = ''; return; }
    preview.innerHTML = MD.render(note.content || '');
    $$('a.wikilink', preview).forEach(function (a) {
      var t = a.getAttribute('data-note');
      if (!findNoteByTitle(t)) {
        a.classList.add('missing');
        a.title = 'Заметки ещё нет — нажмите, чтобы создать';
      }
    });
  }

  function openWikilink(title) {
    var note = findNoteByTitle(title);
    if (!note) {
      note = createNote({ name: String(title || '').trim() || 'Новая заметка', content: '# ' + String(title || '').trim() + '\n\n', silent: true });
      toast('Создана заметка «' + note.name + '»', 'ok');
      return;
    }
    openNote(note.id);
  }

  function renderOutline() {
    var list = $('#outline-list');
    list.innerHTML = '';
    var note = currentId && getItem(currentId);
    if (!note) { list.innerHTML = '<div class="empty">—</div>'; return; }
    var heads = MD.extractHeadings(note.content || '');
    if (!heads.length) { list.innerHTML = '<div class="empty">Нет заголовков</div>'; return; }
    heads.forEach(function (h, i) {
      var item = document.createElement('div');
      item.className = 'outline-item lv' + h.level;
      item.textContent = MD.plain(h.text) || h.text;
      item.title = h.text;
      item.addEventListener('click', function () { scrollToHeading(i); });
      list.appendChild(item);
    });
  }

  function scrollToHeading(i) {
    if (viewMode === 'edit') setViewMode('split');
    renderPreview();
    var el = $('#preview').querySelector('#h' + i);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1000);
  }

  function backlinkSnippet(note, targetName) {
    var raw = note.content || '';
    var re = new RegExp('\\[\\[' + escapeReg(targetName.trim()) + '(\\|[^\\]]*)?\\]\\]', 'i');
    var m = re.exec(raw);
    if (!m) return '';
    var start = Math.max(0, m.index - 70);
    var snip = raw.slice(start, m.index + m[0].length + 90);
    snip = MD.plain(snip);
    return (start > 0 ? '…' : '') + snip + '…';
  }

  function renderBacklinks() {
    var list = $('#backlinks-list');
    var cnt = $('#backlinks-count');
    list.innerHTML = '';
    cnt.textContent = '0';
    var note = currentId && getItem(currentId);
    if (!note) { list.innerHTML = '<div class="empty">—</div>'; return; }
    var target = note.name.trim().toLowerCase();
    var found = [];
    noteItems().forEach(function (n) {
      if (n.id === note.id) return;
      var links = MD.extractLinks(n.content || '');
      if (links.some(function (l) { return l.target.trim().toLowerCase() === target; })) found.push(n);
    });
    cnt.textContent = String(found.length);
    if (!found.length) { list.innerHTML = '<div class="empty">Пока никто не ссылается на эту заметку</div>'; return; }
    found.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'bl-item';
      var t = document.createElement('div');
      t.className = 'bl-title';
      t.textContent = n.name;
      var s = document.createElement('div');
      s.className = 'bl-snippet';
      s.innerHTML = snippetHtml(backlinkSnippet(n, note.name), note.name);
      item.appendChild(t);
      item.appendChild(s);
      item.addEventListener('click', function () { openNote(n.id); });
      list.appendChild(item);
    });
  }

  function metaRow(k, v) {
    return '<div class="meta-row"><span class="meta-key">' + escapeHtml(k) + '</span><span class="meta-val">' + escapeHtml(String(v)) + '</span></div>';
  }

  function renderMeta() {
    var el = $('#note-meta');
    var note = currentId && getItem(currentId);
    if (!note) { el.innerHTML = '<div class="empty">Нет заметки</div>'; return; }
    var tags = MD.extractTags(note.content || '');
    var html = '';
    html += metaRow('Создано', fmtDate(note.created));
    html += metaRow('Изменено', fmtDate(note.updated));
    html += metaRow('Путь', notePath(note.id));
    html += metaRow('Слов', countWords(note.content || ''));
    html += metaRow('Связей', MD.extractLinks(note.content || '').length);
    if (tags.length) {
      html += '<div class="meta-tags">' + tags.map(function (t) {
        return '<span class="tag" data-tag="' + escapeHtml(t) + '">#' + escapeHtml(t) + '</span>';
      }).join('') + '</div>';
    }
    el.innerHTML = html;
    $$('.tag', el).forEach(function (sp) {
      sp.addEventListener('click', function () { showTag(sp.getAttribute('data-tag')); });
    });
  }

  function updateStatus() {
    var note = currentId && getItem(currentId);
    var text = note ? (note.content || '') : '';
    $('#st-words').textContent = 'Слов: ' + countWords(text);
    $('#st-chars').textContent = 'Символов: ' + text.length;
    $('#st-links').textContent = 'Связи: ' + (note ? MD.extractLinks(text).length : 0);
    $('#st-saved').textContent = savedAt ? 'Сохранено в ' + fmtTime(savedAt) : '';
    var modeNames = { edit: 'Текст', split: 'Два окна', read: 'Чтение' };
    $('#st-mode').textContent = modeNames[viewMode] || 'Два окна';
    if (vaultMode === 'disk') {
      var prov = disk && disk.provider;
      $('#st-vault').textContent = prov
        ? '☁️ ' + prov.label + ' · ' + (disk.root ? disk.root.name : '')
        : '📁 Папка: ' + (disk && disk.root ? disk.root.name : 'диск');
    } else {
      $('#st-vault').textContent = '💾 Локально в браузере';
    }
    var syncBtn = $('#st-sync');
    if (syncBtn) syncBtn.classList.toggle('hidden', vaultMode !== 'disk');
  }

  /* ---------- режим просмотра ---------- */

  function setViewMode(mode) {
    if (mode !== 'edit' && mode !== 'split' && mode !== 'read') mode = 'split';
    viewMode = mode;
    $('#panes').className = 'mode-' + mode;
    $$('#view-seg .view-mode').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    try { localStorage.setItem(LS_VIEW, mode); } catch (e) {}
    updateStatus();
    if (mode !== 'edit') renderPreview();
    hideAiPopup();
  }

  function cycleView() {
    var order = ['edit', 'split', 'read'];
    var i = order.indexOf(viewMode);
    setViewMode(order[(i + 1) % order.length]);
  }

  function setRightPanel(open) {
    rightOpen = !!open;
    $('#app').classList.toggle('right-closed', !rightOpen);
    try { localStorage.setItem(LS_RIGHT, rightOpen ? '1' : '0'); } catch (e) {}
  }

  function applyTheme(theme) {
    var t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(LS_THEME, t); } catch (e) {}
    var btn = $('#rb-theme');
    if (btn) btn.innerHTML = t === 'light' ? ICONS.sun : ICONS.moon;
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  /* ---------- редактирование ---------- */

  function editorInput() {
    if (!ED) return;
    var note = currentId && getItem(currentId);
    if (!note) {
      // защита: если текущая запись потерялась (например, удалена), не теряем ввод
      var text = ED.getValue() || '';
      if (!text.trim()) return;
      var t2 = $('#note-title') && $('#note-title').value ? $('#note-title').value.trim() : '';
      note = createNote({ name: t2 || 'Восстановленная заметка', content: text, silent: true, open: false });
      openNote(note.id);
      note = getItem(currentId);
      if (!note) return;
      toast('Ввод сохранён в заметку «' + note.name + '»', 'error');
    }
    note.content = ED.getValue();
    note.updated = Date.now();
    markDirty(note.id);
    persist();
    afterInputDebounced();
    updateStatus();
    scheduleAiCheck();
    hideAiPopup();
    renderEditorOverlay();
  }

  var afterInputDebounced = debounce(function () {
    renderPreview();
    renderOutline();
    renderMeta();
    renderBacklinks();
    renderTagsPanel();
    renderEditorOverlay();
  }, 180);

  function insertTextAt(text, start, end) {
    if (!ED) return;
    ED.insertAt(text, start, end);
  }

  function wrapSelection(pre, post, ph) {
    if (ED) ED.wrapSel(pre, post, ph);
  }

  function linePrefixToggle(prefix) {
    if (ED) ED.linePrefix(prefix);
  }

  function applyCmd(cmd) {
    switch (cmd) {
      case 'bold': wrapSelection('**', '**', 'жирный'); break;
      case 'italic': wrapSelection('*', '*', 'курсив'); break;
      case 'strike': wrapSelection('~~', '~~', 'зачёркнутый'); break;
      case 'mark': wrapSelection('==', '==', 'выделение'); break;
      case 'code': wrapSelection('`', '`', 'код'); break;
      case 'wikilink': wrapSelection('[[', ']]', 'Заметка'); break;
      case 'link': wrapSelection('[', '](url)', 'текст'); break;
      case 'heading': linePrefixToggle('## '); break;
      case 'quote': linePrefixToggle('> '); break;
      case 'ul': linePrefixToggle('- '); break;
      case 'ol': linePrefixToggle('1. '); break;
      case 'task': linePrefixToggle('- [ ] '); break;
      case 'table': {
        var selT = ED ? ED.getSel() : { from: 0, to: 0 };
        insertTextAt('\n| Столбец | Столбец |\n|---|---|\n|  |  |\n', selT.from, selT.to);
        break;
      }
      case 'hr': {
        var selH = ED ? ED.getSel() : { from: 0, to: 0 };
        insertTextAt('\n---\n', selH.from, selH.to);
        break;
      }
    }
  }

  /* ---------- поиск ---------- */

  function snippetHtml(snippet, query) {
    var esc = escapeHtml(snippet || '');
    if (!query) return esc;
    var q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return esc.replace(new RegExp(q, 'gi'), function (m) { return '<mark>' + m + '</mark>'; }); }
    catch (e) { return esc; }
  }

  function searchAll(q) {
    var query = q.trim().toLowerCase();
    if (!query) return [];
    var res = [];
    noteItems().forEach(function (n) {
      var titleHit = n.name.toLowerCase().indexOf(query) !== -1;
      var plainText = MD.plain(n.content || '');
      var idx = plainText.toLowerCase().indexOf(query);
      if (!titleHit && idx === -1) return;
      var snippet;
      if (idx !== -1) {
        var start = Math.max(0, idx - 60);
        snippet = (start > 0 ? '…' : '') + plainText.slice(start, idx + query.length + 90) + (idx + query.length + 90 < plainText.length ? '…' : '');
      } else {
        snippet = plainText.slice(0, 120) + (plainText.length > 120 ? '…' : '');
      }
      res.push({ note: n, snippet: snippet, titleHit: titleHit });
    });
    res.sort(function (a, b) { return (b.titleHit - a.titleHit) || a.note.name.localeCompare(b.note.name, 'ru'); });
    return res.slice(0, 60);
  }

  function runSearch(q) {
    var info = $('#search-info');
    var res = $('#search-results');
    var query = (q || '').trim();
    res.innerHTML = '';
    if (!query) {
      info.textContent = 'Поиск идёт по названиям и тексту заметок.';
      return;
    }
    var found = searchAll(query);
    info.textContent = 'Найдено: ' + found.length;
    if (!found.length) {
      res.innerHTML = '<div class="search-empty">Ничего не нашлось</div>';
      return;
    }
    found.forEach(function (f) {
      var item = document.createElement('div');
      item.className = 's-item';
      var t = document.createElement('div');
      t.className = 's-title';
      t.textContent = f.note.name;
      var p = document.createElement('div');
      p.className = 's-path';
      p.textContent = notePath(f.note.id);
      var s = document.createElement('div');
      s.className = 's-snippet';
      s.innerHTML = snippetHtml(f.snippet, query);
      item.appendChild(t);
      item.appendChild(p);
      item.appendChild(s);
      item.addEventListener('click', function () { openNote(f.note.id); });
      res.appendChild(item);
    });
  }

  var searchDebounced = debounce(function () { runSearch($('#search-input').value); }, 140);

  function activateTab(name) {
    $$('.stab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    $$('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + name); });
  }

  /* ---------- теги ---------- */

  function allTags() {
    var map = {};
    noteItems().forEach(function (n) {
      MD.extractTags(n.content || '').forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return Object.keys(map).map(function (k) { return [k, map[k]]; })
      .sort(function (a, b) { return (b[1] - a[1]) || a[0].localeCompare(b[0], 'ru'); });
  }

  function renderTagsPanel() {
    var list = $('#tag-list');
    list.innerHTML = '';
    var tags = allTags();
    if (!tags.length) {
      list.innerHTML = '<div class="empty">Тегов пока нет. Добавьте #тег в текст заметки.</div>';
      return;
    }
    tags.forEach(function (pair) {
      var row = document.createElement('div');
      row.className = 'tag-row';
      var name = document.createElement('span');
      name.textContent = '#' + pair[0];
      var cnt = document.createElement('span');
      cnt.className = 'count';
      cnt.textContent = String(pair[1]);
      row.appendChild(name);
      row.appendChild(cnt);
      row.addEventListener('click', function () { showTag(pair[0]); });
      list.appendChild(row);
    });
  }

  function showTag(tag) {
    activateTab('search');
    var inp = $('#search-input');
    inp.value = '#' + tag;
    runSearch(inp.value);
  }

  /* ---------- быстрый переход ---------- */

  var swItems = [];
  var swIdx = 0;

  function fuzzyScore(name, query) {
    var n = name.toLowerCase();
    var s = query.toLowerCase();
    if (!s) return 0;
    if (s.length > n.length) return -1;
    var pos = n.indexOf(s);
    if (pos === 0) return 1000;
    if (pos > 0) return 500 - pos;
    var i = 0;
    var score = 0;
    var last = -1;
    for (var k = 0; k < s.length; k++) {
      var j = n.indexOf(s.charAt(k), i);
      if (j === -1) return -1;
      if (last >= 0) score += (j === last + 1 ? 5 : 1);
      last = j;
      i = j + 1;
    }
    return score;
  }

  function refreshSwitcher(q) {
    var query = (q || '').trim().toLowerCase();
    var scored;
    if (!query) {
      scored = noteItems().slice(0, 12).map(function (n) { return { n: n, s: 0 }; });
    } else {
      scored = noteItems().map(function (n) { return { n: n, s: fuzzyScore(n.name, query) }; })
        .filter(function (x) { return x.s >= 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 12);
    }
    swItems = scored.map(function (x) { return x.n; });
    swIdx = 0;
    renderSwitcher();
  }

  function renderSwitcher() {
    var list = $('#switcher-list');
    list.innerHTML = '';
    if (!swItems.length) {
      var none = document.createElement('li');
      none.className = 'sw-item';
      var nm = document.createElement('span');
      nm.className = 'sw-name';
      nm.textContent = 'Ничего не найдено';
      none.appendChild(nm);
      list.appendChild(none);
      return;
    }
    swItems.forEach(function (n, i) {
      var li = document.createElement('li');
      li.className = 'sw-item' + (i === swIdx ? ' active' : '');
      var name = document.createElement('span');
      name.className = 'sw-name';
      name.textContent = n.name;
      var p = document.createElement('span');
      p.className = 'sw-path';
      p.textContent = notePath(n.id);
      li.appendChild(name);
      li.appendChild(p);
      li.addEventListener('click', function () { openSwitcherItem(i); });
      list.appendChild(li);
    });
  }

  function openSwitcherItem(i) {
    var note = swItems[i];
    if (!note) return;
    closeModal('#switcher-modal');
    openNote(note.id);
  }

  function openSwitcher() {
    var m = $('#switcher-modal');
    m.classList.add('open');
    var inp = $('#switcher-input');
    inp.value = '';
    refreshSwitcher('');
    setTimeout(function () { inp.focus(); }, 0);
  }

  /* ---------- граф связей ---------- */

  function openGraph() {
    buildGraph();
    $('#graph-modal').classList.add('open');
  }

  function buildGraph() {
    var svg = $('#graph-svg');
    var notes = noteItems();
    var W = 920;
    var H = 560;
    var cx = W / 2;
    var cy = H / 2 + 6;
    var n = notes.length;
    var pos = new Map();
    var R = Math.min(W, H) / 2 - 95;
    notes.forEach(function (note, i) {
      var ang = (Math.PI * 2 * i) / Math.max(1, n) - Math.PI / 2;
      var r = n <= 14 ? R : R * (i % 2 === 0 ? 1 : 0.62);
      pos.set(note.id, { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) + (i % 2 === 1 ? 14 : 0) });
    });
    var byTitle = {};
    notes.forEach(function (note) { byTitle[note.name.trim().toLowerCase()] = note.id; });
    var deg = {};
    var edges = [];
    notes.forEach(function (note) {
      MD.extractLinks(note.content || '').forEach(function (l) {
        var tid = byTitle[l.target.trim().toLowerCase()];
        if (tid && tid !== note.id) {
          edges.push([note.id, tid]);
          deg[note.id] = (deg[note.id] || 0) + 1;
          deg[tid] = (deg[tid] || 0) + 1;
        }
      });
    });
    var s = '';
    edges.forEach(function (e) {
      var a = pos.get(e[0]);
      var b = pos.get(e[1]);
      if (!a || !b) return;
      s += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="#8b7bf7" stroke-opacity="0.32" stroke-width="1.2"/>';
    });
    notes.forEach(function (note) {
      var p = pos.get(note.id);
      var d = deg[note.id] || 0;
      var r = 7 + Math.min(14, d * 2.2);
      var active = note.id === currentId;
      s += '<g class="gnode" data-id="' + note.id + '">' +
        '<title>' + escapeHtml(note.name) + '</title>' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + (active ? '#c9bfff' : '#8b7bf7') + '" fill-opacity="' + (active ? '1' : '0.85') + '"/>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 15).toFixed(1) + '" text-anchor="middle" font-size="12" fill="#a0a0aa" font-family="Segoe UI, sans-serif">' + escapeHtml(truncate(note.name, 20)) + '</text>' +
        '</g>';
    });
    if (!notes.length) {
      s = '<text x="460" y="280" text-anchor="middle" font-size="14" fill="#a0a0aa" font-family="Segoe UI, sans-serif">Заметок пока нет</text>';
    }
    svg.innerHTML = s;
  }

  /* ---------- экспорт / импорт ---------- */

  function exportJSON() {
    var data = { app: 'Графит', version: 1, exportedAt: new Date().toISOString(), items: vault.items, trash: vault.trash };
    var d = new Date();
    var stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    downloadBlob(JSON.stringify(data, null, 2), 'vault-backup-' + stamp + '.json', 'application/json;charset=utf-8');
    toast('Резервная копия скачана', 'ok');
  }

  function importJSONFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var items = data && data.items && typeof data.items === 'object' ? data.items : null;
        if (!items) throw new Error('в файле нет данных хранилища');
        var idMap = {};
        var added = 0;
        Object.keys(items).forEach(function (oldId) {
          var src = items[oldId];
          if (!src || (src.type !== 'note' && src.type !== 'folder')) return;
          var id = uid(src.type === 'note' ? 'n' : 'f');
          idMap[oldId] = id;
          vault.items[id] = {
            id: id,
            type: src.type,
            name: String(src.name || 'Без названия'),
            parent: null,
            content: src.type === 'note' ? String(src.content || '') : undefined,
            created: src.created || Date.now(),
            updated: Date.now()
          };
          added++;
        });
        Object.keys(idMap).forEach(function (oldId) {
          var src = items[oldId];
          if (src && src.parent && idMap[src.parent]) vault.items[idMap[oldId]].parent = idMap[src.parent];
        });
        persist();
        renderTree();
        renderTagsPanel();
        toast('Импортировано объектов: ' + added, 'ok');
      } catch (e) {
        toast('Не удалось импортировать: ' + e.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  function importMDFiles(files) {
    var arr = Array.prototype.slice.call(files);
    if (!arr.length) return;
    var done = 0;
    var added = 0;
    arr.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        var nm = f.name.replace(/\.(md|markdown|txt)$/i, '') || 'Импорт';
        createNote({ name: uniqueNoteName(nm, null), content: String(reader.result || ''), open: false, silent: true });
        added++;
        done++;
        if (done === arr.length) {
          persist();
          renderTree();
          renderTagsPanel();
          toast('Импортировано заметок: ' + added, 'ok');
        }
      };
      reader.onerror = function () {
        done++;
        if (done === arr.length) toast('Часть файлов не удалось прочитать', 'error');
      };
      reader.readAsText(f);
    });
  }

  async function resetVault() {
    var diskMode = vaultMode === 'disk';
    var ok = await gdConfirm({
      title: diskMode ? 'Отключить папку и сбросить хранилище?' : 'Сбросить хранилище?',
      lines: diskMode
        ? ['Локальное хранилище вернётся к стартовым примерам. Файлы на диске не изменятся.']
        : ['Все заметки будут удалены, вернутся стартовые примеры.', 'Перед сбросом можно скачать резервную копию (меню хранилища → Экспорт).'],
      okLabel: 'Сбросить',
      danger: true
    });
    if (!ok) return;
    if (diskMode) detachDisk();
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    seedVault();
    currentId = null;
    collapsed = {};
    renderTree();
    renderTagsPanel();
    var f = firstNoteId();
    if (f) openNote(f); else selectFallbackNote();
    toast('«Графит» сброшен к стартовым примерам', 'ok');
  }

  /* ---------- меню и модальные окна ---------- */

  function closeModal(sel) {
    var m = $(sel);
    if (m) m.classList.remove('open');
  }

  function closeMenu() {
    var pop = $('#menu-popover');
    if (pop) pop.classList.add('hidden');
  }

  function toggleMenu() {
    var pop = $('#menu-popover');
    if (!pop) return;
    if (!pop.classList.contains('hidden')) { closeMenu(); return; }
    var r = $('#rb-menu').getBoundingClientRect();
    pop.classList.remove('hidden');
    // меню всегда помещается в окно: прижимаем к краям по обеим осям
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = Math.min(r.right + 8, window.innerWidth - pw - 8);
    var top = Math.min(Math.max(8, r.top - 6), window.innerHeight - ph - 8);
    pop.style.left = Math.round(Math.max(8, left)) + 'px';
    pop.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  /* ---------- фирменные диалоги (вместо системных окон) ---------- */

  var GD_ICONS = {
    ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.5.9-1.5 1.8v.4"/><circle cx="11.6" cy="17" r="0.7" fill="currentColor"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 22 20H2z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.4" r="0.7" fill="currentColor"/></svg>',
    del: ICONS.trash
  };
  var gdLayers = [];

  function gdDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var layer = document.createElement('div');
      layer.className = 'gd-layer';
      var box = document.createElement('div');
      box.className = 'gd-box' + (opts.danger ? ' danger' : '');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.tabIndex = -1;

      var head = document.createElement('div'); head.className = 'gd-head';
      var ic = document.createElement('span'); ic.className = 'gd-ic';
      ic.innerHTML = opts.danger ? GD_ICONS.del : GD_ICONS.ask;
      var ttl = document.createElement('div'); ttl.className = 'gd-title';
      ttl.textContent = opts.title || 'Графит';
      var x = document.createElement('button');
      x.className = 'gd-close'; x.type = 'button'; x.setAttribute('aria-label', 'Закрыть');
      x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      head.appendChild(ic); head.appendChild(ttl); head.appendChild(x);

      var body = document.createElement('div'); body.className = 'gd-body';
      (opts.lines || []).forEach(function (s) {
        var p = document.createElement('p'); p.textContent = s; body.appendChild(p);
      });

      var foot = document.createElement('div'); foot.className = 'gd-foot';
      var cancelBtn = null;
      if (!opts.alertOnly) {
        cancelBtn = document.createElement('button');
        cancelBtn.className = 'gd-btn'; cancelBtn.type = 'button';
        cancelBtn.textContent = opts.cancelLabel || 'Отмена';
        foot.appendChild(cancelBtn);
      }
      var okBtn = document.createElement('button');
      okBtn.className = 'gd-btn ' + (opts.danger ? 'danger' : 'primary');
      okBtn.type = 'button';
      okBtn.textContent = opts.okLabel || (opts.alertOnly ? 'Понятно' : 'ОК');
      foot.appendChild(okBtn);

      box.appendChild(head); box.appendChild(body); box.appendChild(foot);
      layer.appendChild(box);
      document.body.appendChild(layer);
      gdLayers.push(layer);

      var done = false;
      function close(val) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        var ix = gdLayers.indexOf(layer);
        if (ix >= 0) gdLayers.splice(ix, 1);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        resolve(val);
      }
      function onKey(e) {
        if (gdLayers[gdLayers.length - 1] !== layer) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
        else if (e.key === 'Enter' && document.activeElement !== cancelBtn) { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.ctrlKey || e.metaKey) { e.stopPropagation(); }
      }
      x.addEventListener('click', function () { close(false); });
      okBtn.addEventListener('click', function () { close(true); });
      if (cancelBtn) cancelBtn.addEventListener('click', function () { close(false); });
      layer.addEventListener('mousedown', function (e) { if (e.target === layer) close(false); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { (opts.danger && cancelBtn ? cancelBtn : okBtn).focus(); }, 0);
    });
  }

  function gdConfirm(opts) { return gdDialog(opts || {}); }
  function gdAlert(opts) { var o = opts || {}; o.alertOnly = true; return gdDialog(o); }

  /* ---------- привязка событий ---------- */

  function bindUI() {
    // лента
    $('#rb-new').addEventListener('click', function () { createNote({}); });
    $('#rb-folder').addEventListener('click', function () { createFolder(null); });
    $('#rb-search').addEventListener('click', function () { activateTab('search'); $('#search-input').focus(); });
    $('#rb-graph').addEventListener('click', openGraph);
    $('#rb-theme').addEventListener('click', toggleTheme);
    $('#rb-help').addEventListener('click', function () { $('#about-modal').classList.add('open'); });
    $('#rb-menu').addEventListener('click', function () { toggleMenu(); });
    window.addEventListener('resize', function () { closeMenu(); });

    // боковая панель
    $('#sb-new-note').addEventListener('click', function () { createNote({}); });
    $('#sb-new-folder').addEventListener('click', function () { createFolder(null); });
    $('#sb-collapse').addEventListener('click', function () {
      var anyOpen = false;
      allItems().forEach(function (i) { if (i.type === 'folder' && !collapsed[i.id]) anyOpen = true; });
      collapsed = {};
      if (anyOpen) allItems().forEach(function (i) { if (i.type === 'folder') collapsed[i.id] = true; });
      renderTree();
    });

    $$('.stab').forEach(function (b) {
      b.addEventListener('click', function () { activateTab(b.dataset.tab); });
    });

    // дерево
    $('#file-tree').addEventListener('click', function (e) {
      var btn = e.target.closest('.mini-btn');
      var row = e.target.closest('.tree-row');
      if (!row) return;
      var id = row.dataset.id;
      if (btn) {
        e.stopPropagation();
        var act = btn.dataset.act;
        if (act === 'rename') startRename(row, id);
        else if (act === 'delete') deleteItem(id);
        else if (act === 'new') {
          var it = getItem(id);
          if (it) createNote({ parent: it.type === 'folder' ? id : it.parent });
        }
        return;
      }
      var item = getItem(id);
      if (!item) return;
      if (item.type === 'folder') {
        if (collapsed[id]) delete collapsed[id];
        else collapsed[id] = true;
        renderTree();
      } else {
        openNote(id);
      }
    });

    // корзина
    $('#trash-toggle').addEventListener('click', function () {
      var l = $('#trash-list');
      var a = $('#trash-actions');
      var caret = $('#trash-caret');
      var hidden = l.classList.toggle('hidden');
      a.classList.toggle('hidden', hidden);
      caret.textContent = hidden ? '▸' : '▾';
      this.setAttribute('aria-expanded', String(!hidden));
    });
    $('#btn-trash-clear').addEventListener('click', async function () {
      if (!vault.trash.length) return;
      var okClear = await gdConfirm({
        title: 'Очистить корзину?',
        lines: ['Удаление без возможности восстановления.'],
        okLabel: 'Очистить',
        danger: true
      });
      if (!okClear) return;
      vault.trash = [];
      persist();
      renderTrash();
      toast('Корзина очищена');
    });

    // поиск
    $('#search-input').addEventListener('input', searchDebounced);

    // заголовок заметки
    var titleEditId = null;
    var renameFromTitle = debounce(function () {
      if (!titleEditId || titleEditId !== currentId) return;
      var it = getItem(titleEditId);
      if (!it) return;
      var v = $('#note-title').value.trim();
      if (v && v !== it.name) renameItem(it.id, v);
      else if (!v) $('#note-title').value = it.name;
    }, 550);
    $('#note-title').addEventListener('input', function () { titleEditId = currentId; renameFromTitle(); });
    $('#note-title').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#note-title').blur(); }
    });
    $('#note-title').addEventListener('blur', function () {
      var it = currentId && getItem(currentId);
      if (!it) return;
      var v = $('#note-title').value.trim();
      if (!v) { $('#note-title').value = it.name; return; }
      if (v !== it.name) renameItem(it.id, v);
    });

    // режимы просмотра
    $$('#view-seg .view-mode').forEach(function (b) {
      b.addEventListener('click', function () { setViewMode(b.dataset.mode); });
    });
    $('#btn-toggle-right').addEventListener('click', function () { setRightPanel(!rightOpen); });
    $('#rb-close').addEventListener('click', function () { setRightPanel(false); });

    // действия с заметкой
    $('#btn-export-note').addEventListener('click', function () {
      var note = currentId && getItem(currentId);
      if (!note) return;
      downloadBlob(note.content || '', safeName(note.name) + '.md', 'text/markdown;charset=utf-8');
      toast('Заметка скачана (.md)', 'ok');
    });
    $('#btn-delete-note').addEventListener('click', function () { if (currentId) deleteItem(currentId); });
    $('#placeholder-new').addEventListener('click', function () { createNote({}); });

    // редактор (CodeMirror)
    ED = window.GrafitEditor ? window.GrafitEditor.create($('#editor'), {
      text: '',
      placeholder: 'Пишите здесь в Markdown…',
      onChange: function () { editorInput(); },
      onSelection: function () {
        if (ghostMode && ghostMode.kind === 'continue' && ED && ED.hasGhost()) { ED.hideGhost(); ghostMode = null; }
        updateAiPopup();
      },
      onScroll: function () { updateAiPopup(); },
      onGhostAccept: function () { acceptGhost(); },
      onGhostRequest: function () { aiContinue(true); },
      onGhostDismiss: function () { ghostMode = null; }
    }) : null;
    document.addEventListener('mousedown', function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('#ai-popup') || e.target.closest('#editor-wrap')) return;
      hideAiPopup();
    });

    // панель инструментов (не крадём фокус у редактора)
    $('#toolbar').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $$('#toolbar .tb-btn').forEach(function (b) {
      b.addEventListener('click', function () { applyCmd(b.dataset.cmd); });
    });

    // просмотр: ссылки, теги, чекбоксы
    $('#preview').addEventListener('click', function (e) {
      var a = e.target.closest('a.wikilink');
      if (a) { e.preventDefault(); openWikilink(a.getAttribute('data-note')); return; }
      var tag = e.target.closest('.tag');
      if (tag) { e.preventDefault(); showTag(tag.getAttribute('data-tag')); return; }
    });
    $('#preview').addEventListener('change', function (e) {
      var cb = e.target.closest('.task-toggle');
      if (!cb) return;
      var note = currentId && getItem(currentId);
      if (!note) return;
      var boxes = $$('.task-toggle', $('#preview'));
      var idx = boxes.indexOf(cb);
      if (idx === -1) return;
      var k = -1;
      note.content = (note.content || '').replace(/^(\s*[-*+]\s+\[)([ xX])(\])/gm, function (m, pre, st, post) {
        k++;
        return k === idx ? pre + (cb.checked ? 'x' : ' ') + post : m;
      });
      note.updated = Date.now();
      markDirty(note.id);
      if (ED) ED.setValue(note.content);
      editorInput();
      renderPreview();
    });

    // разделитель панелей
    (function initDivider() {
      var divider = $('#pane-divider');
      var panes = $('#panes');
      var dragging = false;
      divider.addEventListener('pointerdown', function (e) {
        dragging = true;
        panes.classList.add('dragging');
        try { divider.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      function move(e) {
        if (!dragging) return;
        var rect = panes.getBoundingClientRect();
        var pct = clamp(((e.clientX - rect.left) / rect.width) * 100, 20, 80);
        panes.style.setProperty('--split', pct.toFixed(1) + '%');
      }
      function stop() {
        if (!dragging) return;
        dragging = false;
        panes.classList.remove('dragging');
        var v = panes.style.getPropertyValue('--split');
        if (v) { try { localStorage.setItem(LS_SPLIT, v); } catch (e) {} }
      }
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', stop);
      divider.addEventListener('pointercancel', stop);
    })();

    // быстрый переход
    $('#switcher-input').addEventListener('input', function () { refreshSwitcher(this.value); });
    $('#switcher-input').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        swIdx = Math.min(swItems.length - 1, swIdx + 1);
        renderSwitcher();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        swIdx = Math.max(0, swIdx - 1);
        renderSwitcher();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openSwitcherItem(swIdx);
      } else if (e.key === 'Escape') {
        closeModal('#switcher-modal');
      }
    });

    // граф
    $('#graph-close').addEventListener('click', function () { closeModal('#graph-modal'); });
    $('#graph-svg').addEventListener('click', function (e) {
      var g = e.target && e.target.closest ? e.target.closest('.gnode') : null;
      if (g) {
        closeModal('#graph-modal');
        openNote(g.getAttribute('data-id'));
      }
    });

    // о программе
    $('#about-close').addEventListener('click', function () { closeModal('#about-modal'); });

    // облако и синхронизация
    $('#rb-cloud').addEventListener('click', function () { openCloudWizard(); });
    $('#cloud-close').addEventListener('click', function () { closeModal('#cloud-modal'); });
    $$('#cloud-modal .cloud-card').forEach(function (c) {
      c.addEventListener('click', function () { selectCloud(c.dataset.cloud); });
    });
    $('#st-sync').addEventListener('click', function () { lightDiskSync(true); });
    var aboutCloud = $('#about-open-cloud');
    if (aboutCloud) aboutCloud.addEventListener('click', function () {
      closeModal('#about-modal');
      openCloudWizard();
    });
    window.addEventListener('focus', function () { lightDiskSync(false); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) lightDiskSync(false);
    });

    // ИИ-помощник
    $('#rb-ai').addEventListener('click', function () {
      if (!aiCfg || !aiCfg.enabled) { openAiSettings(); return; }
      setRightPanel(true);
      renderAiPanel();
    });
    $('#ai-close').addEventListener('click', function () { closeModal('#ai-modal'); });
    $('#ai-open-settings').addEventListener('click', function () { openAiSettings(); });
    $('#ai-check').addEventListener('click', function () { aiAnalyze(true); });
    $('#ai-continue').addEventListener('click', function () { aiContinue(true); });
    $('#ai-auto').addEventListener('click', function () {
      aiCfg.auto = !aiCfg.auto;
      saveAiCfg();
      renderAiPanel();
      toast(aiCfg.auto ? 'Автопроверка включена' : 'Автопроверка выключена');
    });
    $('#ai-provider').addEventListener('change', function () {
      aiApplyPreset(this.value);
      aiOllamaToggle();
      if (this.value === 'ollama') aiOllamaRefresh(true);
    });
    $('#ai-base').addEventListener('input', function () { aiOllamaToggle(); });
    $('#ai-ollama-refresh').addEventListener('click', function () { aiOllamaRefresh(false); });
    $('#ai-ollama-pull').addEventListener('click', aiOllamaPull);
    $('#ai-ollama-models').addEventListener('change', function () {
      if (this.value) $('#ai-model').value = this.value;
    });
    $('#ai-save').addEventListener('click', function () {
      aiCfg = readAiForm();
      saveAiCfg();
      setAiFormStatus('ok', 'Сохранено');
      renderAiPanel();
      renderEditorOverlay();
      hideAiPopup();
      if (aiCfg.enabled && aiCfg.auto) scheduleAiCheck();
      toast('Настройки ИИ сохранены', 'ok');
    });
    $('#ai-test').addEventListener('click', aiTestConnection);

    // модальные окна: клик по фону
    $$('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
    });

    // меню хранилища
    $('#menu-popover').addEventListener('click', function (e) {
      var btn = e.target.closest('.menu-item');
      if (!btn) return;
      var act = btn.dataset.act;
      closeMenu();
      if (act === 'export-json') exportJSON();
      else if (act === 'import-json') $('#file-json').click();
      else if (act === 'import-md') $('#file-md').click();
      else if (act === 'open-cloud') openCloudWizard();
      else if (act === 'sync-check') lightDiskSync(true);
      else if (act === 'rescan') refreshDiskVault(true);
      else if (act === 'ai') openAiSettings();
      else if (act === 'reset') resetVault();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('#rb-menu') || e.target.closest('#menu-popover')) return;
      closeMenu();
    });

    // файлы
    $('#file-json').addEventListener('change', function () {
      if (this.files && this.files[0]) importJSONFile(this.files[0]);
      this.value = '';
    });
    $('#file-md').addEventListener('change', function () {
      if (this.files && this.files.length) importMDFiles(this.files);
      this.value = '';
    });

    // глобальные клавиши — работают в русской и английской раскладке (e.code)
    document.addEventListener('keydown', function (e) {
      if (document.querySelector('.gd-layer')) return; // открыт диалог — клавиши принадлежат ему
      var mod = e.ctrlKey || e.metaKey;
      var key = (e.key || '').toLowerCase();
      var code = e.code || '';
      function is(letter) {
        return code === 'Key' + letter.toUpperCase() || key === letter;
      }
      if (mod && is('s')) {
        e.preventDefault();
        if (vaultMode === 'browser') saveLocal(); else saveDiskNow();
        return;
      }
      if (mod && is('n') && !e.shiftKey) { e.preventDefault(); createNote({}); return; }
      if (mod && (is('o') || is('p')) && !e.shiftKey) { e.preventDefault(); openSwitcher(); return; }
      if (mod && e.shiftKey && is('f')) { e.preventDefault(); activateTab('search'); $('#search-input').focus(); return; }
      if (mod && e.shiftKey && is('a')) { e.preventDefault(); aiAnalyze(true); return; }
      if (mod && is('e') && !e.shiftKey) { e.preventDefault(); cycleView(); return; }
      if (mod && (key === '\\' || key === '|' || code === 'Backslash')) { e.preventDefault(); setRightPanel(!rightOpen); return; }
      if (mod && !e.shiftKey && is('b') && ED && ED.hasFocus()) { e.preventDefault(); applyCmd('bold'); return; }
      if (mod && !e.shiftKey && is('i') && ED && ED.hasFocus()) { e.preventDefault(); applyCmd('italic'); return; }
      if (e.key === 'Escape') {
        closeModal('#switcher-modal');
        closeModal('#graph-modal');
        closeModal('#about-modal');
        closeModal('#cloud-modal');
        closeModal('#ai-modal');
        closeMenu();
      }
    });

    // сохранение при закрытии
    window.addEventListener('beforeunload', function () {
      if (!vault) return;
      if (vaultMode === 'browser') saveLocal();
      else if (vaultMode === 'disk') { try { saveDiskNow(); } catch (e) { /* по возможности */ } }
    });
  }

  /* ---------- запуск ---------- */

  function boot() {
    try { applyTheme(localStorage.getItem(LS_THEME) || 'dark'); } catch (e) { applyTheme('dark'); }
    if (!loadLocal()) seedVault();
    loadAiCfg();
    bindUI();
    renderTree();
    renderTagsPanel();
    renderAiPanel();
    renderEditorOverlay();

    var savedView = null;
    try { savedView = localStorage.getItem(LS_VIEW); } catch (e) {}
    setViewMode(savedView === 'edit' || savedView === 'read' || savedView === 'split' ? savedView : 'split');

    var savedRight = null;
    try { savedRight = localStorage.getItem(LS_RIGHT); } catch (e) {}
    setRightPanel(savedRight !== '0');

    try {
      var split = parseFloat(localStorage.getItem(LS_SPLIT) || '');
      if (split >= 20 && split <= 80) $('#panes').style.setProperty('--split', split + '%');
    } catch (e) {}

    var last = null;
    try { last = localStorage.getItem(LS_SESSION); } catch (e) {}
    var target = null;
    if (last && getItem(last) && getItem(last).type === 'note') target = last;
    else target = firstNoteId();
    if (target) openNote(target); else showPlaceholder(true);

    setSaved();

    tryRestoreDisk();
    window.__appReady = true;
    try { window.__grafitUi = { confirm: function (o) { return gdConfirm(o); }, alert: function (o) { return gdAlert(o); }, dialogOpen: function () { return !!document.querySelector('.gd-layer'); } }; } catch (e) {}
    try {
      window.__grafitEditor = {
        get: function () { return ED ? ED.getValue() : null; },
        set: function (t) { if (ED) ED.setValue(t); },
        insert: function (t) { if (ED) ED.insert(t); },
        sel: function () { return ED ? ED.getSel() : null; },
        setSel: function (a, b) { if (ED) ED.setSel(a, b); },
        ghost: function (t) { if (ED) { ghostMode = { kind: 'continue', text: t }; ED.showGhost(t); } },
        hasGhost: function () { return ED ? ED.hasGhost() : false; },
        focus: function () { if (ED) ED.focus(); },
        cm: function () { return !!document.querySelector('.cm-editor'); },
        setSuggestions: function (list) {
          var n = currentId && getItem(currentId);
          if (!n) return false;
          aiSuggestions[n.id] = list || [];
          renderEditorOverlay();
          return true;
        }
      };
    } catch (e) {}
    try {
      // Быстрая заметка из мини-окна (десктоп): создаёт заметку в текущем хранилище
      window.__grafitQuickNote = function (text) {
        try {
          text = String(text || '').replace(/\r\n/g, '\n').trim();
          if (!text) return { ok: false, err: 'пустая заметка' };
          var firstLine = (text.split('\n')[0] || '').trim().slice(0, 48) || 'Быстрая заметка';
          var it = createNote({ name: firstLine, content: text + '\n', silent: true, open: false });
          toast('Быстрая заметка: «' + it.name + '»', 'ok');
          return { ok: true, name: it.name };
        } catch (e2) { return { ok: false, err: String(e2 && e2.message) }; }
      };
    } catch (e) {}
    window.__appInfo = function () {
      return {
        notes: noteItems().length,
        folders: allItems().filter(function (i) { return i.type === 'folder'; }).length,
        current: currentId,
        mode: vaultMode,
        trash: vault.trash.length
      };
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
