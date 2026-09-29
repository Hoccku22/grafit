/* Графит (десктоп) — главный процесс Electron.
   - Открывает приложение (app/index.html) в нативном окне с фирменной шапкой
     (titleBarStyle hidden + системные кнопки в цветах темы).
   - Запускает локальный движок Ollama (если не запущен) и останавливает его при выходе.
   - Даёт странице нативные возможности: системный выбор папки (вместо File System Access API),
     прямые файловые операции.
   - Снимает CORS-ограничения для локального Ollama (заголовки добавляются на уровне сессии),
     так что движок не требует OLLAMA_ORIGINS.
   - Упаковывается electron-builder-ом в портативный .exe и установщик (npm run dist). */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, session, Tray, Menu, globalShortcut, screen, nativeImage, Notification } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const SMOKE = process.argv.includes('--smoke');
const QUICK_TEST = process.argv.includes('--quick-test');
const QSHOT_ARG = process.argv.find(function (a) { return a.indexOf('--quick-shot=') === 0; });
const QSHOT_PATH = QSHOT_ARG ? QSHOT_ARG.slice(QSHOT_ARG.indexOf('=') + 1) : null;
const SHOT_ARG = process.argv.find(function (a) { return a.indexOf('--shot=') === 0; });
const SHOT_PATH = SHOT_ARG ? SHOT_ARG.slice(SHOT_ARG.indexOf('=') + 1) : (SMOKE ? path.join(appRootSafe(), 'shot.png') : null);
const OUT_ARG = process.argv.find(function (a) { return a.indexOf('--smoke-out=') === 0; });
const OUT_PATH = OUT_ARG ? OUT_ARG.slice(OUT_ARG.indexOf('=') + 1) : null;
if (SMOKE || QUICK_TEST) app.disableHardwareAcceleration();

function appRootSafe() { try { return __dirname; } catch (e) { return '.'; } }

const appRoot = __dirname;

let CONFIG = {};
let CONFIG_DIR = appRoot;
let engineProc = null;
let engineStartedByUs = false;
let mainWin = null;
let tray = null;
let quickWin = null;
let isQuitting = false;
let hotkeyDisplay = '';

const CONFIG_NAME = 'grafit.config.json';
const BAR_H = 34;
const OVERLAY_DARK = { color: '#161619', symbolColor: '#a0a0aa' };
const OVERLAY_LIGHT = { color: '#f3f3f6', symbolColor: '#565662' };

/* ---------- Конфиг: рядом с exe (портативный/установленный), затем в проекте, затем в данных пользователя ---------- */

function configCandidates() {
  const list = [];
  if (process.env.GRAFIT_CONFIG) list.push(process.env.GRAFIT_CONFIG);
  if (process.env.PORTABLE_EXECUTABLE_DIR) list.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, CONFIG_NAME));
  try { if (process.execPath) list.push(path.join(path.dirname(process.execPath), CONFIG_NAME)); } catch (e) { /* dev */ }
  list.push(path.join(appRoot, CONFIG_NAME));
  try { list.push(path.join(app.getPath('userData'), 'config.json')); } catch (e) { /* ок */ }
  return list;
}

function loadConfig() {
  const files = configCandidates();
  for (const f of files) {
    try {
      if (f && fs.existsSync(f)) {
        CONFIG = JSON.parse(fs.readFileSync(f, 'utf8'));
        CONFIG_DIR = path.dirname(f);
        console.log('[config] ' + f);
        return;
      }
    } catch (e) { console.log('[config] пропущен битый конфиг: ' + f); }
  }
  CONFIG = {};
  CONFIG_DIR = appRoot;
}

function resolveCfgPath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(CONFIG_DIR, p);
}

/* ---------- Поиск движка: конфиг → рядом → вверх по дереву (../grafit-portable) → системный Ollama ---------- */

