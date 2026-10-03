const assert = require('node:assert/strict');
const ai = require('../app/assets/ai-core.js');
const md = require('../app/assets/markdown.js');
async function main() {
  assert.equal(ai.continuation('Компьютер - это', '', 'Компьютер - это сложное устройство.'), ' сложное устройство.');
  assert.equal(ai.continuation('Компьютер - это', '', 'Компьютер — это электронное устройство.'), ' электронное устройство.');
  assert.equal(ai.continuation('Компью', '', 'Компьютер — устройство.'), 'тер — устройство.');
  assert.equal(ai.continuation('Итак', '', '.'), '.');
  assert.equal(ai.continuation('До курсора ', ' конец текста', 'новое предложение конец текста'), 'новое предложение');
  assert.equal(ai.clean('<think>hidden'), '');
  assert.match(md.render('$$\nx = \\frac{-b}{2a}\n$$'), /class="katex/);
  assert.match(md.render('Формула $x_i^2$'), /class="katex/);
  assert.doesNotMatch(md.render('`$x_i$`'), /class="katex/);
  assert.doesNotMatch(md.render('```\n$$\nx_i\n$$\n```'), /class="katex/);
  assert.doesNotMatch(md.render('$\\href{javascript:alert(1)}{x}$'), /href="javascript:/);
  const original = global.fetch, cfg = { model: 'mock', base: 'http://mock/v1' };
  try {
    const encoder = new TextEncoder(); const chunks = [];
    global.fetch = async () => new Response(new ReadableStream({ start(c) {
      const stream = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'электронное ' } }] }) + '\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: { content: 'устройство.' } }] }) + '\n\ndata: [DONE]\n\n';
      const bytes = encoder.encode(stream);
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
    assert.equal(await ai.request(cfg, [], { onChunk: t => chunks.push(t) }), 'электронное устройство.');
    assert.equal(chunks.length, 2);
    global.fetch = async () => Response.json({ choices: [{ message: { content: 'fallback' } }] });
    assert.equal(await ai.request(cfg, [], { onChunk: () => {} }), 'fallback');
    global.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] });
    await assert.rejects(ai.request(cfg, []), /обрезан/);
    global.fetch = async (url, opts) => new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (opts.signal.aborted) abort(); else opts.signal.addEventListener('abort', abort);
    });
    await assert.rejects(ai.request(cfg, [], { timeout: 10 }), /вовремя/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(ai.request(cfg, [], { signal: controller.signal }), { name: 'AbortError' });
  } finally { global.fetch = original; }
  console.log('AI_CHECK_OK');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
