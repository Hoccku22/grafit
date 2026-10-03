'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecommendedManager, config } = require('../recommended-ai.js');
async function main() {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grafit-setup-check-'));
  let running = false, installed = false, downloads = 0, installs = 0, verified = 0, pulls = [];
  const progress = [];
  const options = { platform: 'win32', cacheDir, sleep: async () => {}, findEngine: () => installed,
    isUp: async () => running, startEngine: async () => { running = true; },
    onProgress: state => progress.push(state),
    verifyInstaller: async file => { assert.equal(fs.readFileSync(file, 'utf8'), 'signed-test'); verified++; },
    runInstaller: async () => { installs++; installed = true; },
    fetch: async (url, opts) => {
      if (url.startsWith('https://ollama.com/')) { downloads++; return new Response('signed-test', { headers: { 'content-length': '11' } }); }
      if (url.endsWith('/api/tags')) return Response.json({ models: [] });
      if (url.endsWith('/api/pull')) {
        pulls.push(JSON.parse(opts.body).model);
        return new Response('{"status":"downloading","total":100,"completed":50}\n{"status":"success"}');
      }
      if (url.endsWith('/api/generate')) return Response.json({ done: true });
      throw new Error('Unexpected URL');
    }
  };
  const manager = createRecommendedManager(options);
  const first = manager.ensure(), second = manager.ensure();
  assert.equal(first, second, 'simultaneous clicks must share setup');
  assert.deepEqual(await first, config);
  assert.equal(downloads, 1); assert.equal(installs, 1); assert.equal(verified, 1);
  assert.deepEqual(pulls, [config.model, config.qualityModel]);
  assert.equal(manager.status().ready, true);
  assert(progress.some(s => s.stage === 'install'));
  const existing = createRecommendedManager({ ...options, fetch: async url => {
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: config.model }, { name: config.qualityModel }, { name: 'my-own-model' }] });
    if (url.endsWith('/api/generate')) return Response.json({ done: true });
    throw new Error('Existing models must not download again');
  } });
  await existing.ensure();
  let fail = true;
  const retry = createRecommendedManager({ ...options, fetch: async (url, opts) => {
    if (url.endsWith('/api/pull') && fail) { fail = false; return new Response('{"error":"network failed"}'); }
    return options.fetch(url, opts);
  } });
  await assert.rejects(retry.ensure(), /network failed/);
  assert.equal(retry.status().running, false);
  await retry.ensure(); assert.equal(retry.status().ready, true);
  running = false; installed = false;
  const invalid = createRecommendedManager({ ...options, verifyInstaller: async () => { throw new Error('Invalid signature'); } });
  await assert.rejects(invalid.ensure(), /Invalid signature/);
  assert.equal(installs, 1, 'unverified installer must never execute');
  console.log('RECOMMENDED_CHECK_OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
