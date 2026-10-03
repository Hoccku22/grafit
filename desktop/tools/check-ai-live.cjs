'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const recommended = require('../app/assets/ai-recommended.js');
const ai = require('../app/assets/ai-core.js');
const md = require('../app/assets/markdown.js');
const code = fs.readFileSync(path.join(__dirname, '../app/assets/app.js'), 'utf8');
function instruction(prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const literal = new RegExp("'(" + escaped + "[^']*)'").exec(code);
  if (!literal) throw new Error('Missing instruction: ' + prefix);
  return literal[1];
}
async function main() {
  const cases = [
    { task: 'continue-computer', before: 'Компьютер - это', model: recommended.config.qualityModel,
      system: instruction('Ты дополняешь текст'), user: 'Заметка «Информатика» (фрагмент до курсора):\n\nКомпьютер - это[КУРСОР]', check: text => {
        const suffix = ai.continuation('Компьютер - это', '', text);
        assert(suffix.trim().length > 15, 'nonempty definition');
        assert(!/компьютер\s*[-—–]\s*это/i.test(suffix), 'no repeated definition prefix');
        return 'Компьютер - это' + suffix;
      } },
    { task: 'continue-photosynthesis', before: 'Фотосинтез — это', model: recommended.config.qualityModel,
      system: instruction('Ты дополняешь текст'), user: 'Заметка «Биология» (фрагмент до курсора):\n\nФотосинтез — это[КУРСОР]', check: text => {
        const suffix = ai.continuation('Фотосинтез — это', '', text); assert(suffix.trim().length > 15);
        assert(!/фотосинтез\s*[-—–]\s*это/i.test(suffix)); return 'Фотосинтез — это' + suffix;
      } },
    { task: 'structure', model: recommended.config.qualityModel,
      system: instruction('Структурируй конспект'),
      user: 'Компьютер обрабатывает данные. Процессор выполняет команды. Оперативная память временно хранит данные. Постоянная память хранит данные после выключения. В нашей лаборатории 12 компьютеров и 3 принтера. Бюджет лаборатории 150000 рублей.',
      check: text => { ai.validateStructure('Компьютер обрабатывает данные. Процессор выполняет команды. Оперативная память временно хранит данные. Постоянная память хранит данные после выключения. В нашей лаборатории 12 компьютеров и 3 принтера. Бюджет лаборатории 150000 рублей.', text); assert(/^#{1,6}\s/m.test(text)); return text; } },
    { task: 'formula-pythagoras', model: recommended.config.qualityModel,
      system: instruction('По названию запиши математическую формулу'), user: 'Теорема Пифагора',
      check: text => { assert(text.includes('$$')); assert(/a\s*\^\s*\{?2/.test(text)); assert(/b\s*\^\s*\{?2/.test(text)); assert(/c\s*\^\s*\{?2/.test(text)); assert(/прямоугольн/i.test(text)); assert.match(md.render(text), /class="katex/); return text; } },
    { task: 'formula-quadratic', model: recommended.config.qualityModel,
      system: instruction('По названию запиши математическую формулу'), user: 'Корни квадратного уравнения',
      check: text => { assert(text.includes('$$')); assert(/sqrt/.test(text) && /4\s*a\s*c/.test(text)); assert(/2\s*a/.test(text)); assert(/ne(?:q)?\s*0|не рав.*нул|≠\s*0/.test(text)); assert(/кратности два/.test(text)); assert.match(md.render(text), /class="katex/); return text; } },
    { task: 'formula-sine-area', model: recommended.config.qualityModel,
      system: instruction('По названию запиши математическую формулу'), user: 'Площадь треугольника через две стороны и угол между ними',
      check: text => { assert(/sin/.test(text)); assert(/frac\s*\{1\}\s*\{2\}|frac\s*\{[^}]*ab[^}]*\}\s*\{2\}|0[.,]5/.test(text)); assert.match(md.render(text), /class="katex/); return text; } }
  ];
  const results = [];
  for (const item of cases.filter(item => !process.argv.includes('--fast') || item.before)) {
    const started = performance.now(); let first = null;
    const messages = item.task === 'structure' ? ai.structureMessages(item.user) : [
      { role: 'system', content: item.system }, { role: 'user', content: item.user }
    ];
    const known = item.task.startsWith('formula-') ? ai.knownFormula(item.user) : null;
    const output = known || await ai.request({ ...recommended.config, model: item.model }, messages,
      { maxTokens: item.before ? 220 : item.task === 'structure' ? 1200 : 900, onChunk: () => { if (first == null) first = performance.now() - started; } });
    const text = item.task === 'structure' ? ai.buildStructured(item.user, output) : ai.clean(output), result = { task: item.task, model: known ? 'built-in formula catalog' : item.model,
      firstTokenMs: Math.round(first || 0), totalMs: Math.round(performance.now() - started), raw: text, passed: true };
    try { result.result = item.check(text); } catch (error) { result.passed = false; result.error = error.message; }
    results.push(result); console.log(JSON.stringify(result));
  }
  if (process.env.GRAFIT_AI_REPORT) fs.writeFileSync(process.env.GRAFIT_AI_REPORT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  if (results.some(result => !result.passed)) throw new Error('LIVE_AI_CHECK_FAILED');
  console.log('LIVE_AI_CHECK_OK');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
