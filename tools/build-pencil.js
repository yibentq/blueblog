#!/usr/bin/env node
/**
 * blog.blue 红铅笔排线生成器 —— 任务B「可能不单独立项」条目（高亮 mark）
 *
 * docs/UNFORGEABLE_DESIGN.md 第6节的判断：mark 该换的是隐喻本身——\"荧光笔\"是通用网页套路，
 * 跟\"图纸\"这个站的概念不搭；\"红蓝铅笔标注\"（制图/校对时用红铅笔在图上划重点）才贴题。
 * 原实现是 linear-gradient(transparent 58%, 铜色 58%) 的一条平直色带。
 *
 * 红铅笔划重点不是涂满，是**排线**：一组近似平行、倾斜的短笔画，每一笔——
 *   1. 起笔落笔的位置不齐（笔画长短不一，所以上沿是毛的，不是一条直线）；
 *   2. 压力沿笔画变化：起笔和收笔轻、中间重（两头渐细）；
 *   3. 角度有一点点抖（手腕的自然摆动），间距也不严格相等；
 *   4. 铅笔只蹭到纸面凸起的纤维，凹处不着色——这就是粒状的\"铅笔感\"，由纸纤维噪声决定，
 *      不是逐点随机；
 * 输出：横向周期 288px 的透明 PNG（RGB 已染成红铅笔色），CSS 里 repeat-x 铺在 mark 下半部。
 *
 * 用法：node tools/build-pencil.js            重新生成 public/img/pencil-hatch-v1.png
 *       node tools/build-pencil.js --preview  另存放大预览到 /tmp（米黄底）
 */
const path = require('path');
const sharp = require('sharp');

const T = 288, H = 14, S = 8;
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 纸纤维噪声：横向周期 T，纵向周期 KY 格
function tooth(seed, cell) {
  const r = mulberry32(seed), KX = Math.round(T / cell), KY = 24;
  const g = new Float32Array(KX * KY); for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (ix, iy) => g[(((iy % KY) + KY) % KY) * KX + (((ix % KX) + KX) % KX)];
  return (x, y) => {
    const fx = (x / T) * KX, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), ux = fx - ix, uy = fy - iy;
    const u = ux * ux * (3 - 2 * ux), v = uy * uy * (3 - 2 * uy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// ---- 笔画表：由种子决定，整张瓦片里固定 ----
const rnd = mulberry32(19930614);
const STROKES = [];
const N = 118;                     // 288 / 118 ≈ 2.4px 平均间距：排线要密到读得出"一片"
for (let i = 0; i < N; i++) {
  const x0 = (i + (rnd() - 0.5) * 0.7) * (T / N);          // 间距不严格相等
  const ang = (58 + (rnd() - 0.5) * 7) * Math.PI / 180;     // 倾角约 58°，抖 ±3.5°
  const y0 = rnd() * 2.4;                                    // 起笔高度不齐（自底向上画：y 从 H 往上）
  const y1 = H - rnd() * 3.2;
  STROKES.push({ x0, ang, top: y0, bot: y1, w: 1.0 + rnd() * 0.5, pr: 0.7 + rnd() * 0.3, skip: rnd() < 0.05 });
}

function build() {
  const W = T * S, HH = H * S;
  const cov = new Float32Array(W * HH);
  const g1 = tooth(31, 0.9), g2 = tooth(59, 2.4);
  for (const s of STROKES) {
    if (s.skip) continue;
    const dx = 1 / Math.tan(s.ang);                          // 每向上 1px，x 右移 dx
    for (const shiftX of [-T, 0, T]) {                       // 回绕
      for (let py = 0; py < HH; py++) {
        const y = py / S;
        if (y < s.top - 0.6 || y > s.bot + 0.6) continue;
        const t = (y - s.top) / (s.bot - s.top);             // 0 顶端 .. 1 底端
        const taper = smooth(0, 0.22, t) * smooth(0, 0.22, 1 - t);
        const cx = s.x0 + shiftX + (s.bot - y) * dx;
        const hw = s.w * (0.4 + 0.6 * taper) / 2;
        const press = s.pr * (0.35 + 0.65 * taper);
        for (let px = Math.floor((cx - hw - 1) * S); px <= Math.ceil((cx + hw + 1) * S); px++) {
          if (px < 0 || px >= W) continue;
          const d = Math.abs(px / S - cx);
          const a = (1 - smooth(hw * 0.6, hw + 0.35, d)) * press;
          const i = py * W + px; cov[i] = 1 - (1 - cov[i]) * (1 - a);   // 多笔叠加：越叠越实
        }
      }
    }
  }
  // 粒状：铅笔只蹭到纸的凸处
  const out = new Float32Array(T * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < T; x++) {
    let sum = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const xx = x + (i + 0.5) / S, yy = y + (j + 0.5) / S;
      const c = cov[(y * S + j) * W + x * S + i];
      const gr = 1 - smooth(0.42, 0.86, g1(xx, yy)) * 0.62 * (0.75 + 0.25 * g2(xx, yy));
      sum += c * gr;
    }
    out[y * T + x] = sum / (S * S);
  }
  return out;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'img');
  const cov = build();
  const buf = Buffer.alloc(T * H * 4);
  for (let i = 0; i < T * H; i++) {
    buf[i * 4] = 179; buf[i * 4 + 1] = 73; buf[i * 4 + 2] = 47;             // 红铅笔色（同 --danger）
    buf[i * 4 + 3] = Math.round(Math.min(1, cov[i] * 0.95) * 255);
  }
  const png = await sharp(buf, { raw: { width: T, height: H, channels: 4 } }).png().toBuffer();
  await sharp(png).toFile(path.join(outDir, 'pencil-hatch-v1.png'));
  console.log('[pencil] pencil-hatch-v1.png 已生成');
  if (process.argv.includes('--preview')) {
    await sharp({ create: { width: T, height: 30, channels: 4, background: '#F6EFE0' } })
      .composite([{ input: png, top: 8, left: 0 }]).png().toBuffer()
      .then((b) => sharp(b).resize(T * 4, 120, { kernel: 'nearest' }).png().toFile('/tmp/pencil-preview.png'));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
