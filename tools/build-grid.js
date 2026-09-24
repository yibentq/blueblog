#!/usr/bin/env node
/**
 * blog.blue 压印线格生成器 —— 任务B「原创材质」条目（网格线 + 交点针孔）
 *
 * 现状（要替换掉的）：body 背景里 5 层 CSS 渐变——每 28px 一条辅线、每 140px 一条主线、
 * 每个交点一个一模一样的圆形针孔。所有线绝对笔直、绝对等距、绝对同深，是\"数学上的格子\"。
 *
 * 第一次尝试（experiments/unforgeable-linework）是给每条线的每个顶点各自加随机抖动，
 * 被站长否掉：那是\"手绘特效库\"的通用套路。这一版换判断依据——**瑕疵必须有共同的成因，
 * 所以彼此相关**：
 *
 *   1. **同一把尺子**：整张图所有横线、竖线都是用同一根尺子的边压出来的。这根尺子本身有一个
 *      固定的、极轻微的弯曲轮廓 bend(u)。每一条线 = 把尺子放在不同的位置(shift)、带一点点
 *      不同的倾角(tilt)压一遍，所以每条线的弯曲\"长得像\"同一个东西的不同截取，而不是各自独立的抖动。
 *      竖线和横线用同一根尺子（转了 90 度），因此两个方向的瑕疵也是同一个性格。
 *   2. **压力不均**：每条线的压印深度沿线缓慢起伏（手的压力），深处凹槽暗、浅处几乎看不见——
 *      不是逐点噪声，是每条线自己一条平滑的压力曲线。
 *   3. **针孔跟着线走**：交点处的针孔不是画在理想网格点上，而是画在\"这一条实际压出来的横线\"和
 *      \"这一条实际压出来的竖线\"真正相交的位置——线歪了，针孔跟着歪；每个针孔孔径/深度不同
 *      （扎针的力度），但由该点的种子决定，不是白噪声。
 *   4. 光照仍然是皮革同一套：凹槽 → 高度场 → 法线 → 左上光源；所以这些线压在\"皮\"里，不是画在皮上。
 *
 * 输出：560×560 的无缝瓦片（= 20 条辅线间距 = 4 个主线间距），透明底 webp，
 * CSS 里作为 body 背景的最上层，叠在 leather-navy 之上。
 *
 * 用法：node tools/build-grid.js            重新生成 public/img/grid-navy-v1.webp
 *       node tools/build-grid.js --preview  另存 PNG 预览到 /tmp（叠在皮革底上）
 */
const path = require('path');
const sharp = require('sharp');

const T = 560;      // 瓦片边长 (px)
const S = 4;        // 超采样
const STEP = 28;    // 辅线间距
const MAIN = 5;     // 每 5 条是主线（140px）
const N = T / STEP; // 20

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
const TAU = Math.PI * 2;
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const rnd = mulberry32(20260924);

// ---- 那一根尺子：周期为 T 的低频轮廓，单位 px。所有线共用。----
// 谐波数取整数才能在瓦片边界严丝合缝。振幅很小：真尺子弯不了多少，弯多了就是坏尺子。
const RULER = [
  { k: 1, a: 0.42, p: rnd() * TAU },
  { k: 2, a: 0.30, p: rnd() * TAU },
  { k: 3, a: 0.16, p: rnd() * TAU },
  { k: 7, a: 0.05, p: rnd() * TAU }, // 边缘的一点点小起伏（尺子边被磨过）
];
const bend = (u) => RULER.reduce((s, h) => s + h.a * Math.sin((u / T) * TAU * h.k + h.p), 0);

