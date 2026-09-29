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
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('Не удалось открыть папку: ' + (e && e.message ? e.message : e), 'error');
    }
  }

  async function tryRestoreDisk() {
    if (!FSA_OK) return;
    var root = null;
    try { root = await idbGet('diskRoot'); } catch (e) { return; }
    if (!root) return;
    try {
      var perm = await root.queryPermission({ mode: 'readwrite' });
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
    idbDel('diskRoot').catch(function () {});
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

  async function lightDiskSync(manual) {
    if (vaultMode !== 'disk' || !disk) {
      if (manual) {
        toast('Сначала подключите облако или папку на диске');
        openCloudWizard();
      }
      return;
    }
    var now = Date.now();
    if (!manual && (now - lastDiskCheck < 30000)) return;
    if (!manual && document.hidden) return;
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
              $('#editor').value = text;
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
    } else if (manual) {
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
    if (!confirm('Перечитать папку заново?\n\nВсё будет считано из файлов; несохранённые правки сначала сохранятся.')) return;
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
    if (!confirm('В локальном хранилище есть заметки (' + localNotes.length + ').\n\nПеренести их в подключённую папку? Существующие файлы не перезапишутся.')) return;

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
      if (cur) { $('#editor').value = cur.content; renderPreview(); }
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

  function deleteItem(id) {
    var it = getItem(id);
    if (!it) return;
    var kids = descendantsOf(id);
    var msg;
    if (it.type === 'folder') {
      msg = 'Удалить папку «' + it.name + '»' + (kids.length ? ' вместе с содержимым (' + kids.length + ')' : '') + '?';
    } else {
      msg = 'Удалить заметку «' + it.name + '»?';
    }
    msg += '\n\n' + (vaultMode === 'disk' ? 'Файлы будут удалены с диска.' : 'Объекты попадут в корзину — их можно будет восстановить.');
    if (!confirm(msg)) return;

    var items = [it].concat(kids);
    if (vaultMode === 'disk') {
      items.forEach(function (x) {
        var h = disk.handles.get(x.id);
        if (h && typeof h.remove === 'function') { h.remove().catch(function () {}); }
        if (disk.handles.delete) disk.handles.delete(x.id);
        delete vault.items[x.id];
      });
      toast('Удалено с диска');
    } else {
      items.forEach(function (x) {
        vault.trash.push({ item: x, deletedAt: Date.now() });
        delete vault.items[x.id];
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
    $('#editor').value = note.content || '';
    renderPreview();
    renderOutline();
    renderBacklinks();
    renderMeta();
    updateStatus();
    updateActiveRow();
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
      $('#editor').value = '';
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
    var note = currentId && getItem(currentId);
    if (!note) return;
    note.content = $('#editor').value;
    note.updated = Date.now();
    markDirty(note.id);
    persist();
    afterInputDebounced();
    updateStatus();
  }

  var afterInputDebounced = debounce(function () {
    renderPreview();
    renderOutline();
    renderMeta();
    renderBacklinks();
    renderTagsPanel();
  }, 180);

  function insertTextAt(text, start, end) {
    var ta = $('#editor');
    ta.focus();
    ta.setSelectionRange(start, end);
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) ta.setRangeText(text, start, end, 'end');
    editorInput();
  }

  function wrapSelection(pre, post, ph) {
    var ta = $('#editor');
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var sel = ta.value.slice(start, end);
    var inner = sel || ph;
    insertTextAt(pre + inner + post, start, end);
    var from = start + pre.length;
    ta.setSelectionRange(from, from + inner.length);
  }

  function linePrefixToggle(prefix) {
    var ta = $('#editor');
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var val = ta.value;
    var lineStart = val.lastIndexOf('\n', start - 1) + 1;
    var lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    var lines = val.slice(lineStart, lineEnd).split('\n');
    var allPrefixed = lines.every(function (l) { return !l.trim() || l.indexOf(prefix) === 0; });
    var out = lines.map(function (l) {
      if (!l.trim()) return l;
      if (allPrefixed) return l.indexOf(prefix) === 0 ? l.slice(prefix.length) : l;
      return prefix + l;
    }).join('\n');
    insertTextAt(out, lineStart, lineEnd);
    ta.focus();
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
      case 'table':
        insertTextAt('\n| Столбец | Столбец |\n|---|---|\n|  |  |\n', $('#editor').selectionStart, $('#editor').selectionEnd);
        break;
      case 'hr':
        insertTextAt('\n---\n', $('#editor').selectionStart, $('#editor').selectionEnd);
        break;
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

  function resetVault() {
    var diskMode = vaultMode === 'disk';
    var msg = diskMode
      ? 'Отключить папку на диске и сбросить локальное хранилище?\n\nФайлы на диске не изменятся.'
      : 'Сбросить хранилище?\n\nВсе заметки будут удалены, вернутся стартовые примеры. Сначала можно скачать резервную копию.';
    if (!confirm(msg)) return;
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
    pop.style.left = Math.round(r.right + 8) + 'px';
    pop.style.top = Math.round(Math.max(8, r.top - 6)) + 'px';
  }

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
    $('#btn-trash-clear').addEventListener('click', function () {
      if (!vault.trash.length) return;
      if (!confirm('Очистить корзину без возможности восстановления?')) return;
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

    // редактор
    $('#editor').addEventListener('input', editorInput);
    $('#editor').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var start = this.selectionStart;
        var end = this.selectionEnd;
        insertTextAt('  ', start, end);
      }
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
      $('#editor').value = note.content;
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

    // глобальные клавиши
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      var key = (e.key || '').toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        if (vaultMode === 'browser') saveLocal(); else saveDiskNow();
        return;
      }
      if (mod && key === 'n' && !e.shiftKey) { e.preventDefault(); createNote({}); return; }
      if (mod && (key === 'o' || key === 'p') && !e.shiftKey) { e.preventDefault(); openSwitcher(); return; }
      if (mod && e.shiftKey && key === 'f') { e.preventDefault(); activateTab('search'); $('#search-input').focus(); return; }
      if (mod && key === 'e' && !e.shiftKey) { e.preventDefault(); cycleView(); return; }
      if (mod && (key === '\\' || key === '|')) { e.preventDefault(); setRightPanel(!rightOpen); return; }
      if (mod && !e.shiftKey && key === 'b' && document.activeElement === $('#editor')) { e.preventDefault(); applyCmd('bold'); return; }
      if (mod && !e.shiftKey && key === 'i' && document.activeElement === $('#editor')) { e.preventDefault(); applyCmd('italic'); return; }
      if (e.key === 'Escape') {
        closeModal('#switcher-modal');
        closeModal('#graph-modal');
        closeModal('#about-modal');
        closeModal('#cloud-modal');
        closeMenu();
      }
    });

    // сохранение при закрытии
    window.addEventListener('beforeunload', function () {
      if (vault && vaultMode === 'browser') saveLocal();
    });
  }

  /* ---------- запуск ---------- */

  function boot() {
    try { applyTheme(localStorage.getItem(LS_THEME) || 'dark'); } catch (e) { applyTheme('dark'); }
    if (!loadLocal()) seedVault();
    bindUI();
    renderTree();
    renderTagsPanel();

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
