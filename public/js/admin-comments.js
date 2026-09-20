// 评论收件箱的前端。
//
// 原则：
//   1. 卡片长什么样只由服务端模板 partials/comment-card.ejs 决定。动作成功后服务端返回
//      "更新后的卡片 HTML"，这里只做替换，不在浏览器里另拼一份——否则刷新前后会不一致。
//   2. 处理评论是重复劳动，所以：不刷新页面、能撤销、能用键盘、能批量。
//   3. 中文输入法组词时（isComposing / keyCode 229）不拦截任何按键。
(function () {
  'use strict';

  var root = document.querySelector('.cm-main');
  if (!root) return;

  var csrf = root.getAttribute('data-csrf');
  var tab = root.getAttribute('data-status');            // pending | approved | spam | all
  var postId = root.getAttribute('data-post') || '';     // 空 = 全站视图
  var page = parseInt(root.getAttribute('data-page'), 10) || 1;
  var totalPages = parseInt(root.getAttribute('data-total-pages'), 10) || 1;
  var list = document.getElementById('cm-list');
  var emptyBox = document.getElementById('cm-empty');
  var toast = document.getElementById('cm-toast');
  var toastText = document.getElementById('cm-toast-text');
  var toastUndo = document.getElementById('cm-toast-undo');
  var bulkBar = document.getElementById('cm-bulk');
  var bulkN = document.getElementById('cm-bulk-n');
  var selectAll = document.getElementById('cm-selectall');
  var busy = false;

  // ------------------------------------------------------------------
  // 网络
  // ------------------------------------------------------------------
  function post(url, data) {
    var body = new URLSearchParams();
    body.set('_csrf', csrf);
    Object.keys(data || {}).forEach(function (k) { body.set(k, data[k]); });
    return fetch(url, {
      method: 'POST', body: body, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || (res.status === 403 ? '页面已过期，刷新后重试' : '操作失败（' + res.status + '）'));
        return json;
      });
    });
  }

  // ------------------------------------------------------------------
  // 小工具
  // ------------------------------------------------------------------
  function cards() { return Array.prototype.slice.call(list.querySelectorAll('.cc')); }
  function fromHtml(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function stateWord(s) { return ({ pending: '待审核', approved: '已通过', spam: '垃圾' })[s]; }

  var toastTimer = null, undoFn = null;
  function showToast(text, undo) {
    toastText.textContent = text;
    undoFn = undo || null;
    toastUndo.hidden = !undo;
    toast.hidden = false;
    toast.classList.remove('err');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; undoFn = null; }, undo ? 7000 : 3500);
  }
  function showError(err) {
    toastText.textContent = (err && err.message) || '操作失败';
    undoFn = null; toastUndo.hidden = true; toast.hidden = false; toast.classList.add('err');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 5000);
  }
  toastUndo.addEventListener('click', function () { if (undoFn) { var f = undoFn; undoFn = null; toast.hidden = true; f(); } });

  // 时间：服务端给的是 UTC，这里换成读者习惯的本地相对时间；鼠标悬停看完整时间
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function localizeTimes(scope) {
    var now = new Date();
    Array.prototype.forEach.call((scope || document).querySelectorAll('time.cc-time'), function (el) {
      var d = new Date(el.getAttribute('datetime'));
      if (isNaN(d)) return;
      var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
      var diff = (now - d) / 60000, text;
      var startOfDay = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
      var days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
      if (diff < 1) text = '刚刚';
      else if (diff < 60) text = Math.floor(diff) + ' 分钟前';
      else if (days === 0) text = '今天 ' + hm;
      else if (days === 1) text = '昨天 ' + hm;
      else if (d.getFullYear() === now.getFullYear()) text = pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
      else text = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
      el.textContent = text;
      el.title = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm + ':' + pad(d.getSeconds());
    });
  }
  localizeTimes(document);

  // ------------------------------------------------------------------
  // 数字同步：标签页 / 文章栏 / 侧栏角标 / 文章卡片
  // ------------------------------------------------------------------
  function syncNumbers(json) {
    var scope = (postId && json.postId === postId && json.postCounts) ? json.postCounts : null;
    var c = scope
      ? { pending: scope.pending, approved: scope.approved, spam: scope.spam, all: scope.pending + scope.approved + scope.spam }
      : json.counts;
    if (c && (!postId || scope)) {
      ['pending', 'approved', 'spam', 'all'].forEach(function (k) {
        var el = document.querySelector('.cm-count[data-count="' + k + '"]');
        if (!el) return;
        el.textContent = c[k];
        el.classList.toggle('hot', k === 'pending' && c[k] > 0);
      });
      var nums = document.getElementById('cm-post-nums');
      if (nums && scope) nums.textContent = c.pending + ' 待审 · ' + c.approved + ' 已通过 · ' + c.spam + ' 垃圾';
    }
    // 文章栏里对应文章的数字
    if (json.postId && json.postCounts) {
      var item = document.querySelector('.cm-rail-item[data-post="' + json.postId + '"]');
      if (item) {
        var p = json.postCounts;
        item.setAttribute('data-p', p.pending); item.setAttribute('data-a', p.approved); item.setAttribute('data-s', p.spam);
        var num = item.querySelector('.cm-rail-num');
        num.textContent = '';
        if (p.pending > 0) { var b = document.createElement('b'); b.className = 'cm-pill pending'; b.textContent = p.pending; num.appendChild(b); }
        else { var s = document.createElement('span'); s.className = 'dim'; s.textContent = p.approved + p.spam; num.appendChild(s); }
      }
    }
    // 侧栏"评论"上的待审角标
    if (json.counts) {
      var link = document.querySelector('.admin-sidebar nav a[href="/admin/comments"]');
      if (link) {
        var badge = link.querySelector('.nav-badge');
        var n = json.counts.pending;
        if (n > 0) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; badge.title = '待审核'; link.appendChild(badge); }
          badge.textContent = n > 99 ? '99+' : n;
        } else if (badge) badge.remove();
      }
    }
  }

  // 列表被处理空了：显示"清空了"；如果后面还有下一页，给一个载入下一批的入口
  function refreshEmpty() {
    var any = cards().length > 0;
    emptyBox.hidden = any;
    if (any) return;
    document.getElementById('cm-empty-reload').hidden = !(page < totalPages);
    updateBulk();
  }

  // ------------------------------------------------------------------
  // 卡片替换 / 移除
  // ------------------------------------------------------------------
  function focusCard(card) { if (card) { card.focus({ preventScroll: false }); } }

  function removeCard(card) {
    var next = card.nextElementSibling || card.previousElementSibling;
    card.classList.add('leaving');
    setTimeout(function () {
      card.remove();
      refreshEmpty();
      if (next) focusCard(next);
    }, 160);
  }

  function replaceCard(card, html) {
    var fresh = fromHtml(html);
    var hadFocus = document.activeElement === card || card.contains(document.activeElement);
    card.replaceWith(fresh);
    localizeTimes(fresh);
    if (hadFocus) focusCard(fresh);
    updateBulk();
    return fresh;
  }

  // 应该出现在当前标签页里吗？（"全部"里什么都留；其他标签页只留同状态的）
  function belongsHere(status) { return tab === 'all' || tab === status; }

  // ------------------------------------------------------------------
  // 状态动作：通过 / 垃圾 / 退回待审（撤销也走这里）
  // ------------------------------------------------------------------
  function setStatus(card, status, opts) {
    opts = opts || {};
    if (busy) return;
    var id = card.getAttribute('data-id');
    var prev = card.getAttribute('data-status');
    var depth = card.getAttribute('data-depth');
    var anchor = card.nextElementSibling;
    busy = true;
    post('/admin/comments/' + id + '/status', { status: status, depth: depth }).then(function (json) {
      syncNumbers(json);
      if (belongsHere(status)) replaceCard(card, json.html);
      else removeCard(card);
      if (!opts.silent) {
        var words = { approved: '已通过', spam: '已标为垃圾', pending: '已退回待审' };
        showToast(words[status] + '　', function () { restore(id, prev, depth, anchor); });
      }
    }).catch(showError).then(function () { busy = false; });
  }

  // 撤销：把它改回原来的状态；如果它已经从当前列表消失了，按原位置插回来
  function restore(id, prev, depth, anchor) {
    post('/admin/comments/' + id + '/status', { status: prev, depth: depth }).then(function (json) {
      syncNumbers(json);
      var existing = document.getElementById('cc-' + id);
      if (existing) { replaceCard(existing, json.html); return; }
      if (!belongsHere(prev)) return;
      var fresh = fromHtml(json.html);
      if (anchor && anchor.isConnected) list.insertBefore(fresh, anchor); else list.appendChild(fresh);
      localizeTimes(fresh);
      emptyBox.hidden = true;
      focusCard(fresh);
      showToast('已撤销');
    }).catch(showError);
  }

  // ------------------------------------------------------------------
  // 删除 / 同访客批量垃圾
  // ------------------------------------------------------------------
  function deleteCard(card) {
    var isAuthorReply = card.classList.contains('is-author');
    var msg = isAuthorReply ? '删除这条你的回复？此操作不可恢复。' : '永久删除这条评论？此操作不可恢复。\n（它下面的回复会一并删除）';
    if (!window.confirm(msg)) return;
    if (busy) return;
    busy = true;
    post('/admin/comments/' + card.getAttribute('data-id') + '/delete').then(function (json) {
      syncNumbers(json);
      removeCard(card);
      if (json.replies > 0) { showToast('已删除，同时删除了 ' + json.replies + ' 条回复'); setTimeout(function () { location.reload(); }, 900); }
      else showToast('已永久删除');
    }).catch(showError).then(function () { busy = false; });
  }

  function spamVisitor(card) {
    if (!window.confirm('把这位访客所有【待审】的评论一次性标为垃圾？\n（已通过的评论不受影响）')) return;
    if (busy) return;
    busy = true;
    post('/admin/comments/' + card.getAttribute('data-id') + '/spam-visitor').then(function (json) {
      syncNumbers(json);
      showToast('已将 ' + json.n + ' 条评论标为垃圾');
      setTimeout(function () { location.reload(); }, 700);
    }).catch(showError).then(function () { busy = false; });
  }

  // ------------------------------------------------------------------
  // 回复
  // ------------------------------------------------------------------
  function closeReplies(except) {
    Array.prototype.forEach.call(list.querySelectorAll('.cc-reply:not([hidden])'), function (box) {
      if (box !== except) box.hidden = true;
    });
  }
  function openReply(card) {
    var box = card.querySelector('.cc-reply');
    if (!box) return;
    closeReplies(box);
    box.hidden = false;
    var ta = box.querySelector('textarea');
    ta.focus();
  }
  function cancelReply(card) {
    var box = card.querySelector('.cc-reply');
    if (box) box.hidden = true;
    card.focus();
  }
  function sendReply(card) {
    var box = card.querySelector('.cc-reply');
    var ta = box.querySelector('textarea');
    var text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    if (busy) return;
    busy = true;
    post('/admin/comments/' + card.getAttribute('data-id') + '/reply', { content: text, depth: card.getAttribute('data-depth') })
      .then(function (json) {
        syncNumbers(json);
        var parent = card;
        if (json.parentApproved) {
          if (belongsHere('approved')) parent = replaceCard(card, json.parentHtml);
          else removeCard(card); // 待审队列里：回复 = 处理完了
        } else {
          box.hidden = true; ta.value = '';
        }
        // 回复卡片插在上级（及其已有回复）后面，仅当当前视图里看得到已通过的评论
        if (belongsHere('approved') && parent.isConnected) {
          var fresh = fromHtml(json.html);
          var after = parent;
          while (after.nextElementSibling && after.nextElementSibling.classList.contains('is-reply')) after = after.nextElementSibling;
          after.after(fresh);
          localizeTimes(fresh);
        }
        showToast(json.parentApproved ? '已回复，原评论一并通过' : '已回复');
      }).catch(showError).then(function () { busy = false; });
  }

  // ------------------------------------------------------------------
  // 点击分发
  // ------------------------------------------------------------------
  list.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.cc');
    var act = btn.getAttribute('data-act');
    if (act === 'approve') setStatus(card, 'approved');
    else if (act === 'spam') setStatus(card, 'spam');
    else if (act === 'pending') setStatus(card, 'pending');
    else if (act === 'delete') deleteCard(card);
    else if (act === 'reply') openReply(card);
    else if (act === 'cancel-reply') cancelReply(card);
    else if (act === 'send-reply') sendReply(card);
    else if (act === 'spam-visitor') spamVisitor(card);
  });

  // 回复框里：Ctrl/⌘+Enter 发送，Esc 取消
  list.addEventListener('keydown', function (ev) {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.target.tagName !== 'TEXTAREA') return;
    var card = ev.target.closest('.cc');
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); sendReply(card); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelReply(card); }
  });

  // ------------------------------------------------------------------
  // 选择与批量
  // ------------------------------------------------------------------
  function selectedIds() {
    return cards().filter(function (c) { return c.querySelector('.cc-check').checked; })
      .map(function (c) { return c.getAttribute('data-id'); });
  }
  function updateBulk() {
    var n = selectedIds().length;
    bulkBar.hidden = n === 0;
    bulkN.textContent = '已选 ' + n + ' 条';
    cards().forEach(function (c) { c.classList.toggle('selected', c.querySelector('.cc-check').checked); });
    var all = cards().length;
    selectAll.checked = all > 0 && n === all;
    selectAll.indeterminate = n > 0 && n < all;
  }
  list.addEventListener('change', function (ev) { if (ev.target.classList.contains('cc-check')) updateBulk(); });
  selectAll.addEventListener('change', function () {
    cards().forEach(function (c) { c.querySelector('.cc-check').checked = selectAll.checked; });
    updateBulk();
  });
  bulkBar.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-bulk]');
    if (!btn) return;
    var action = btn.getAttribute('data-bulk');
    if (action === 'clear') {
      cards().forEach(function (c) { c.querySelector('.cc-check').checked = false; });
      updateBulk(); return;
    }
    var ids = selectedIds();
    if (!ids.length || busy) return;
    if (action === 'delete' && !window.confirm('永久删除选中的 ' + ids.length + ' 条评论？此操作不可恢复。\n（它们下面的回复会一并删除）')) return;
    busy = true;
    post('/admin/comments/bulk', { ids: ids.join(','), action: action }).then(function (json) {
      syncNumbers(json);
      showToast('已处理 ' + json.n + ' 条');
      setTimeout(function () { location.reload(); }, 500);
    }).catch(showError).then(function () { busy = false; });
  });

  // ------------------------------------------------------------------
  // 键盘：像处理邮件一样处理评论
  // ------------------------------------------------------------------
  function current() {
    var a = document.activeElement;
    return a && a.closest ? a.closest('.cc') : null;
  }
  function move(delta) {
    var all = cards();
    if (!all.length) return;
    var cur = current();
    var i = cur ? all.indexOf(cur) + delta : (delta > 0 ? 0 : all.length - 1);
    i = Math.max(0, Math.min(all.length - 1, i));
    focusCard(all[i]);
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    var k = ev.key.toLowerCase();
    var card = current();
    if (k === 'j') { ev.preventDefault(); move(1); }
    else if (k === 'k') { ev.preventDefault(); move(-1); }
    else if (k === 'u' && undoFn) { ev.preventDefault(); toastUndo.click(); }
    else if (card) {
      var st = card.getAttribute('data-status');
      var author = card.classList.contains('is-author');
      if (k === 'a' && st !== 'approved') { ev.preventDefault(); setStatus(card, 'approved'); }
      else if (k === 's' && st !== 'spam' && !author) { ev.preventDefault(); setStatus(card, 'spam'); }
      else if (k === 'r' && !author) { ev.preventDefault(); openReply(card); }
      else if (k === 'x') { ev.preventDefault(); var cb = card.querySelector('.cc-check'); cb.checked = !cb.checked; updateBulk(); }
    }
  });

  updateBulk();
  refreshEmpty();
})();
