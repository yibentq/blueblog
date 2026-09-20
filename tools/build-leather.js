#!/usr/bin/env node
/**
 * blog.blue 皮革底纹生成器
 *
 * 为什么不用 CSS/SVG 的 feTurbulence：
 *   - 各浏览器对 SVG 滤镜的栅格化不一致，Safari/Chrome/Firefox 出来的颗粒大小和明暗都不同；
 *   - 滤镜每次重绘都要重新算，长文章滚动会掉帧；
 *   - 想要的是"真皮"的粒面（一颗颗鼓起的小圆丘 + 之间的细褶皱），噪声滤镜只能给出"脏"，给不出"粒"。
 * 所以离线生成成静态图，仓库里只留脚本和产物，改配方只改这一个文件。
 *
 * 做法：
 *   1. 细胞噪声（Worley）：每个粒面是一个细胞，F1 = 到最近种子点的距离，F2 = 到次近的；
 *      F2-F1 趋近 0 的地方就是两粒之间的褶皱（凹），细胞中心鼓起（凸）——这就是荔枝纹/小牛皮粒面。
 *   2. 每粒高度带随机偏差 + 极细的多层值噪声（毛孔、纤维），避免"整齐得像塑料"。
 *   3. 高度图 → 法线 → 左上光源漫反射 + 一点高光，得到真实的凹凸光影。
 *   4. 低频色斑（皮革着色不均、手工染色留下的云纹）叠在基色上。
 *   5. 全部取模回绕，四边无缝，可以直接 background-repeat。
 *
 * 用法： node tools/build-leather.js            重新生成 public/img/leather-*.webp
 *        node tools/build-leather.js --preview   另存一张 PNG 预览到 /tmp
 */
const path = require('path');
const sharp = require('sharp');

const SIZE = 768; // 必须能被 cell 整除，也最好是 16 的倍数（webp 宏块），否则接缝处会有压缩痕迹

// ---------- 可复现的随机数（同一份配方永远出同一张图）----------
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

// ---------- 无缝值噪声 ----------
function makeValueNoise(rand, lattice) {
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const smooth = (t) => t * t * (3 - 2 * t);
  return function (x, y) {
    // x,y ∈ [0,1)，取模回绕
    const fx = x * lattice, fy = y * lattice;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const xa = ((x0 % lattice) + lattice) % lattice, xb = (xa + 1) % lattice;
    const ya = ((y0 % lattice) + lattice) % lattice, yb = (ya + 1) % lattice;
    const a = grid[ya * lattice + xa], b = grid[ya * lattice + xb];
    const c = grid[yb * lattice + xa], d = grid[yb * lattice + xb];
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  };
}

// ---------- 高度图：粒面 + 微纹理 ----------
function buildHeight(opts) {
  const { cell, seed, crease, jitter, domeBias, fine, pores } = opts;
  const rand = mulberry32(seed);
  const n = SIZE / cell; // 每边细胞数
  // 每个细胞一个种子点（带抖动）和一个随机高度系数
  const pts = new Float32Array(n * n * 2);
  const cellH = new Float32Array(n * n);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      pts[i * 2] = (cx + 0.5 + (rand() - 0.5) * jitter) * cell;
      pts[i * 2 + 1] = (cy + 0.5 + (rand() - 0.5) * jitter) * cell;
      cellH[i] = 0.82 + rand() * 0.18;
    }
  }
  const noiseA = makeValueNoise(mulberry32(seed + 11), 96); // 纤维
  const noiseB = makeValueNoise(mulberry32(seed + 23), 48);
  const noiseC = makeValueNoise(mulberry32(seed + 37), 24);
  const poreRand = mulberry32(seed + 91);

  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const cy0 = Math.floor(y / cell);
    for (let x = 0; x < SIZE; x++) {
      const cx0 = Math.floor(x / cell);
      let f1 = 1e9, f2 = 1e9, best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ccx = cx0 + dx, ccy = cy0 + dy;
          const wx = ((ccx % n) + n) % n, wy = ((ccy % n) + n) % n;
          const i = wy * n + wx;
          // 种子点坐标要还原到"未回绕"的位置才能算对距离
          const px = pts[i * 2] + (ccx - wx) * cell;
          const py = pts[i * 2 + 1] + (ccy - wy) * cell;
          const d = Math.hypot(x - px, y - py);
          if (d < f1) { f2 = f1; f1 = d; best = i; } else if (d < f2) { f2 = d; }
        }
      }
      // 褶皱：两粒交界处 F2-F1 → 0
      const edge = Math.min(1, (f2 - f1) / (cell * crease));
      const groove = edge * edge * (3 - 2 * edge);
      // 圆丘：中心最高
      const dome = 1 - Math.pow(Math.min(1, f1 / (cell * 0.78)), 2) * domeBias;
      let v = groove * dome * cellH[best];

      // 纤维 / 毛孔 / 手工鞣制留下的起伏
      const u = x / SIZE, w = y / SIZE;
      v += (noiseA(u, w) - 0.5) * fine;
      v += (noiseB(u, w) - 0.5) * fine * 0.9;
      v += (noiseC(u, w) - 0.5) * fine * 0.5;
      if (pores && poreRand() < pores) v -= 0.16 + poreRand() * 0.18; // 偶发毛孔
      h[y * SIZE + x] = v;
    }
  }
  return h;
}

