#!/usr/bin/env node
/**
 * blog.blue 烫金纹理生成器 —— 任务B「原创材质」条目（烫金分隔线）
 *
 * 现状（要替换掉的）：三处分隔线（顶部标题栏下沿、页脚上沿、文章标题下的短横）都是
 * 同一条 CSS `linear-gradient(90deg, 铜色, 透明)` 的 1~3px 平直色带——"渐变"不是烫金，
 * 烫金的视觉来自它的物理成因，而不是"金色 + 渐隐"。
 *
 * 这版复用 build-leather.js / build-stitch.js 同一套「高度场 → 法线 → 光照」管线，
 * 但按"热烫金箔"的真实工艺重新建模：
 *   1. 烫版把皮面压出一条**凹槽**（梯形截面：平底 + 两侧斜坡）——高度场是凹的，不是凸的，
 *      这跟缝线（凸起的圆柱）是相反的几何。
 *   2. 金箔转印到凹槽底部，不是均匀涂一层：箔面本身是拉丝金属，用沿线方向拉长的噪声
 *      扰动微法线，产生"各向异性"的拉丝光泽（金属看起来是金属，靠的就是这个）。
 *   3. 整条线上有缓慢移动的反光带（低频正弦叠加）——同一根金属条在不同位置反射到的
 *      环境光不同，不是恒定的一个颜色。
 *   4. **转印不完整**：越往线的末端、箔越薄，出现斑驳的漏烫——箔没粘上的地方只剩下
 *      压出来的暗凹槽。这取代了原来"渐变到透明"的做法：渐隐不再是数学插值，而是
 *      转印覆盖率逐渐下降（真实烫金件磨损/压力不足时就是这样的）。
 *   5. 凹槽上沿（背光侧）压出一道暗线，下沿（迎光侧）有一线亮边——跟皮革、缝线同一个
 *      光源方向，所以三者放在一起属于同一个"世界"。
 *   6. 凹槽中心线沿线极缓慢地偏移（烫版和皮面对位有微小误差）——量级不到半个像素，
 *      是"整条线连续有记忆的偏移"，不是逐点抖动。
 *
 * 输出（透明底 PNG，叠在皮革/纸上）：
 *   public/img/foil-line-v1.png   长线：标题栏下沿 / 页脚上沿，从左端实到右端渐无
 *   public/img/foil-bar-v1.png    短横：文章标题下的那一小段
 *
 * 用法：node tools/build-foil.js            重新生成
 *       node tools/build-foil.js --preview  另存放大预览到 /tmp（深蓝底 + 米黄底各一份）
 */
const path = require('path');
const sharp = require('sharp');

const S = 6; // 超采样倍数

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

