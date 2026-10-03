/* Графит: движок редактора на CodeMirror 6.
   Требует codemirror.bundle.js (window.__CM). Даёт window.GrafitEditor.create(). */
(function () {
  'use strict';
  var CM = window.__CM;
  if (!CM) { console.error('[GrafitEditor] бандл CodeMirror не загружен'); return; }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- призрачная подсказка ---------- */

  function GhostWidget(text) { this.text = text; }
  GhostWidget.prototype = Object.create(CM.WidgetType.prototype);
  GhostWidget.prototype.constructor = GhostWidget;
  GhostWidget.prototype.toDOM = function () {
    var el = document.createElement('span');
    el.className = 'cm-ghost';
    el.textContent = this.text;
    return el;
  };
  GhostWidget.prototype.eq = function (other) { return other.text === this.text; };
  GhostWidget.prototype.ignoreEvent = function () { return false; };

  var ghostEffect = CM.StateEffect.define();
  var ghostField = CM.StateField.define({
    create: function () { return null; },
    update: function (val, tr) {
      var next = val;
      tr.effects.forEach(function (e) { if (e.is(ghostEffect)) next = e.value; });
      if (tr.docChanged) next = null;
      return next;
    },
    provide: function (f) {
      return CM.EditorView.decorations.from(f, function (v) {
        if (!v || !v.text) return CM.Decoration.none;
        var b = new CM.RangeSetBuilder();
        b.add(v.pos, v.pos, CM.Decoration.widget({ widget: new GhostWidget(v.text), side: 1 }));
        return b.finish();
      });
    }
  });

  /* ---------- метки подсказок ИИ ---------- */

  var marksEffect = CM.StateEffect.define();
  var marksField = CM.StateField.define({
    create: function () { return CM.Decoration.none; },
    update: function (val, tr) {
      tr.effects.forEach(function (e) {
        if (e.is(marksEffect)) {
          var b = new CM.RangeSetBuilder();
          (e.value || []).forEach(function (r) {
            if (r.to > r.from) b.add(r.from, r.to, CM.Decoration.mark({ class: 'ai-deco ' + (r.cls || '') }));
          });
          val = b.finish();
        }
      });
      if (tr.docChanged) val = val.map(tr.changes);
      return val;
    },
    provide: function (f) { return CM.EditorView.decorations.from(f); }
  });

  /* ---------- сворачивание по заголовкам ---------- */

  var headingFold = CM.foldService.of(function (state, lineStart) {
    var line = state.doc.lineAt(lineStart);
    var m = /^(#{1,6})\s/.exec(line.text);
    if (!m) return null;
    var level = m[1].length;
    var l = line.number + 1;
    var end = line.to;
    while (l <= state.doc.lines) {
      var ln = state.doc.line(l);
      var mm = /^(#{1,6})\s/.exec(ln.text);
      if (mm && mm[1].length <= level) break;
      end = ln.to;
      l++;
    }
    if (end <= line.to) return null;
    return { from: line.to, to: end };
  });

  /* ---------- стили ---------- */

  var hlStyle = CM.HighlightStyle.define([
    { tag: CM.t.heading1, color: 'var(--accent)', fontWeight: '700' },
    { tag: CM.t.heading2, color: 'var(--accent)', fontWeight: '650' },
    { tag: [CM.t.heading3, CM.t.heading4, CM.t.heading5, CM.t.heading6], color: 'var(--accent)', fontWeight: '600' },
    { tag: CM.t.strong, fontWeight: '700' },
    { tag: CM.t.emphasis, fontStyle: 'italic' },
    { tag: CM.t.strikethrough, textDecoration: 'line-through' },
    { tag: CM.t.monospace, fontFamily: 'var(--font-mono)', background: 'var(--bg-soft)', borderRadius: '4px' },
    { tag: CM.t.link, color: 'var(--accent)', textDecoration: 'underline' },
    { tag: CM.t.url, color: 'var(--muted)' },
    { tag: CM.t.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
    { tag: CM.t.punctuation, color: 'var(--muted)' }
  ]);

  var themeBase = {
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65', overflow: 'auto' },
    '.cm-content': { padding: '18px 22px 80px', caretColor: 'var(--accent)', minHeight: '100%' },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-selectionBackground': { backgroundColor: 'rgba(139,123,247,0.22)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(139,123,247,0.26)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none' },
    '.cm-gutterElement': { fontFamily: 'var(--font-mono)', fontSize: '11.5px' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '30px' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 4px 0 0', color: 'var(--muted)' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-dim)' },
    '.cm-ghost': { color: 'rgba(163,160,180,0.72)', whiteSpace: 'pre-wrap' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-soft)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '0 6px', borderRadius: '6px' },
    '.cm-tooltip': { border: '1px solid var(--border)', backgroundColor: 'var(--panel-2)', color: 'var(--text)' }
  };

  /* ---------- создание ---------- */

  function create(container, opts) {
    opts = opts || {};
    var silentSet = false;

    // Жёсткие переопределения стилей (перекрывают дефолты CodeMirror при любом порядке стилей)
    try {
      if (!document.getElementById('cm-grafit-overrides')) {
        var st = document.createElement('style');
        st.id = 'cm-grafit-overrides';
        st.textContent = [
          '.cm-editor .cm-selectionBackground { background-color: rgba(139, 123, 247, 0.18) !important; }',
          '.cm-editor.cm-focused .cm-selectionBackground { background-color: rgba(139, 123, 247, 0.22) !important; }',
          '.cm-editor .cm-content ::selection { background-color: transparent !important; }',
          '.cm-editor .cm-content::selection { background-color: transparent !important; }',
          '.cm-editor .cm-ghost { color: rgba(163, 160, 180, 0.72) !important; }'
        ].join('\n');
        document.head.appendChild(st);
      }
    } catch (e) { /* ок */ }

    var updateListener = CM.EditorView.updateListener.of(function (u) {
      if (u.docChanged && !silentSet && opts.onChange) opts.onChange(u.state.doc.toString());
      if ((u.selectionSet || u.docChanged) && opts.onSelection) {
        opts.onSelection(u.state.selection.main.head);
      }
    });

    var enterKey = { key: 'Enter', run: CM.insertNewlineContinueMarkup };
    var backspaceKey = { key: 'Backspace', run: CM.deleteMarkupBackward };
    var tabKey = { key: 'Tab', run: function (view) {
      var g = view.state.field(ghostField, false);
      if (g) { if (opts.onGhostAccept) opts.onGhostAccept(); return true; }
      view.dispatch(view.state.replaceSelection('  '));
      return true;
    } };
    var escKey = { key: 'Escape', run: function (view) {
      var g = view.state.field(ghostField, false);
      if (g) {
        view.dispatch({ effects: ghostEffect.of(null) });
        if (opts.onGhostDismiss) opts.onGhostDismiss();
        return true;
      }
      return false;
    } };
    var continueKey = { key: 'Ctrl-Space', run: function () {
      if (opts.onGhostRequest) { opts.onGhostRequest(); return true; }
      return false;
    } };
    var lastAltTap = 0;
    // Двойное нажатие Alt: слушаем честные DOM-события, потому что в keymap CodeMirror
    // одиночный Alt как клавиша не матчится (модификатор меняет имя события).
    function isAltPress(e) {
      return e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight' || e.keyCode === 18;
    }
    function onAltKeyDown(e) {
      if (!isAltPress(e)) { lastAltTap = 0; return; }
      if (e.repeat) return;
      var active = document.activeElement;
      var tag = (active && active.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { lastAltTap = 0; return; }
      var now = Date.now();
      if (now - lastAltTap < 600) {
        lastAltTap = 0;
        if (opts.onGhostRequest) opts.onGhostRequest();
      } else {
        lastAltTap = now;
      }
    }
    function onAltReset() { lastAltTap = 0; }

    var extensions = [
      CM.highlightSpecialChars(),
      CM.history(),
      CM.drawSelection(),
      CM.dropCursor(),
      CM.indentOnInput(),
      CM.bracketMatching(),
      CM.lineNumbers(),
      CM.foldGutter(),
      headingFold,
      CM.markdown(),
      CM.syntaxHighlighting(hlStyle),
      CM.EditorView.lineWrapping,
      CM.EditorView.theme(themeBase),
      CM.EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Редактор заметки' }),
      ghostField,
      marksField,
      updateListener,
      CM.Prec.highest(CM.keymap.of([enterKey, backspaceKey, tabKey, escKey, continueKey])),
      CM.keymap.of([CM.indentWithTab]),
      CM.keymap.of(CM.historyKeymap),
      CM.keymap.of(CM.defaultKeymap),
      CM.keymap.of(CM.foldKeymap)
    ];
    if (opts.placeholder) extensions.push(CM.placeholder(opts.placeholder));

    var state = CM.EditorState.create({
      doc: opts.text || '',
      extensions: extensions
    });
    var view = new CM.EditorView({ state: state, parent: container });
    window.addEventListener('keydown', onAltKeyDown, true);
    window.addEventListener('blur', onAltReset);

    if (opts.onScroll) {
      view.scrollDOM.addEventListener('scroll', function () { opts.onScroll(); }, { passive: true });
    }

    return {
      view: view,
      getValue: function () { return view.state.doc.toString(); },
      setValue: function (text) {
        silentSet = true;
        try {
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(text == null ? '' : text) } });
          view.scrollDOM.scrollTop = 0;
        } finally { silentSet = false; }
      },
      focus: function () { view.focus(); },
      hasFocus: function () { return view.hasFocus; },
      getSel: function () { var m = view.state.selection.main; return { from: m.from, to: m.to }; },
      setSel: function (from, to) { view.dispatch({ selection: { anchor: from, head: to == null ? from : to } }); },
      insertAt: function (text, from, to) {
        from = clamp(from || 0, 0, view.state.doc.length);
        to = (to == null) ? from : clamp(to, from, view.state.doc.length);
        view.dispatch({ changes: { from: from, to: to, insert: String(text) }, selection: { anchor: from + String(text).length }, userEvent: 'input.ai' });
        view.focus();
      },
      insert: function (text) {
        view.dispatch(view.state.replaceSelection(String(text)));
        view.focus();
      },
      replaceRange: function (from, to, text) {
        from = clamp(from || 0, 0, view.state.doc.length);
        to = clamp(to || from, from, view.state.doc.length);
        view.dispatch({ changes: { from: from, to: to, insert: String(text) }, userEvent: 'input.ai' });
      },
      wrapSel: function (pre, post, ph) {
        var m = view.state.selection.main;
        var sel = view.state.sliceDoc(m.from, m.to);
        var inner = sel || ph || '';
        view.dispatch({
          changes: { from: m.from, to: m.to, insert: pre + inner + post },
          selection: { anchor: m.from + pre.length, head: m.from + pre.length + inner.length }
        });
        view.focus();
      },
      linePrefix: function (prefix) {
        var m = view.state.selection.main;
        var doc = view.state.doc;
        var a = doc.lineAt(m.from), b = doc.lineAt(m.to);
        var lines = [];
        for (var l = a.number; l <= b.number; l++) lines.push(doc.line(l));
        var allPrefixed = lines.every(function (ln) { return !ln.text.trim() || ln.text.indexOf(prefix) === 0; });
        var out = lines.map(function (ln) {
          if (!ln.text.trim()) return ln.text;
          return allPrefixed ? (ln.text.indexOf(prefix) === 0 ? ln.text.slice(prefix.length) : ln.text) : prefix + ln.text;
        }).join('\n');
        view.dispatch({ changes: { from: a.from, to: b.to, insert: out } });
        view.focus();
      },
      coordsAtPos: function (pos) {
        try { return view.coordsAtPos(clamp(pos, 0, view.state.doc.length)); } catch (e) { return null; }
      },
      showGhost: function (text, pos) {
        if (pos == null) pos = view.state.selection.main.head;
        pos = clamp(pos, 0, view.state.doc.length);
        view.dispatch({ effects: ghostEffect.of({ pos: pos, text: String(text) }) });
      },
      hideGhost: function () { view.dispatch({ effects: ghostEffect.of(null) }); },
      hasGhost: function () { return !!view.state.field(ghostField, false); },
      setMarks: function (list) { view.dispatch({ effects: marksEffect.of(list || []) }); },
      scrollToPos: function (pos) {
        view.dispatch({ effects: CM.EditorView.scrollIntoView(clamp(pos, 0, view.state.doc.length), { y: 'center' }) });
      },
      length: function () { return view.state.doc.length; }
    };
  }

  window.GrafitEditor = { create: create, available: true };
})();