function findEngine() {
  const candidates = [];
  const cfgExe = resolveCfgPath(CONFIG.enginePath);
  if (cfgExe) candidates.push(cfgExe);
  const bases = [CONFIG_DIR];
  try { if (process.execPath) bases.push(path.dirname(process.execPath)); } catch (e) { /* ок */ }
  bases.push(appRoot);
  for (const b of bases) {
    candidates.push(path.join(b, 'engine', 'ollama.exe'));
    let p = b;
    for (let i = 0; i < 5; i++) {
      const up = path.dirname(p);
      if (!up || up === p) break;
      p = up;
      candidates.push(path.join(p, 'grafit-portable', 'desktop', 'engine', 'ollama.exe'));
    }
  }
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch (e) { /* дальше */ }
  }
  return null;
}

function resolveModelsDir(engineExe) {
  const cfgModels = resolveCfgPath(CONFIG.modelsDir);
  if (cfgModels) { try { if (fs.existsSync(cfgModels)) return cfgModels; } catch (e) { /* дальше */ } }
  const engineDir = path.dirname(engineExe);
  return path.join(path.dirname(engineDir), 'models');
}

async function isOllamaUp() {
  try {
    const r = await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function startEngine() {
  if (SMOKE || QUICK_TEST) return;
  if (await isOllamaUp()) {
    console.log('[engine] Ollama уже запущена — используем её');
    return;
  }
  const exe = findEngine();
  if (!exe) {
    console.log('[engine] движок не найден (grafit.config.json рядом с программой или системный Ollama)');
    return;
  }
  const engineDir = path.dirname(exe);
  const modelsDir = resolveModelsDir(exe);
  try { fs.mkdirSync(modelsDir, { recursive: true }); } catch (e) { /* не критично */ }
  const env = Object.assign({}, process.env, { OLLAMA_MODELS: modelsDir });
  engineProc = spawn(exe, ['serve'], { cwd: engineDir, env, windowsHide: true, stdio: 'ignore' });
  engineStartedByUs = true;
  engineProc.on('exit', function () { engineProc = null; });
  console.log('[engine] запущен: ' + exe + ' | модели: ' + modelsDir);
}

function stopEngine() {
  if (engineStartedByUs && engineProc && engineProc.pid) {
    try { spawn('taskkill', ['/pid', String(engineProc.pid), '/T', '/F'], { windowsHide: true }); } catch (e) { /* ок */ }
  }
  engineProc = null;
  engineStartedByUs = false;
}

/* ---------- Окно ---------- */

function createWindow() {
  const opts = {
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 620,
    show: !SMOKE && !QUICK_TEST,
    backgroundColor: '#1e1e21',
    title: 'Графит',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(appRoot, 'preload.js'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: ['--grafit-shell=overlay']
    }
  };
  const iconPath = path.join(appRoot, 'build', 'icon.png');
  try { if (fs.existsSync(iconPath)) opts.icon = iconPath; } catch (e) { /* без значка */ }
  if (process.platform === 'win32') {
    opts.titleBarStyle = 'hidden';
    opts.titleBarOverlay = Object.assign({ height: BAR_H }, OVERLAY_DARK);
  }
  const win = new BrowserWindow(opts);
  mainWin = win;

  // Закрытие окна прячет программу в трей (чтобы работали быстрая заметка и глобальная клавиша)
  win.on('close', function (e) {
    if (!isQuitting && !SMOKE && !QUICK_TEST) {
      e.preventDefault();
      win.hide();
      maybeTrayHint();
    }
  });

  win.loadFile(path.join(appRoot, 'app', 'index.html'));

  if (SMOKE) {
    win.webContents.once('did-finish-load', function () {
      setTimeout(async function () {
        try {
          const r = await win.webContents.executeJavaScript(
            '(function(){ return { title: document.title, desktop: !!window.__grafitDesktop, version: (window.__grafitDesktop ? window.__grafitDesktop.version : ""), picker: typeof window.showDirectoryPicker, notes: (window.__appInfo ? window.__appInfo().notes : -1), overlay: !!document.getElementById("editor-overlay"), md: (typeof window.MD === "object" && window.MD.render("# т").indexOf("<h1") !== -1), shell: !!document.getElementById("gd-titlebar"), shellMode: (window.__grafitDesktop ? window.__grafitDesktop.shell : null) }; })()'
          );
          console.log('SMOKE_RESULT ' + JSON.stringify(r));
          if (SHOT_PATH) {
            try {
              const img = await win.webContents.capturePage();
              fs.writeFileSync(SHOT_PATH, img.toPNG());
              console.log('SMOKE_SHOT ' + SHOT_PATH);
            } catch (e2) { console.log('SMOKE_SHOT_ERR ' + (e2 && e2.message)); }
          }
          try {
            const engineExe = findEngine();
            const info = { result: r, engine: engineExe, models: engineExe ? resolveModelsDir(engineExe) : null, configDir: CONFIG_DIR, packaged: app.isPackaged };
            console.log('SMOKE_INFO ' + JSON.stringify(info));
            if (OUT_PATH) { fs.writeFileSync(OUT_PATH, JSON.stringify(info, null, 2)); console.log('SMOKE_OUT ' + OUT_PATH); }
          } catch (e3) { console.log('SMOKE_INFO_ERR ' + (e3 && e3.message)); }
          const ok = !!r.title && r.title.indexOf('Графит') !== -1 && r.desktop && r.picker === 'function' && r.notes >= 1 && r.overlay && r.md && r.shell && r.shellMode === 'overlay';
          console.log(ok ? 'SMOKE_OK' : 'SMOKE_FAIL');
          app.exit(ok ? 0 : 1);
        } catch (e) {
          console.log('SMOKE_ERR ' + (e && e.message));
          app.exit(1);
        }
      }, 2200);
    });
  }
  if (QUICK_TEST) {
    win.webContents.once('did-finish-load', function () {
      setTimeout(async function () {
        const res = { steps: {} };
        try {
          res.steps.userData = app.getPath('userData');
          res.steps.tray = !!tray;
          res.steps.hotkey = hotkeyDisplay || null;
          toggleQuickNote();
          await new Promise(function (r) { setTimeout(r, 800); });
          res.steps.quickVisible = !!(quickWin && quickWin.isVisible());
          res.steps.notesBefore = await win.webContents.executeJavaScript('window.__appInfo().notes');
          await quickWin.webContents.executeJavaScript('window.__qnSet && window.__qnSet("Тест быстрой заметки\\nвторая строка мысли"); true');
          await new Promise(function (r) { setTimeout(r, 300); });
          if (QSHOT_PATH) {
            try {
              const img = await quickWin.webContents.capturePage();
              fs.writeFileSync(QSHOT_PATH, img.toPNG());
              console.log('QUICK_SHOT ' + QSHOT_PATH);
            } catch (e2) { console.log('QUICK_SHOT_ERR ' + (e2 && e2.message)); }
          }
          await quickWin.webContents.executeJavaScript('(function(){ var e = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }); (document.getElementById("qn-text") || document).dispatchEvent(e); return true; })()');
          await new Promise(function (r) { setTimeout(r, 1100); });
          res.steps.notesAfter = await win.webContents.executeJavaScript('window.__appInfo().notes');
          res.steps.saved = res.steps.notesAfter === res.steps.notesBefore + 1;
          res.steps.quickHiddenAfterSave = !!(quickWin && !quickWin.isVisible());
          res.steps.treeHasNote = await win.webContents.executeJavaScript('(function(){ return [].some.call(document.querySelectorAll("#file-tree .item-label"), function(e){ return e.textContent.indexOf("Тест быстрой заметки") !== -1; }); })()');
        } catch (e) { res.err = String(e && e.message); }
        console.log('QUICK_TEST_RESULT ' + JSON.stringify(res, null, 2));
        app.exit(res.steps && res.steps.saved ? 0 : 1);
      }, 2400);
    });
  }
  return win;
}

/* ---------- Трей, глобальная клавиша и быстрая заметка ---------- */

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) return;
  try {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  } catch (e) { /* ок */ }
}