// 二维值噪声（格点随机 + smoothstep 插值）。scaleX/scaleY 分开，才能造出"沿线拉长"的拉丝纹。
function makeNoise(seed) {
  const r = mulberry32(seed);
  const N = 256;
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (ix, iy) => g[(((iy % N) + N) % N) * N + (((ix % N) + N) % N)];
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// 颜色：三档金属色带。r 是"这一点反射了多少环境光"，0=最暗的阴影金，1=最亮的高光。
const SHADOW = [104, 72, 30];
const BASE = [199, 154, 69];   // = var(--brass)，和站内其他烫金色一致
const HIGH = [252, 230, 172];
function ramp(r) {
  const t = Math.max(0, Math.min(1, r));
  const out = [0, 0, 0];
  if (t < 0.5) {
    const k = t / 0.5;
    for (let c = 0; c < 3; c++) out[c] = SHADOW[c] + (BASE[c] - SHADOW[c]) * k;
  } else {
    const k = (t - 0.5) / 0.5;
    for (let c = 0; c < 3; c++) out[c] = BASE[c] + (HIGH[c] - BASE[c]) * k;
  }
  return out;
}

/**
 * @param length  贴图长度(px，1x)
 * @param height  贴图高度(px，1x)
 * @param foilW   槽底（箔面）宽度(px，1x)
 * @param bevel   两侧斜坡宽度(px，1x)
 * @param fade    true：转印覆盖率沿长度下降到 0（长线）；false：整段基本完整，只有边角轻微磨损（短横）
 * @param seed    每张图独立的种子
 */
function build({ length, height, foilW, bevel, fade, seed }) {
  const W = length * S, Hs = height * S;
  const nLow = makeNoise(seed);        // 低频：反射带、漏烫的大块分布
  const nBrush = makeNoise(seed + 7);  // 拉丝：沿 x 极度拉长
  const nSpeck = makeNoise(seed + 13); // 高频：漏烫的细碎斑点
  const nAlign = makeNoise(seed + 29); // 极低频：烫版对位偏移

  const hw = (foilW / 2) * S;
  const bv = bevel * S;
  const cyBase = Hs / 2;

  // ---- 高度场：凹槽深度 depth(x,y) ∈ [0,1]，1 = 槽底 ----
  const depth = new Float32Array(W * Hs);
  for (let x = 0; x < W; x++) {
    // 中心线偏移：<0.5px，沿整条线连续缓变
    const cy = cyBase + (nAlign(x / (140 * S), 3.3) - 0.5) * 0.9 * S;
    for (let y = 0; y < Hs; y++) {
      const d = Math.abs(y - cy);
      let v;
      if (d <= hw) v = 1;
      else if (d < hw + bv) v = 1 - smooth(0, 1, (d - hw) / bv);
      else v = 0;
      depth[y * W + x] = v;
    }
  }
  const D = (x, y) => (y < 0 || y >= Hs || x < 0 || x >= W) ? 0 : depth[y * W + x];

  // ---- 转印覆盖率 T(x,y)：1 = 箔完整粘上，0 = 漏烫 ----
  const transfer = (x, y) => {
    const u = x / W;
    // 漏烫阈值随位置抬高：长线越往右越薄；短横只在两端轻微磨损
    let thr;
    // 值噪声的实际分布集中在 0.25~0.75，阈值要在这个区间里扫过，覆盖率才是均匀渐降而不是突然断掉
    if (fade) thr = 0.2 + 0.6 * Math.pow(smooth(0.03, 1, u), 0.85);
    else thr = 0.18 + 0.5 * smooth(0.5, 1, u) + 0.08 * smooth(0.12, 0, u);
    const big = nLow(x / (26 * S), y / (2.2 * S) + 11);
    const fine = nSpeck(x / (1.6 * S), y / (1.3 * S) + 5);
    const n = big * 0.62 + fine * 0.38;
    return smooth(thr - 0.07, thr + 0.07, n);
  };

  const L = (() => {
    const v = [-0.55, -0.6, 0.58]; // 和皮革/缝线同一个光源
    const m = Math.hypot(...v);
    return v.map((c) => c / m);
  })();

  const buf = Buffer.alloc(W * Hs * 4);
  const K = 3.2; // 高度→法线的放大系数（凹槽比缝线浅，边缘要更陡才有压印感）

  for (let y = 0; y < Hs; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const dep = D(x, y);
      // 微法线扰动：拉丝金属。只在箔面上起作用
      const brush = nBrush(x / (38 * S), y / (0.55 * S) + 21) - 0.5;
      const T = transfer(x, y);
      const foilCover = smooth(0.35, 0.8, dep) * T;

      // 凹槽本身的法线（对皮面和箔面都成立）
      const dx = (D(x + 1, y) - D(x - 1, y)) * K * -1; // depth 是"凹"，高度取反
      const dy = (D(x, y + 1) - D(x, y - 1)) * K * -1;
      // 箔面：叠加拉丝微扰（主要沿 y 方向的微小起伏 → 高光被拉成沿线方向的细条）
      const fdy = dy + brush * 0.9 * (dep > 0.5 ? 1 : 0);
      const nl = Math.hypot(dx, fdy, 1);
      const nx = -dx / nl, ny = -fdy / nl, nz = 1 / nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const hv = [L[0], L[1], L[2] + 1];
      const hm = Math.hypot(...hv);
      const spec = Math.pow(Math.max(0, (nx * hv[0] + ny * hv[1] + nz * hv[2]) / hm), 20);

      // 反射带：两个不同频率的正弦叠加，沿线缓慢明暗交替
      const band = 0.5 + 0.5 * Math.sin((x / S) * 0.045 + seed) * 0.6 + 0.25 * Math.sin((x / S) * 0.0113 + seed * 0.3);

      let R = 0, G = 0, B = 0, A = 0;

      if (foilCover > 0.002) {
        const r = 0.34 + diff * 0.42 + band * 0.26 + spec * 0.5 + brush * 0.22;
        const c = ramp(r);
        R = c[0]; G = c[1]; B = c[2];
        A = foilCover;
      }

      // 凹槽的皮面部分（斜坡 + 漏烫处的槽底）：只剩压痕。背光坡暗、迎光坡带一线亮边
      const leatherPart = (dep > 0.002 ? 1 : 0) * (1 - foilCover);
      if (leatherPart > 0.002) {
        // 中性斜面 diffuse ≈ L.z；偏离它的程度就是"这一处被压得多暗/多亮"
        const rel = diff - L[2];
        let pr, pg, pb, pa;
        if (rel < 0) { // 背光侧：暗
          pr = SHADOW[0] * 0.55; pg = SHADOW[1] * 0.5; pb = SHADOW[2] * 0.45;
          pa = Math.min(1, -rel * 1.5) * 0.85;
        } else {        // 迎光侧：一线暖亮边
          pr = HIGH[0]; pg = HIGH[1]; pb = HIGH[2];
          pa = Math.min(1, rel * 1.3) * 0.5;
        }
        // 漏烫处的槽底：压出来了但没有箔，是均匀的暗凹
        if (dep > 0.9) { pr = SHADOW[0] * 0.5; pg = SHADOW[1] * 0.45; pb = SHADOW[2] * 0.4; pa = Math.max(pa, 0.24); }
        pa *= leatherPart;
        // 与箔面合成（premultiplied over）
        const outA = A + pa * (1 - A);
        if (outA > 0) {
          R = (R * A + pr * pa * (1 - A)) / outA;
          G = (G * A + pg * pa * (1 - A)) / outA;
          B = (B * A + pb * pa * (1 - A)) / outA;
        }
        A = outA;
      }

      // 长线末端：烫版压力收尽，凹槽本身也渐渐浅到消失（不留一道硬切的暗槽）
      A *= fade ? 1 - smooth(0.8, 1, x / W) : 1 - 0.85 * smooth(0.93, 1, x / W);
      if (A < 0.002) { R = SHADOW[0]; G = SHADOW[1]; B = SHADOW[2]; A = 0; } // 透明像素的 RGB 也填成暗金，避免缩小时出黑边
      buf[o] = Math.round(Math.max(0, Math.min(255, R)));
      buf[o + 1] = Math.round(Math.max(0, Math.min(255, G)));
      buf[o + 2] = Math.round(Math.max(0, Math.min(255, B)));
      buf[o + 3] = Math.round(Math.max(0, Math.min(1, A)) * 255);
    }
  }
  return { buf, W, Hs };
}

