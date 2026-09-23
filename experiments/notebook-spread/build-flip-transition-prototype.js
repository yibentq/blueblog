'use strict';

// 生成 flip-transition-prototype.html：点击目录条目 → 全文页的翻页动效原型（步骤5）。
//
// 2026-09-23 补充（预览路由改用登录校验，不再按 NODE_ENV 区分）：
// /dev/notebook/* 这条静态路由原来只在 NODE_ENV !== 'production' 时挂载，导致站长
// 在生产环境完全看不到这批原型，每次预览都要临时切 NODE_ENV 再切回去。改成
// src/routes/public.js 里对这条路由套 requireAuth（和 /admin/* 一样的登录校验），
// 不再区分环境——登录管理员账号就能在生产环境直接看，未登录会跳到 /admin/login。
// 这里改的只是错误提示文案，实际路由改动在 src/routes/public.js。
//
// 2026-09-23 补充（步骤5补充项：返回目录 + 阅读量静默计数）：
// 上一轮 README 里记的两个"还没做"，这一轮做了：
// - 全文页加了"← 返回目录"按钮，点击播放一次反向动效（同一批 flying-page 元素，
//   轨迹和时长跟"进入"对称：旋转方向、错开顺序都反过来），动画结束后把 dest 收起、
//   demoToc 显示回来、目录条目重新可点。不是新的一套动效系统，复用同一批 DOM 节点。
// - contentReady 拿到真实文章后，用 `fetch(..., {method:'POST'})` 打一次新增的
//   `/api/notebook/article/:slug/view` 轻量计数端点（不用 sendBeacon 是因为要在用户
//   点"返回"又点别的文章时也能正常触发，sendBeacon 更适合页面卸载场景，这里不是）。
//   失败了就静默忽略，不影响动效和内容展示——阅读量不是这个原型要保证的东西。
//   每次点开同一篇都会计一次，和 /p/:slug 现有的 incrementViewCount 逻辑同样不做去重，
//   口径保持一致。
//
// 2026-09-23 补充（步骤4前端对接，第三片，收尾）：
// 上一轮的 TODO——"步骤4接入真实数据后，这里要重新接线：把 setTimeout(fakeLatency)
// 换成真实的 fetch(slug) 完成时机，动效本身不用大改，只是触发信号源要换"——这一轮做了：
// - 目录条目不再写死3条假标题，改成 fetch 最新一册第1页真实数据（和 spread-prototype
//   同一个来源），每条目录记住自己的 slug。
// - 点击后原来的假延迟 Promise 换成真正的 fetch('/api/notebook/article/:slug')，
//   动效本身（错开时间、旋转轨迹、总时长0.7s）完全没动——只换了触发信号源，跟计划一致。
// - 全文页内容现在是真实标题 + content_html（服务端已经用 sanitize-html 净化过，
//   和 /p/:slug 走的是同一份净化管线，这里直接 innerHTML 不是新开的风险面）。
// - 阅读量静默计数那个小 TODO 仍然没做（原作者标注过"这里先不做"），这一轮没有顺带加，
//   不属于这次"重新接线"的范围，需要的话应该单独作为一步来做，不要混进来。
//
// 范围声明：
// - 只做"哗啦啦翻过一叠纸"的动效本身，接了真实数据后依然不是最终排版——不涉及目录页
//   之间的翻页（那是 docs/BOOK_DESIGN.md 第6节讲的慢速物理翻转，已在
//   build-spread-prototype.js 里做了，不是执行计划编号的"步骤6"——那是标签/搜索
//   便签系统，另一块），这里是快速冲刺式的哗啦啦效果。
// - 材质复用 experiments/notebook-spread/ 已生成的 P0~P4 内页贴图，不再另起一套。
// - 依赖同源的 /api/notebook/* 接口，不能再直接双击本地文件打开——跑 `npm run dev` 后
//   访问 http://localhost:3000/dev/notebook/flip-transition-prototype.html。
//
// 用法：node experiments/notebook-spread/build-flip-transition-prototype.js

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'flip-transition-prototype.html');

