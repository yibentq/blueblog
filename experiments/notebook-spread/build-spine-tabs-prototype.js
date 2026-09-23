'use strict';

// 生成 spine-tabs-prototype.html：步骤3剩余项之二——书脊分册标签。
// 基于 build-spread-prototype.js 的跨页结构（封面+目录页），在装订缝（.gutter，也就是
// 打开状态下"书脊"所在的位置）上加几片可点标签，对应 docs/BOOK_DESIGN.md 第3节
// "按年/季度分册，历史册子通过书脊上的可点标签切换"。
//
// 2026-09-23 补充（步骤4前端对接）：
// - 标签数量、每个分册的目录条目**不再写死**，改成页面加载后用 fetch() 打
//   GET /api/notebook/volumes 和 GET /api/notebook/toc?year=&quarter=&page=1，
//   这两个接口是步骤4后端已经做好、测过的（见 src/routes/public.js）。
// - **补上了点击切换分册的交互**（原来"点击切换的交互完全没接，纯静态展示"，见本目录
//   README"步骤3剩余项补充"一节）：点哪个标签，哪个标签变成 .active（伸出更多），
//   同时重新 fetch 那个分册的目录、换掉右页内容。
// - 因为现在要发真实请求，**不能再靠双击本地文件直接打开**（file:// 协议下 fetch 相对路径
//   会被浏览器当跨源拦掉）。运行 `npm run dev` 之后，同源访问：
//     http://localhost:3000/dev/notebook/spine-tabs-prototype.html
//   这条路由只在 NODE_ENV !== 'production' 时挂载（见 src/routes/public.js 对应注释），
//   生产环境不会暴露 experiments/ 目录。
// - **磨损（--wear）和"当前选中"（.active class）现在是两件独立的事**，这是本轮新加的
//   工程判断，写清楚免得下次被当成 bug 改掉：
//     · .active（标签伸出更多）跟着"你现在点开看的是哪本"走，点哪个换哪个。
//     · --wear（磨损深浅）是每个分册固定的物理属性，按"离现在多久没翻"算——真实使用
//       频率数据库里没记录，沿用原型阶段"越新的分册磨损越重"这条已确认的反直觉设定
//       （最近发布的分册=写得最勤=翻得最多），按分册新旧顺序线性插值（最新 0.85 ~
//       最旧 0.12），不随点击变化。也就是说：点开一本旧分册看，它会伸出来，但磨损
//       深浅不会突然变重——磨损记录的是"平时翻不翻"，不是"这一刻在不在看"。
//     · 这条新分离出来的规则本身没有和站长确认过，是延续原有设定推出的工程实现，
//       如果站长觉得"点开哪本哪本就该显脏"更符合直觉，这里要改。
// - 目前只 fetch 每个分册的第 1 页（`page=1`），翻页控件、步骤5的"哗啦啦翻页"动效
//   都还没接进来——点目录条目暂时没有反应，这两项是接下来的步骤，不在这一轮里做。
//
// 设计判断（未与站长确认，属于本轮原型的判断题，见文件末尾说明）：
// - 遵守步骤2禁忌1：标签本身不用 hover 高亮/发光，"当前选中"状态靠"伸出更多 + 磨损更重"
//   两个静态视觉信号表达，不是数字界面式反馈。
// - 遵守禁忌2（不均匀的旧）：当前这本被翻得最多，磨损应该比历史册子更重，不是更新更干净——
//   这是刻意反直觉的一点，写在这里避免被当成 bug 改掉。
// - 标签配色沿用已定稿的蓝图语言（--paper/--thread金线/--blue-900），不引入新色相，
//   避免变成参考图里"巴洛克唐草"那类和设定无关的通用手帐装饰。
//
// 用法：node experiments/notebook-spread/build-spine-tabs-prototype.js
// 然后 npm run dev，浏览器打开 http://localhost:3000/dev/notebook/spine-tabs-prototype.html

const fs = require('fs');
const path = require('path');
const { buildSignature } = require('../../src/utils/brand');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'spine-tabs-prototype.html');

