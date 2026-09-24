#!/usr/bin/env node
/**
 * 样稿：把 style.css 里两处"数学上绝对规则、CSS 一行 linear-gradient 就能复制"的
 * 线条——蓝图网格线/针孔、卡片缝线——换成跟皮革纹理同一套逻辑生成的版本：
 * 每一段都带 seed 派生的、受控的不规则扰动，视觉上仍然是"图纸线格"/"手工缝线"，
 * 但不再是任何人复制一行 CSS 就能拿到的东西。
 *
 * 对照组（左半张）：现在线上的规则版本（原样复刻 style.css 的渐变参数）。
 * 实验组（右半张）：不规则版本。
 */
const path = require('path');
const sharp = require('sharp');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 900, H = 620;
const rand = mulberry32(20260924);

// ---------- 规则版网格（对照组，直接照抄 style.css 的间距）----------
function regularGrid() {
  let s = '';
  const draw = (step, color, w) => {
    for (let x = -14; x < W; x += step) s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${color}" stroke-width="${w}"/>`;
    for (let y = -14; y < H; y += step) s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${color}" stroke-width="${w}"/>`;
  };
  draw(28, 'rgba(150,190,240,0.09)', 1);
  draw(140, 'rgba(150,190,240,0.15)', 1);
  for (let x = -14; x < W; x += 28) for (let y = -14; y < H; y += 28) {
    s += `<circle cx="${x}" cy="${y}" r="1.4" fill="rgba(150,190,240,0.28)"/>`;
  }
  return s;
}

// ---------- 不规则版网格（实验组）----------
// 每条线拆成若干段，每个控制点带垂直于线方向的小幅随机偏移（手绘图纸的笔颤），
// 沿线不透明度也做轻微起伏（墨水深浅不均）；针孔不再是正圆，半径和位置都有偏差。
function wobblyLine(x1, y1, x2, y2, amp, segs, seedOffset) {
  const r = mulberry32(seedOffset);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len; // 法向
  let pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const jitter = (r() - 0.5) * 2 * amp;
    pts.push([x1 + dx * t + nx * jitter, y1 + dy * t + ny * jitter]);
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
  for (let i = 1; i < pts.length; i++) d += `L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} `;
  return d;
}

function irregularGrid() {
  let s = '';
  let seed = 3000;
  const drawSet = (step, color, w, amp) => {
    for (let x = -14; x < W; x += step) {
      const d = wobblyLine(x, -6, x, H + 6, amp, 10, seed++);
      s += `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" opacity="${(0.82 + rand() * 0.18).toFixed(2)}"/>`;
    }
    for (let y = -14; y < H; y += step) {
      const d = wobblyLine(-6, y, W + 6, y, amp, 14, seed++);
      s += `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" opacity="${(0.82 + rand() * 0.18).toFixed(2)}"/>`;
    }
  };
  drawSet(28, 'rgba(150,190,240,0.11)', 1, 0.55);
  drawSet(140, 'rgba(150,190,240,0.17)', 1.1, 0.4);
  for (let x = -14; x < W; x += 28) for (let y = -14; y < H; y += 28) {
    const jx = x + (rand() - 0.5) * 1.6, jy = y + (rand() - 0.5) * 1.6;
    const rr = 1.1 + rand() * 0.7;
    const rot = rand() * 360;
    s += `<ellipse cx="${jx.toFixed(2)}" cy="${jy.toFixed(2)}" rx="${rr.toFixed(2)}" ry="${(rr * (0.75 + rand() * 0.3)).toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${jx.toFixed(2)} ${jy.toFixed(2)})" fill="rgba(150,190,240,${(0.22 + rand() * 0.14).toFixed(2)})"/>`;
  }
  return s;
}

// ---------- 规则版缝线（对照组）----------
function regularStitch(x0, y0, len) {
  let s = '';
  for (let x = x0; x < x0 + len; x += 12) {
    s += `<line x1="${x}" y1="${y0}" x2="${x + 7}" y2="${y0}" stroke="#C79A45" stroke-width="2"/>`;
  }
  return s;
}

// ---------- 不规则版缝线（实验组）----------
// 针脚长度、间距、y向偏移、角度都带受控随机，偶尔一针略深/略浅（顶线张力不均），
// 模拟真实手缝皮具"看得出是手工"但依然整齐克制的节奏，不是杂乱。
function irregularStitch(x0, y0, len, seed) {
  const r = mulberry32(seed);
  let s = '';
  let x = x0;
  while (x < x0 + len) {
    const stitchLen = 6 + r() * 3;
    const gap = 4 + r() * 3.5;
    const yj = (r() - 0.5) * 1.6;
    const rot = (r() - 0.5) * 7;
    const op = 0.78 + r() * 0.22;
    s += `<line x1="${x.toFixed(2)}" y1="${(y0 + yj).toFixed(2)}" x2="${(x + stitchLen).toFixed(2)}" y2="${(y0 + yj).toFixed(2)}" stroke="#C79A45" stroke-width="${(1.7 + r() * 0.6).toFixed(2)}" opacity="${op.toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(2)} ${y0.toFixed(2)})"/>`;
    x += stitchLen + gap;
  }
  return s;
}

async function main() {
  const half = W;
  const svg = `<svg width="${half * 2 + 20}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0F2E52"/>
    <g>${regularGrid()}</g>
    <g transform="translate(60,60)">${regularStitch(0, 0, 560)}${regularStitch(0, 220, 560)}</g>
    <text x="20" y="${H - 18}" font-family="monospace" font-size="13" fill="rgba(255,255,255,0.55)">对照：现有规则版（style.css 原参数）</text>

    <g transform="translate(${half + 20},0)">
      <rect width="${half}" height="100%" fill="#0F2E52"/>
      ${irregularGrid()}
      <g transform="translate(60,60)">${irregularStitch(0, 0, 560, 5501)}${irregularStitch(0, 220, 560, 6402)}</g>
      <text x="20" y="${H - 18}" font-family="monospace" font-size="13" fill="rgba(255,255,255,0.55)">实验：不规则 seed 派生版</text>
    </g>
    <line x1="${half + 10}" y1="0" x2="${half + 10}" y2="${H}" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, 'compare-grid-stitch.png'));
  console.log('done');
}
main().catch((e) => { console.error(e); process.exit(1); });