// ---------- 光照 + 上色 ----------
function shade(h, o) {
  const { base, light, strength, spec, mottle, seed, aoStrength, tint, lightGain, exposure = 1 } = o;
  const mott = makeValueNoise(mulberry32(seed + 5), 6);
  const mott2 = makeValueNoise(mulberry32(seed + 6), 14);
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  const L = (() => { // 光源：左上、偏高
    const v = [-0.55, -0.6, 0.58];
    const m = Math.hypot(...v);
    return v.map((c) => c / m);
  })();
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const nl = Math.hypot(dx, dy, 1);
      const nx = -dx / nl, ny = -dy / nl, nz = 1 / nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      // 半程向量高光（皮革的油润感来自这里）
      const hv = [L[0], L[1], L[2] + 1];
      const hm = Math.hypot(...hv);
      const sp = Math.pow(Math.max(0, (nx * hv[0] + ny * hv[1] + nz * hv[2]) / hm), 38) * spec;
      // 环境遮蔽：褶皱越深越暗
      const ao = 1 - aoStrength * Math.pow(1 - Math.min(1, Math.max(0, at(x, y))), 2);
      // 平面 diff = L[2]，让平整处亮度恰好等于基色；凹凸只在此基础上加减，色调不会整体漂灰
      const lit = (1 + (diff - L[2]) * lightGain) * ao * exposure;
      const u = x / SIZE, w = y / SIZE;
      const cloud = 1 + ((mott(u, w) - 0.5) * 0.9 + (mott2(u, w) - 0.5) * 0.5) * mottle;
      const o3 = (y * SIZE + x) * 3;
      for (let c = 0; c < 3; c++) {
        let val = base[c] * lit * cloud + light[c] * sp + tint[c] * (1 - ao) * 20;
        buf[o3 + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }
  return buf;
}

// ---------- 两张底纹的配方 ----------
const RECIPES = {
  // 深靛蓝细粒皮：页面底。粒细、反差低，让上面的线格和白字说了算，皮革只做质感不抢戏。
  navy: {
    file: 'leather-navy-v1.webp',
    height: { cell: 16, seed: 1907, crease: 0.3, jitter: 0.9, domeBias: 0.9, fine: 0.07, pores: 0.001 },
    sub: { mix: 0.10, height: { cell: 8, seed: 78, crease: 0.9, jitter: 1.0, domeBias: 0.8, fine: 0.05, pores: 0 } },
    shade: { base: [17, 50, 90], light: [130, 170, 225], strength: 1.2, lightGain: 0.5, exposure: 1.04, spec: 0.12, mottle: 0.16, seed: 1907, aoStrength: 0.22, tint: [-0.4, -0.1, 0.4] },
    quality: 74,
  },
  // 象牙色植鞣革（粗粒）：文章卡片。粒更大、更不规则、毛孔更多——"粗糙"就在这里。
  // 基色刻意接近原来的纸色，正文墨色的对比度不变，只是纸变成了皮。
  cream: {
    file: 'leather-cream-v1.webp',
    height: { cell: 24, seed: 2026, crease: 0.42, jitter: 1.0, domeBias: 0.95, fine: 0.10, pores: 0.0018 },
    sub: { mix: 0.13, height: { cell: 8, seed: 77, crease: 0.9, jitter: 1.0, domeBias: 0.8, fine: 0.05, pores: 0 } },
    shade: { base: [246, 238, 216], light: [255, 250, 236], strength: 1.25, lightGain: 0.5, exposure: 1.08, spec: 0.10, mottle: 0.05, seed: 2026, aoStrength: 0.16, tint: [0.7, 0.4, -0.2] },
    quality: 70,
  },
};

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'img');
  const preview = process.argv.includes('--preview');
  for (const [name, r] of Object.entries(RECIPES)) {
    let h = buildHeight(r.height);
    if (r.sub) {
      // 第二层更细的粒面叠在大粒面上：大粒决定"皮的性格"，细粒决定"摸上去粗不粗"
      const h2 = buildHeight(r.sub.height);
      for (let i = 0; i < h.length; i++) h[i] = h[i] * (1 - r.sub.mix * 0.4) + (h2[i] - 0.5) * r.sub.mix + 0.5 * r.sub.mix * 0.4;
    }
    const rgb = shade(h, r.shade);
    const img = sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } });
    await img.clone().webp({ quality: r.quality, effort: 5 }).toFile(path.join(outDir, r.file));
    if (preview) await img.clone().png().toFile(`/tmp/leather-${name}.png`);
    console.log(`[leather] ${r.file} 已生成`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
