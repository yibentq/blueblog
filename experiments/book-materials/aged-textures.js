#!/usr/bin/env node
/**
 * 材质实验：参照站长挑中的参照图（发霉笔记本 / antique leather tome）
 * 做几版"真的旧"而不是"滤镜的旧"的材质样片。
 *
 * 复用 tools/build-leather.js 的 Worley 粒面 + 高度图光照思路，
 * 在此基础上叠加三样 build-leather.js 里没有的东西：
 *   1. 斑块状的深色浸染（水渍/包浆），用低频噪声阈值化出"块"而不是"渐变"
 *   2. 狐斑（foxing）：老纸典型的褐色小圆斑，随机撒点 + 羽化边缘
 *   3. 边角重手感做旧：磨损/包浆集中在角落和边缘，中心相对干净（呼应"磨损不均匀"原则）
 */
const path = require('path');
const sharp = require('sharp');

const SIZE = 512;

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

function makeValueNoise(rand, lattice) {
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const smooth = (t) => t * t * (3 - 2 * t);
  return function (x, y) {
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

function buildHeight(opts) {
  const { cell, seed, crease, jitter, domeBias, fine } = opts;
  const rand = mulberry32(seed);
  const n = SIZE / cell;
  const pts = new Float32Array(n * n * 2);
  const cellH = new Float32Array(n * n);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      pts[i * 2] = (cx + 0.5 + (rand() - 0.5) * jitter) * cell;
      pts[i * 2 + 1] = (cy + 0.5 + (rand() - 0.5) * jitter) * cell;
      cellH[i] = 0.8 + rand() * 0.2;
    }
  }
  const noiseA = makeValueNoise(mulberry32(seed + 11), 96);
  const noiseB = makeValueNoise(mulberry32(seed + 23), 48);
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
          const px = pts[i * 2] + (ccx - wx) * cell;
          const py = pts[i * 2 + 1] + (ccy - wy) * cell;
          const d = Math.hypot(x - px, y - py);
          if (d < f1) { f2 = f1; f1 = d; best = i; } else if (d < f2) { f2 = d; }
        }
      }
      const edge = Math.min(1, (f2 - f1) / (cell * crease));
      const groove = edge * edge * (3 - 2 * edge);
      const dome = 1 - Math.pow(Math.min(1, f1 / (cell * 0.78)), 2) * domeBias;
      let v = groove * dome * cellH[best];
      const u = x / SIZE, w = y / SIZE;
      v += (noiseA(u, w) - 0.5) * fine;
      v += (noiseB(u, w) - 0.5) * fine * 0.8;
      h[y * SIZE + x] = v;
    }
  }
  return h;
}

// ---------- 纸张纤维高度图：与皮革的 Worley 粒面完全不同的生成方式 ----------
// 纸不该有"一颗颗鼓起来的粒"，那是皮革的特征。纸的起伏是纤维交织的細絮感：
// 多层不同频率的值噪声叠加（fBm），外加一层轻微拉伸过的噪声模拟纤维的方向性，
// 整体幅度压得很低（纸是哑光、平整的，不是有立体颗粒的）。
function buildPaperHeight(opts) {
  const { seed, amp } = opts;
  const n1 = makeValueNoise(mulberry32(seed), 6);
  const n2 = makeValueNoise(mulberry32(seed + 1), 14);
  const n3 = makeValueNoise(mulberry32(seed + 2), 34);
  const n4 = makeValueNoise(mulberry32(seed + 3), 84);
  const nFiber = makeValueNoise(mulberry32(seed + 4), 70);
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, w = y / SIZE;
      let v = (n1(u, w) - 0.5) * 1.0
        + (n2(u, w) - 0.5) * 0.5
        + (n3(u, w) - 0.5) * 0.25
        + (n4(u, w) - 0.5) * 0.12;
      // 纤维方向感：把噪声坐标在一个轴上拉伸采样，产生细长的纤维状纹理而不是圆点
      const fu = (u * 5) % 1, fw = (w * 0.6) % 1;
      v += (nFiber(fu, fw) - 0.5) * 0.18;
      h[y * SIZE + x] = v * amp;
    }
  }
  return h;
}

// 斑块状浸染：多层低频噪声相乘再阈值化，产生"一块一块"而不是"整体渐变"的效果
function buildBlotchMask(seed, scale, sharpness) {
  const nA = makeValueNoise(mulberry32(seed), 5);
  const nB = makeValueNoise(mulberry32(seed + 1), 9);
  const nC = makeValueNoise(mulberry32(seed + 2), 17);
  const mask = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * scale, w = (y / SIZE) * scale;
      let v = nA(u % 1, w % 1) * 0.55 + nB(u % 1, w % 1) * 0.3 + nC(u % 1, w % 1) * 0.15;
      // 阈值化成"块"：把 0.5 附近拉开，让分布变成"要么浓要么没有"
      v = Math.pow(Math.max(0, v - (1 - sharpness) * 0.5) / (0.5 + sharpness * 0.5), 1.6);
      mask[y * SIZE + x] = Math.min(1, v);
    }
  }
  return mask;
}

