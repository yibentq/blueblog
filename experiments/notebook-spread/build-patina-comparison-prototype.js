'use strict';

// 生成 patina-comparison-prototype.html：步骤3剩余项之一——多痕迹页对比。
// 目的：验证 P0~P4 五种"痕迹故事"贴图放在一起是不是"同一本书"（基底配方/边角磨损一致），
// 以及每种痕迹上叠加目录文字后，可读性是否受影响（尤其 P2 水渍、P4 包浆这类偏暗的变体）。
//
// 方法论：五页用完全相同的排版和文字内容，唯一变量是贴图，这样看到的差异只能来自贴图本身，
// 不会和"排版本身还没锁定"这件事混在一起干扰判断。
//
// 范围声明：只做静态对比，不涉及"哪篇文章用哪种痕迹"的分配机制（README 里明确写了这个机制还没定）。
//
// 用法：node experiments/notebook-spread/build-patina-comparison-prototype.js

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'patina-comparison-prototype.html');

function dataUri(absPath, mime) {
  const buf = fs.readFileSync(absPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const VARIANTS = [
  { file: 'P0-clean.png', label: 'P0 · 素页（基线）' },
  { file: 'P1-tea-ring.png', label: 'P1 · 茶渍' },
  { file: 'P2-water-mark.png', label: 'P2 · 水渍' },
  { file: 'P3-sun-fade.png', label: 'P3 · 晒痕' },
  { file: 'P4-handling-patina.png', label: 'P4 · 包浆' },
].map((v) => ({ ...v, uri: dataUri(path.join(__dirname, v.file), 'image/png') }));

// 和 spread-prototype.js 用同一份占位条目，保证"唯一变量是贴图"
const ENTRIES = [
  { title: '给博客换了个封面', date: '9.14', excerpt: '折腾了一下午贴图和阴影，总算不那么像 PPT 了。', hasImage: true },
  { title: '一次失败的部署', date: '9.09', excerpt: 'Nginx 配置抄错了一行，凌晨两点在骂自己。', hasImage: false },
  { title: '路过的一只猫', date: '9.03', excerpt: '楼下便利店门口，好像认识我了。', hasImage: true },
  { title: '关于慢下来这件事', date: '8.27', excerpt: '这周没写代码，读了两本闲书。', hasImage: false },
];

const entriesHtml = ENTRIES.map((e) => `
        <div class="entry" data-has-image="${!!e.hasImage}">
          ${e.hasImage ? '<div class="thumb"></div>' : ''}
          <span class="title">${e.title}</span><span class="date">${e.date}</span>
          <span class="excerpt">${e.excerpt}</span>
        </div>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>blog.blue 多痕迹页对比（步骤3剩余项）</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Source+Serif+4:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{ --blue-900:#0F2E52; --ink:#2A2015; box-sizing:border-box; }
*{box-sizing:inherit;}
html,body{margin:0;}
body{
  background-color:var(--blue-900);
  background-image:
    linear-gradient(90deg, rgba(2,9,20,0.35) 0 1px, rgba(150,190,240,0.1) 1px 2px, transparent 2px),
    linear-gradient(180deg, rgba(2,9,20,0.35) 0 1px, rgba(150,190,240,0.1) 1px 2px, transparent 2px);
  background-size: 28px 28px;
  padding: 2.4rem 1.6rem 3rem;
  font-family: 'Source Serif 4', Georgia, serif;
}
.note{ max-width:900px; margin:0 auto 1.8rem; color:rgba(234,240,248,0.55); font-size:0.8rem; text-align:center; line-height:1.6; }
.note b{ color:#E7D9B8; }
.row{ display:flex; flex-wrap:wrap; gap:1.1rem; justify-content:center; max-width:1180px; margin:0 auto; }
.card{ display:flex; flex-direction:column; align-items:center; }
.page{
  position:relative; width:218px; height:262px;
  background-size: cover; border-radius:3px;
  box-shadow: 0 12px 26px rgba(2,8,18,0.45);
  padding: 1rem 0.95rem 0.8rem; color: var(--ink);
}
.entries{ display:flex; flex-direction:column; gap:0.5rem; }
.entry{ position:relative; }
.entry .title{ font-family:'Caveat',cursive; font-weight:700; font-size:1.05rem; color:#20293A; display:inline-block; margin-right:0.4em; }
.entry .date{ font-family:'Caveat',cursive; font-size:0.72rem; color:#8a6a3a; opacity:0.85; }
.entry .excerpt{ display:block; font-family:'Source Serif 4',serif; font-size:0.6rem; color:#3a3226; line-height:1.45; margin-top:0.1rem; max-width:96%; }
.entry .thumb{
  position:absolute; right:0; top:-2px; width:20px; height:20px; border-radius:2px;
  background: repeating-linear-gradient(45deg, #b7a37e 0 3px, #a4906b 3px 6px); opacity:0.7;
}
.entry[data-has-image="true"]{ padding-right:26px; }
.label{ margin-top:0.6rem; font-size:0.78rem; color:#E7D9B8; font-family:'Source Serif 4',serif; }
</style>
</head>
<body>
  <p class="note">
    <b>步骤3剩余项 · 多痕迹页对比</b> —— 五页排版和文字完全相同，唯一变量是贴图，
    用来验证"同一本书"的一致性、以及痕迹是否影响目录文字可读性。<b>排版本身仍是占位，未定稿。</b>
  </p>
  <div class="row">
    ${VARIANTS.map((v) => `
    <div class="card">
      <div class="page" style="background-image:url('${v.uri}')">
        <div class="entries">${entriesHtml}</div>
      </div>
      <span class="label">${v.label}</span>
    </div>`).join('')}
  </div>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf-8');
console.log(`[patina-comparison] 写入 ${OUT}（${(html.length / 1024).toFixed(0)} KB）`);
