(function () {
  'use strict';

  // ---- 桌面宽度渐进增强的总闸门 ----
  // 断点和 style.css 里全站唯一的移动端断点（max-width:640px）保持一致，不另起一个数字。
  var mq = window.matchMedia('(min-width: 641px)');

  var plainList = document.getElementById('plain-post-list');
  var book = document.getElementById('notebook-book');
  if (!plainList || !book) return; // 不是首页第1页（notebookEnabled=false）时这两个元素不存在

  var booted = false;

  function applyMode() {
    if (mq.matches) {
      plainList.setAttribute('hidden', '');
      book.removeAttribute('hidden');
      if (!booted) { booted = true; boot(); }
    } else {
      // 移动宽度：永远显示朴素列表，目录视觉层收起。就算窗口从桌面缩小到
      // 移动宽度也会立刻收回去——不是"进入过桌面模式就回不去了"。
      book.setAttribute('hidden', '');
      plainList.removeAttribute('hidden');
    }
  }
  mq.addEventListener('change', applyMode);
  applyMode();

  if (!mq.matches) return; // 移动端直接结束，下面的代码一行都不用跑

  // =====================================================================
  // 以下只在桌面宽度、且曾经进入过桌面模式时执行一次 boot()
  // =====================================================================
  function boot() {
    var QUARTER_LABEL = { 1: '春', 2: '夏', 3: '秋', 4: '冬' };

    var volLabelEl = document.getElementById('nb-vol');
    var volSelectEl = document.getElementById('nb-volume-select');
    var searchEl = document.getElementById('nb-search');
    var tagsEl = document.getElementById('nb-tags');
    var entriesEl = document.getElementById('nb-entries');
    var emptyEl = document.getElementById('nb-empty');
    var errEl = document.getElementById('nb-error');
    var pagerEl = document.getElementById('nb-pagination');
    var pageNoEl = document.getElementById('nb-page-no');
    var prevBtn = document.getElementById('nb-prev');
    var nextBtn = document.getElementById('nb-next');

    // state.mode: 'volume'（按年·季浏览，支持翻页）或 'search'（关键词搜索，不翻页）
    var state = { mode: 'volume', year: null, quarter: null, page: 1, totalPages: 1, q: '' };
    var searchDebounce = null;

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function formatDate(iso) {
      return new Date(iso).toISOString().slice(0, 10).replace(/-/g, '.');
    }
    function showError(msg) {
      errEl.textContent = msg;
      errEl.removeAttribute('hidden');
      emptyEl.setAttribute('hidden', '');
      entriesEl.innerHTML = '';
      pagerEl.setAttribute('hidden', '');
    }
    function clearError() { errEl.setAttribute('hidden', ''); }

    function renderEntries(entries) {
      clearError();
      if (!entries.length) {
        entriesEl.innerHTML = '';
        emptyEl.removeAttribute('hidden');
        return;
      }
      emptyEl.setAttribute('hidden', '');
      entriesEl.innerHTML = entries.map(function (e) {
        var excerpt = e.excerpt
          ? '<p class="nb-entry-excerpt">' + escapeHtml(e.excerpt) + '</p>'
          : '';
        return (
          '<li class="nb-entry">' +
            '<a class="nb-entry-link" href="/p/' + encodeURIComponent(e.slug) + '">' +
              '<span class="nb-entry-title">' + escapeHtml(e.title) + '</span>' +
              '<span class="nb-entry-dots" aria-hidden="true"></span>' +
              '<span class="nb-entry-date">' + formatDate(e.date) + '</span>' +
            '</a>' +
            excerpt +
          '</li>'
        );
      }).join('');
    }

    function updatePager() {
      if (state.mode !== 'volume' || state.totalPages <= 1) {
        pagerEl.setAttribute('hidden', '');
        return;
      }
      pagerEl.removeAttribute('hidden');
      pageNoEl.textContent = '第 ' + state.page + ' / ' + state.totalPages + ' 页';
      prevBtn.classList.toggle('disabled', state.page <= 1);
      nextBtn.classList.toggle('disabled', state.page >= state.totalPages);
    }

    function loadToc(year, quarter, page) {
      state.mode = 'volume'; state.year = year; state.quarter = quarter; state.page = page;
      volLabelEl.textContent = year + ' · ' + (QUARTER_LABEL[quarter] || quarter);
      fetch('/api/notebook/toc?year=' + year + '&quarter=' + quarter + '&page=' + page)
        .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
        .then(function (data) {
          state.totalPages = data.totalPages;
          renderEntries(data.entries);
          updatePager();
        })
        .catch(function () { showError('目录加载失败，请刷新页面重试。'); });
    }

    function loadSearch(q) {
      state.mode = 'search'; state.q = q;
      volLabelEl.textContent = '搜索："' + q + '"';
      pagerEl.setAttribute('hidden', '');
      fetch('/api/notebook/search?q=' + encodeURIComponent(q))
        .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
        .then(function (data) { renderEntries(data.results); })
        .catch(function () { showError('搜索失败，请稍后再试。'); });
    }

    function backToVolume() {
      if (state.year && state.quarter) loadToc(state.year, state.quarter, state.page || 1);
    }

    // ---- 季度筛选下拉 ----
    fetch('/api/notebook/volumes')
      .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
      .then(function (data) {
        var volumes = data.volumes || [];
        if (!volumes.length) { showError('还没有已发布的文章。'); return; }
        volSelectEl.innerHTML = volumes.map(function (v) {
          return '<option value="' + v.year + '-' + v.quarter + '">' +
            v.year + ' · ' + (QUARTER_LABEL[v.quarter] || v.quarter) + '（' + v.n + '篇）</option>';
        }).join('');
        var first = volumes[0];
        loadToc(first.year, first.quarter, 1);
      })
      .catch(function () { showError('目录加载失败，请刷新页面重试。'); });

    volSelectEl.addEventListener('change', function () {
      var parts = volSelectEl.value.split('-');
      loadToc(parseInt(parts[0], 10), parseInt(parts[1], 10), 1);
    });

    prevBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (state.page > 1) loadToc(state.year, state.quarter, state.page - 1);
    });
    nextBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (state.page < state.totalPages) loadToc(state.year, state.quarter, state.page + 1);
    });

    // ---- 搜索：输入停顿 300ms 再请求，清空输入自动回到当前季度目录 ----
    searchEl.addEventListener('input', function () {
      var q = searchEl.value.trim();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        if (q) loadSearch(q); else backToVolume();
      }, 300);
    });

    // ---- 标签：真实链接跳到 /tag/:slug（全站现成的标签页），不在这里做筛选 ----
    fetch('/api/notebook/tags')
      .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
      .then(function (data) {
        tagsEl.innerHTML = (data.tags || []).map(function (t) {
          return '<a href="/tag/' + encodeURIComponent(t.slug) + '">' + escapeHtml(t.name) + '</a>';
        }).join('');
      })
      .catch(function () { /* 标签加载失败不影响目录主功能，安静跳过 */ });
  }
})();
