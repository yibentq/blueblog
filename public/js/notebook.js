(function () {
  'use strict';

  // ---- 桌面宽度渐进增强的总闸门 ----
  // 断点和 style.css 里全站唯一的移动端断点（max-width:640px）保持一致，不另起一个数字。
  var mq = window.matchMedia('(min-width: 641px)');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
      // 移动宽度：永远显示朴素列表，book 收起。就算窗口从桌面缩小到移动宽度
      // 也会立刻收回去——不是"进入过桌面模式就回不去了"。
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

    var errEl = document.getElementById('nb-error');
    var tabsEl = document.getElementById('nb-spine-tabs');
    var entriesEl = document.getElementById('nb-entries');
    var tocPageEl = document.getElementById('nb-toc-page');
    var volLabelEl = document.getElementById('nb-vol-label');
    var pageNoEl = document.getElementById('nb-page-no');
    var prevBtn = document.getElementById('nb-prev');
    var nextBtn = document.getElementById('nb-next');

    var state = { volumes: [], volIndex: 0, page: 1, totalPages: 1, busy: false };

    function showError(msg) {
      errEl.hidden = false;
      errEl.textContent = '加载失败：' + msg + '（不影响下方文章列表，可以刷新重试）';
    }

    // ---- 目录条目渲染（含步骤7真实图片装饰） ----
    function decorationClass(deco) {
      if (deco === 'tape') return 'deco-tape';
      if (deco === 'polaroid') return 'deco-polaroid';
      if (deco === 'pin') return 'deco-pin';
      return '';
    }

    function renderEntries(data) {
      state.page = data.page;
      state.totalPages = data.totalPages;
      volLabelEl.textContent = data.year + ' · ' + (QUARTER_LABEL[data.quarter] || data.quarter);
      pageNoEl.textContent = '— ' + data.page + ' / ' + data.totalPages + ' —';
      tocPageEl.style.backgroundImage = "url('/img/notebook/page-" + data.pageTexture + "-v1.webp')";

      entriesEl.innerHTML = '';
      if (!data.entries.length) {
        entriesEl.innerHTML = '<p class="nb-placeholder">这个分册还没有文章。</p>';
      } else {
        data.entries.forEach(function (e) {
          var d = new Date(e.date);
          var dateStr = (d.getMonth() + 1) + '.' + d.getDate();
          var entry = document.createElement('div');
          entry.className = 'nb-entry';
          entry.setAttribute('data-has-image', e.hasImage ? 'true' : 'false');

          if (e.hasImage) {
            var thumb = document.createElement('div');
            thumb.className = 'nb-thumb ' + decorationClass(e.decoration);
            if (e.decoration === 'tape' && typeof e.tapeAngle === 'number') {
              thumb.style.setProperty('--nb-tape-angle', e.tapeAngle + 'deg');
            }
            var img = document.createElement('img');
            img.src = e.coverImage;
            img.alt = '';
            img.loading = 'lazy';
            thumb.appendChild(img);
            entry.appendChild(thumb);
          }

          var titleBtn = document.createElement('button');
          titleBtn.type = 'button';
          titleBtn.className = 'nb-entry-title';
          titleBtn.textContent = e.title;
          titleBtn.addEventListener('click', function () { playFlip(e.slug); });
          entry.appendChild(titleBtn);

          var dateSpan = document.createElement('span');
          dateSpan.className = 'nb-entry-date';
          dateSpan.textContent = dateStr;
          entry.appendChild(dateSpan);

          if (e.excerpt) {
            var excerpt = document.createElement('span');
            excerpt.className = 'nb-entry-excerpt';
            excerpt.textContent = e.excerpt;
            entry.appendChild(excerpt);
          }

          entriesEl.appendChild(entry);
        });
      }
      prevBtn.disabled = data.page <= 1;
      nextBtn.disabled = data.page >= data.totalPages;
    }

    function fetchToc(year, quarter, page) {
      return fetch('/api/notebook/toc?year=' + year + '&quarter=' + quarter + '&page=' + page)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }

    // ---- 书脊分册标签：磨损（--nb-wear）按新旧顺序固定插值，和"当前选中"是两件独立的事
    // （沿用 experiments/notebook-spread 已确认过的判断：磨损记录"平时翻不翻"，不是"这一刻在不在看"） ----
    function renderTabs() {
      tabsEl.innerHTML = '';
      var n = state.volumes.length;
      state.volumes.forEach(function (v, i) {
        var wear = n <= 1 ? 0.85 : (0.85 - (0.85 - 0.12) * (i / (n - 1)));
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'nb-tab' + (i === state.volIndex ? ' active' : '');
        tab.style.setProperty('--nb-wear', wear.toFixed(2));
        tab.setAttribute('aria-pressed', i === state.volIndex ? 'true' : 'false');
        tab.setAttribute('aria-label', v.year + '年' + (QUARTER_LABEL[v.quarter] || v.quarter));
        var txt = document.createElement('span');
        txt.className = 'nb-tab-txt';
        txt.textContent = v.year + '·' + (QUARTER_LABEL[v.quarter] || v.quarter);
        tab.appendChild(txt);
        tab.addEventListener('click', function () { selectVolume(i); });
        tabsEl.appendChild(tab);
      });
    }

    function selectVolume(index) {
      if (state.busy || index === state.volIndex) return;
      state.volIndex = index;
      renderTabs();
      var v = state.volumes[index];
      entriesEl.innerHTML = '<p class="nb-placeholder">加载中…</p>';
      fetchToc(v.year, v.quarter, 1).then(renderEntries).catch(function (err) { showError(err.message); });
    }

    // ---- 目录页之间的翻页：慢速物理翻书（900ms），和步骤5点进全文的快速哗啦啦刻意区分 ----
    function flipToPage(targetPage, direction) {
      if (state.busy) return;
      var v = state.volumes[state.volIndex];
      if (!v) return;
      state.busy = true;
      prevBtn.disabled = true; nextBtn.disabled = true;

      if (reduceMotion.matches) {
        fetchToc(v.year, v.quarter, targetPage)
          .then(function (data) { renderEntries(data); state.busy = false; })
          .catch(function (err) { showError(err.message); state.busy = false; prevBtn.disabled = state.page <= 1; nextBtn.disabled = state.page >= state.totalPages; });
        return;
      }

      var HALF = 450;
      var awayDeg = direction === 1 ? -92 : 92;
      tocPageEl.style.transition = 'transform ' + HALF + 'ms ease-in';
      tocPageEl.style.transform = 'rotateY(' + awayDeg + 'deg)';

      var fetchPromise = fetchToc(v.year, v.quarter, targetPage);
      setTimeout(function () {
        fetchPromise.then(function (data) {
          renderEntries(data);
          tocPageEl.style.transition = 'transform ' + HALF + 'ms ease-out';
          tocPageEl.style.transform = 'rotateY(0deg)';
          setTimeout(function () { state.busy = false; }, HALF);
        }).catch(function (err) {
          tocPageEl.style.transition = 'transform ' + HALF + 'ms ease-out';
          tocPageEl.style.transform = 'rotateY(0deg)';
          state.busy = false;
          prevBtn.disabled = state.page <= 1; nextBtn.disabled = state.page >= state.totalPages;
          showError(err.message);
        });
      }, HALF);
    }
    prevBtn.addEventListener('click', function () { if (state.page > 1) flipToPage(state.page - 1, -1); });
    nextBtn.addEventListener('click', function () { if (state.page < state.totalPages) flipToPage(state.page + 1, 1); });

    // ---- 点击目录条目 → 全文页：哗啦啦翻过一叠纸（0.7s），进入/返回共用同一套参数 ----
    var stage = document.getElementById('nb-stage');
    var dest = document.getElementById('nb-dest');
    var TOTAL = 700;

    function getFlyingPages() {
      return [0, 1, 2, 3].map(function (i) { return document.getElementById('nb-fp' + i); });
    }

    function runFlying(direction, onDone) {
      if (reduceMotion.matches) { onDone(); return; }
      var pages = getFlyingPages();
      var perPage = TOTAL / pages.length;
      var order = direction === 1 ? pages : pages.slice().reverse();
      var textures = ['P0-clean', 'P2-water-mark', 'P1-tea-ring', 'P4-handling-patina'];
      order.forEach(function (p, i) {
        p.style.backgroundImage = "url('/img/notebook/page-" + textures[i] + "-v1.webp')";
        var delay = i * (perPage * 0.55);
        var idx = pages.indexOf(p);
        var fromT = direction === 1
          ? 'rotateY(0deg) translateX(0) translateY(0px)'
          : 'rotateY(-100deg) translateX(-40px) translateY(' + ((idx - 1.5) * 6) + 'px)';
        var toT = direction === 1
          ? 'rotateY(-100deg) translateX(-40px) translateY(' + ((idx - 1.5) * 6) + 'px)'
          : 'rotateY(0deg) translateX(0) translateY(0px)';
        p.style.transition = 'none';
        p.style.opacity = '0';
        p.style.transform = fromT;
        setTimeout(function () {
          p.style.transition = 'transform ' + (perPage * 1.4) + 'ms cubic-bezier(.4,.0,.2,1), opacity ' + (perPage * 1.4) + 'ms ease-out';
          p.style.opacity = '1';
          requestAnimationFrame(function () {
            p.style.transform = toT;
            setTimeout(function () { p.style.opacity = '0'; }, perPage * 1.4 * 0.7);
          });
        }, delay);
      });
      setTimeout(onDone, TOTAL);
    }

    function pingView(slug) {
      fetch('/api/notebook/article/' + encodeURIComponent(slug) + '/view', { method: 'POST' }).catch(function () {});
    }

    var lastFocused = null;
    function playFlip(slug) {
      lastFocused = document.activeElement;
      stage.classList.add('active');
      stage.setAttribute('aria-hidden', 'false');

      var contentReady = fetch('/api/notebook/article/' + encodeURIComponent(slug))
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function (err) { return { title: '加载失败', html: '<p>' + err.message + '，可以直接打开 <a href="/p/' + encodeURIComponent(slug) + '">/p/' + slug + '</a> 查看。</p>' }; });

      runFlying(1, function () {});

      Promise.all([new Promise(function (r) { setTimeout(r, reduceMotion.matches ? 0 : TOTAL); }), contentReady])
        .then(function (results) {
          var article = results[1];
          dest.innerHTML = '';
          var backBtn = document.createElement('button');
          backBtn.type = 'button';
          backBtn.className = 'nb-back-btn';
          backBtn.textContent = '← 返回目录';
          dest.appendChild(backBtn);
          var titleEl = document.createElement('p');
          titleEl.className = 'nb-dest-title';
          titleEl.textContent = article.title;
          dest.appendChild(titleEl);
          var bodyEl = document.createElement('div');
          bodyEl.className = 'nb-dest-body';
          // 服务端 /api/notebook/article/:slug 给的 html 和 /p/:slug 走同一份
          // sanitize-html 净化管线，这里 innerHTML 不是新开的风险面。
          bodyEl.innerHTML = article.html || '';
          dest.appendChild(bodyEl);
          dest.classList.add('show');
          backBtn.addEventListener('click', function () { backToToc(backBtn); });
          backBtn.focus();
          if (article.title && article.title !== '加载失败') pingView(slug);
        });
    }

    function backToToc(backBtn) {
      if (backBtn) backBtn.disabled = true;
      dest.classList.remove('show');
      runFlying(-1, function () {
        dest.innerHTML = '';
        stage.classList.remove('active');
        stage.setAttribute('aria-hidden', 'true');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
      });
    }

    // Esc 关闭全文层，返回目录（键盘可访问性）
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && stage.classList.contains('active')) {
        var btn = dest.querySelector('.nb-back-btn');
        backToToc(btn);
      }
    });

    // ---- 标签便签 ----
    var tagsTab = document.getElementById('nb-note-tags-tab');
    var tagsDrawer = document.getElementById('nb-note-tags-drawer');
    var tagCloudEl = document.getElementById('nb-tag-cloud');
    var tagsLoaded = false;

    function toggleDrawer(tab, drawer, otherTab, otherDrawer) {
      var isOpen = !drawer.hidden;
      // 互斥：打开一个就收起另一个，桌面上两片便签同时摊开会互相压住
      otherDrawer.hidden = true;
      otherTab.setAttribute('aria-expanded', 'false');
      drawer.hidden = isOpen;
      tab.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    }

    tagsTab.addEventListener('click', function () {
      toggleDrawer(tagsTab, tagsDrawer, searchTab, searchDrawer);
      if (!tagsLoaded && !tagsDrawer.hidden) {
        tagsLoaded = true;
        fetch('/api/notebook/tags').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (data) {
            tagCloudEl.innerHTML = '';
            if (!data.tags.length) { tagCloudEl.innerHTML = '<p class="nb-placeholder">还没有标签。</p>'; return; }
            data.tags.forEach(function (t) {
              var a = document.createElement('a');
              a.className = 'nb-tag-chip';
              a.href = '/tag/' + encodeURIComponent(t.slug);
              a.textContent = t.name + ' ';
              var count = document.createElement('span');
              count.className = 'nb-tag-count';
              count.textContent = '(' + t.post_count + ')';
              a.appendChild(count);
              tagCloudEl.appendChild(a);
            });
          })
          .catch(function (err) { tagCloudEl.innerHTML = '<p class="nb-placeholder">加载失败：' + err.message + '</p>'; });
      }
    });

    // ---- 搜索便签 ----
    var searchTab = document.getElementById('nb-note-search-tab');
    var searchDrawer = document.getElementById('nb-note-search-drawer');
    var searchInput = document.getElementById('nb-search-input');
    var searchResultsEl = document.getElementById('nb-search-results');
    var searchTimer = null;

    searchTab.addEventListener('click', function () {
      toggleDrawer(searchTab, searchDrawer, tagsTab, tagsDrawer);
      if (!searchDrawer.hidden) searchInput.focus();
    });

    searchInput.addEventListener('input', function () {
      var q = searchInput.value;
      clearTimeout(searchTimer);
      if (!q.trim()) { searchResultsEl.innerHTML = ''; return; }
      searchTimer = setTimeout(function () {
        fetch('/api/notebook/search?q=' + encodeURIComponent(q))
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (data) {
            searchResultsEl.innerHTML = '';
            if (!data.results.length) {
              searchResultsEl.innerHTML = '<p class="nb-search-hint">没有找到匹配的文章。</p>';
              return;
            }
            data.results.forEach(function (r) {
              var a = document.createElement('a');
              a.href = '/p/' + encodeURIComponent(r.slug);
              a.textContent = r.title;
              searchResultsEl.appendChild(a);
            });
          })
          .catch(function (err) { searchResultsEl.innerHTML = '<p class="nb-search-hint">搜索失败：' + err.message + '</p>'; });
      }, 220); // 简单防抖，不用每敲一个字都发请求
    });

    // ---- 初始加载：默认打开最新一册并翻到最新一页（docs/BOOK_DESIGN.md 第3节要求） ----
    fetch('/api/notebook/volumes')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (!data.volumes.length) {
          entriesEl.innerHTML = '<p class="nb-placeholder">还没有已发布的文章。</p>';
          return;
        }
        state.volumes = data.volumes;
        state.volIndex = 0;
        renderTabs();
        var v = data.volumes[0];
        return fetchToc(v.year, v.quarter, 1).then(function (initial) {
          // "翻到最新一页"：默认拿总页数最后一页而不是第1页——第1页在接口语义里是
          // 最新一批（listByVolume 按 published_at DESC 排），所以"最新一页"其实就是
          // page=1，这里不用再反查 totalPages 跳页，命名上的"最新"已经对齐。
          renderEntries(initial);
        });
      })
      .catch(function (err) { showError(err.message); });
  }
})();
