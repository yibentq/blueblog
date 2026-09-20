// 后台写作编辑器。
//
// 结构（从上到下）：
//   1. 文本操作原语：replaceRange / wrap / transformLines / insertBlock
//      —— 所有改动都走 replaceRange，而它优先用 execCommand('insertText')，
//         这样浏览器自带的撤销栈（Ctrl+Z）能撤回工具栏做的每一步，而不是"整块文本被替换"后撤不回来。
//   2. COMMANDS：工具栏按钮、使用表的每一行、快捷键，全部指向这一张表，行为永远一致。
//   3. 键盘：快捷键 / 列表智能回车 / Tab 缩进 / 粘贴与拖入图片
//   4. 上传：图片列表（先上传、后选位置插入）+ 粘贴/拖入/工具栏的"边传边插入"
//   5. 预览：走服务端 /admin/preview，和发布后的渲染是同一套代码
//   6. 状态：字数统计、草稿暂存、离开提醒、专注模式、使用表/大纲抽屉
//
// 输入法注意：中文输入法组词过程中（isComposing / keyCode 229）不拦截任何按键，
// 否则回车会在"确认候选词"的同时被当成"换行续列表"，把正在打的字吃掉。
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('post-form');
    var ta = document.getElementById('content_md');
    if (!form || !ta) return;

    var titleInput = document.getElementById('title');
    var csrfInput = form.querySelector('input[name="_csrf"]');
    var csrfToken = csrfInput ? csrfInput.value : '';
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    var lastCaretPos = ta.value.length;

    // 记住最后一次光标位置：点工具栏/上传按钮时焦点已经不在 textarea 上，
    // 但用户"想插在哪"是由最后一次在正文里点过/打过字的位置决定的。
    ['click', 'keyup', 'select', 'input', 'focus'].forEach(function (evt) {
      ta.addEventListener(evt, function () { lastCaretPos = ta.selectionStart; });
    });

    // ------------------------------------------------------------------
    // 1. 文本操作原语
    // ------------------------------------------------------------------

    // 替换 [start,end) 为 text，并把选区设成 [selStart,selEnd]。
    function replaceRange(start, end, text, selStart, selEnd) {
      var before = ta.value;
      var expected = before.slice(0, start) + text + before.slice(end);
      ta.focus();
      ta.setSelectionRange(start, end);
      try {
        if (text === '') document.execCommand('delete');
        else document.execCommand('insertText', false, text);
      } catch (e) { /* 落到下面的兜底 */ }
      if (ta.value !== expected) {
        // 浏览器不支持 / 没生效：直接改值。失去撤销栈，但保证内容正确。
        ta.value = expected;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      ta.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
      lastCaretPos = ta.selectionStart;
    }

    // 在选区两侧套标记；再点一次取消（标记在选区外侧或内侧都能识别）。
    function wrap(open, close, placeholder) {
      var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
      var single = open === '*' && close === '*'; // 斜体的 * 不能和粗体的 ** 混淆
      var outsideOpen = v.slice(s - open.length, s) === open;
      var outsideClose = v.slice(e, e + close.length) === close;
      if (single && (v.charAt(s - 2) === '*' || v.charAt(e + 1) === '*')) { outsideOpen = false; }
      if (sel && outsideOpen && outsideClose) {
        replaceRange(s - open.length, e + close.length, sel, s - open.length, s - open.length + sel.length);
        return;
      }
      if (sel.length >= open.length + close.length && sel.indexOf(open) === 0 &&
          sel.slice(sel.length - close.length) === close && !(single && sel.indexOf('**') === 0)) {
        var inner = sel.slice(open.length, sel.length - close.length);
        replaceRange(s, e, inner, s, s + inner.length);
        return;
      }
      var text = sel || placeholder;
      replaceRange(s, e, open + text + close, s + open.length, s + open.length + text.length);
    }

    // 当前选区覆盖的整行范围（选区末尾恰好落在换行符之后时，不把下一行算进来）
    function lineRange() {
      var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var from = (e > s && v.charAt(e - 1) === '\n') ? e - 1 : e;
      var le = v.indexOf('\n', from);
      if (le === -1) le = v.length;
      return { ls: ls, le: le, text: v.slice(ls, le) };
    }

    function transformLines(fn) {
      var collapsed = ta.selectionStart === ta.selectionEnd;
      var r = lineRange();
      var out = fn(r.text.split('\n')).join('\n');
      var end = r.ls + out.length;
      replaceRange(r.ls, r.le, out, collapsed ? end : r.ls, end);
    }

    var LIST_MARK = /^(\s*)(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/;
    function stripListMark(line) { return line.replace(LIST_MARK, '$1'); }

    function toggleHeading(level) {
      var prefix = new Array(level + 1).join('#') + ' ';
      transformLines(function (lines) {
        var allHave = lines.every(function (l) { return !l.trim() || (l.indexOf(prefix) === 0 && l.charAt(prefix.length) !== '#'); });
        return lines.map(function (l) {
          if (!l.trim()) return l;
          var bare = l.replace(/^#{1,6}\s+/, '');
          return allHave ? bare : prefix + bare;
        });
      });
    }

    function toggleQuote() {
      transformLines(function (lines) {
        var allHave = lines.every(function (l) { return !l.trim() || /^>\s?/.test(l); });
        return lines.map(function (l) {
          if (!l.trim()) return l;
          return allHave ? l.replace(/^>\s?/, '') : '> ' + l;
        });
      });
    }

    // kind: 'ul' | 'ol' | 'task'
    function toggleList(kind) {
      var has = {
        ul: function (l) { return /^\s*[-*+]\s+(?!\[[ xX]\])/.test(l); },
        ol: function (l) { return /^\s*\d+\.\s+/.test(l); },
        task: function (l) { return /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l); },
      }[kind];
      transformLines(function (lines) {
        var body = lines.filter(function (l) { return l.trim(); });
        var allHave = body.length > 0 && body.every(has);
        var n = 0;
        return lines.map(function (l) {
          if (!l.trim()) return l;
          var bare = stripListMark(l);
          if (allHave) return bare;
          var indent = (/^\s*/.exec(bare) || [''])[0];
          var rest = bare.slice(indent.length);
          n += 1;
          if (kind === 'ol') return indent + n + '. ' + rest;
          if (kind === 'task') return indent + '- [ ] ' + rest;
          return indent + '- ' + rest;
        });
      });
    }

    // 插入一个"块"（代码块、表格、分隔线、提示框）：前后自动补空行，避免和上下文粘成一段。
    // selOffset/selLen 是块内部要选中的范围（相对块开头），方便用户接着直接改占位文字。
    function insertBlock(block, selOffset, selLen) {
      var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      var nBefore = 0; while (nBefore < 2 && v.charAt(s - 1 - nBefore) === '\n') nBefore++;
      var nAfter = 0; while (nAfter < 2 && v.charAt(e + nAfter) === '\n') nAfter++;
      var pre = s === 0 ? '' : new Array(3 - nBefore).join('\n');
      var post = e >= v.length ? '\n' : new Array(Math.max(0, 2 - nAfter) + 1).join('\n');
      var start = s + pre.length + (selOffset || 0);
      replaceRange(s, e, pre + block + post, start, start + (selLen || 0));
    }

    function selectedText() { return ta.value.slice(ta.selectionStart, ta.selectionEnd); }

    function insertCallout(tag) {
      var sel = selectedText();
      var head = '> [!' + tag + ']\n> ';
      if (sel) {
        var body = sel.split('\n').map(function (l) { return '> ' + l; }).join('\n');
        insertBlock('> [!' + tag + ']\n' + body, 0, 0);
      } else {
        insertBlock(head + '内容', head.length, 2);
      }
    }

    function insertLink(url) {
      var s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
      var label = sel || '链接文字';
      var target = url || 'https://';
      var out = '[' + label + '](' + target + ')';
      if (url) { replaceRange(s, e, out, s + out.length); return; }
      // 有选中文字：选中 https:// 方便直接粘贴网址；没有：选中"链接文字"
      if (sel) replaceRange(s, e, out, s + label.length + 3, s + label.length + 3 + target.length);
      else replaceRange(s, e, out, s + 1, s + 1 + label.length);
    }

    // ------------------------------------------------------------------
    // 2. 命令表
    // ------------------------------------------------------------------
    var COMMANDS = {
      h2: function () { toggleHeading(2); },
      h3: function () { toggleHeading(3); },
      h4: function () { toggleHeading(4); },
      bold: function () { wrap('**', '**', '粗体文字'); },
      italic: function () { wrap('*', '*', '斜体文字'); },
      strike: function () { wrap('~~', '~~', '删除线文字'); },
      mark: function () { wrap('==', '==', '高亮重点'); },
      code: function () { wrap('`', '`', '代码'); },
      ul: function () { toggleList('ul'); },
      ol: function () { toggleList('ol'); },
      task: function () { toggleList('task'); },
      quote: toggleQuote,
      note: function () { insertCallout('NOTE'); },
      tip: function () { insertCallout('TIP'); },
      warn: function () { insertCallout('WARN'); },
      important: function () { insertCallout('IMPORTANT'); },
      link: function () { insertLink(); },
      image: function () { pickImage(true); },
      codeblock: function () {
        var sel = selectedText();
        if (sel) insertBlock('```\n' + sel + '\n```', 0, 0);
        else insertBlock('```\n代码写在这里\n```', 4, 7);
      },
      table: function () {
        insertBlock('| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |', 2, 2);
      },
      hr: function () { insertBlock('---', 3, 0); },
    };

    function run(cmd) {
      var fn = COMMANDS[cmd];
      if (!fn) return;
      fn();
      scheduleStats();
    }

    // 工具栏 / 使用表里所有带 data-cmd 的元素
    document.addEventListener('mousedown', function (ev) {
      // 点按钮时不让 textarea 失焦，选区高亮才不会消失
      var t = ev.target.closest && ev.target.closest('[data-cmd]');
      if (t) ev.preventDefault();
    });
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-cmd]');
      if (!t) return;
      ev.preventDefault();
      run(t.getAttribute('data-cmd'));
      var menu = t.closest('details.tb-menu');
      if (menu) menu.removeAttribute('open');
    });
    document.addEventListener('click', function (ev) { // 点空白处收起"提示框"下拉
      document.querySelectorAll('details.tb-menu[open]').forEach(function (d) {
        if (!d.contains(ev.target)) d.removeAttribute('open');
      });
    });

    // ------------------------------------------------------------------
    // 3. 键盘、粘贴、拖入
    // ------------------------------------------------------------------
    function modKey(ev) { return isMac ? ev.metaKey : ev.ctrlKey; }

    function submitForm() {
      if (form.requestSubmit) form.requestSubmit(); else form.submit();
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.isComposing || ev.keyCode === 229) return;
      var mod = modKey(ev);

      if (ev.key === 'Escape' && document.body.classList.contains('focus-mode')) {
        toggleFocus(false); return;
      }
      if (mod && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 's') {
        ev.preventDefault(); submitForm(); return;
      }
      if (mod && !ev.altKey && ev.key === '/') {
        ev.preventDefault(); toggleDrawer(); return;
      }
      // Alt 组合键用 code 判断：Mac 上 Option+P 的 key 会变成 π 之类的字符
      if (mod && ev.altKey && ev.code === 'KeyP') { ev.preventDefault(); cycleView(); return; }
      if (mod && ev.altKey && ev.code === 'KeyF') { ev.preventDefault(); toggleFocus(); return; }

      if (document.activeElement !== ta) return;

      if (mod && !ev.altKey && !ev.shiftKey) {
        var k = ev.key.toLowerCase();
        var map = { b: 'bold', i: 'italic', k: 'link', e: 'code' };
        if (map[k]) { ev.preventDefault(); run(map[k]); return; }
      }
      if (ev.key === 'Enter' && !ev.shiftKey && !mod && !ev.altKey) smartEnter(ev);
      else if (ev.key === 'Tab' && !mod && !ev.altKey) smartTab(ev);
    });

    // 列表 / 待办 / 引用里按回车：自动续上一项；空项再按回车 = 结束列表。
    function smartEnter(ev) {
      var s = ta.selectionStart;
      if (s !== ta.selectionEnd) return;
      var v = ta.value;
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var le = v.indexOf('\n', s); if (le === -1) le = v.length;
      if (s !== le) return; // 只在行尾接管；在句子中间回车就是普通换行
      var line = v.slice(ls, le), m, prefix, content;

      if ((m = /^(\s*)([-*+])\s+\[[ xX]\]\s(.*)$/.exec(line))) { prefix = m[1] + m[2] + ' [ ] '; content = m[3]; }
      else if ((m = /^(\s*)([-*+])\s(.*)$/.exec(line))) { prefix = m[1] + m[2] + ' '; content = m[3]; }
      else if ((m = /^(\s*)(\d+)\.\s(.*)$/.exec(line))) { prefix = m[1] + (parseInt(m[2], 10) + 1) + '. '; content = m[3]; }
      else if ((m = /^(\s*(?:>\s?)+)(.*)$/.exec(line))) { prefix = /\s$/.test(m[1]) ? m[1] : m[1] + ' '; content = m[2]; }
      else return;

      ev.preventDefault();
      if (!content.trim()) { replaceRange(ls, le, '', ls); return; } // 空项：把前缀删掉，回到普通段落
      replaceRange(s, s, '\n' + prefix, s + 1 + prefix.length);
    }

    // Tab：只在列表行 / 多行选区里接管缩进；其他情况放行，键盘用户还能靠 Tab 离开输入框。
    function smartTab(ev) {
      var r = lineRange();
      var multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).indexOf('\n') !== -1;
      var onList = LIST_MARK.test(r.text);
      if (!multi && !onList) return;
      ev.preventDefault();
      var outdent = ev.shiftKey;
      var collapsed = ta.selectionStart === ta.selectionEnd;
      var caret = ta.selectionStart;
      var delta = 0;
      var lines = r.text.split('\n').map(function (l, i) {
        var mk = /^(\s*)([-*+]|\d+\.)\s/.exec(l);
        var w = mk ? mk[2].length + 1 : 2; // 子级要对齐到父级内容起点："- " 缩 2 格，"1. " 缩 3 格
        if (outdent) {
          var lead = (/^ */.exec(l) || [''])[0].length;
          var cut = Math.min(w, lead);
          if (i === 0) delta = -cut;
          return l.slice(cut);
        }
        if (i === 0) delta = w;
        return new Array(w + 1).join(' ') + l;
      });
      var out = lines.join('\n');
      if (collapsed) replaceRange(r.ls, r.le, out, Math.max(r.ls, caret + delta));
      else replaceRange(r.ls, r.le, out, r.ls, r.ls + out.length);
      scheduleStats();
    }

    ta.addEventListener('paste', function (ev) {
      var cd = ev.clipboardData;
      if (!cd) return;
      var files = Array.prototype.filter.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) {
        ev.preventDefault();
        files.forEach(function (f) { uploadFile(f, { autoInsert: true }); });
        return;
      }
      // 选中一段文字后粘贴网址 → 直接变成 [文字](网址)
      var text = (cd.getData('text/plain') || '').trim();
      if (/^https?:\/\/\S+$/.test(text) && ta.selectionStart !== ta.selectionEnd) {
        ev.preventDefault();
        insertLink(text);
      }
    });

    function hasImageFile(ev) {
      var dt = ev.dataTransfer;
      if (!dt) return false;
      if (dt.files && dt.files.length) return Array.prototype.some.call(dt.files, function (f) { return /^image\//.test(f.type); });
      return Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1;
    }
    ta.addEventListener('dragover', function (ev) { if (hasImageFile(ev)) { ev.preventDefault(); ta.classList.add('drop-hot'); } });
    ta.addEventListener('dragleave', function () { ta.classList.remove('drop-hot'); });
    ta.addEventListener('drop', function (ev) {
      ta.classList.remove('drop-hot');
      if (!hasImageFile(ev)) return;
      ev.preventDefault();
      Array.prototype.forEach.call(ev.dataTransfer.files, function (f) {
        if (/^image\//.test(f.type)) uploadFile(f, { autoInsert: true });
      });
    });

    // ------------------------------------------------------------------
    // 4. 图片上传
    // ------------------------------------------------------------------
    var fileInput = document.getElementById('image-upload-input');
    var uploadBtn = document.getElementById('image-upload-btn');
    var uploadStatus = document.getElementById('upload-status');
    var gallery = document.getElementById('image-gallery');
    var maxMb = Number(fileInput.getAttribute('data-max-mb')) || 8;
    var pickAutoInsert = false;
    var uploadSeq = 0;

    function setStatus(text, isError) {
      uploadStatus.textContent = text;
      uploadStatus.style.color = isError ? 'var(--a-danger)' : 'var(--a-text-dim)';
    }

    function insertAtCaret(snippet) {
      var pos = Math.min(lastCaretPos, ta.value.length);
      replaceRange(pos, pos, snippet, pos + snippet.length);
    }

    function pickImage(autoInsert) {
      pickAutoInsert = !!autoInsert;
      fileInput.click();
    }

    function uploadFile(file, opts) {
      opts = opts || {};
      if (!file) return;
      var maxBytes = maxMb * 1024 * 1024;
      if (file.size > maxBytes) {
        setStatus('文件太大（' + (file.size / 1024 / 1024).toFixed(1) + 'MB），最大允许 ' + maxMb + 'MB', true);
        return;
      }
      // 边传边插入时先放一个占位符——上传要几秒，这期间用户可能继续打字，
      // 等传完再按"当时的光标位置"插入就会插歪；占位符会跟着文字走，传完按占位符原地替换。
      var token = '';
      if (opts.autoInsert) {
        token = '![上传中 #' + (++uploadSeq) + '…](uploading)';
        insertAtCaret(token);
      }
      var fd = new FormData();
      fd.append('image', file, file.name || 'pasted-image.png');
      fd.append('_csrf', csrfToken);
      setStatus('上传中…', false);

      fetch('/admin/upload', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          if (!result.ok || result.data.error) throw new Error(result.data.error || '未知错误');
          addToGallery(result.data.url, result.data.name);
          if (token) {
            var at = ta.value.indexOf(token);
            var md = '![](' + result.data.url + ')';
            if (at !== -1) replaceRange(at, at + token.length, md, at + md.length);
            else insertAtCaret(md + '\n');
            setStatus('已上传并插入：' + result.data.url, false);
          } else {
            setStatus('上传成功，点下面的"插入到光标处"把它放进正文', false);
          }
          scheduleStats();
        })
        .catch(function (err) {
          if (token) {
            var at = ta.value.indexOf(token);
            if (at !== -1) replaceRange(at, at + token.length, '', at);
          }
          setStatus('上传失败：' + (err && err.message ? err.message : '检查网络连接'), true);
        });
    }

    function addToGallery(url, name) {
      var item = document.createElement('div');
      item.className = 'gallery-item';

      var thumb = document.createElement('img');
      thumb.src = url; thumb.alt = name || '';
      item.appendChild(thumb);

      var label = document.createElement('span');
      label.className = 'gallery-name mono';
      label.textContent = name || url;
      item.appendChild(label);

      var insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'btn secondary sm';
      insertBtn.textContent = '插入到光标处';
      insertBtn.addEventListener('click', function () {
        insertAtCaret('![](' + url + ')\n');
        setStatus('已插入：' + url, false);
        scheduleStats();
      });
      item.appendChild(insertBtn);

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn secondary sm';
      copyBtn.textContent = '复制链接';
      copyBtn.addEventListener('click', function () {
        navigator.clipboard.writeText(location.origin + url).then(function () { setStatus('链接已复制', false); });
      });
      item.appendChild(copyBtn);

      gallery.prepend(item);
    }

    uploadBtn.addEventListener('click', function () { pickImage(false); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      var auto = pickAutoInsert;
      pickAutoInsert = false;
      if (file) uploadFile(file, { autoInsert: auto });
      fileInput.value = '';
    });

    // ------------------------------------------------------------------
    // 5. 预览（服务端渲染，和发布后是同一套 renderMarkdown）
    // ------------------------------------------------------------------
    var stage = document.getElementById('md-stage');
    var preview = document.getElementById('md-preview');
    var pvBody = document.getElementById('pv-body');
    var pvTitle = document.getElementById('pv-title');
    var pvMinutes = document.getElementById('pv-minutes');
    var pvState = document.getElementById('pv-state');
    var viewBtns = document.querySelectorAll('[data-view]');
    var view = 'write';
    var previewTimer = null, previewCtrl = null, lastPreviewAt = 0, previewDirty = true;
    var pvScrollSource = 'editor';

    function narrow() { return window.matchMedia('(max-width: 1100px)').matches; }

    function setView(next) {
      if (next === 'split' && narrow()) next = 'preview'; // 窄屏放不下两栏
      view = next;
      stage.setAttribute('data-view', view);
      preview.hidden = view === 'write';
      Array.prototype.forEach.call(viewBtns, function (b) {
        b.classList.toggle('active', b.getAttribute('data-view') === view);
      });
      if (view !== 'write') schedulePreview(0);
      if (view !== 'preview') ta.focus();
    }
    function cycleView() {
      var order = narrow() ? ['write', 'preview'] : ['write', 'split', 'preview'];
      setView(order[(order.indexOf(view) + 1) % order.length]);
    }
    Array.prototype.forEach.call(viewBtns, function (b) {
      b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
    });

    function schedulePreview(delay) {
      previewDirty = true;
      if (view === 'write') return;
      clearTimeout(previewTimer);
      // 防抖 + 最小间隔：连续打字时不会每个字都打一次服务器
      var wait = Math.max(delay === undefined ? 450 : delay, lastPreviewAt + 900 - Date.now());
      previewTimer = setTimeout(renderPreview, Math.max(0, wait));
    }

    function renderPreview() {
      if (view === 'write' || !previewDirty) return;
      previewDirty = false;
      lastPreviewAt = Date.now();
      pvTitle.textContent = titleInput.value.trim() || '（未命名）';
      if (previewCtrl) previewCtrl.abort();
      previewCtrl = window.AbortController ? new AbortController() : null;

      var body = new URLSearchParams();
      body.set('_csrf', csrfToken);
      body.set('content_md', ta.value);
      pvState.textContent = '渲染中…';

      fetch('/admin/preview', {
        method: 'POST', body: body, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: previewCtrl ? previewCtrl.signal : undefined,
      })
        .then(function (res) {
          return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
        })
        .then(function (r) {
          if (!r.ok) {
            pvState.textContent = r.status === 429 ? '预览太频繁，稍后自动重试' : (r.data.error || '预览失败');
            if (r.status === 429) { previewDirty = true; previewTimer = setTimeout(renderPreview, 5000); }
            return;
          }
          var keepTop = pvScrollSource === 'preview' ? preview.scrollTop : null;
          pvBody.innerHTML = r.data.html; // 服务端已经过 sanitize-html 白名单净化
          pvMinutes.textContent = '约 ' + r.data.minutes + ' 分钟阅读';
          pvState.textContent = '';
          if (keepTop !== null) preview.scrollTop = keepTop; else syncScroll();
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          pvState.textContent = '预览失败——登录可能已过期，刷新页面后重试（正文有本机暂存）';
        });
    }

    // 分栏时，写作区滚到哪，预览就按比例跟到哪
    function syncScroll() {
      if (view !== 'split') return;
      var max = ta.scrollHeight - ta.clientHeight;
      var ratio = max > 0 ? ta.scrollTop / max : 0;
      preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
    }
    ta.addEventListener('scroll', function () { pvScrollSource = 'editor'; syncScroll(); });
    preview.addEventListener('wheel', function () { pvScrollSource = 'preview'; }, { passive: true });
    ta.addEventListener('mouseenter', function () { pvScrollSource = 'editor'; });
    titleInput.addEventListener('input', function () { pvTitle.textContent = titleInput.value.trim() || '（未命名）'; });

    // ------------------------------------------------------------------
    // 6. 统计 / 草稿暂存 / 离开提醒 / 专注 / 抽屉
    // ------------------------------------------------------------------
    var statCount = document.getElementById('stat-count');
    var statTime = document.getElementById('stat-time');
    var statSel = document.getElementById('stat-sel');
    var statSave = document.getElementById('stat-save');
    var statsTimer = null;

    function countText(text) {
      var cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      var words = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g) || []).length;
      return { cjk: cjk, words: words, total: cjk + words };
    }
    function updateStats() {
      var v = ta.value;
      var c = countText(v);
      statCount.textContent = c.total.toLocaleString() + ' 字';
      // 阅读时长的算法和服务端 estimateReadingMinutes 保持一致（去掉代码块，中文 300 字/分，英文 200 词/分）
      var noCode = countText(v.replace(/```[\s\S]*?```/g, ''));
      statTime.textContent = '约 ' + Math.max(1, Math.round(noCode.cjk / 300 + noCode.words / 200)) + ' 分钟阅读';
      updateSel();
    }
    function updateSel() {
      var s = ta.selectionStart, e = ta.selectionEnd;
      statSel.textContent = e > s ? '已选 ' + countText(ta.value.slice(s, e)).total + ' 字' : '';
    }
    function scheduleStats() {
      clearTimeout(statsTimer);
      statsTimer = setTimeout(updateStats, 120);
    }
    ['select', 'keyup', 'mouseup'].forEach(function (evt) { ta.addEventListener(evt, updateSel); });

    // ---- 草稿暂存（localStorage，只在这台电脑上）----
    var key = 'bb-draft:' + (form.getAttribute('data-post-key') || 'new');
    var initialTitle = titleInput.value;
    var initialContent = ta.value;
    var submitting = false;
    var saveTimer = null;

    function safeStorage(fn) { try { return fn(); } catch (e) { return null; } }
    function fmtTime(ts) {
      var d = new Date(ts);
      function p(n) { return n < 10 ? '0' + n : '' + n; }
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    function isDirty() { return ta.value !== initialContent || titleInput.value !== initialTitle; }

    function stashDraft() {
      if (!isDirty()) { safeStorage(function () { localStorage.removeItem(key); }); statSave.textContent = '未改动'; return; }
      var ts = Date.now();
      var ok = safeStorage(function () {
        localStorage.setItem(key, JSON.stringify({ t: titleInput.value, c: ta.value, ts: ts }));
        return true;
      });
      statSave.textContent = ok ? '本机已暂存 ' + fmtTime(ts) + '（还没保存到网站）' : '有未保存的改动';
    }
    function scheduleStash() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(stashDraft, 1500);
    }

    ta.addEventListener('input', function () { scheduleStats(); scheduleStash(); schedulePreview(); });
    titleInput.addEventListener('input', scheduleStash);

    // 提交成功后（页面带 ?saved=1 回来）清掉这篇的暂存；新文章是 'new' 这把钥匙，靠 sessionStorage 里的记号找到它
    form.addEventListener('submit', function () {
      submitting = true;
      safeStorage(function () { sessionStorage.setItem('bb-pending-clear', key); });
    });
    if (form.getAttribute('data-saved') === '1') {
      safeStorage(function () {
        var pending = sessionStorage.getItem('bb-pending-clear');
        if (pending) localStorage.removeItem(pending);
        localStorage.removeItem(key);
        sessionStorage.removeItem('bb-pending-clear');
      });
    } else {
      var raw = safeStorage(function () { return localStorage.getItem(key); });
      if (raw) {
        var draft = null;
        try { draft = JSON.parse(raw); } catch (e) { draft = null; }
        if (draft && (draft.c !== ta.value || draft.t !== titleInput.value)) {
          var banner = document.getElementById('draft-banner');
          document.getElementById('draft-banner-text').textContent =
            '发现一份 ' + fmtTime(draft.ts) + ' 暂存的草稿，和当前内容不一样。';
          banner.hidden = false;
          document.getElementById('draft-restore').addEventListener('click', function () {
            titleInput.value = draft.t;
            ta.value = draft.c;
            banner.hidden = true;
            updateStats(); schedulePreview(0); stashDraft();
          });
          document.getElementById('draft-discard').addEventListener('click', function () {
            safeStorage(function () { localStorage.removeItem(key); });
            banner.hidden = true;
          });
        } else {
          safeStorage(function () { localStorage.removeItem(key); });
        }
      }
    }

    window.addEventListener('beforeunload', function (ev) {
      if (!submitting && isDirty()) { ev.preventDefault(); ev.returnValue = ''; }
    });

    // ---- 专注模式 ----
    function toggleFocus(force) {
      var on = typeof force === 'boolean' ? force : !document.body.classList.contains('focus-mode');
      document.body.classList.toggle('focus-mode', on);
      document.getElementById('tb-focus').classList.toggle('active', on);
      if (on) closeDrawer();
      ta.focus();
    }
    document.getElementById('tb-focus').addEventListener('click', function () { toggleFocus(); });

    // ---- 抽屉：使用表 / 大纲 / 快捷键 ----
    var drawer = document.getElementById('md-drawer');
    function openDrawer(tab) {
      drawer.hidden = false;
      requestAnimationFrame(function () { drawer.classList.add('open'); });
      if (tab) showTab(tab);
      if (getTab() === 'outline') buildOutline();
      document.getElementById('tb-cheat').classList.add('active');
    }
    function closeDrawer() {
      drawer.classList.remove('open');
      document.getElementById('tb-cheat').classList.remove('active');
      setTimeout(function () { if (!drawer.classList.contains('open')) drawer.hidden = true; }, 180);
    }
    function toggleDrawer() { if (drawer.hidden || !drawer.classList.contains('open')) openDrawer(); else closeDrawer(); }
    document.getElementById('tb-cheat').addEventListener('click', toggleDrawer);
    document.getElementById('md-drawer-close').addEventListener('click', closeDrawer);

    function getTab() {
      var a = drawer.querySelector('.md-tab.active');
      return a ? a.getAttribute('data-tab') : 'cheat';
    }
    function showTab(name) {
      drawer.querySelectorAll('.md-tab').forEach(function (t) {
        var on = t.getAttribute('data-tab') === name;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      drawer.querySelectorAll('.md-pane').forEach(function (p) {
        p.hidden = p.getAttribute('data-pane') !== name;
      });
      if (name === 'outline') buildOutline();
    }
    drawer.querySelectorAll('.md-tab').forEach(function (t) {
      t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
    });

    // Mac 上把 Ctrl 显示成 ⌘、Alt 显示成 ⌥
    if (isMac) {
      document.querySelectorAll('kbd[data-keys]').forEach(function (k) {
        k.textContent = k.getAttribute('data-keys').replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥');
      });
    }

    // ---- 大纲 ----
    var outlineBox = document.getElementById('md-outline');
    function buildOutline() {
      var lines = ta.value.split('\n'), pos = 0, inFence = false, items = [];
      lines.forEach(function (line) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        else if (!inFence) {
          var m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
          if (m) items.push({ level: m[1].length, text: m[2], pos: pos, len: line.length });
        }
        pos += line.length + 1;
      });
      outlineBox.textContent = '';
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'cs-lead';
        empty.textContent = '正文里还没有标题。用 ## 开头写一个二级标题，这里就会出现。';
        outlineBox.appendChild(empty);
        return;
      }
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ol-item ol-l' + it.level;
        b.textContent = it.text;
        b.addEventListener('click', function () { jumpTo(it.pos, it.len); });
        outlineBox.appendChild(b);
      });
    }
    // 用一个同宽同字体的隐藏 div 量出目标位置之前的文字有多高——textarea 里折行的行数不能靠"行号 × 行高"估
    function caretTop(pos) {
      var cs = getComputedStyle(ta);
      var mirror = document.createElement('div');
      ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
        'borderLeftWidth', 'borderRightWidth', 'tabSize'].forEach(function (p) { mirror.style[p] = cs[p]; });
      mirror.style.cssText += ';position:absolute;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box;width:' + ta.clientWidth + 'px;';
      mirror.textContent = ta.value.slice(0, pos);
      document.body.appendChild(mirror);
      var h = mirror.scrollHeight;
      document.body.removeChild(mirror);
      return h;
    }
    function jumpTo(pos, len) {
      ta.focus();
      ta.setSelectionRange(pos, pos + len);
      lastCaretPos = pos;
      ta.scrollTop = Math.max(0, caretTop(pos) - 80);
    }

    // ---- 摘要：从正文取开头一段 ----
    var summaryBtn = document.getElementById('summary-gen');
    var summaryBox = document.getElementById('summary');
    if (summaryBtn && summaryBox) {
      summaryBtn.addEventListener('click', function () {
        var plain = ta.value
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+(\[[ xX]\]\s+)?/gm, '')
          .replace(/\[!(NOTE|TIP|WARN|WARNING|IMPORTANT)\]/gi, '')
          .replace(/(\*\*|__|~~|==|`)/g, '')
          .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!plain) { summaryBox.focus(); return; }
        if (summaryBox.value.trim() && !window.confirm('摘要里已经有内容，要用正文开头替换掉吗？')) return;
        var limit = 110;
        summaryBox.value = plain.length > limit ? plain.slice(0, limit).replace(/[，。、；：,.;:\s]+$/, '') + '…' : plain;
      });
    }

    // 初始化
    updateStats();
    if (isDirty()) statSave.textContent = '有未保存的改动';
    // 窄屏没有"分栏"
    if (narrow()) {
      var splitBtn = document.querySelector('.tb-split');
      if (splitBtn) splitBtn.hidden = true;
    }
  });
})();
