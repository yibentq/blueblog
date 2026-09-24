#!/usr/bin/env node
/**
 * 样稿二：标签 pill、按钮、引用装饰引号、分页箭头——
 * 四个"看起来配色对了，但形状/图形是全网默认套路"的地方，改成跟皮革/签名
 * 同一套"手工感、seed 派生路径"的版本。左对照/右实验，一一对应。
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

const BRASS = '#C79A45', BRASS_D = '#9C7A38', INK = '#16233A', PAPER = '#F6EFE0', WHITE = '#EAF0F8', NAVY='#0F2E52';

// 手抖路径：给一组顶点的每条边加若干带法向抖动的中点，营造"手工裁边"的不规则轮廓，
// 而不是数学上绝对精确的贝塞尔/直线多边形。
function handCutPolygon(points, amp, seed) {
  const r = mulberry32(seed);
  let out = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    out.push([x1, y1]);
    const steps = 2;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const mx = x1 + (x2 - x1) * t, my = y1 + (y2 - y1) * t;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const j = (r() - 0.5) * 2 * amp;
      out.push([mx + nx * j, my + ny * j]);
    }
  }
  return 'M ' + out.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ') + ' Z';
}

// ---------- 1. 标签：现在是圆角矩形 pill，换成"皮牌吊牌"——不规则四边形 + 一角穿线孔+短线头 ----------
function regularTag(x, y, label) {
  const w = label.length * 8 + 26;
  return `<g transform="translate(${x},${y})">
    <rect width="${w}" height="24" rx="12" fill="none" stroke="${'#1D4E89'}" opacity="0.5"/>
    <text x="${w/2}" y="16" font-family="monospace" font-size="12" fill="${'#1D4E89'}" text-anchor="middle">${label}</text>
  </g>`;
}
function irregularTag(x, y, label, seed) {
  const r = mulberry32(seed);
  const w = label.length * 8.5 + 24, h = 25;
  const poly = handCutPolygon([[0,0],[w,2],[w-2,h],[2,h-1]], 1.1, seed);
  const holeX = 9, holeY = h/2;
  return `<g transform="translate(${x},${y})">
    <path d="${poly}" fill="none" stroke="${BRASS_D}" stroke-width="1.2" opacity="0.85"/>
    <circle cx="${holeX}" cy="${holeY}" r="1.6" fill="none" stroke="${BRASS}" stroke-width="1"/>
    <path d="M ${holeX-4} ${holeY-3} Q ${holeX-8} ${holeY} ${holeX-4} ${holeY+4}" stroke="${BRASS}" stroke-width="1" fill="none" opacity="0.8"/>
    <text x="${w/2+6}" y="${h/2+4}" font-family="monospace" font-size="12" fill="${BRASS_D}" text-anchor="middle">${label}</text>
  </g>`;
}

// ---------- 2. 按钮：纯色矩形，换成不规则手裁边框+顶边细缝线 ----------
function regularBtn(x, y) {
  return `<g transform="translate(${x},${y})">
    <rect width="120" height="38" rx="2" fill="${BRASS}"/>
    <text x="60" y="24" font-family="monospace" font-size="13" fill="${INK}" text-anchor="middle">发表评论</text>
  </g>`;
}
function irregularBtn(x, y, seed) {
  const r = mulberry32(seed);
  const w = 122, h = 38;
  const poly = handCutPolygon([[0,1],[w,0],[w-1,h],[1,h-1]], 1.3, seed);
  let stitch = '';
  const rr = mulberry32(seed+1);
  let sx = 6;
  while (sx < w - 6) {
    const len = 4 + rr()*2.5, gap = 3 + rr()*2;
    stitch += `<line x1="${sx.toFixed(1)}" y1="5" x2="${(sx+len).toFixed(1)}" y2="5" stroke="${'#3b2a0c'}" stroke-width="1" opacity="0.5"/>`;
    sx += len + gap;
  }
  return `<g transform="translate(${x},${y})">
    <path d="${poly}" fill="${BRASS}"/>
    <path d="${poly}" fill="none" stroke="${BRASS_D}" stroke-width="1"/>
    ${stitch}
    <text x="${w/2}" y="${h/2+5}" font-family="monospace" font-size="13" fill="${INK}" text-anchor="middle">发表评论</text>
  </g>`;
}

// ---------- 3. 引用装饰引号：字体自带双引号 → 手绘笔触双钩 ----------
function regularQuote(x, y) {
  return `<text x="${x}" y="${y}" font-family="serif" font-size="46" fill="${BRASS}" opacity="0.5">&#8220;</text>`;
}
function irregularQuote(x, y, seed) {
  // 两个不对称的逗号形笔触（毛笔起笔重、收笔尖），而不是字体自带的直引号字符
  const comma = (cx, cy, scale, rot) => `
    <path d="M 0 0 C 6 -2, 9 4, 6 11 C 4 15, 0 15.5, -1.5 13
             C 2 13.5, 4.5 10, 3 6 C 1.8 2.6, -1 1, -3.5 2.5 Z"
      fill="${BRASS}" transform="translate(${cx},${cy}) scale(${scale}) rotate(${rot})"/>`;
  return `<g opacity="0.85">
    ${comma(x, y - 22, 1.15, -6)}
    ${comma(x + 11, y - 19, 1.0, 4)}
  </g>`;
}

// ---------- 4. 分页箭头：字符实体 → 手绘技术笔刻度箭头 ----------
function regularArrow(x, y, dir) {
  const ch = dir === 'l' ? '&#8592;' : '&#8594;';
  return `<text x="${x}" y="${y}" font-family="monospace" font-size="16" fill="${WHITE}">${ch} 上一页</text>`;
}
function irregularArrow(baseX, y, dir, seed, label) {
  const r = mulberry32(seed);
  const wob = (r() - 0.5) * 1.2;
  // 左箭头：从左到右依次是 [箭头][杆][文字]；右箭头：[文字][杆][箭头]，
  // 箭头永远指向阅读前进方向，杆带轻微手绘弯曲。
  if (dir === 'l') {
    const tip = baseX, tail = baseX + 16;
    return `<g>
      <path d="M ${tip} ${y-4} L ${tip} ${y} L ${tip+4} ${y+4.5}" stroke="${BRASS}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M ${tip} ${y-4} L ${tip+4} ${y-4.5}" stroke="${BRASS}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M ${tip+2} ${y} Q ${(tip+tail)/2} ${y+wob} ${tail} ${y}" stroke="${BRASS}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <text x="${tail+6}" y="${y+5}" font-family="monospace" font-size="14" fill="${WHITE}" text-anchor="start">${label}</text>
    </g>`;
  }
  const tail = baseX, tip = baseX + 16;
  return `<g>
    <text x="${tail-6}" y="${y+5}" font-family="monospace" font-size="14" fill="${WHITE}" text-anchor="end">${label}</text>
    <path d="M ${tail} ${y} Q ${(tail+tip)/2} ${y+wob} ${tip-2} ${y}" stroke="${BRASS}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M ${tip} ${y-4} L ${tip} ${y} L ${tip-4} ${y+4.5}" stroke="${BRASS}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M ${tip} ${y-4} L ${tip-4} ${y-4.5}" stroke="${BRASS}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </g>`;
}

async function main() {
  const W = 960, H = 420;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W/2}" height="${H}" fill="${NAVY}"/>
    <rect x="${W/2}" width="${W/2}" height="${H}" fill="${NAVY}"/>
    <line x1="${W/2}" y1="0" x2="${W/2}" y2="${H}" stroke="rgba(255,255,255,0.3)"/>

    <text x="24" y="30" font-family="monospace" font-size="13" fill="rgba(255,255,255,0.5)">对照：现有默认套路</text>
    <rect x="24" y="46" width="480" height="120" rx="5" fill="${PAPER}"/>
    ${regularTag(44, 60, '随笔')}
    ${regularTag(120, 60, 'blog')}
    ${regularBtn(44, 100)}

    <g transform="translate(44,205)">${regularQuote(0, 40)}</g>
    <g transform="translate(80, 235)"><text font-family="serif" font-size="15" fill="${WHITE}">一段引用的文字内容……</text></g>

    ${regularArrow(44, 320, 'l')}
    ${regularArrow(280, 320, 'r').replace('上一页', '下一页')}

    <text x="${W/2+24}" y="30" font-family="monospace" font-size="13" fill="rgba(255,255,255,0.5)">实验：手工感 seed 派生版</text>
    <rect x="${W/2+24}" y="46" width="480" height="120" rx="5" fill="${PAPER}"/>
    ${irregularTag(W/2+44, 60, '随笔', 101)}
    ${irregularTag(W/2+128, 60, 'blog', 202)}
    ${irregularBtn(W/2+44, 100, 303)}

    <g transform="translate(${W/2+44},205)">${irregularQuote(0, 40, 404)}</g>
    <g transform="translate(${W/2+80}, 235)"><text font-family="serif" font-size="15" fill="${WHITE}">一段引用的文字内容……</text></g>

    ${irregularArrow(W/2+44, 320, 'l', 505, '上一页')}
    ${irregularArrow(W/2+340, 320, 'r', 606, '下一页')}
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, 'compare-elements.png'));
  console.log('done');
}
main().catch(e => { console.error(e); process.exit(1); });