function maybeTrayHint() {
  try {
    const flag = path.join(app.getPath('userData'), 'tray-hint.flag');
    if (fs.existsSync(flag)) return;
    fs.writeFileSync(flag, '1');
    if (Notification.isSupported && Notification.isSupported()) {
      new Notification({
        title: '«Графит» свёрнут в трей',
        body: 'Программа осталась работать. ' + (hotkeyDisplay || 'Ctrl+Alt+N') + ' — быстрая заметка из любой программы.'
      }).show();
    }
  } catch (e) { /* ок */ }
}

function createTray() {
  try {
    let img = nativeImage.createFromPath(path.join(appRoot, 'build', 'tray.png'));
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(appRoot, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    if (img.isEmpty()) { console.log('[tray] нет значка — трей пропущен'); return; }
    tray = new Tray(img);
    tray.setToolTip('Графит · быстрая заметка: ' + (hotkeyDisplay || 'Ctrl+Alt+N'));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Быстрая заметка', click: function () { toggleQuickNote(); } },
      { label: 'Открыть «Графит»', click: function () { showMain(); } },
      { type: 'separator' },
      { label: 'Выход', click: function () { isQuitting = true; app.quit(); } }
    ]));
    tray.on('click', function () { showMain(); });
    console.log('[tray] создан');
  } catch (e) { console.log('[tray] ошибка: ' + (e && e.message)); }
}

