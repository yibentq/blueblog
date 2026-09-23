'use strict';

// 生成 flip-transition-prototype.html：点击目录条目 → 全文页的翻页动效原型（步骤5）。
//
// 范围声明：
// - 只做"哗啦啦翻过一叠纸"的动效本身，用假数据（点击后模拟异步延迟）触发，
//   不接真实 /p/:slug 路由和真实文章内容——这部分要等步骤4接完真实数据后再接回来，
//   到时候这段动效代码需要重新接线（把 setTimeout 假延迟换成真实 fetch 完成时机）。
// - 不涉及目录页之间的翻页（那是步骤6，慢速物理翻转），这里是快速冲刺式的哗啦啦效果。
// - 材质复用 experiments/notebook-spread/ 已生成的 P0~P4 内页贴图，不再另起一套。
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

.demo-toc{
  position:relative; width:340px; height:200px; background:#1a3a5c; border-radius:4px;
  padding:1.2rem; box-shadow:0 10px 24px rgba(0,0,0,0.4);
}
.demo-entry{
  cursor:pointer; padding:0.5rem 0.3rem; border-radius:3px; color:#EDE3CC; font-size:0.95rem;
  transition:none; /* 明确不做hover发光/放大——只在点击后触发真实翻页动效，不是数字界面式反馈 */
}
.demo-entry:active{ background:rgba(255,255,255,0.06); } /* 只在真正按下的瞬间给一点点反馈，不是hover */
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
  display:flex; align-items:center; justify-content:center; text-align:center; padding:2rem;
  color:#20293A; font-size:1.1rem; opacity:0; box-shadow:0 8px 30px rgba(0,0,0,0.5);
}
.dest.show{ opacity:1; transition: opacity 0.15s ease-out; }

.replay{ margin-top:1.4rem; font-size:0.8rem; color:#9fb3c8; }
</style>
</head>
<body>
  <p class="note">
    <b>步骤5 · 翻页动效原型</b> —— 只验证"点击目录条目 → 哗啦啦翻过一叠纸 → 进入全文页"的动效手感和时长，
    条目和全文内容都是假数据（真实数据接入见步骤4）。
  </p>
  <div class="demo-toc">
    <div class="demo-entry" onclick="playFlip(this)">给博客换了个封面</div>
    <div class="demo-entry" onclick="playFlip(this)">一次失败的部署</div>
    <div class="demo-entry" onclick="playFlip(this)">路过的一只猫</div>
    <p class="hint">点击任意一条 · 模拟真实场景下边播动画边异步取内容</p>
  </div>

  <div class="stage" id="stage">
    ${pages.map((p, i) => `<div class="flying-page" id="fp${i}" style="background-image:url('${p}')"></div>`).join('')}
    <div class="dest" id="dest">（这里是全文页内容，异步取到后淡入）</div>
  </div>

  <p class="replay" id="replay" style="display:none">动效已播放完成 · 刷新页面可重新体验</p>

<script>
function playFlip(el){
  document.querySelectorAll('.demo-entry').forEach(e=>e.style.pointerEvents='none');
  const stage = document.getElementById('stage');
  stage.classList.add('active');

  // 模拟异步取全文内容——真实版本这里是 fetch(slug)，延迟不确定；
  // 动效必须能兜住"内容比动画慢"或"内容比动画快"两种情况，都不能让用户等出空白或跳变。
  const contentReady = new Promise((resolve) => {
    const fakeLatency = 550 + Math.random() * 250; // 故意让它接近动画时长，模拟真实网络的不确定性
    setTimeout(() => resolve('（真实场景：这里替换成异步取回的文章正文）'), fakeLatency);
  });

  const pages = [0,1,2,3].map(i => document.getElementById('fp'+i));
  const total = 700; // 总时长 0.7s，落在规格要求的 0.6-1s 区间
  const perPage = total / pages.length;

  pages.forEach((p, i) => {
    const delay = i * (perPage * 0.55); // 页与页之间错开，制造"连续哗啦啦"而不是同时消失
    p.style.transition = 'none';
    p.style.opacity = '0';
    p.style.transform = 'rotateY(0deg) translateX(0)';
    setTimeout(() => {
      p.style.transition = \`transform \${perPage * 1.4}ms cubic-bezier(.4,.0,.2,1), opacity \${perPage*1.4}ms ease-out\`;
      p.style.opacity = '1';
      requestAnimationFrame(() => {
        p.style.transform = \`rotateY(-100deg) translateX(-40px) translateY(\${(i-1.5)*6}px)\`;
        setTimeout(() => { p.style.opacity = '0'; }, perPage * 1.4 * 0.7);
      });
    }, delay);
  });

  Promise.all([
    new Promise((r) => setTimeout(r, total)),
    contentReady,
  ]).then(([_, text]) => {
    const dest = document.getElementById('dest');
    dest.textContent = text;
    dest.classList.add('show');
    document.getElementById('replay').style.display = 'block';
  });
}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[flip-transition-prototype] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
