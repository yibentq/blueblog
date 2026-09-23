#!/usr/bin/env node
/**
 * [复用自 experiments/book-materials/page-variants.js，材质算法不变]
 * 内页"痕迹故事"变体：站长确认了纸张基底材质（B 版）之后提的新问题——
 * 为什么整本书都要发霉？一本正在被使用、被珍惜的手帐，更合理的痕迹是
 * 茶渍/水渍/晒痕/包浆这类"用旧"的痕迹，而不是"腐坏"的霉斑。
 *
 * 这版做 5 页不同"故事"的内页，但全部复用同一份已确认的纸张基底配方
 * （纤维高度图 seed=502 / amp=0.55，边角磨损同一套参数），只在"这一页
 * 具体发生了什么"这一层做区分——这样多页放在一起翻，会觉得"同一本书
 * 不同的使用痕迹"，而不是"风格各异的拼贴"。
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

// 与已确认的 B 版完全相同的纸张基底（不改，保证一致性）
function buildPaperHeight(seed, amp) {
  const n1 = makeValueNoise(mulberry32(seed), 6);
  const n2 = makeValueNoise(mulberry32(seed + 1), 14);
  const n3 = makeValueNoise(mulberry32(seed + 2), 34);
  const n4 = makeValueNoise(mulberry32(seed + 3), 84);
  const nFiber = makeValueNoise(mulberry32(seed + 4), 70);
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, w = y / SIZE;
      let v = (n1(u, w) - 0.5) * 1.0 + (n2(u, w) - 0.5) * 0.5
        + (n3(u, w) - 0.5) * 0.25 + (n4(u, w) - 0.5) * 0.12;
      const fu = (u * 5) % 1, fw = (w * 0.6) % 1;
      v += (nFiber(fu, fw) - 0.5) * 0.18;
      h[y * SIZE + x] = v * amp;
    }
  }
  return h;
}

function buildEdgeWear(power) {
  const mask = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const ny = (y / SIZE) * 2 - 1;
    for (let x = 0; x < SIZE; x++) {
      const nx = (x / SIZE) * 2 - 1;
      const d = Math.max(Math.abs(nx), Math.abs(ny));
      mask[y * SIZE + x] = Math.pow(Math.max(0, d), power);
    }
  }
  return mask;
}

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
          const idx = y * SIZE + x;
          mask[idx] = Math.max(mask[idx], falloff * falloff * strength);
        }
      }
    }
  }
  return mask;
}

// 单圈渍痕（茶渍/水渍）：边缘一圈略深，中间基本透明——只有一圈，不是同心圆靶心。
// 关键修正：真实渍痕的边缘从来不是数学意义上的圆，是不规则的、有的地方宽有的地方窄、
// 轮廓略歪——这里用随机谐波去扭曲半径（而不是用固定半径画正圆），让轮廓变得"手写感"
function buildRingMask(seed, count, rMin, rMax, ringWidth, box) {
  const rand = mulberry32(seed);
  const mask = new Float32Array(SIZE * SIZE);
  const bx0 = box ? box.x0 * SIZE : 0, bx1 = box ? box.x1 * SIZE : SIZE;
  const by0 = box ? box.y0 * SIZE : 0, by1 = box ? box.y1 * SIZE : SIZE;
  for (let i = 0; i < count; i++) {
    const cx = bx0 + rand() * (bx1 - bx0), cy = by0 + rand() * (by1 - by0);
    const r = rMin + rand() * (rMax - rMin);
    const strength = 0.4 + rand() * 0.4;
    // 每个渍痕独立的随机谐波扭曲：低频（2-4）决定"整体歪成什么形状"（比如椭圆/水滴），
    // 高频（7-11）决定"边缘的细碎不规则感"（不是光滑的椭圆，是有点毛躲的轮廓）
    const harms = [];
    const lowN = 2 + Math.floor(rand() * 2), highN = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < lowN; k++) harms.push({ freq: 2 + k, amp: 0.10 + rand() * 0.16, phase: rand() * Math.PI * 2 });
    for (let k = 0; k < highN; k++) harms.push({ freq: 7 + k * 2, amp: 0.03 + rand() * 0.05, phase: rand() * Math.PI * 2 });
    const wobble = (theta) => harms.reduce((s, h) => s + h.amp * Math.cos(h.freq * theta + h.phase), 0);
    // 渍痕本身也不是正圆心，中心带一点随机偏心（真实液体渗开不会以几何圆心对称）
    const offx = (rand() - 0.5) * r * 0.12, offy = (rand() - 0.5) * r * 0.12;
    const rwMax = r * 1.35;
    const m = rwMax + ringWidth * 3;
    const x0 = Math.max(0, Math.floor(cx - m)), x1 = Math.min(SIZE, Math.ceil(cx + m));
    const y0 = Math.max(0, Math.floor(cy - m)), y1 = Math.min(SIZE, Math.ceil(cy + m));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const ex = x - cx + offx, ey = y - cy + offy;
        const d = Math.hypot(ex, ey);
        const theta = Math.atan2(ey, ex);
        const rw = r * (1 + wobble(theta));
        const localWidth = ringWidth * (0.7 + 0.3 * Math.abs(Math.sin(theta * 3 + i)));
        const ringDist = Math.abs(d - rw);
        const v = Math.max(0, 1 - ringDist / localWidth) * strength;
        const inner = d < rw ? 0.12 * strength * (1 - d / rw) : 0;
        const idx = y * SIZE + x;
        mask[idx] = Math.max(mask[idx], v, inner);
      }
    }
  }
  return mask;
}

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

function buildLinearFade(dirx, diry, sharpness) {
  const mask = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const ny = (y / SIZE) * 2 - 1;
    for (let x = 0; x < SIZE; x++) {
      const nx = (x / SIZE) * 2 - 1;
      let v = (nx * dirx + ny * diry + 1) / 2;
      v = Math.pow(Math.max(0, Math.min(1, v)), sharpness);
      mask[y * SIZE + x] = v;
    }
  }
  return mask;
}

// 通用分层上色：每一层是 {mask, color, amt}，按顺序依次往上叠色，
// 这样可以同一张纸上同时叠"边角磨损（深）+ 渍痕（彩色）+ 晒痕（浅）"等互不相关的效果
function shadeLayered(h, layers, o) {
  const { base, light, strength, spec, aoStrength, lightGain, exposure } = o;
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
      const o3 = idx * 3;
      for (let c = 0; c < 3; c++) {
        let val = base[c] * lit;
        for (const layer of layers) {
          const mix = Math.min(1, layer.mask[idx] * layer.amt);
          val = val * (1 - mix) + layer.color[c] * mix;
        }
        val += light[c] * sp;
        buf[o3 + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }
  return buf;
}

// ---------- 共享基底：已确认的纸张 + 边角磨损（所有页面都用这一份，保证统一感） ----------
const PAPER_H = buildPaperHeight(502, 0.55);
const EDGE = buildEdgeWear(2.0);
const BASE_SHADE = {
  base: [224, 208, 170], light: [255, 250, 226],
  strength: 1.8, spec: 0.0, aoStrength: 0.16, lightGain: 0.3, exposure: 1.0,
};
const EDGE_LAYER = { mask: EDGE, color: [150, 130, 96], amt: 0.55 }; // 边角包浆，所有页共用

const PAGES = {
  // P0：这一页几乎没痕迹——一本真实的手帐里，大部分页应该是这种"干净"的基线，
  // 用来跟其他页形成对比，不然"每页都很有戏"反而显得刻意
  'P0-clean': {
    layers: [EDGE_LAYER],
  },
  // P1：茶渍——暖褐色单圈渍痕，集中在右上角（像随手把杯子搁在页角）
  'P1-tea-ring': {
    layers: [
      EDGE_LAYER,
      { mask: buildRingMask(7001, 2, 55, 95, 10, { x0: 0.55, x1: 0.95, y0: 0.05, y1: 0.4 }), color: [132, 78, 34], amt: 1.0 },
      { mask: buildFoxing(7002, 0.00006, 4, 9), color: [140, 92, 48], amt: 0.5 },
    ],
  },
  // P2：水渍——更浅、更冷、更干净的圆环，位置随意（水杯没有咖啡那么容易染色）
  'P2-water-mark': {
    layers: [
      EDGE_LAYER,
      { mask: buildRingMask(7101, 2, 60, 100, 7, { x0: 0.1, x1: 0.6, y0: 0.55, y1: 0.92 }), color: [150, 160, 148], amt: 0.55 },
    ],
  },
  // P3：晒痕——书常年摊开在窗边，靠窗一侧长期褪色发白，跟深色渍痕方向相反
  'P3-sun-fade': {
    layers: [
      EDGE_LAYER,
      { mask: buildLinearFade(1, -0.3, 1.4), color: [246, 238, 210], amt: 0.6 },
      { mask: buildFoxing(7202, 0.00004, 3, 7), color: [138, 90, 46], amt: 0.4 },
    ],
  },
  // P4：包浆——手汗常年摸的那个角（比如翻页时惯用的右下角）比整体边角磨损更暗一块，
  // 叠加在共用的边角磨损之上，是"这本书特别常翻的这一页"的痕迹
  'P4-handling-patina': {
    layers: [
      EDGE_LAYER,
      { mask: buildSpot(0.88, 0.86, 90, 0.8, 0.6), color: [118, 92, 58], amt: 0.9 },
      { mask: buildFoxing(7302, 0.00005, 3, 8), color: [136, 88, 44], amt: 0.4 },
    ],
  },
};

async function main() {
  for (const [name, p] of Object.entries(PAGES)) {
    const rgb = shadeLayered(PAPER_H, p.layers, BASE_SHADE);
    await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } })
      .png()
      .toFile(path.join(__dirname, `${name}.png`));
    console.log(`[page-variants] ${name}.png 已生成`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