// ---- 每条线：尺子放的位置 shift、倾角 tilt、压力曲线 ----
function makeLine(idx) {
  const isMain = idx % MAIN === 0;
  return {
    isMain,
    shift: rnd() * T,                        // 尺子这次放在哪一段
    tilt: (rnd() - 0.5) * 2 * 0.0055,        // 倾角（弧度量级），<0.5px 的整体偏斜
    pressPh: [rnd() * TAU, rnd() * TAU, rnd() * TAU],
    pressBase: isMain ? 0.86 : 0.74,
    width: isMain ? 1.5 : 0.9,              // 凹槽底宽 (px)
    base: isMain ? 0.5 : 0.3,                // 槽底暗度（对应原 CSS 里的 0.5 / 0.3）
  };
}
const HLINES = Array.from({ length: N }, (_, i) => makeLine(i));
const VLINES = Array.from({ length: N }, (_, i) => makeLine(i));

// 线 L 在沿线位置 u (px) 处，偏离理想位置的距离 (px)
function offset(L, u) {
  const tilt = L.tilt * (T / TAU) * Math.sin((u / T) * TAU);
  return bend(u + L.shift) + tilt;
}
// 压力 0..1.2，沿线平滑起伏
function pressure(L, u) {
  const x = (u / T) * TAU;
  return L.pressBase + 0.13 * Math.sin(x * 2 + L.pressPh[0]) + 0.1 * Math.sin(x * 5 + L.pressPh[1]) + 0.05 * Math.sin(x * 11 + L.pressPh[2]);
}

// ---- 针孔：位置 = 真实相交点 ----
const PINS = [];
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const nx = i * STEP + 1, ny = j * STEP + 1; // 理想交点（线中心在 28k+1，跟原 CSS 的 0~2px 线宽居中一致）
    // 竖线 i 在 y≈ny 处的横向偏移、横线 j 在 x≈nx 处的纵向偏移；迭代一次足够收敛（偏移 <1.5px）
    let px = nx + offset(VLINES[i], ny);
    let py = ny + offset(HLINES[j], px);
    px = nx + offset(VLINES[i], py);
    const major = i % MAIN === 0 && j % MAIN === 0;
    PINS.push({
      x: px, y: py,
      r: (major ? 1.7 : 1.4) + rnd() * 0.5,   // 孔径
      q: (major ? 1.05 : 0.8) + rnd() * 0.45,   // 深度（扎针力度）
    });
  }
}
// 每个像素只需看附近的针孔：按格子索引
const pinAt = (i, j) => PINS[(((j % N) + N) % N) * N + (((i % N) + N) % N)];

