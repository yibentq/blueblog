'use strict';

// 生成 spread-prototype.html：封面 + 一页目录页的跨页静态原型（步骤3）。
// 目的只有一个：验证"封面新用色"和"内页旧材质"放在一起协不协调——这是
// experiments/notebook-cover/README.md 里明确点出的风险点，重启前的封面和
// 这版内页材质用色逻辑不完全一样，所以先做最小的双页拼版，而不是直接接完整分册。
//
// 范围声明（对照 docs/BOOK_DESIGN.md 步骤3）：
// - 只做静态视觉，不做翻页交互（步骤4/5）、不接真实文章数据、不做真实图片装饰系统（步骤7）。
// - 图片装饰这里用简单色块占位，明确标注"占位"，避免用 CSS 渐变冒充最终效果被误认成定稿。
// - 目录条目标题用的手写艺术字体（Google Fonts: Caveat）是临时选择，未与站长确认，
//   仅用于验证"标题艺术字 / 正文清晰字体"分层用字这条设定是否成立，不是字体定稿。
//
// 用法：node experiments/notebook-spread/build-spread-prototype.js
// 依赖：先跑 gen-page-textures.js 生成 P0~P4 内页贴图（已在本目录生成一次）。

const fs = require('fs');
const path = require('path');
const { buildSignature } = require('../../src/utils/brand');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'spread-prototype.html');