function dataUri(absPath, mime) {
  const buf = fs.readFileSync(absPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const calfUri = dataUri(path.join(ROOT, 'public/img/leather-calf-v1.webp'), 'image/webp');
const creamUri = dataUri(path.join(ROOT, 'public/img/leather-cream-v1.webp'), 'image/webp');
const pageUri = dataUri(path.join(__dirname, 'P1-tea-ring.png'), 'image/png');

const sigDark = buildSignature({ width: 210, ink: '#16233A' }).svg;
const sigLight = buildSignature({ width: 210, ink: '#FBF6E8', opacity: 0.5 }).svg;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>blog.blue 书脊分册标签原型（步骤3剩余项 + 步骤4前端对接）</title>
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

.spread{ position:relative; display:flex; box-shadow: 0 24px 50px rgba(2,8,18,0.5); border-radius:4px; overflow:visible; }

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

.gutter{
  position:relative; width:22px; z-index:3;
  background: linear-gradient(90deg, rgba(0,0,0,0.32), rgba(0,0,0,0.06) 40%, rgba(0,0,0,0.06) 60%, rgba(0,0,0,0.32));
}

/* ---- 书脊分册标签：贴在装订缝上，往右页方向伸出一截 ---- */
.spine-tabs{ position:absolute; left:0; top:46px; width:100%; z-index:4; }
.tab{
  position:relative; height:40px; margin-bottom:9px;
  display:flex; align-items:center; justify-content:center;
  width:26px; left:12px;
  background: linear-gradient(90deg, #E4D6AE, var(--paper) 60%);
  border:1px solid rgba(74,46,10,0.35);
  border-left:2px solid var(--thread);
  border-radius: 0 3px 3px 0;
  box-shadow: 2px 3px 6px rgba(2,8,18,0.35);
  transition: none; /* 明确不用 transition/hover，状态由 JS 切换的 class 决定，不是交互动画 */
  cursor:pointer;
}
.tab .txt{
  writing-mode: vertical-rl; text-orientation: mixed;
  font-family:'Caveat',cursive; font-weight:700; font-size:0.95rem; color:#3a2c16;
  letter-spacing:0.02em;
}
.tab.active{ width:38px; box-shadow: 3px 4px 9px rgba(2,8,18,0.45); }
.tab.active .txt{ color:#20293A; }
/* 包浆磨损：只叠在被摸得最多的那片标签上，颜色变深而不是"整体旧"， */
.tab::after{
  content:''; position:absolute; inset:0; border-radius:0 3px 3px 0; pointer-events:none;
  background: radial-gradient(ellipse at 70% 85%, rgba(90,58,20,var(--wear,0.15)) 0%, transparent 65%);
}

.toc-page{
  position:relative; width:340px; height:408px;
  background-image: url('${pageUri}');
  background-size: cover;
  border-radius: 0 4px 4px 0;
  padding: 1.6rem 1.5rem 1.2rem 2.6rem;
  color: var(--ink);
}
.toc-header{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.9rem; }
.toc-header .vol{ font-family:'Caveat',cursive; font-size:1.3rem; color:#5B3A1E; transform:rotate(-2deg); display:inline-block; }
.toc-header .page-no{ font-size:0.68rem; color:#6b5a42; opacity:0.75; }

.entries{ display:flex; flex-direction:column; gap:0.85rem; min-height:220px; }
.entries .placeholder{ font-family:'Source Serif 4',serif; font-size:0.85rem; color:#6b5a42; opacity:0.8; }
.entry{ position:relative; padding-left:0.1em; }
.entry .title{ font-family:'Caveat',cursive; font-weight:700; font-size:1.5rem; color:#20293A; display:inline-block; margin-right:0.5em; }
.entry .date{ font-family:'Caveat',cursive; font-size:1rem; color:#8a6a3a; opacity:0.85; display:inline-block; transform:rotate(-4deg); margin-left:0.3em; }
.entry .excerpt{ display:block; font-family:'Source Serif 4',serif; font-size:0.82rem; color:#3a3226; line-height:1.5; margin-top:0.15rem; max-width:92%; }
.entry .thumb{ position:absolute; width:34px; height:34px; border-radius:2px; background: repeating-linear-gradient(45deg, #b7a37e 0 4px, #a4906b 4px 8px); opacity:0.7; box-shadow:0 2px 5px rgba(0,0,0,0.25); }
.entry[data-has-image="true"] .thumb{ right:0; top:-4px; }
.entry[data-has-image="true"]{ padding-right:44px; }

.caption{ margin-top:1.4rem; text-align:center; color:var(--line-white-dim); font-size:0.78rem; max-width:640px; line-height:1.6; }
</style>
</head>
<body>
  <p class="note" id="note">
    <b>步骤3剩余项 · 书脊分册标签（步骤4前端对接版）</b> —— 标签和目录条目已换成
    <code>fetch('/api/notebook/volumes')</code> / <code>fetch('/api/notebook/toc?...')</code>
    读到的真实数据；点击标签会切换分册并重新拉取目录。<b>只取了每个分册的第 1 页，
    翻页控件和步骤5"哗啦啦翻页"动效还没接，点目录条目暂时没有反应。</b>
    磨损参数（哪本更旧磨损更浅）沿用原有未确认判断题，未与站长确认。
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
    <div class="gutter">
      <div class="spine-tabs" id="spineTabs">
        <!-- JS 运行时按 /api/notebook/volumes 的结果动态填充 -->
      </div>
    </div>
    <div class="toc-page">
      <div class="toc-header">
        <span class="vol" id="volLabel">—</span>
        <span class="page-no" id="pageNo">— 1 —</span>
      </div>
      <div class="entries" id="entries">
        <span class="placeholder">加载中…</span>
      </div>
    </div>
  </div>
  <p class="caption">
    当前分册标签伸出更多、颜色也更深——因为设定上这是被翻得最多的一册，磨损该最重，
    不是"最新=最干净"。点击任意标签可以切换到该分册看真实目录（第1页）。
  </p>

<script>
(function () {
  var QUARTER_LABEL = { 1: '春', 2: '夏', 3: '秋', 4: '冬' };
  var tabsEl = document.getElementById('spineTabs');
  var entriesEl = document.getElementById('entries');
  var volLabelEl = document.getElementById('volLabel');
  var pageNoEl = document.getElementById('pageNo');
  var noteEl = document.getElementById('note');

  function showFetchError(msg) {
    noteEl.classList.add('err');
    noteEl.innerHTML = '<b>加载真实数据失败：</b>' + msg +
      '。这个原型现在依赖同源的 /api/notebook/* 接口，需要先 <code>npm run dev</code> 跑起来，' +
      '再打开 <code>http://localhost:3000/dev/notebook/spine-tabs-prototype.html</code>' +
      '（双击本地文件直接打开会因为跨源被拦掉，不是接口坏了）。';
  }

  function renderTabs(volumes, activeIndex) {
    tabsEl.innerHTML = '';
    var n = volumes.length;
    volumes.forEach(function (v, i) {
      // 磨损：按"新旧顺序"线性插值，最新 0.85，最旧 0.12——固定属性，不随点击变化。
      var wear = n <= 1 ? 0.85 : (0.85 - (0.85 - 0.12) * (i / (n - 1)));
      var tab = document.createElement('div');
      tab.className = 'tab' + (i === activeIndex ? ' active' : '');
      tab.style.setProperty('--wear', wear.toFixed(2));
      var txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = v.year + '\u00b7' + (QUARTER_LABEL[v.quarter] || v.quarter);
      tab.appendChild(txt);
      tab.addEventListener('click', function () {
        selectVolume(volumes, i);
      });
      tabsEl.appendChild(tab);
    });
  }

  function renderEntries(data) {
    volLabelEl.textContent = data.year + ' \u00b7 ' + (QUARTER_LABEL[data.quarter] || data.quarter);
    pageNoEl.textContent = '\u2014 ' + data.page + ' / ' + data.totalPages + ' \u2014';
    entriesEl.innerHTML = '';
    if (!data.entries.length) {
      entriesEl.innerHTML = '<span class="placeholder">这个分册还没有文章。</span>';
      return;
    }
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

  function selectVolume(volumes, index) {
    renderTabs(volumes, index);
    var v = volumes[index];
    entriesEl.innerHTML = '<span class="placeholder">加载中…</span>';
    fetch('/api/notebook/toc?year=' + v.year + '&quarter=' + v.quarter + '&page=1')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(renderEntries)
      .catch(function (err) { showFetchError(err.message); });
  }

  fetch('/api/notebook/volumes')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data.volumes.length) {
        entriesEl.innerHTML = '<span class="placeholder">还没有已发布的文章分册。</span>';
        return;
      }
      selectVolume(data.volumes, 0); // 默认打开最新一册（接口按新到旧排序）
    })
    .catch(function (err) { showFetchError(err.message); });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[spine-tabs] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
