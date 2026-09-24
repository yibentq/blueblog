#!/usr/bin/env node
/**
 * blog.blue 墨线生成器 —— 任务B「原创材质」条目（callout / hr / 表格分隔线）
 *
 * docs/UNFORGEABLE_DESIGN.md 第6节这一行的原话是：「网格线的"墨水+纸"材质做出来后，
 * 直接套小尺度版本，不单独立项」。网格线（tools/build-grid.js）已经落地，所以这里不是
 * 另起一套东西，而是**同一把尺子**画在米黄卡片上的版本：
 *
 *   1. 同一根尺子：RULER 的谐波和相位跟 build-grid.js 用同一个种子、同一个抽取顺序，
 *      所以正文里的 hr、表格线、提示框色带，弯的方式跟背景线格是同一根尺子的边。
 *   2. 墨线不是凹槽：卡片是纸，不是皮。线是笔沿尺子拖出来的墨——压力大的地方线略粗、
 *      墨略深；纸面有纤维，个别地方墨挂不住（漏墨点），这些漏点由纸的纤维噪声决定，
 *      不是逐点随机。
 *   3. 针孔跟主线节距走：每 140px（= 网格的主线间距）有一个扎针留下的小墨点，
 *      中心透出纸色（针孔），跟背景上皮里的针孔是同一件事在纸上的样子。
 *
 * 输出（全部是「只有形状」的 alpha 瓦片，横向周期 560px = 网格瓦片边长，整数谐波，无缝）：
 *   public/img/ink-rule-v1.png        细线（hr）——CSS 里当 mask 用，颜色由 CSS 决定
 *   public/img/ink-rule-brass-v1.png  细线，预先染成黄铜色（表格上下沿/表头下沿，table 不能挂伪元素）
 *   public/img/ink-rule-faint-v1.png  同上但浅（表格行间）
 *   public/img/ink-bar-v1.png         竖向粗线（提示框左侧色带）——mask，宽 8px、高 560px 周期
 *   public/img/ink-rule-light-v1.png / ink-rule-lightfaint-v1.png
 *                                     白墨线（靛蓝皮上的分隔：评论、站点地图）——蓝图本来就是蓝底白线
 *   public/img/ink-ruled-v1.png       560×28 的横格纸一行（评论框的稿纸线，行高 28px）
 *
 * 用法：node tools/build-ink.js            重新生成
 *       node tools/build-ink.js --preview  另存放大预览到 /tmp（米黄底）
 */
const path = require('path');
const sharp = require('sharp');

const T = 560;      // 周期 (px)，同 build-grid.js 的瓦片边长
const S = 8;        // 超采样
const H = 8;        // 瓦片厚度 (px)
const TAU = Math.PI * 2;
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

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

// ---- 同一把尺子：种子与抽取顺序必须和 build-grid.js 的 RULER 完全一致 ----
const gridRnd = mulberry32(20260924);
const RULER = [
  { k: 1, a: 0.42, p: gridRnd() * TAU },
  { k: 2, a: 0.30, p: gridRnd() * TAU },
  { k: 3, a: 0.16, p: gridRnd() * TAU },
  { k: 7, a: 0.05, p: gridRnd() * TAU },
];
const bend = (u) => RULER.reduce((s, h) => s + h.a * Math.sin((u / T) * TAU * h.k + h.p), 0);