function dataUri(name, mime) {
  const buf = fs.readFileSync(path.join(__dirname, name));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 取4张不同痕迹变体做"翻过去的这叠纸"，让每一页翻过时看起来不是同一张复制粘贴的纸
const pages = ['P0-clean.png', 'P2-water-mark.png', 'P1-tea-ring.png', 'P4-handling-patina.png']
  .map((n) => dataUri(n, 'image/png'));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>blog.blue 翻页动效原型（步骤5）</title>
<style>
:root{
  --blue-900:#0F2E52; --line-white-dim:rgba(234,240,248,0.5);
  box-sizing:border-box;
}
*{box-sizing:inherit;}
html,body{height:100%;margin:0;}
body{
  min-height:100%; background-color:var(--blue-900);
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:3rem 1rem; font-family:'Source Serif 4',Georgia,serif; color:#EDE3CC;
  perspective: 1600px;
}
.note{ max-width:620px; color:var(--line-white-dim); font-size:0.8rem; text-align:center; margin-bottom:1.6rem; line-height:1.6; }
.note b{ color:#E7D9B8; }
.note.err{ color:#E8A0A0; }

.demo-toc{
  position:relative; width:340px; height:200px; background:#1a3a5c; border-radius:4px;
  padding:1.2rem; box-shadow:0 10px 24px rgba(0,0,0,0.4);
}
.demo-entry{
  cursor:pointer; padding:0.5rem 0.3rem; border-radius:3px; color:#EDE3CC; font-size:0.95rem;
  transition:none; /* 明确不做hover发光/放大——只在点击后触发真实翻页动效，不是数字界面式反馈 */
}
.demo-entry:active{ background:rgba(255,255,255,0.06); } /* 只在真正按下的瞬间给一点点反馈，不是hover */
.demo-entry.placeholder{ cursor:default; color:#9fb3c8; }
.hint{ font-size:0.72rem; color:#9fb3c8; margin-top:0.8rem; }

.stage{
  position:fixed; inset:0; display:none; align-items:center; justify-content:center;
  z-index:50; pointer-events:none;
}
.stage.active{ display:flex; }

.flying-page{
  position:absolute; width:300px; height:420px; border-radius:2px;
  background-size:cover; box-shadow:0 8px 30px rgba(0,0,0,0.5);
  transform-origin: left center;
  opacity:0;
}

.dest{
  position:absolute; width:340px; height:420px; background:#F6EFE0; border-radius:2px;
  display:flex; align-items:flex-start; justify-content:center; text-align:left; padding:2rem;
  overflow-y:auto; color:#20293A; font-size:0.95rem; line-height:1.6; opacity:0; box-shadow:0 8px 30px rgba(0,0,0,0.5);
}
.dest.show{ opacity:1; transition: opacity 0.15s ease-out; }

.replay{ margin-top:1.4rem; font-size:0.8rem; color:#9fb3c8; }

.back-btn{
  display:inline-block; margin-bottom:1rem; cursor:pointer; border:none; background:none;
  color:#3a5a80; font-family:inherit; font-size:0.85rem; padding:0; text-decoration:underline;
}
.back-btn:disabled{ color:#b8b0a0; cursor:default; text-decoration:none; }
</style>
</head>
<body>
  <p class="note" id="note">
    <b>步骤5 · 翻页动效原型</b> —— 验证"点击目录条目 → 哗啦啦翻过一叠纸 → 进入全文页 →
    返回目录"的整套动效手感和时长；目录条目和全文内容都是 <code>fetch('/api/notebook/*')</code>
    读到的真实数据（不是最终排版，动效手感本身也还没让站长确认过）。
  </p>
  <div class="demo-toc" id="demoToc">
    <p class="hint" id="loadingHint">加载真实目录中…</p>
  </div>

  <div class="stage" id="stage">
    ${pages.map((p, i) => `<div class="flying-page" id="fp${i}" style="background-image:url('${p}')"></div>`).join('')}
    <div class="dest" id="dest"></div>
  </div>

  <p class="replay" id="replay" style="display:none">动效已播放完成 · 刷新页面可重新体验</p>

<script>
var ENTRIES = [];

function showFetchError(msg) {
  var noteEl = document.getElementById('note');
  noteEl.classList.add('err');
  noteEl.innerHTML = '<b>加载真实数据失败：</b>' + msg +
    '。这个原型依赖同源的 /api/notebook/* 接口和 /dev/notebook/* 静态路由——' +
    '本地开发跑 <code>npm run dev</code> 后打开 <code>http://localhost:3000/dev/notebook/flip-transition-prototype.html</code> 即可；' +
    '生产环境需要先登录 /admin 管理员账号（这条路由现在按登录状态放行，不再区分环境），' +
    '双击本地文件直接打开会因为跨源被拦掉，都不是接口坏了。';
}

function loadEntries() {
  var toc = document.getElementById('demoToc');
  return fetch('/api/notebook/volumes')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      if (!data.volumes.length) throw new Error('还没有已发布的文章');
      var v = data.volumes[0];
      return fetch('/api/notebook/toc?year=' + v.year + '&quarter=' + v.quarter + '&page=1');
    })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      ENTRIES = data.entries;
      toc.innerHTML = '';
      if (!ENTRIES.length) {
        toc.innerHTML = '<p class="hint">还没有可点的文章。</p>';
        return;
      }
      ENTRIES.slice(0, 3).forEach(function (e, i) {
        var div = document.createElement('div');
        div.className = 'demo-entry';
        div.textContent = e.title;
        div.onclick = function () { playFlip(e.slug); };
        toc.appendChild(div);
      });
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '点击任意一条 · 真实取该篇文章内容，边播动画边异步取';
      toc.appendChild(hint);
    })
    .catch(function (err) { showFetchError(err.message); });
}

var TOTAL = 700; // 总时长 0.7s，落在规格要求的 0.6-1s 区间，进入/返回共用同一个时长

function getPages() {
  return [0,1,2,3].map(function (i) { return document.getElementById('fp'+i); });
}

// direction: 1 = 进入全文页（目录→左翻走），-1 = 返回目录（全文页→翻回来）
function runFlying(direction, onDone) {
  var pages = getPages();
  var perPage = TOTAL / pages.length;
  var order = direction === 1 ? pages : pages.slice().reverse(); // 返回时反着错开，制造"倒放"的观感

  order.forEach(function (p, i) {
    var delay = i * (perPage * 0.55);
    var fromT = direction === 1
      ? 'rotateY(0deg) translateX(0) translateY(0px)'
      : 'rotateY(-100deg) translateX(-40px) translateY(' + ((pages.indexOf(p)-1.5)*6) + 'px)';
    var toT = direction === 1
      ? 'rotateY(-100deg) translateX(-40px) translateY(' + ((pages.indexOf(p)-1.5)*6) + 'px)'
      : 'rotateY(0deg) translateX(0) translateY(0px)';
    p.style.transition = 'none';
    p.style.opacity = '0';
    p.style.transform = fromT;
    setTimeout(function () {
      p.style.transition = 'transform ' + (perPage * 1.4) + 'ms cubic-bezier(.4,.0,.2,1), opacity ' + (perPage*1.4) + 'ms ease-out';
      p.style.opacity = '1';
      requestAnimationFrame(function () {
        p.style.transform = toT;
        setTimeout(function () { p.style.opacity = '0'; }, perPage * 1.4 * 0.7);
      });
    }, delay);
  });

  setTimeout(onDone, TOTAL);
}

// 真实文章看过之后，打一下轻量计数端点——不阻塞、不影响动效，失败就算了。
// 用普通 fetch 而不是 sendBeacon：这里不是"页面要卸载了"的场景（用户可能点返回
// 又点别的文章），sendBeacon 是为卸载场景设计的，这里语义不对。
function pingView(slug) {
  fetch('/api/notebook/article/' + encodeURIComponent(slug) + '/view', { method: 'POST' })
    .catch(function () {});
}

function playFlip(slug){
  document.querySelectorAll('.demo-entry').forEach(function (e) { e.style.pointerEvents = 'none'; });
  var stage = document.getElementById('stage');
  stage.classList.add('active');

  // 真实取全文内容——延迟不确定；动效必须能兜住"内容比动画慢"或"内容比动画快"
  // 两种情况，都不能让用户等出空白或跳变。
  var contentReady = fetch('/api/notebook/article/' + encodeURIComponent(slug))
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(function (err) {
      return { title: '加载失败', html: '<p>' + err.message + '</p>' };
    });

  runFlying(1, function () {});

  Promise.all([
    new Promise(function (r) { setTimeout(r, TOTAL); }),
    contentReady,
  ]).then(function (results) {
    var article = results[1];
    var dest = document.getElementById('dest');
    dest.innerHTML = '<button class="back-btn" id="backBtn">← 返回目录</button>' +
      '<div><h2 style="margin-top:0">' + article.title + '</h2>' + (article.html || '') + '</div>';
    dest.classList.add('show');
    document.getElementById('replay').style.display = 'block';
    var backBtn = document.getElementById('backBtn');
    backBtn.onclick = function () { backToToc(backBtn); };
    if (article.title && article.title !== '加载失败') pingView(slug);
  });
}

function backToToc(backBtn) {
  if (backBtn) backBtn.disabled = true; // 播放期间不许连点，避免两套动效叠在一起
  var dest = document.getElementById('dest');
  dest.classList.remove('show');
  dest.innerHTML = '';

  runFlying(-1, function () {
    document.getElementById('stage').classList.remove('active');
    document.getElementById('replay').style.display = 'none';
    document.querySelectorAll('.demo-entry').forEach(function (e) { e.style.pointerEvents = 'auto'; });
  });
}

loadEntries();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[flip-transition-prototype] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
