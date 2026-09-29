/* =========================================================================
   markdown.js — мини-Markdown в стиле Obsidian (без зависимостей)

   Поддерживает: заголовки, **жирный**, *курсив*, ~~зачёркивание~~,
   ==выделение==, код (блоки и строчный), цитаты, списки (вложенные,
   нумерованные, чек-листы), таблицы, ссылки, изображения,
   вики-ссылки [[Заметка]] и [[Заметка|алиас]], #теги, frontmatter.

   Работает в браузере (window.MD) и в Node.js (module.exports) для тестов.
   ========================================================================= */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.MD = api;
})(function () {
  'use strict';

  var headingSeq = 0;

  /* ---------- утилиты ---------- */

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripCode(src) {
    return String(src === null || src === undefined ? '' : src)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/`[^`\n]*`/g, ' ');
  }

  /* ---------- inline ---------- */

  function renderInline(text) {
    var s = escapeHtml(text);
    var codes = [];

    // строчный код — первым, чтобы не трогать его содержимое дальше
    s = s.replace(/`([^`\n]+)`/g, function (m, c) {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    // изображения и ссылки
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      return '<img src="' + url + '" alt="' + alt + '" loading="lazy">';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });

    // вики-ссылки
    s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, function (m, target, alias) {
      var t = String(target).trim();
      var label = String(alias || target).trim();
      return '<a href="#" class="wikilink" data-note="' + t.replace(/"/g, '&quot;') + '">' + label + '</a>';
    });

    // жирный / курсив
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>');

    // зачёркивание и выделение
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // #теги
    s = s.replace(/(^|[\s(])#([\p{L}\p{N}_\/-]{1,64})/gu, function (m, pre, tag) {
      return pre + '<span class="tag" data-tag="' + tag + '">#' + tag + '</span>';
    });

    // вернуть код на место
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, k) {
      return '<code>' + codes[+k] + '</code>';
    });

    return s;
  }

  /* ---------- frontmatter ---------- */

  function renderFrontmatter(fm) {
    var rows = [];
    fm.split('\n').forEach(function (l) {
      var m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(l.trim());
      if (m) rows.push(m);
    });
    if (!rows.length) return '';
    var html = '<div class="frontmatter">';
    rows.forEach(function (m) {
      var key = m[1];
      var val = m[2];
      var vhtml;
      if (/^tags?$/i.test(key)) {
        vhtml = val.split(/[,\s]+/).filter(Boolean).map(function (t) {
          return '<span class="tag" data-tag="' + escapeHtml(t) + '">#' + escapeHtml(t) + '</span>';
        }).join(' ');
      } else {
        vhtml = renderInline(val);
      }
      html += '<div class="fm-row"><span class="fm-key">' + escapeHtml(key) + '</span><span class="fm-val">' + vhtml + '</span></div>';
    });
    return html + '</div>';
  }

  /* ---------- блоки ---------- */

  function splitRow(line) {
    var t = line.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(function (c) { return c.trim(); });
  }

  function isTableDelim(line) {
    if (line.indexOf('-') === -1) return false;
    var cells = splitRow(line);
    if (!cells.length) return false;
    return cells.every(function (c) { return /^:?-{3,}:?$/.test(c); });
  }

  function renderListNode(node) {
    var t = node.ordered ? 'ol' : 'ul';
    var h = '<' + t + '>';
    for (var k = 0; k < node.children.length; k++) {
      var ch = node.children[k];
      var task = /^\[( |x|X)\]\s+([\s\S]*)$/.exec(ch.text);
      var isDone = task && task[1].toLowerCase() === 'x';
      var inner;
      if (task) {
        inner = '<span class="task-box"><input type="checkbox" class="task-toggle"' +
          (isDone ? ' checked' : '') +
          '><span class="task-text">' + renderInline(task[2].replace(/\n/g, ' ')) + '</span></span>';
      } else {
        inner = renderInline(ch.text.replace(/\n/g, ' '));
      }
      h += '<li' + (task ? ' class="task-item' + (isDone ? ' done' : '') + '"' : '') + '>' + inner;
      if (ch.sub) h += renderListNode(ch.sub);
      h += '</li>';
    }
    return h + '</' + t + '>';
  }

  function buildList(items) {
    var base = items[0].indent;
    var root = { ordered: items[0].ordered, children: [] };
    var stack = [{ level: 0, list: root, item: null }];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var level = Math.max(0, Math.min(3, Math.round((it.indent - base) / 2)));
      while (stack.length > 1 && level < stack[stack.length - 1].level) stack.pop();
      var top = stack[stack.length - 1];
      if (level > top.level && top.item) {
        top.item.sub = { ordered: it.ordered, children: [] };
        stack.push({ level: level, list: top.item.sub, item: null });
        top = stack[stack.length - 1];
      } else if (level > top.level && !top.item) {
        level = top.level;
      }
      var node = { text: it.text, ordered: it.ordered, sub: null };
      top.list.children.push(node);
      top.item = node;
    }
    return renderListNode(root);
  }

  var RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+#.-]*)\s*$/;
  var RE_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  var RE_HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
  var RE_QUOTE = /^\s*>\s?/;
  var RE_LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

  function renderBlocks(text) {
    var lines = String(text === null || text === undefined ? '' : text).split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // блок кода
      var fence = RE_FENCE.exec(line);
      if (fence) {
        var fchar = fence[2].charAt(0) === '`' ? '`' : '~';
        var codeLines = [];
        i++;
        while (i < lines.length) {
          if (new RegExp('^\\s*' + fchar + '{3,}\\s*$').test(lines[i])) { i++; break; }
          codeLines.push(lines[i]);
          i++;
        }
        var lang = fence[3] || '';
        out.push('<div class="code-block"' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : '') + '>' +
          (lang ? '<div class="code-lang">' + escapeHtml(lang) + '</div>' : '') +
          '<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre></div>');
        continue;
      }

      // заголовок
      var h = RE_HEADING.exec(line);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + ' id="h' + (headingSeq++) + '">' + renderInline(h[2]) + '</h' + lv + '>');
        i++;
        continue;
      }

      // горизонтальная линия
      if (RE_HR.test(line)) { out.push('<hr>'); i++; continue; }

      // цитата
      if (RE_QUOTE.test(line)) {
        var qLines = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          qLines.push(lines[i].replace(RE_QUOTE, ''));
          i++;
        }
        out.push('<blockquote>' + renderBlocks(qLines.join('\n')) + '</blockquote>');
        continue;
      }

      // таблица
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
        var header = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var thtml = '<table class="md-table"><thead><tr>' + header.map(function (c) {
          return '<th>' + renderInline(c) + '</th>';
        }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
          thtml += '<tr>';
          for (var ci = 0; ci < header.length; ci++) thtml += '<td>' + renderInline(r[ci] || '') + '</td>';
          thtml += '</tr>';
        });
        thtml += '</tbody></table>';
        out.push(thtml);
        continue;
      }

      // список
      var lm = RE_LIST.exec(line);
      if (lm) {
        var items = [];
        while (i < lines.length) {
          var cur = RE_LIST.exec(lines[i]);
          if (cur) {
            items.push({ indent: cur[1].replace(/\t/g, '  ').length, ordered: /\d/.test(cur[2]), text: cur[3] });
            i++;
          } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
            items[items.length - 1].text += ' ' + lines[i].trim();
            i++;
          } else {
            break;
          }
        }
        out.push(buildList(items));
        continue;
      }

      // абзац
      var buf = [line];
      i++;
      while (i < lines.length) {
        var l = lines[i];
        if (!l.trim()) break;
        if (RE_FENCE.test(l)) break;
        if (RE_HEADING.test(l)) break;
        if (RE_HR.test(l)) break;
        if (RE_QUOTE.test(l)) break;
        if (RE_LIST.test(l)) break;
        if (l.indexOf('|') !== -1 && i + 1 < lines.length && isTableDelim(lines[i + 1])) break;
        buf.push(l);
        i++;
      }
      out.push('<p>' + buf.map(renderInline).join('<br>') + '</p>');
    }

    return out.join('\n');
  }

  /* ---------- главная функция ---------- */

  function render(src) {
    headingSeq = 0;
    var text = String(src === null || src === undefined ? '' : src).replace(/\r\n?/g, '\n');

    var html = '';
    var fm = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
    if (fm) {
      html += renderFrontmatter(fm[1]);
      text = text.slice(fm[0].length);
    }
    html += renderBlocks(text);
    return html;
  }

  /* ---------- извлечение данных (для поиска, ссылок, тегов) ---------- */

  function extractHeadings(src) {
    var text = String(src === null || src === undefined ? '' : src).replace(/\r\n?/g, '\n');
    var heads = [];
    var inFence = false;
    var fenceChar = '';
    text.split('\n').forEach(function (line) {
      var f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!inFence) { inFence = true; fenceChar = f[1].charAt(0); }
        else if (f[1].charAt(0) === fenceChar) { inFence = false; }
        return;
      }
      if (inFence) return;
      var clean = line.replace(/^(\s*>\s*)+/, '');
      var m = RE_HEADING.exec(clean);
      if (m) heads.push({ level: m[1].length, text: m[2] });
    });
    return heads;
  }

  function extractLinks(src) {
    var text = stripCode(src);
    var res = [];
    var re = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    var m;
    while ((m = re.exec(text))) {
      res.push({ target: m[1].trim(), alias: (m[2] || '').trim() });
    }
    return res;
  }

  function extractTags(src) {
    var raw = String(src === null || src === undefined ? '' : src);
    var text = stripCode(raw);
    var set = {};
    var fm = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(raw);
    if (fm) {
      var tm = /^[ \t]*tags?[ \t]*:[ \t]*(.*)$/mi.exec(fm[1]);
      if (tm) {
        tm[1].split(/[,\s]+/).forEach(function (t) { if (t) set[t] = true; });
      }
    }
    var re = /(^|[\s(])#([\p{L}\p{N}_\/-]{1,64})/gu;
    var m;
    while ((m = re.exec(text))) set[m[2]] = true;
    return Object.keys(set);
  }

  /* очищенный текст — для поиска и анонсов */
  function plain(src) {
    return String(src === null || src === undefined ? '' : src)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/~~~[\s\S]*?~~~/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, function (m, t, a) { return a || t; })
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~=<>\u0000]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, ' \n')
      .trim();
  }

  return {
    render: render,
    renderInline: renderInline,
    extractHeadings: extractHeadings,
    extractLinks: extractLinks,
    extractTags: extractTags,
    plain: plain,
    escapeHtml: escapeHtml
  };
});
