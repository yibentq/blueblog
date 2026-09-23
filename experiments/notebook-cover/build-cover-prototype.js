'use strict';

// 生成 cover-prototype.html：笔记本封面静态原型。
// 直接读线上正在用的两张贴图（public/img/leather-*.webp）和真实的品牌签名（src/utils/brand.js），
// 不需要另外跑材质生成脚本——这是这次重启和 experiments/book-materials/（已否决的深棕牛皮革方向）
// 最大的不同：封面材质本身就是已经上线、站长认过的东西，只是排版和装饰是新的。
//
// 用法：node experiments/notebook-cover/build-cover-prototype.js
// 改了 public/img/leather-calf-v1.webp / leather-cream-v1.webp 之后，重新跑一遍这个脚本，
// 原型会跟着换成新图。

const fs = require('fs');
const path = require('path');
const { buildSignature } = require('../../src/utils/brand');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'cover-prototype.html');

function dataUri(relPath, mime) {
  const buf = fs.readFileSync(path.join(ROOT, relPath));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const calfUri = dataUri('public/img/leather-calf-v1.webp', 'image/webp');
const creamUri = dataUri('public/img/leather-cream-v1.webp', 'image/webp');

// 中心图腾：卸刻凹陷感——深色主线 + 偏移1.6px的浅色高光副本垫在下面，
// 模拟盖章压进皮里、凹槽下边缘透一点光的效果。不用滤镜做旧。
const sigDark = buildSignature({ width: 260, ink: '#16233A' }).svg;
const sigLight = buildSignature({ width: 260, ink: '#FBF6E8', opacity: 0.5 }).svg;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>blog.blue 笔记本封面原型</title>
<style>
:root{
  --blue-900:#0F2E52;
  --paper:#F6EFE0; --thread:#C79A45; --thread-shadow:rgba(74,46,10,0.42);
  --line-white-dim:rgba(234,240,248,0.5);
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
  display:flex; align-items:center; justify-content:center;
  padding: 3rem 1rem;
  font-family: Georgia, serif;
}
.stage{ position:relative; width:340px; height:462px; }
.pages-edge{
  position:absolute; top:6px; left:6px; right:-6px; bottom:-6px;
  border-radius: 3px; background-color:#EDE3CC;
  background-image: repeating-linear-gradient(180deg, rgba(122,88,42,0.16) 0 1px, transparent 1px 3px);
  box-shadow: 2px 4px 10px rgba(2,8,18,0.35);
}
.cover{
  position:absolute; inset:0; border-radius: 4px;
  background-color: var(--paper);
  background-image: url('${calfUri}');
  background-size: cover; background-position: 40% 30%;
  box-shadow: 0 18px 30px rgba(2,8,18,0.45), 0 3px 6px rgba(2,8,18,0.3);
}
/* 粗粒羽化边——复用 .post-card 现成的"边缘粗粒、中心细腻"手法 */
.cover::after{
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background-image:url('${creamUri}'); background-size:480px 480px; opacity:0.8;
  -webkit-mask-image:
    linear-gradient(90deg, #000 0, transparent 46px, transparent calc(100% - 46px), #000 100%),
    linear-gradient(180deg, #000 0, transparent 46px, transparent calc(100% - 46px), #000 100%);
  mask-image:
    linear-gradient(90deg, #000 0, transparent 46px, transparent calc(100% - 46px), #000 100%),
    linear-gradient(180deg, #000 0, transparent 46px, transparent calc(100% - 46px), #000 100%);
}
/* 缝线：和 .post-card 同一种针脚做法、同一个金色 */
.stitch{
  position:absolute; inset:14px; border-radius:3px; pointer-events:none;
  background:
    repeating-linear-gradient(90deg, var(--thread) 0 7px, transparent 7px 12px) top / 100% 2px no-repeat,
    repeating-linear-gradient(90deg, var(--thread) 0 7px, transparent 7px 12px) bottom / 100% 2px no-repeat,
    repeating-linear-gradient(180deg, var(--thread) 0 7px, transparent 7px 12px) left / 2px 100% no-repeat,
    repeating-linear-gradient(180deg, var(--thread) 0 7px, transparent 7px 12px) right / 2px 100% no-repeat;
  filter: drop-shadow(0 1px 0 var(--thread-shadow));
  opacity:0.92;
}
/* 蓝图装饰框：罗盘弧线 + 四角十字校准记号 + 刻度短线，代替参考图里的巴洛克唐草 */
.blueprint-frame{ position:absolute; inset:30px; pointer-events:none; }
.corner{ position:absolute; width:22px; height:22px; }
.corner::before, .corner::after{ content:''; position:absolute; background:var(--thread); opacity:0.75; }
.corner::before{ width:100%; height:1px; top:50%; }
.corner::after{ width:1px; height:100%; left:50%; }
.corner.tl{ top:-8px; left:-8px; } .corner.tr{ top:-8px; right:-8px; }
.corner.bl{ bottom:-8px; left:-8px; } .corner.br{ bottom:-8px; right:-8px; }
.compass-arc{ position:absolute; border:1px solid var(--thread); opacity:0.55; border-radius:50%; }
.compass-arc.top{ width:120px; height:120px; top:-60px; left:50%; transform:translateX(-50%); clip-path: inset(60px 0 0 0); }
.compass-arc.bottom{ width:120px; height:120px; bottom:-60px; left:50%; transform:translateX(-50%); clip-path: inset(0 0 60px 0); }
.ticks{ position:absolute; inset:0; }
.ticks span{ position:absolute; background:var(--thread); opacity:0.6; }
.ticks .tx{ width:1px; height:6px; top:-6px; } .ticks .bx{ width:1px; height:6px; bottom:-6px; }
.ticks .ly{ width:6px; height:1px; left:-6px; } .ticks .ry{ width:6px; height:1px; right:-6px; }
/* 中心签名图腾：卸刻/凹陷感 */
.emblem{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:230px; }
.emblem .light{ position:absolute; top:1.6px; left:1.6px; opacity:0.5; }
.emblem .dark{ position:relative; }
/* 书签带：纯装饰，不可点击 */
.ribbon{
  position:absolute; top:-4px; left:74px; width:11px; height:150px;
  background: linear-gradient(90deg, #9C7A38, var(--thread) 45%, #E7C878 55%, var(--thread) 70%, #9C7A38);
  clip-path: polygon(0 0, 100% 0, 100% 88%, 50% 100%, 0 88%);
  box-shadow: 1px 2px 4px rgba(2,8,18,0.35);
}
.caption{ margin-top:1.4rem; text-align:center; color:var(--line-white-dim); font-size:0.78rem; font-family:'Source Serif 4',Georgia,serif; }
</style>
</head>
<body>
  <div>
    <div class="stage">
      <div class="pages-edge"></div>
      <div class="cover">
        <div class="stitch"></div>
        <div class="blueprint-frame">
          <div class="corner tl"></div><div class="corner tr"></div>
          <div class="corner bl"></div><div class="corner br"></div>
          <div class="compass-arc top"></div>
          <div class="compass-arc bottom"></div>
          <div class="ticks">
            <span class="tx" style="left:20%"></span><span class="tx" style="left:50%"></span><span class="tx" style="left:80%"></span>
            <span class="bx" style="left:20%"></span><span class="bx" style="left:50%"></span><span class="bx" style="left:80%"></span>
            <span class="ly" style="top:25%"></span><span class="ly" style="top:50%"></span><span class="ly" style="top:75%"></span>
            <span class="ry" style="top:25%"></span><span class="ry" style="top:50%"></span><span class="ry" style="top:75%"></span>
          </div>
        </div>
        <div class="emblem">
          <div class="light">${sigLight}</div>
          <div class="dark">${sigDark}</div>
        </div>
        <div class="ribbon"></div>
      </div>
    </div>
    <p class="caption">封面原型 · 复用线上 leather-calf 质感 + 蓝图装饰框 + 卸刻签名图腾</p>
  </div>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[cover-prototype] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
