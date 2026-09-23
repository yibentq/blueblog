'use strict';

// 生成 flip-transition-prototype.html：点击目录条目 → 全文页的翻页动效原型（步骤5）。
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
//   之间的翻页（那是步骤6，慢速物理翻转），这里是快速冲刺式的哗啦啦效果。
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
</style>
</head>
<body>
  <p class="note" id="note">
    <b>步骤5 · 翻页动效原型（步骤4前端对接版）</b> —— 验证"点击目录条目 → 哗啦啦翻过一叠纸 → 进入全文页"
    的动效手感和时长；目录条目和点击后取到的全文内容都已换成 <code>fetch('/api/notebook/*')</code>
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
    '。这个原型现在依赖同源的 /api/notebook/* 接口，需要先 <code>npm run dev</code> 跑起来，' +
    '再打开 <code>http://localhost:3000/dev/notebook/flip-transition-prototype.html</code>' +
    '（双击本地文件直接打开会因为跨源被拦掉，不是接口坏了）。';
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

  var pages = [0,1,2,3].map(function (i) { return document.getElementById('fp'+i); });
  var total = 700; // 总时长 0.7s，落在规格要求的 0.6-1s 区间
  var perPage = total / pages.length;

  pages.forEach(function (p, i) {
    var delay = i * (perPage * 0.55); // 页与页之间错开，制造"连续哗啦啦"而不是同时消失
    p.style.transition = 'none';
    p.style.opacity = '0';
    p.style.transform = 'rotateY(0deg) translateX(0)';
    setTimeout(function () {
      p.style.transition = 'transform ' + (perPage * 1.4) + 'ms cubic-bezier(.4,.0,.2,1), opacity ' + (perPage*1.4) + 'ms ease-out';
      p.style.opacity = '1';
      requestAnimationFrame(function () {
        p.style.transform = 'rotateY(-100deg) translateX(-40px) translateY(' + ((i-1.5)*6) + 'px)';
        setTimeout(function () { p.style.opacity = '0'; }, perPage * 1.4 * 0.7);
      });
    }, delay);
  });

  Promise.all([
    new Promise(function (r) { setTimeout(r, total); }),
    contentReady,
  ]).then(function (results) {
    var article = results[1];
    var dest = document.getElementById('dest');
    dest.innerHTML = '<div><h2 style="margin-top:0">' + article.title + '</h2>' + (article.html || '') + '</div>';
    dest.classList.add('show');
    document.getElementById('replay').style.display = 'block';
  });
}

loadEntries();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[flip-transition-prototype] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