// 狐斑（foxing）：老纸典型的褐色小圆斑，随机撒点，边缘羽化
function buildFoxing(seed, density, minR, maxR) {
  const rand = mulberry32(seed);
  const mask = new Float32Array(SIZE * SIZE);
  const count = Math.floor(SIZE * SIZE * density);
  for (let i = 0; i < count; i++) {
    const cx = rand() * SIZE, cy = rand() * SIZE;
    const r = minR + rand() * (maxR - minR);
    const strength = 0.35 + rand() * 0.5;
    const x0 = Math.max(0, Math.floor(cx - r * 1.6)), x1 = Math.min(SIZE, Math.ceil(cx + r * 1.6));
    const y0 = Math.max(0, Math.floor(cy - r * 1.6)), y1 = Math.min(SIZE, Math.ceil(cy + r * 1.6));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1.6) {
          const falloff = Math.max(0, 1 - d / 1.6);
          const v = falloff * falloff * strength;
          const idx = y * SIZE + x;
          mask[idx] = Math.max(mask[idx], v);
        }
      }
    }
  }
  return mask;
}

// 单圈渍痕（茶渍/水渍）：真实的茎渍是"边缘一圈略深，中间基本透明"（毛细作用把色素带到边缘），
// 只有一圈，不是同心圆靶心——这跟之前被否掉的"多圈靶心"是两回事
function buildRingMask(seed, count, rMin, rMax, ringWidth, box) {
  const rand = mulberry32(seed);
  const mask = new Float32Array(SIZE * SIZE);
  const bx0 = box ? box.x0 * SIZE : 0, bx1 = box ? box.x1 * SIZE : SIZE;
  const by0 = box ? box.y0 * SIZE : 0, by1 = box ? box.y1 * SIZE : SIZE;
  for (let i = 0; i < count; i++) {
    const cx = bx0 + rand() * (bx1 - bx0), cy = by0 + rand() * (by1 - by0);
    const r = rMin + rand() * (rMax - rMin);
    const strength = 0.35 + rand() * 0.4;
    const m = r + ringWidth * 3;
    const x0 = Math.max(0, Math.floor(cx - m)), x1 = Math.min(SIZE, Math.ceil(cx + m));
    const y0 = Math.max(0, Math.floor(cy - m)), y1 = Math.min(SIZE, Math.ceil(cy + m));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const ringDist = Math.abs(d - r);
        const v = Math.max(0, 1 - ringDist / ringWidth) * strength;
        // 环内侧也留一点极淡的底色，真实渍痕中心不是完全没有颜色
        const inner = d < r ? 0.12 * strength * (1 - d / r) : 0;
        const idx = y * SIZE + x;
        mask[idx] = Math.max(mask[idx], v, inner);
      }
    }
  }
  return mask;
}

// 单点软斑：手汗/拇指按压痕迹这种"就一块"的痕迹，不撒点，直接指定位置
function buildSpot(cx01, cy01, r, strength, feather) {
  const cx = cx01 * SIZE, cy = cy01 * SIZE;
  const mask = new Float32Array(SIZE * SIZE);
  const m = r * (1 + feather);
  const x0 = Math.max(0, Math.floor(cx - m)), x1 = Math.min(SIZE, Math.ceil(cx + m));
  const y0 = Math.max(0, Math.floor(cy - m)), y1 = Math.min(SIZE, Math.ceil(cy + m));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1 + feather) {
        const v = Math.max(0, 1 - d / (1 + feather));
        mask[y * SIZE + x] = v * v * strength;
      }
    }
  }
  return mask;
}

// 线性褪色（晒痕）：靠窗的一侧被长期晒到，颜色偏淡、偏冷，跟"深色渍"是反方向的效果
function buildLinearFade(direction, sharpness) {
  const mask = new Float32Array(SIZE * SIZE);
  const [dx, dy] = direction;
  for (let y = 0; y < SIZE; y++) {
    const ny = (y / SIZE) * 2 - 1;
    for (let x = 0; x < SIZE; x++) {
      const nx = (x / SIZE) * 2 - 1;
      let v = (nx * dx + ny * dy + 1) / 2;
      v = Math.pow(Math.max(0, Math.min(1, v)), sharpness);
      mask[y * SIZE + x] = v;
    }
  }
  return mask;
}


function buildEdgeWear(power) {
  const mask = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const ny = (y / SIZE) * 2 - 1;
    for (let x = 0; x < SIZE; x++) {
      const nx = (x / SIZE) * 2 - 1;
      // 用切比雪夫距离而不是欧氏距离，让四个角更突出（书角磨损特征）
      const d = Math.max(Math.abs(nx), Math.abs(ny));
      mask[y * SIZE + x] = Math.pow(Math.max(0, d), power);
    }
  }
  return mask;
}