function build() {
  const W = T * S;
  const depth = new Float32Array(W * W);
  const base = new Float32Array(W * W); // 该处槽底暗度系数
  const ring = new Float32Array(W * W); // 针孔边沿被挤起的一圈亮边（扎针时皮被顶起来的孔沿）

  const lineIdx = (c) => Math.round((c - 1) / STEP); // 最近的线序号（未取模）
  const wrapI = (i) => ((i % N) + N) % N;

  for (let py = 0; py < W; py++) {
    const y = py / S;
    for (let px = 0; px < W; px++) {
      const x = px / S;
      let dep = 0, bas = 0, rg = 0;

      // 横线：最近的一条
      {
        const j = lineIdx(y);
        const L = HLINES[wrapI(j)];
        const cy = j * STEP + 1 + offset(L, x);
        const d = Math.abs(y - cy);
        const hw = L.width / 2, bv = 0.4;
        if (d < hw + bv) {
          const prof = d <= hw ? 1 : 1 - smooth(0, 1, (d - hw) / bv);
          const v = prof * Math.max(0.15, pressure(L, x));
          if (v > dep) { dep = v; bas = L.base; }
        }
      }
      // 竖线：最近的一条
      {
        const i = lineIdx(x);
        const L = VLINES[wrapI(i)];
        const cx = i * STEP + 1 + offset(L, y);
        const d = Math.abs(x - cx);
        const hw = L.width / 2, bv = 0.4;
        if (d < hw + bv) {
          const prof = d <= hw ? 1 : 1 - smooth(0, 1, (d - hw) / bv);
          const v = prof * Math.max(0.15, pressure(L, y));
          if (v > dep) { dep = v; bas = L.base; }
        }
      }
      // 针孔：看周围 4 个候选交点
      {
        const i0 = Math.floor((x - 1) / STEP), j0 = Math.floor((y - 1) / STEP);
        for (let dj = 0; dj <= 1; dj++) {
          for (let di = 0; di <= 1; di++) {
            const P = pinAt(i0 + di, j0 + dj);
            // 瓦片回绕：把针孔坐标平移到离 (x,y) 最近的那个副本
            let ex = P.x + Math.round((x - P.x) / T) * T;
            let ey = P.y + Math.round((y - P.y) / T) * T;
            const dist = Math.hypot(x - ex, y - ey);
            const R = P.r + 0.75;
            if (dist < R) {
              const v = P.q * (1 - smooth(P.r * 0.7, R, dist));
              if (v > dep) { dep = v; bas = Math.max(bas, 0.85); }
            }
            const rd = 1 - Math.abs(dist - (P.r + 0.55)) / 0.85;
            if (rd > 0) {
              rg = Math.max(rg, rd * rd * (0.6 + 0.4 * Math.min(1, P.q)));
            }
          }
        }
      }
      depth[py * W + px] = dep;
      base[py * W + px] = bas;
      ring[py * W + px] = rg;
    }
  }

  // ---- 光照（皮革同一光源）----
  const L = (() => { const v = [-0.55, -0.6, 0.58]; const m = Math.hypot(...v); return v.map((c) => c / m); })();
  const buf = Buffer.alloc(W * W * 4);
  const D = (x, y) => depth[(((y % W) + W) % W) * W + (((x % W) + W) % W)]; // 瓦片回绕
  const K = 3.6;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const dep = depth[y * W + x];
      // 高度是凹的，取反
      const dx = -(D(x + 1, y) - D(x - 1, y)) * K;
      const dy = -(D(x, y + 1) - D(x, y - 1)) * K;
      const nl = Math.hypot(dx, dy, 1);
      const nz = 1 / nl, nx = -dx / nl, ny = -dy / nl;
      const rel = nx * L[0] + ny * L[1] + nz * L[2] - L[2];
      const floor = dep * base[y * W + x];         // 槽底本身的暗度
      let dark = floor + Math.max(0, -rel) * 0.4 * Math.min(1, dep * 3 + 0.2);
      let light = Math.max(0, rel) * 1.7;
      dark = Math.min(0.8, dark);
      light = Math.min(0.42, Math.max(light, ring[y * W + x] * 0.34));
      // 两层合成：先暗后亮（亮边压在暗槽之上，不会被吃掉）
      let r = 2, g = 9, b = 20, a = dark;
      if (light > 0.003) {
        const oa = light + a * (1 - light);
        r = (150 * light + r * a * (1 - light)) / oa;
        g = (190 * light + g * a * (1 - light)) / oa;
        b = (240 * light + b * a * (1 - light)) / oa;
        a = oa;
      }
      if (a < 0.003) { r = 2; g = 9; b = 20; a = 0; }
      buf[o] = Math.round(r); buf[o + 1] = Math.round(g); buf[o + 2] = Math.round(b);
      buf[o + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return { buf, W };
}

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'img');
  const preview = process.argv.includes('--preview');
  const { buf, W } = build();
  const png = await sharp(buf, { raw: { width: W, height: W, channels: 4 } })
    .resize(T, T, { kernel: 'lanczos3' }).png().toBuffer();
  await sharp(png).webp({ quality: 92, alphaQuality: 100, effort: 5 }).toFile(path.join(outDir, 'grid-navy-v1.webp'));
  console.log('[grid] grid-navy-v1.webp 已生成');
  if (preview) {
    const leather = path.join(outDir, 'leather-navy-v1.webp');
    const bg = await sharp(leather).resize(T, T).ensureAlpha().png().toBuffer();
    await sharp(bg).composite([{ input: png }]).png().toFile('/tmp/grid-preview.png');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