const RECIPES = {
  // 长线：标题栏下沿、页脚上沿。高 10，槽底 2.4px，两侧各 1.6px 斜坡。
  line: { length: 520, height: 10, foilW: 2.4, bevel: 1.6, fade: true, seed: 4107 },
  // 短横：文章标题下。比长线粗一档（原本就是 3px 粗的短横），左端完整，右端有轻微漏烫收尾（原来的短横也是往右渐隐）。
  bar: { length: 96, height: 12, foilW: 3.6, bevel: 1.9, fade: false, seed: 5219 },
};

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'img');
  const preview = process.argv.includes('--preview');
  for (const [name, r] of Object.entries(RECIPES)) {
    const { buf, W, Hs } = build(r);
    const png = await sharp(buf, { raw: { width: W, height: Hs, channels: 4 } })
      .resize(r.length, r.height, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const file = `foil-${name}-v1.png`;
    await sharp(png).toFile(path.join(outDir, file));
    console.log(`[foil] ${file} 已生成 (${r.length}x${r.height})`);
    if (preview) {
      const scale = name === 'line' ? 3 : 8;
      const big = await sharp(png).resize(r.length * scale, r.height * scale, { kernel: 'nearest' }).png().toBuffer();
      for (const [bgName, bg] of [['navy', '#14243d'], ['cream', '#efe4cc']]) {
        await sharp({ create: { width: r.length * scale, height: Math.round(r.height * scale + 40 * scale / 3), channels: 3, background: bg } })
          .composite([{ input: big, left: 0, top: Math.round(20 * scale / 3) }])
          .png().toFile(`/tmp/foil-${name}-${bgName}-preview.png`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