function shade(h, blotch, foxing, edgeWear, o) {
  const { base, darkStain, foxColor, light, strength, spec, aoStrength, lightGain, exposure, blotchAmt, foxAmt, edgeAmt } = o;
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  const L = (() => {
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
      const hv = [L[0], L[1], L[2] + 1];
      const hm = Math.hypot(...hv);
      const sp = Math.pow(Math.max(0, (nx * hv[0] + ny * hv[1] + nz * hv[2]) / hm), 30) * spec;
      const ao = 1 - aoStrength * Math.pow(1 - Math.min(1, Math.max(0, at(x, y))), 2);
      const lit = (1 + (diff - L[2]) * lightGain) * ao * exposure;

      const idx = y * SIZE + x;
      const bMix = Math.min(1, blotch[idx] * blotchAmt + edgeWear[idx] * edgeAmt);
      const fMix = foxing[idx] * foxAmt;

      const o3 = idx * 3;
      for (let c = 0; c < 3; c++) {
        let val = base[c] * lit;
        // 深色浸染：往暗、往冷（水渍/霉斑常偏灰绿）叠
        val = val * (1 - bMix) + darkStain[c] * bMix;
        // 狐斑：局部偏褐红，叠加在浸染之上
        val = val * (1 - fMix) + foxColor[c] * fMix;
        val += light[c] * sp;
        buf[o3 + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }
  return buf;
}

const VARIANTS = {
  // A：牛皮封面（修正版）——原版太亮、颗粒太大太规整像蛇皮/鳄鱼皮，这版调暗、
  // 把颗粒调细调柔（更小的 cell、更低的 crease/domeBias、几乎不给高光），
  // 真实牛皮的粒面是细密不规则的皮孔和细纹，不是一颗颗鼓起来的圆粒
  'A-antique-leather-cover': {
    height: { cell: 8, seed: 501, crease: 0.85, jitter: 1.0, domeBias: 0.45, fine: 0.05 },
    blotch: buildBlotchMask(9001, 1.8, 0.94),
    foxing: buildFoxing(9002, 0.00008, 6, 16),
    edgeWear: buildEdgeWear(1.8),
    shade: {
      base: [66, 46, 30], darkStain: [16, 13, 12], foxColor: [82, 42, 24],
      light: [150, 128, 100], strength: 0.65, spec: 0.04, aoStrength: 0.14,
      lightGain: 0.3, exposure: 0.82, blotchAmt: 0.9, foxAmt: 0.5, edgeAmt: 0.9,
    },
  },
  // B：发霉牛皮纸内页（修正版）——之前误用了皮革的颗粒生成方式，纸不该有"鼓起来的粒"，
  // 改用纤维状的 fBm 高度图（buildPaperHeight），哑光、細絮感，不是皮革的圆粒
  'B-moldy-kraft-page': {
    heightType: 'paper',
    height: { seed: 502, amp: 0.55 },
    blotch: buildBlotchMask(9101, 2.0, 0.96),
    foxing: buildFoxing(9102, 0.00030, 4, 11),
    edgeWear: buildEdgeWear(2.0),
    shade: {
      base: [224, 208, 170], darkStain: [64, 78, 60], foxColor: [148, 94, 50],
      light: [255, 250, 226], strength: 1.8, spec: 0.0, aoStrength: 0.16,
      lightGain: 0.3, exposure: 1.0, blotchAmt: 0.9, foxAmt: 0.75, edgeAmt: 0.6,
    },
  },
  // C：更极端版本——两者叠加到位站长指的那种"发霉古籍"的重度感，用来探边界（可能过头，就是要探）
  'C-heavy-decay-extreme': {
    height: { cell: 32, seed: 503, crease: 0.6, jitter: 1.0, domeBias: 0.9, fine: 0.11 },
    blotch: buildBlotchMask(9201, 1.4, 0.97),
    foxing: buildFoxing(9202, 0.00040, 7, 22),
    edgeWear: buildEdgeWear(1.5),
    shade: {
      base: [84, 60, 38], darkStain: [14, 16, 13], foxColor: [106, 50, 26],
      light: [190, 165, 120], strength: 1.4, spec: 0.14, aoStrength: 0.36,
      lightGain: 0.6, exposure: 0.96, blotchAmt: 1.0, foxAmt: 0.65, edgeAmt: 1.0,
    },
  },
};

async function main() {
  for (const [name, r] of Object.entries(VARIANTS)) {
    const h = r.heightType === 'paper' ? buildPaperHeight(r.height) : buildHeight(r.height);
    const rgb = shade(h, r.blotch, r.foxing, r.edgeWear, r.shade);
    await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } })
      .png()
      .toFile(path.join(__dirname, `${name}.png`));
    console.log(`[aged-textures] ${name}.png 已生成`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