function dataUri(absPath, mime) {
  const buf = fs.readFileSync(absPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const calfUri = dataUri(path.join(ROOT, 'public/img/leather-calf-v1.webp'), 'image/webp');
const creamUri = dataUri(path.join(ROOT, 'public/img/leather-cream-v1.webp'), 'image/webp');

// 右页选用 P1（茶渍）——刻意不选 P0（太素，验证不出渍痕和封面是否协调）也不选
// 最重的 P4（怕干扰这一步真正要看的东西：排版 + 分层用字）。
const pageUri = dataUri(path.join(__dirname, 'P1-tea-ring.png'), 'image/png');

const sigDark = buildSignature({ width: 210, ink: '#16233A' }).svg;
const sigLight = buildSignature({ width: 210, ink: '#FBF6E8', opacity: 0.5 }).svg;

// 2026-09-23 补充（步骤4前端对接，第二片，续 spine-tabs 那一片）：
// 原来这里写死 4 条占位目录，现在改成运行时 fetch 真实数据（最新一个分册的第1页），
// 跟 build-spine-tabs-prototype.js 那次的处理方式一致：不能再直接双击本地文件打开，
// 要跑 `npm run dev` 后访问 http://localhost:3000/dev/notebook/spread-prototype.html。
// 这个原型本身没有书脊标签、不切换分册，所以只需要"拿最新一册第1页"这一次 fetch，
// 比 spine-tabs 那版简单——分册切换的交互留在 spine-tabs 那个原型里，这里不重复做。
//
// 2026-09-23 补充（目录页之间的翻页，对应 docs/BOOK_DESIGN.md 第6节"目录页之间
// 翻页"那一档——注意这不是执行计划里编号的"步骤6"，那个编号在第9节指的是标签/
// 搜索便签系统，是完全不同的另一块，别混；这里做的是第6节里提到、此前一直没接的
// "上一页/下一页"分页控件，README 之前也误把它写成"步骤6"，已在 README 里更正）：
// - 右页目录页底部加了"‹ 上一页 / 下一页 ›"两个按钮，翻页时 fetch 同一分册的
//   上一页/下一页（`/api/notebook/toc?...&page=N`，接口本来就支持分页，只是前端
//   一直只用了 page=1）。
// - 动效走"慢速物理翻书"路线（第6节明确要求和步骤5的快速哗啦啦区分开）：单张
//   .toc-page 元素以左侧装订缝为轴心做 CSS 3D rotateY，翻到 90° 侧面看不见内容
//   的那一瞬间换上新数据，再转回 0°；总时长 900ms，比步骤5的 700ms 明显更慢、
//   更像"翻一页厚重的纸"而不是"哗啦啦扫过一叠纸"，两种动效手感刻意做出区分。
// - 翻页期间按钮 disable，防止连点导致动画交叠；到第一页/最后一页时对应按钮
//   disable（不是隐藏，让用户能看到"到头了"而不是以为按钮消失了）。
// - 沿用同一份 P1 内页材质，不用另开一套贴图。

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>blog.blue 跨页原型（封面 + 目录页 · 步骤3）</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Source+Serif+4:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{
  --blue-900:#0F2E52;
  --paper:#F6EFE0; --thread:#C79A45; --thread-shadow:rgba(74,46,10,0.42);
  --line-white-dim:rgba(234,240,248,0.5);
  --ink:#2A2015;
  box-sizing:border-box;
}
*{box-sizing:inherit;}
html,body{height:100%;margin:0;}
body{
  min-height:100%;
  background-color:var(--blue-900);
  background-image:
    linear-gradient(90deg, rgba(2,9,20,0.35) 0 1px, rgba(150,190,240,0.1) 1px 2px, transparent 2px),
    linear-gradient(180deg, rgba(2,9,20,0.35) 0 1px, rgba(150,190,240,0.1) 1px 2px, transparent 2px);
  background-size: 28px 28px;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding: 3rem 1rem;
  font-family: 'Source Serif 4', Georgia, serif;
}
.note{ max-width:760px; color:var(--line-white-dim); font-size:0.8rem; text-align:center; margin-bottom:1.6rem; line-height:1.6; }
.note b{ color:#E7D9B8; }
.note.err{ color:#E8A0A0; }

.spread{ position:relative; display:flex; box-shadow: 0 24px 50px rgba(2,8,18,0.5); border-radius:4px; overflow:visible; perspective: 1800px; }

.pager{ display:flex; justify-content:space-between; align-items:center; margin-top:1rem; width:100%; max-width:662px; }
.pager button{
  font-family:'Source Serif 4',serif; font-size:0.82rem; color:#EDE3CC; background:rgba(255,255,255,0.06);
  border:1px solid rgba(234,240,248,0.3); border-radius:3px; padding:0.4rem 0.9rem; cursor:pointer;
}
.pager button:disabled{ opacity:0.35; cursor:default; }
.pager button:not(:disabled):active{ background:rgba(255,255,255,0.14); }

/* ---- 左页：封面（复用 notebook-cover 原样式，等比缩小） ---- */
.cover-page{
  position:relative; width:300px; height:408px;
  background-color: var(--paper);
  background-image: url('${calfUri}');
  background-size: cover; background-position: 40% 30%;
  border-radius: 4px 0 0 4px;
  z-index:2;
}
.cover-page::after{
  content:''; position:absolute; inset:0; pointer-events:none;
  background-image:url('${creamUri}'); background-size:420px 420px; opacity:0.8;
  -webkit-mask-image: linear-gradient(90deg, #000 0, transparent 40px, transparent calc(100% - 40px), #000 100%),
    linear-gradient(180deg, #000 0, transparent 40px, transparent calc(100% - 40px), #000 100%);
  mask-image: linear-gradient(90deg, #000 0, transparent 40px, transparent calc(100% - 40px), #000 100%),
    linear-gradient(180deg, #000 0, transparent 40px, transparent calc(100% - 40px), #000 100%);
}
.stitch-r{
  position:absolute; top:12px; bottom:12px; right:12px; width:2px; pointer-events:none;
  background: repeating-linear-gradient(180deg, var(--thread) 0 7px, transparent 7px 12px);
  filter: drop-shadow(0 1px 0 var(--thread-shadow)); opacity:0.9;
}
.emblem{ position:absolute; left:50%; top:44%; transform:translate(-50%,-50%); width:190px; }
.emblem .light{ position:absolute; top:1.4px; left:1.4px; opacity:0.5; }
.ribbon{
  position:absolute; top:-4px; left:64px; width:10px; height:130px; z-index:5;
  background: linear-gradient(90deg, #9C7A38, var(--thread) 45%, #E7C878 55%, var(--thread) 70%, #9C7A38);
  clip-path: polygon(0 0, 100% 0, 100% 88%, 50% 100%, 0 88%);
  box-shadow: 1px 2px 4px rgba(2,8,18,0.35);
}

/* ---- 装订缝：两页交界处的暗部，暗示"这是一本合起来的书" ---- */
.gutter{
  position:relative; width:22px; z-index:3;
  background: linear-gradient(90deg, rgba(0,0,0,0.32), rgba(0,0,0,0.06) 40%, rgba(0,0,0,0.06) 60%, rgba(0,0,0,0.32));
}

/* ---- 右页：目录页（内页纸张材质 + 随性排布条目） ---- */
.toc-page{
  position:relative; width:340px; height:408px;
  background-image: url('${pageUri}');
  background-size: cover;
  border-radius: 0 4px 4px 0;
  padding: 1.6rem 1.5rem 1.2rem;
  color: var(--ink);
  transform-origin: left center;
  backface-visibility: hidden;
  box-shadow: 0 0 0 transparent; /* 占位，翻页时JS会叠加真实阴影，避免闪一下没有过渡 */
}
.toc-header{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.9rem; }
.toc-header .vol{ font-family:'Caveat',cursive; font-size:1.3rem; color:#5B3A1E; transform:rotate(-2deg); display:inline-block; }
.toc-header .page-no{ font-size:0.68rem; color:#6b5a42; opacity:0.75; }

.entries{ display:flex; flex-direction:column; gap:0.85rem; min-height:220px; }
.entries .placeholder{ font-family:'Source Serif 4',serif; font-size:0.85rem; color:#6b5a42; opacity:0.8; }
.entry{ position:relative; padding-left:0.1em; }
.entry:nth-child(2){ margin-left:14px; }
.entry:nth-child(3){ margin-left:-6px; }
.entry:nth-child(4){ margin-left:8px; }
.entry .title{
  font-family:'Caveat',cursive; font-weight:700; font-size:1.5rem; color:#20293A;
  display:inline-block; margin-right:0.5em;
}
.entry:nth-child(odd) .title{ transform:rotate(-0.6deg); }
.entry:nth-child(even) .title{ transform:rotate(0.8deg); }
.entry .date{
  font-family:'Caveat',cursive; font-size:1rem; color:#8a6a3a; opacity:0.85;
  display:inline-block; transform:rotate(-4deg); margin-left:0.3em;
}
.entry .excerpt{
  display:block; font-family:'Source Serif 4',serif; font-size:0.82rem; color:#3a3226;
  line-height:1.5; margin-top:0.15rem; max-width:92%;
}
.entry .thumb{
  /* 占位色块，代表未来会替换成真实上传图片 + 胶带/拍立得装饰（步骤7），这里只验证排版位置 */
  position:absolute; width:34px; height:34px; border-radius:2px;
  background: repeating-linear-gradient(45deg, #b7a37e 0 4px, #a4906b 4px 8px);
  opacity:0.7; box-shadow:0 2px 5px rgba(0,0,0,0.25);
}
.entry[data-has-image="true"] .thumb{ right:0; top:-4px; }
.entry[data-has-image="true"]{ padding-right:44px; }

.caption{ margin-top:1.4rem; text-align:center; color:var(--line-white-dim); font-size:0.78rem; }
</style>
</head>
<body>
  <p class="note" id="note">
    <b>步骤3 · 跨页静态原型（含目录页翻页）</b> —— 只验证封面新用色 + 内页旧材质放在一起协不协调，<b>不是最终排版</b>。
    右页目录已换成 <code>fetch('/api/notebook/toc?...')</code> 读到的真实数据，底部"上一页/下一页"是真的翻页
    （同一分册内，慢速 CSS 3D 翻书动效，和步骤5点进全文的快速哗啦啦是两种手感）；缩略图仍是占位色块，
    步骤7再接真实图片装饰系统；标题手写字体 Caveat 仍是临时占位，未与站长确认，字体本身待定。
  </p>
  <div class="spread">
    <div class="cover-page">
      <div class="stitch-r"></div>
      <div class="emblem">
        <div class="light">${sigLight}</div>
        <div class="dark">${sigDark}</div>
      </div>
      <div class="ribbon"></div>
    </div>
    <div class="gutter"></div>
    <div class="toc-page" id="tocPage">
      <div class="toc-header">
        <span class="vol" id="volLabel">—</span>
        <span class="page-no" id="pageNo">—</span>
      </div>
      <div class="entries" id="entries">
        <span class="placeholder">加载中…</span>
      </div>
    </div>
  </div>
  <div class="pager">
    <button type="button" id="prevBtn" disabled>‹ 上一页</button>
    <button type="button" id="nextBtn" disabled>下一页 ›</button>
  </div>
  <p class="caption">跨页原型 · 左页封面（复用线上贴图）+ 右页目录（P1 茶渍内页材质 + 真实文章数据，可翻页）</p>

<script>
(function () {
  var QUARTER_LABEL = { 1: '春', 2: '夏', 3: '秋', 4: '冬' };
  var entriesEl = document.getElementById('entries');
  var volLabelEl = document.getElementById('volLabel');
  var pageNoEl = document.getElementById('pageNo');
  var noteEl = document.getElementById('note');
  var tocPage = document.getElementById('tocPage');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');

  // 当前分册 + 当前页，翻页按钮和动效都基于这份状态，fetch 成功后才更新
  var state = { year: null, quarter: null, page: 1, totalPages: 1 };
  var busy = false; // 动画/请求进行中，防止连点导致两次翻页动效叠在一起

  function showFetchError(msg) {
    noteEl.classList.add('err');
    noteEl.innerHTML = '<b>加载真实数据失败：</b>' + msg +
      '。这个原型现在依赖同源的 /api/notebook/* 接口，需要先 <code>npm run dev</code> 跑起来，' +
      '再打开 <code>http://localhost:3000/dev/notebook/spread-prototype.html</code>' +
      '（双击本地文件直接打开会因为跨源被拦掉，不是接口坏了）。';
  }

  function renderEntries(data) {
    state.year = data.year; state.quarter = data.quarter;
    state.page = data.page; state.totalPages = data.totalPages;
    volLabelEl.textContent = data.year + ' \u00b7 ' + (QUARTER_LABEL[data.quarter] || data.quarter);
    pageNoEl.textContent = '\u2014 ' + data.page + ' / ' + data.totalPages + ' \u2014';
    entriesEl.innerHTML = '';
    if (!data.entries.length) {
      entriesEl.innerHTML = '<span class="placeholder">这个分册还没有文章。</span>';
    } else {
      data.entries.forEach(function (e) {
        var d = new Date(e.date);
        var dateStr = (d.getMonth() + 1) + '.' + d.getDate();
        var div = document.createElement('div');
        div.className = 'entry';
        div.setAttribute('data-has-image', e.hasImage ? 'true' : 'false');
        div.innerHTML =
          (e.hasImage ? '<div class="thumb"></div>' : '') +
          '<span class="title"></span><span class="date"></span>' +
          '<span class="excerpt"></span>';
        div.querySelector('.title').textContent = e.title;
        div.querySelector('.date').textContent = dateStr;
        div.querySelector('.excerpt').textContent = e.excerpt || '';
        entriesEl.appendChild(div);
      });
    }
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= data.totalPages;
  }

  // 慢速物理翻页：以左侧装订缝为轴心转到90°（侧面看不见内容）时换上新数据，
  // 再转回0°——对应 docs/BOOK_DESIGN.md 第6节"目录页之间翻页"的要求，
  // 总时长900ms，和步骤5那版0.7s的快速哗啦啦刻意做出手感区分。
  function flipToPage(targetPage, direction) {
    if (busy || !state.year) return;
    busy = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    var HALF = 450; // 900ms 总时长的一半：转过去 + 换内容 + 转回来
    var awayDeg = direction === 1 ? -92 : 92; // 1=下一页(翻向内页深处)，-1=上一页(翻回来)

    tocPage.style.transition = 'transform ' + HALF + 'ms ease-in';
    tocPage.style.transform = 'rotateY(' + awayDeg + 'deg)';

    var fetchPromise = fetch(
      '/api/notebook/toc?year=' + state.year + '&quarter=' + state.quarter + '&page=' + targetPage
    ).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

    setTimeout(function () {
      fetchPromise
        .then(function (data) {
          renderEntries(data); // 此刻页面转到侧面，内容看不见，换数据不会有跳变
          tocPage.style.transition = 'transform ' + HALF + 'ms ease-out';
          tocPage.style.transform = 'rotateY(0deg)';
          setTimeout(function () { busy = false; }, HALF);
        })
        .catch(function (err) {
          // 翻页请求失败：转回原样，不吞掉错误也不留在侧面卡住
          tocPage.style.transition = 'transform ' + HALF + 'ms ease-out';
          tocPage.style.transform = 'rotateY(0deg)';
          busy = false;
          prevBtn.disabled = state.page <= 1;
          nextBtn.disabled = state.page >= state.totalPages;
          showFetchError(err.message);
        });
    }, HALF);
  }

  prevBtn.addEventListener('click', function () {
    if (state.page > 1) flipToPage(state.page - 1, -1);
  });
  nextBtn.addEventListener('click', function () {
    if (state.page < state.totalPages) flipToPage(state.page + 1, 1);
  });

  fetch('/api/notebook/volumes')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      if (!data.volumes.length) {
        entriesEl.innerHTML = '<span class="placeholder">还没有已发布的文章分册。</span>';
        return;
      }
      var v = data.volumes[0]; // 最新一册
      return fetch('/api/notebook/toc?year=' + v.year + '&quarter=' + v.quarter + '&page=1')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(renderEntries);
    })
    .catch(function (err) { showFetchError(err.message); });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[spread-prototype] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
