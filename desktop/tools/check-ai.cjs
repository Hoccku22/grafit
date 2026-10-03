const assert = require('node:assert/strict');
const ai = require('../app/assets/ai-core.js');
const recommended = require('../app/assets/ai-recommended.js');
const md = require('../app/assets/markdown.js');
async function main() {
  assert.equal(ai.continuation('Компьютер - это электронное устройство для обработки данных.', '', 'электронное устройство для обработки информации.'), '');
  assert.equal(ai.continuation('Компьютер - это электронное устройство для обработки данных.', '', 'электронное устройство'), '');
  assert.equal(ai.continuation('Компьютер - это электронное устройство для обработки данных.', '', 'Он также позволяет хранить файлы.'), ' Он также позволяет хранить файлы.');
  assert.equal(ai.continuation('Компьютер - это', '', 'Компьютер - это сложное устройство.'), ' сложное устройство.');
  assert.equal(ai.continuation('Компьютер - это', '', 'Компьютер — это электронное устройство.'), ' электронное устройство.');
  assert.equal(ai.continuation('Компью', '', 'Компьютер — устройство.'), 'тер — устройство.');
  assert.equal(ai.continuation('Итак', '', '.'), '.');
  assert.equal(ai.continuation('До курсора ', ' конец текста', 'новое предложение конец текста'), 'новое предложение');
  assert.equal(ai.clean('<think>hidden'), '');
  assert.equal(ai.validateStructure('Процессор выполняет команды. Бюджет 150000 рублей.', '## Процессор\n\nПроцессор выполняет команды.\n\nБюджет **150 000 рублей**.'), '## Процессор\n\nПроцессор выполняет команды.\n\nБюджет **150 000 рублей**.');
  assert.throws(() => ai.validateStructure('Процессор выполняет команды.', '## Процессор\n\nПамять хранит данные.'), /изменил содержание/);
  assert.throws(() => ai.validateStructure('Бюджет 150000 рублей.', '---\ndate: 2025-01-01\n---\nБюджет 150000 рублей.'), /изменил содержание/);
  assert.throws(() => ai.validateStructure('Бюджет 150000 рублей.', 'Бюджет 160000 рублей.'), /изменил содержание/);
  const structured = ai.buildStructured('Процессор выполняет команды. Память хранит данные.', JSON.stringify({ sections: [{ heading: 'Устройство', items: [0, 1], list: true }] }));
  assert.equal(structured, '## Устройство\n\n- Процессор выполняет команды.\n- Память хранит данные.');
  assert.throws(() => ai.buildStructured('Первое. Второе.', '{"sections":[{"heading":"План","items":[0]}]}'), /пропустил часть/);
  assert.throws(() => ai.buildStructured('Первое. Второе.', '{"sections":[{"heading":"План","items":[1,0]}]}'), /пропустил или переставил/);
  const metadata = '---\ndate: 2025-01-01\n---\nТекст.\n\n```js\nlet n=12;\n```';
  assert.equal(ai.structureParts(metadata).units.length, 2);
  assert(ai.buildStructured(metadata, '{"sections":[{"heading":"","items":[0,1]}]}').startsWith('---\ndate: 2025-01-01\n---'));
  assert.match(ai.knownFormula('Корни квадратного уравнения'), /кратности два/);
  assert.match(md.render(ai.knownFormula('Теорема Пифагора')), /class="katex/);
  assert.equal(ai.knownFormula('Теорема Пифагора в сферической геометрии'), null);
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
    const fixed = recommended.apply({ enabled: true, model: 'custom', base: 'http://remote', key: 'unused' });
    assert.equal(fixed.model, 'qwen2.5:1.5b');
    assert.equal(fixed.key, '');
    global.fetch = async (url, opts) => {
      const payload = JSON.parse(opts.body);
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      assert.equal(payload.model, 'qwen2.5:1.5b');
      assert.equal(payload.options.num_ctx, 4096);
      assert.equal(payload.think, false);
      return new Response('{"message":{"content":"ответ"}}\n{"done":true}', { headers: { 'content-type': 'application/x-ndjson' } });
    };
    assert.equal(await ai.request({ ...fixed, model: 'injected', base: 'http://remote' }, [], { onChunk: () => {} }), 'ответ');
    global.fetch = async (url, opts) => {
      assert.equal(JSON.parse(opts.body).options.num_ctx, 8192);
      return Response.json({ message: { content: 'quality' }, done: true });
    };
    assert.equal(await ai.request({ ...fixed, model: fixed.qualityModel }, [{ role: 'user', content: 'a'.repeat(5000) }], { maxTokens: 1600 }), 'quality');
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