// ---- 纸的纤维噪声：横向周期 T（格点数 K 取整）、纵向周期 16 ----
function paperTooth(seed, cell) {
  const r = mulberry32(seed);
  const KX = Math.round(T / cell), KY = 16;
  const g = new Float32Array(KX * KY);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (ix, iy) => g[(((iy % KY) + KY) % KY) * KX + (((ix % KX) + KX) % KX)];
  return (x, y) => {
    const fx = (x / T) * KX, fy = (y / cell) % KY;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ux = fx - ix, uy = fy - iy;
    const u = ux * ux * (3 - 2 * ux), v = uy * uy * (3 - 2 * uy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/**
 * 沿横向画一条墨线（周期 T × 厚 H）。返回 Float32Array 覆盖率 0..1（已缩回 1x）。
 * opt.hw      半线宽 (px)
 * opt.shift   尺子放在哪一段（每种线不同，避免 hr 和表格线长得一模一样）
 * opt.pins    是否每 140px 扎一个针孔墨点
 * opt.seed    纸纤维种子
 */
function renderRule(opt) {
  const TH = opt.h || H;                      // 瓦片厚度（默认 8px；稿纸行用 28px）
  const W = T * S, HH = TH * S;
  const tooth = paperTooth(opt.seed, 1.6);
  const tooth2 = paperTooth(opt.seed + 77, 5.5);   // 更大尺度的纸浆不匀
  const cov = new Float32Array(W * HH);
  const cyBase = opt.cy != null ? opt.cy : TH / 2;
  const P1 = opt.seed % 7, P2 = opt.seed % 11; // 压力曲线相位（由种子决定，不逐点随机）
  const press = (x) => {
    const t = (x / T) * TAU;
    return 0.86 + 0.12 * Math.sin(t * 2 + P1) + 0.08 * Math.sin(t * 5 + P2) + 0.04 * Math.sin(t * 13 + P1 * 2);
  };
  for (let py = 0; py < HH; py++) {
    const y = py / S;
    for (let px = 0; px < W; px++) {
      const x = px / S;
      const cy = cyBase + bend(x + opt.shift);
      const d = Math.abs(y - cy);
      const p = press(x);
      const hw = opt.hw * (0.88 + 0.35 * (p - 0.75));           // 压得重，线略粗
      let a = 1 - smooth(hw, hw + 0.42, d);                       // 线身 + 软边
      a *= Math.min(1, 0.55 + p * 0.5);                           // 压力决定墨的深浅
      // 纸的纤维：个别位置墨挂不住（漏墨），尺度比线宽还小，所以只在线上留细碎缺口
      const t1 = tooth(x + 13, y * 1.3), t2 = tooth2(x, y);
      a *= 1 - smooth(0.78, 0.97, t1) * 0.75;
      a *= 0.9 + 0.1 * t2;
      // 洇边：墨沿纤维往外晕开一点点，压力大处更明显
      a += 0.1 * Math.exp(-(d * d) / (2 * 0.85 * 0.85)) * (p - 0.6) * (0.6 + 0.4 * t2);
      cov[py * W + px] = Math.max(0, Math.min(1, a));
    }
  }
  if (opt.pins) {
    for (let k = 0; k < 4; k++) {
      const pr = mulberry32(opt.seed + 900 + k);
      const r = 1.55 + pr() * 0.5, q = 0.85 + pr() * 0.15, hole = 0.42 + pr() * 0.18;
      const X = k * 140 + 0.5;
      const cy = cyBase + bend(X + opt.shift);
      for (let py = 0; py < HH; py++) {
        for (let dx = -Math.ceil((r + 1) * S); dx <= Math.ceil((r + 1) * S); dx++) {
          const px = Math.round(X * S) + dx;
          const x = px / S, y = py / S;
          const dist = Math.hypot(x - X, y - cy);
          if (dist > r + 0.6) continue;
          const pool = q * (1 - smooth(r * 0.75, r + 0.6, dist));    // 墨点
          const ink = dist < hole ? pool * smooth(hole * 0.5, hole, dist) : pool; // 中心透纸
          const idx = py * W + (((px % W) + W) % W);
          cov[idx] = Math.max(cov[idx] * (dist < hole ? 0.4 : 1), ink);
        }
      }
    }
  }
  // 缩回 1x（盒式平均）
  const out = new Float32Array(T * TH);
  for (let y = 0; y < TH; y++) for (let x = 0; x < T; x++) {
    let s = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) s += cov[(y * S + j) * W + x * S + i];
    out[y * T + x] = s / (S * S);
  }
  return out;
}

const toRGBA = (cov, w, h, [r, g, b], scale = 1) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b;
    buf[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, cov[i] * scale)) * 255);
  }
  return buf;
};

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'img');
  const preview = process.argv.includes('--preview');
  const files = {};

  const thin = renderRule({ hw: 0.62, shift: 91, pins: true, seed: 4101 });
  // hr：mask 用，颜色随便（CSS 决定），存成墨色便于直接看
  files['ink-rule-v1.png'] = { w: T, h: H, buf: toRGBA(thin, T, H, [22, 35, 58]) };

  const brass = renderRule({ hw: 0.55, shift: 233, pins: false, seed: 4102 });
  files['ink-rule-brass-v1.png'] = { w: T, h: H, buf: toRGBA(brass, T, H, [156, 122, 56], 0.95) };
  files['ink-rule-faint-v1.png'] = { w: T, h: H, buf: toRGBA(brass, T, H, [156, 122, 56], 0.42) };

  // 提示框色带：更粗的一笔，沿竖向；横版渲染后转 90°
  const bar = renderRule({ hw: 1.55, shift: 377, pins: false, seed: 4103 });
  const barPng = await sharp(toRGBA(bar, T, H, [22, 35, 58]), { raw: { width: T, height: H, channels: 4 } })
    .rotate(90).png().toBuffer();
  files['ink-bar-v1.png'] = { png: barPng };

  // 白墨线：同一把尺子，换个位置压；颜色是蓝图的白线
  const light = renderRule({ hw: 0.6, shift: 141, pins: false, seed: 4104 });
  files['ink-rule-light-v1.png'] = { w: T, h: H, buf: toRGBA(light, T, H, [234, 240, 248], 0.62) };
  files['ink-rule-lightfaint-v1.png'] = { w: T, h: H, buf: toRGBA(light, T, H, [234, 240, 248], 0.26) };

  // 稿纸行：28px 一行，线压在行底（y=24），用于评论框的横格
  const ruled = renderRule({ hw: 0.5, shift: 19, pins: false, seed: 4105, h: 28, cy: 24 });
  files['ink-ruled-v1.png'] = { w: T, h: 28, buf: toRGBA(ruled, T, 28, [156, 122, 56], 0.5) };

  for (const [name, f] of Object.entries(files)) {
    const png = f.png || (await sharp(f.buf, { raw: { width: f.w, height: f.h, channels: 4 } }).png().toBuffer());
    await sharp(png).toFile(path.join(outDir, name));
    console.log('[ink]', name, '已生成');
  }

  if (preview) {
    const paper = { create: { width: T, height: 120, channels: 4, background: '#F6EFE0' } };
    const layers = [
      { input: path.join(outDir, 'ink-rule-v1.png'), top: 20, left: 0 },
      { input: path.join(outDir, 'ink-rule-brass-v1.png'), top: 50, left: 0 },
      { input: path.join(outDir, 'ink-rule-faint-v1.png'), top: 80, left: 0 },
    ];
    const base = await sharp(paper).composite(layers).png().toBuffer();
    await sharp(base).resize(T * 3, 360, { kernel: 'nearest' }).png().toFile('/tmp/ink-preview.png');
    await sharp(path.join(outDir, 'ink-bar-v1.png')).extract({ left: 0, top: 0, width: 8, height: 120 })
      .resize(48, 720, { kernel: 'nearest' }).flatten({ background: '#F6EFE0' }).png().toFile('/tmp/ink-bar-preview.png');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
