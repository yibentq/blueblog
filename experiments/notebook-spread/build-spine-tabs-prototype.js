'use strict';

// 生成 spine-tabs-prototype.html：步骤3剩余项之二——书脊分册标签。
// 基于 build-spread-prototype.js 的跨页结构（封面+目录页），在装订缝（.gutter，也就是
// 打开状态下"书脊"所在的位置）上加几片可点标签，对应 docs/BOOK_DESIGN.md 第3节
// "按年/季度分册，历史册子通过书脊上的可点标签切换"。
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

const ENTRIES = [
  { title: '给博客换了个封面', date: '9.14', excerpt: '折腾了一下午贴图和阴影，总算不那么像 PPT 了。', hasImage: true },
  { title: '一次失败的部署', date: '9.09', excerpt: 'Nginx 配置抄错了一行，凌晨两点在骂自己。', hasImage: false },
  { title: '路过的一只猫', date: '9.03', excerpt: '楼下便利店门口，好像认识我了。', hasImage: true },
  { title: '关于慢下来这件事', date: '8.27', excerpt: '这周没写代码，读了两本闲书。', hasImage: false },
];

// 4 个分册：最新（当前打开、磨损最重）在最上面，往下是历史册子（磨损递减——
// 越久没翻的册子，标签本该越干净，这点和"整体做旧"的直觉相反，是刻意的）
const VOLUMES = [
  { label: '2026·秋', active: true, wear: 0.85 },
  { label: '2026·夏', active: false, wear: 0.4 },
  { label: '2026·春', active: false, wear: 0.25 },
  { label: '2025·冬', active: false, wear: 0.15 },
];

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>blog.blue 书脊分册标签原型（步骤3剩余项）</title>
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
  transition: none; /* 明确不用 transition/hover，状态由服务端渲染的 class 决定，不是交互动画 */
}
.tab .txt{
  writing-mode: vertical-rl; text-orientation: mixed;
  font-family:'Caveat',cursive; font-weight:700; font-size:0.95rem; color:#3a2c16;
  letter-spacing:0.02em;
}
.tab.active{ width:38px; box-shadow: 3px 4px 9px rgba(2,8,18,0.45); }
.tab.active .txt{ color:#20293A; }
/* 包浆磨损：只叠在被摸得最多的那片标签上（当前分册），颜色变深而不是"整体旧"， */
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

.entries{ display:flex; flex-direction:column; gap:0.85rem; }
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
  <p class="note">
    <b>步骤3剩余项 · 书脊分册标签</b> —— 验证"按年/季度分册、书脊标签切换"的视觉呈现。
    <b>纯静态展示，点击切换的交互还没接（属于步骤4/6范围）</b>；标签数量/文案/磨损参数均为占位判断，未与站长确认。
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
      <div class="spine-tabs">
        ${VOLUMES.map((v) => `
        <div class="tab${v.active ? ' active' : ''}" style="--wear:${v.wear}">
          <span class="txt">${v.label}</span>
        </div>`).join('')}
      </div>
    </div>
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
  <p class="caption">
    当前分册（2026·秋）标签伸出更多、颜色也更深——因为这是被翻得最多的一册，磨损该最重，
    不是"最新=最干净"。历史册子标签依次收进去、颜色转淡。
  </p>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[spine-tabs] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
