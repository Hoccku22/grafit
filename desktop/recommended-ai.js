'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { config } = require('./app/assets/ai-recommended.js');
const exec = promisify(execFile);
const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

async function verifyInstaller(file) {
  const literal = "'" + file.replace(/'/g, "''") + "'";
  const script = "$ErrorActionPreference = 'Stop'; $s = Get-AuthenticodeSignature -LiteralPath " + literal + "; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch '(^|, )O=Ollama Inc\\.(,|$)') { throw 'Invalid Ollama signature' }";
  const modules = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  try {
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 60000, env: Object.assign({}, process.env, { PSModulePath: modules })
    });
  } catch (error) { throw new Error('Не удалось подтвердить цифровую подпись установщика Ollama. Повторите настройку.'); }
}
async function runInstaller(file) {
  // Ollama's own installer uses this marker to start its app hidden after setup.
  const markerDir = path.join(process.env.LOCALAPPDATA, 'Ollama');
  await fsp.mkdir(markerDir, { recursive: true });
  await fsp.writeFile(path.join(markerDir, 'upgraded'), '');
  await new Promise((resolve, reject) => {
    const child = spawn(file, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Установка Ollama завершилась с кодом ' + code)));
  });
}
function createRecommendedManager(options) {
  const request = options.fetch || fetch;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let job = null;
  let state = { running: false, ready: false, stage: 'idle', percent: 0, message: 'Рекомендуемый ИИ ещё не настроен' };
  function report(update) {
    state = Object.assign({}, state, update);
    if (options.onProgress) options.onProgress(Object.assign({}, state));
  }
  async function downloadInstaller() {
    const dir = path.join(options.cacheDir, 'ollama-setup');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'OllamaSetup.exe');
    const verify = options.verifyInstaller || verifyInstaller;
    try { await fsp.access(file); await verify(file); return file; } catch (e) { /* download fresh */ }
    report({ stage: 'download', percent: 0, message: 'Скачиваю Ollama с официального сайта…' });
    const response = await request(INSTALLER_URL, { signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!response.ok) throw new Error('Не удалось скачать Ollama: HTTP ' + response.status);
    const total = Number(response.headers.get('content-length'));
    const partial = file + '.part';
    const output = await fsp.open(partial, 'w');
    let received = 0, lastUpdate = 0;
    try {
      for await (const chunk of response.body) {
        await output.writeFile(chunk);
        received += chunk.length;
        if (Date.now() - lastUpdate > 300) {
          lastUpdate = Date.now();
          report({ percent: total ? Math.min(99, Math.round(received / total * 100)) : 0,
            message: 'Ollama: скачано ' + Math.round(received / 1048576) + ' МБ' + (total ? ' из ' + Math.round(total / 1048576) : '') });
        }
      }
    } finally { await output.close(); }
    if (!received || (total && received !== total)) throw new Error('Загрузка установщика прервалась. Повторите настройку.');
    report({ stage: 'verify', percent: 100, message: 'Проверяю подпись установщика Ollama…' });
    await verify(partial);
    await fsp.rename(partial, file);
    return file;
  }
  async function pull(model, number) {
    report({ stage: 'models', percent: 0, message: 'Скачиваю модель ' + number + '/2: ' + model });
    const response = await request('http://127.0.0.1:11434/api/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }), signal: AbortSignal.timeout(60 * 60 * 1000)
    });
    if (!response.ok) throw new Error('Не удалось скачать модель: HTTP ' + response.status);
    let buffer = '', success = false;
    const decoder = new TextDecoder();
    function consume(line) {
      if (!line.trim()) return;
      const progress = JSON.parse(line);
      if (progress.error) throw new Error(progress.error);
      if (progress.status === 'success') success = true;
      report({ percent: progress.total ? Math.round((progress.completed || 0) / progress.total * 100) : 0,
        message: 'Модель ' + number + '/2: ' + model + (progress.total ? ' — ' + Math.round((progress.completed || 0) / progress.total * 100) + '%' : ' — ' + (progress.status || 'подготовка')) });
    }
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(consume);
    }
    buffer += decoder.decode(); consume(buffer);
    if (!success) throw new Error('Загрузка модели прервалась. Нажмите «Повторить настройку».');
  }
  async function setup() {
    report({ running: true, ready: false, error: '', stage: 'checking', percent: 0, message: 'Проверяю Ollama…' });
    try {
      if (!(await options.isUp())) {
        if (!options.findEngine()) {
          if ((options.platform || process.platform) !== 'win32') throw new Error('Автоустановка поддерживается в версии для Windows');
          const installer = await downloadInstaller();
          report({ stage: 'install', percent: 0, message: 'Устанавливаю Ollama…' });
          await (options.runInstaller || runInstaller)(installer);
          // Give Ollama's own background app time to start its server before spawning ours.
          for (let attempt = 0; attempt < 10 && !(await options.isUp()); attempt++) await sleep(1000);
        }
        report({ stage: 'starting', percent: 0, message: 'Запускаю Ollama…' });
        if (!(await options.isUp())) await options.startEngine();
        let up = false;
        for (let attempt = 0; attempt < 90; attempt++) {
          if (await options.isUp()) { up = true; break; }
          await sleep(1000);
        }
        if (!up) throw new Error('Ollama установлена, но не запустилась. Повторите настройку.');
      }
      const tags = await request('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(10000) });
      if (!tags.ok) throw new Error('Не удалось прочитать список локальных моделей');
      const models = (await tags.json()).models || [];
      const installed = new Set(models.map(model => model.name));
      for (const [index, model] of [config.model, config.qualityModel].entries()) {
        if (!installed.has(model)) await pull(model, index + 1);
      }
      // Warm only the lightweight model to keep larger models out of limited GPU memory.
      report({ stage: 'warming', percent: 100, message: 'Подготавливаю быстрые подсказки…' });
      const warm = await request('http://127.0.0.1:11434/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, prompt: 'Ответь одним словом: готово.', stream: false, keep_alive: '5m', options: { num_ctx: 4096, num_predict: 8, num_batch: 64 } }),
        signal: AbortSignal.timeout(180000)
      });
      if (!warm.ok) throw new Error('Модели скачаны, но запуск модели не удался');
      const warmed = await warm.json();
      if (warmed.error) throw new Error(warmed.error);
      report({ running: false, ready: true, stage: 'ready', percent: 100, message: 'Рекомендуемый ИИ готов: продолжение, структура и формулы' });
      return Object.assign({}, config);
    } catch (error) {
      report({ running: false, ready: false, stage: 'error', percent: 0, error: error.message, message: error.message });
      throw error;
    }
  }
  return { status: () => Object.assign({}, state), ensure: function () {
    if (!job) job = setup().finally(() => { job = null; });
    return job;
  } };
}
module.exports = { createRecommendedManager, verifyInstaller, runInstaller, config };
