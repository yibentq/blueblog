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

// 4 条目录条目占位数据（非真实文章，仅供排版验证；日期用手写批注式样式呈现）
const ENTRIES = [
  { title: '给博客换了个封面', date: '9.14', excerpt: '折腾了一下午贴图和阴影，总算不那么像 PPT 了。', hasImage: true, tape: -6 },
  { title: '一次失败的部署', date: '9.09', excerpt: 'Nginx 配置抄错了一行，凌晨两点在骂自己。', hasImage: false },
  { title: '路过的一只猫', date: '9.03', excerpt: '楼下便利店门口，好像认识我了。', hasImage: true, tape: 4 },
  { title: '关于慢下来这件事', date: '8.27', excerpt: '这周没写代码，读了两本闲书。', hasImage: false },
];

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

.spread{ position:relative; display:flex; box-shadow: 0 24px 50px rgba(2,8,18,0.5); border-radius:4px; overflow:visible; }

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
}
.toc-header{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.9rem; }
.toc-header .vol{ font-family:'Caveat',cursive; font-size:1.3rem; color:#5B3A1E; transform:rotate(-2deg); display:inline-block; }
.toc-header .page-no{ font-size:0.68rem; color:#6b5a42; opacity:0.75; }

.entries{ display:flex; flex-direction:column; gap:0.85rem; }
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
  <p class="note">
    <b>步骤3 · 跨页静态原型</b> —— 只验证封面新用色 + 内页旧材质放在一起协不协调，<b>不是最终排版</b>。
    右页缩略图为占位色块（步骤7再接真实图片装饰系统），标题手写字体（Caveat）为临时占位（未与站长确认，字体本身待定）。
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
    <div class="toc-page">
      <div class="toc-header">
        <span class="vol">2026 · 秋</span>
        <span class="page-no">— 14 —</span>
      </div>
      <div class="entries">
        ${ENTRIES.map((e) => `
        <div class="entry" data-has-image="${!!e.hasImage}">
          ${e.hasImage ? '<div class="thumb"></div>' : ''}
          <span class="title">${e.title}</span><span class="date">${e.date}</span>
          <span class="excerpt">${e.excerpt}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>
  <p class="caption">跨页原型 · 左页封面（复用线上贴图）+ 右页目录（P1 茶渍内页材质）</p>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[spread-prototype] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