function registerHotkey() {
  const wanted = String(CONFIG.hotkey || 'Control+Alt+N');
  const candidates = [wanted, 'Control+Alt+N', 'Control+Alt+Space'];
  for (const c of candidates) {
    try {
      if (globalShortcut.register(c, function () { toggleQuickNote(); })) {
        hotkeyDisplay = c.replace('Control', 'Ctrl').replace('CommandOrControl', 'Ctrl');
        console.log('[hotkey] зарегистрирован: ' + hotkeyDisplay);
        return true;
      }
    } catch (e) { /* пробуем следующий */ }
  }
  console.log('[hotkey] не удалось зарегистрировать');
  return false;
}

function createQuickWindow() {
  const opts = {
    width: 470,
    height: 244,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#161619',
    title: 'Быстрая заметка',
    webPreferences: {
      preload: path.join(appRoot, 'preload.js'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: ['--grafit-quick=1']
    }
  };
  quickWin = new BrowserWindow(opts);
  try { quickWin.setAlwaysOnTop(true, 'screen-saver'); } catch (e) { /* ок */ }
  quickWin.loadFile(path.join(appRoot, 'app', 'quick.html'));
  quickWin.on('close', function (e) {
    if (!isQuitting) { e.preventDefault(); quickWin.hide(); }
  });
  console.log('[quick] окно создано');
}

function toggleQuickNote() {
  if (!quickWin || quickWin.isDestroyed()) createQuickWindow();
  if (quickWin.isVisible()) { quickWin.hide(); return; }
  try {
    const pt = screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(pt).workArea;
    const b = quickWin.getBounds();
    quickWin.setPosition(
      Math.round(wa.x + (wa.width - b.width) / 2),
      Math.round(wa.y + (wa.height - b.height) / 2 - wa.height * 0.10)
    );
  } catch (e) { try { quickWin.center(); } catch (e2) { /* ок */ } }
  quickWin.show();
  quickWin.focus();
  quickWin.webContents.executeJavaScript('window.__qnFocus && window.__qnFocus(); true').catch(function () { /* ок */ });
}

async function quickSave(text) {
  text = String(text || '');
  if (!text.trim()) return { ok: false, err: 'пустая заметка' };
  if (!mainWin || mainWin.isDestroyed()) return { ok: false, err: 'нет главного окна' };
  try {
    const res = await mainWin.webContents.executeJavaScript(
      '(window.__grafitQuickNote ? window.__grafitQuickNote(' + JSON.stringify(text) + ') : { ok: false, err: "Графит ещё загружается" })'
    );
    return (res && typeof res === 'object') ? res : { ok: false, err: 'bad-result' };
  } catch (e) { return { ok: false, err: String(e && e.message) }; }
}

/* Цвет системных кнопок окна следует за темой приложения */
ipcMain.on('shell:theme', function (ev, theme) {
  if (!mainWin || process.platform !== 'win32') return;
  try {
    if (typeof mainWin.setTitleBarOverlay === 'function') {
      mainWin.setTitleBarOverlay(Object.assign({ height: BAR_H }, theme === 'light' ? OVERLAY_LIGHT : OVERLAY_DARK));
    }
  } catch (e) { /* не критично */ }
});

/* Защита от двух окон: второй запуск показывает уже открытое окно.
   (Две копии, работающие с одним хранилищем, могли бы затирать правки друг друга.) */
const gotSingleLock = (SMOKE || QUICK_TEST) ? true : app.requestSingleInstanceLock();
if (!gotSingleLock) {
  app.quit();
} else if (!SMOKE && !QUICK_TEST) {
  app.on('second-instance', function () {
    showMain();
  });
}

app.whenReady().then(async function () {
  if (!gotSingleLock) return;
  try { app.setAppUserModelId('ru.grafit.desktop'); } catch (e) { /* ок */ }
  loadConfig();

  // Локальный Ollama: добавляем CORS-заголовки, чтобы интерфейс мог к нему обращаться
  try {
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['http://127.0.0.1:11434/*', 'http://localhost:11434/*'] },
      function (details, cb) {
        const headers = Object.assign({}, details.responseHeaders);
        headers['Access-Control-Allow-Origin'] = ['*'];
        headers['Access-Control-Allow-Methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
        headers['Access-Control-Allow-Headers'] = ['Authorization, Content-Type'];
        cb({ responseHeaders: headers });
      }
    );
  } catch (e) { console.log('[cors] ' + e.message); }

  // Нативные файловые операции (используются preload-шимом вместо File System Access API)
  ipcMain.handle('fs:list', async function (ev, dir) {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    return items.map(function (it) { return { name: it.name, isDir: it.isDirectory() }; });
  });
  ipcMain.handle('fs:readfile', async function (ev, p) {
    const st = await fsp.stat(p);
    const content = await fsp.readFile(p, 'utf8');
    return { content: content, mtime: st.mtimeMs, size: st.size };
  });
  ipcMain.handle('fs:writefile', async function (ev, p, data) {
    await fsp.writeFile(p, String(data), 'utf8');
    return true;
  });
  ipcMain.handle('fs:mkdir', async function (ev, p) {
    await fsp.mkdir(p, { recursive: true });
    return true;
  });
  ipcMain.handle('fs:touch', async function (ev, p) {
    if (!fs.existsSync(p)) await fsp.writeFile(p, '', 'utf8');
    return true;
  });
  ipcMain.handle('fs:remove', async function (ev, p) {
    await fsp.rm(p, { recursive: true, force: true });
    return true;
  });
  ipcMain.handle('fs:exists', async function (ev, p) {
    return fs.existsSync(p);
  });
  ipcMain.handle('dlg:pickFolder', async function () {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Выберите папку хранилища' });
    return (r.canceled || !r.filePaths.length) ? null : r.filePaths[0];
  });
  ipcMain.handle('engine:status', async function () {
    return { up: await isOllamaUp(), path: findEngine() };
  });
  ipcMain.handle('engine:restart', async function () {
    stopEngine();
    await new Promise(function (r) { setTimeout(r, 700); });
    await startEngine();
    return { up: await isOllamaUp() };
  });

  // Быстрая заметка: мостики мини-окна
  ipcMain.handle('qn:save', async function (ev, text) { return await quickSave(text); });
  ipcMain.handle('qn:hide', function () { if (quickWin && !quickWin.isDestroyed()) quickWin.hide(); });
  ipcMain.handle('qn:info', function () { return { hotkey: hotkeyDisplay, packaged: app.isPackaged }; });

  await startEngine();
  createWindow();
  if (!SMOKE) {
    createTray();
    registerHotkey();
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', function () {
  try { globalShortcut.unregisterAll(); } catch (e) { /* ок */ }
});
app.on('before-quit', function () {
  isQuitting = true;
  stopEngine();
});
app.on('window-all-closed', function () {
  // Обычное закрытие окна прячет его в трей; полный выход — через трей или завершение системы.
  if (isQuitting || SMOKE || QUICK_TEST) {
    stopEngine();
    app.quit();
  }
});
