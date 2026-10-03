(function (root) {
  'use strict';
  function clean(text) {
    return String(text || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/\/no_think/g, '')
      .replace(/^```(?:markdown|md|latex|json)?\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim();
  }
  function continuation(before, after, reply) {
    var text = clean(reply);
    var line = before.slice(before.lastIndexOf('\n') + 1).trimStart();
    var normalizedLine = line.replace(/[-—–]/g, '-').replace(/\s+/g, ' ').toLowerCase();
    var normalizedReply = text.replace(/[-—–]/g, '-').replace(/\s+/g, ' ').toLowerCase();
    if (normalizedReply && normalizedLine.startsWith(normalizedReply)) return '';
    // Some models return the completed sentence rather than its missing suffix.
    var joinWord = false;
    var pattern = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-—–]/g, '[-—–]').replace(/\s+/g, '\\s+');
    var repeated = line && new RegExp('^' + pattern, 'i').exec(text);
    if (repeated) {
      var suffix = text.slice(repeated[0].length);
      joinWord = /[\p{L}\p{N}]$/u.test(before) && /^[\p{L}\p{N}]/u.test(suffix);
      text = suffix;
    }
    else {
      for (var n = Math.min(before.length, text.length); n >= 8; n--) {
        if (before.slice(-n).toLowerCase() === text.slice(0, n).toLowerCase()) { text = text.slice(n); break; }
      }
    }
    for (var k = Math.min(after.length, text.length); k >= 8; k--) {
      if (text.slice(-k) === after.slice(0, k)) { text = text.slice(0, -k); break; }
    }
    text = text.trim();
    if (text && before && !joinWord && !/\s$/.test(before) && !/^[.,;:!?\)\]}]/.test(text)) text = ' ' + text;
    return text;
  }
  async function request(cfg, messages, options) {
    options = options || {};
    var controller = new AbortController();
    var timedOut = false;
    var onAbort = function () { controller.abort(); };
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, options.timeout || 60000);
    var payload = { model: cfg.model, messages: messages, temperature: options.temperature == null ? 0.2 : options.temperature,
      max_tokens: options.maxTokens || 240, stream: !!options.onChunk };
    if (/qwen3/i.test(cfg.model)) {
      payload.messages = messages.map(function (m, i) { return i === messages.length - 1 ? { role: m.role, content: m.content + '\n/no_think' } : m; });
    }
    var headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers.Authorization = 'Bearer ' + cfg.key;
    try {
      var res = await fetch(String(cfg.base).replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: headers, body: JSON.stringify(payload), signal: controller.signal
      });
      if (!res.ok) throw new Error('Сервис ответил ' + res.status);
      if (!payload.stream || !/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
        var data = await res.json();
        var choice = data.choices && data.choices[0];
        if (choice && choice.finish_reason === 'length') throw new Error('Ответ обрезан моделью. Выделите меньший фрагмент.');
        var result = choice && choice.message && choice.message.content;
        if (!result) throw new Error('Пустой ответ сервиса');
        return result;
      }
      var reader = res.body.getReader(), decoder = new TextDecoder(), buffer = '', output = '';
      function consume(line) {
        if (!line.startsWith('data:')) return;
        var raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') return;
        var event = JSON.parse(raw);
        if (event.error) throw new Error(event.error.message || 'Ошибка сервиса');
        var item = event.choices && event.choices[0];
        if (item && item.finish_reason === 'length') throw new Error('Ответ обрезан моделью. Выделите меньший фрагмент.');
        var chunk = item && item.delta && item.delta.content;
        if (chunk) { output += chunk; options.onChunk(output); }
      }
      while (true) {
        var part = await reader.read();
        buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
        var lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(consume);
        if (part.done) { consume(buffer); break; }
      }
      if (!output.trim()) throw new Error('Пустой ответ сервиса');
      return output;
    } catch (e) {
      if (timedOut) throw new Error('Сервис не ответил вовремя. Попробуйте меньшую или другую модель.');
      throw e;
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    }
  }
  var api = { clean: clean, continuation: continuation, request: request };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GrafitAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
