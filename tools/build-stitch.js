#!/usr/bin/env node
/**
 * blog.blue 缝线纹理生成器 —— 任务B「原创材质」条目
 *
 * 现状（要替换掉的）：CSS 的 repeating-linear-gradient 画的 2D 虚线，本质是
 * "一段颜色、一段透明"的平面矩形序列，跟"这是一根穿过皮革的线"没有任何物理关系。
 *
 * 这版做法：复用 build-leather.js 已经验证过的高度场→法线→漫反射+高光管线，
 * 但这次高度场描述的是"一根圆柱形线"的真实截面——
 *   1. 沿线方向按"针脚段+间隙段"分布（间隙处线遁入皮革，即缝线的针孔）。
 *   2. 每一段内，垂直于线方向做半圆截面高度（穿过皮革表面凸起的线始终是这个形状）。
 *   3. 线的粗细、中心线位置随一个低频、确定性的函数缓慢起伏（同一根线全程张力不是
 *      恒定的），而不是每一段独立随机抖动——这是跟"简单加噪声"版本的关键区别：
 *      变化是沿整根线连续、有记忆的，不是逐点无关的白噪声。
 *   4. 针孔（线遁入点）额外压一个小凹痕，呼应皮革本身"线穿过洞"的物理逻辑。
 *   5. 法线→光照复用皮革同一套公式（左上光源+半程向量高光），线才会跟皮革在
 *      同一个"世界"里，光影不会各画各的。
 *
 * 输出：透明背景的 PNG 长条，横向无缝可重复（background-repeat: repeat-x），
 * 通过 CSS 叠在皮革纹理之上，而不是替换掉皮革——线本身立体，皮革还是皮革。
 *
 * 用法：node tools/build-stitch.js            重新生成 public/img/stitch-*.png
 *       node tools/build-stitch.js --preview   另存放大预览到 /tmp
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

const TILE_W = 54;   // 一个横向重复周期 = 3 针（每针 18px），保证针脚节奏在图纸间距下自然
const H = 22;         // 纹理条高度，线只占中间一小段，上下留出光晕空间
const SCALE = 6;      // 超采样再缩小，边缘不锯齿（缝线比皮革粒面小得多，锯齿更明显）

const STITCH_LEN = 10, GAP_LEN = 8; // 基准针脚长/间隙长，周期 = 18，TILE_W=54 正好 3 个周期

// ---------- 一根线的"张力曲线"：低频、确定性，不是逐点白噪声 ----------
// 用两个不同频率的正弦叠加，得到"沿线缓慢起伏"而不是"每一段各抖各的"——
// 关键是频率必须是 TILE_W 的整数倍，起伏才能在瓦片边界处严丝合缝地接上。
function tensionCurve(seed) {
  const r = mulberry32(seed);
  const a1 = 0.35 + r() * 0.25, a2 = 0.18 + r() * 0.15;
  const p1 = r() * Math.PI * 2, p2 = r() * Math.PI * 2;
  return (x) => {
    const u = (x / TILE_W) * Math.PI * 2;
    return a1 * Math.sin(u * 1 + p1) + a2 * Math.sin(u * 3 + p2);
  };
}

function buildStitchHeight(seed) {
  const W = TILE_W * SCALE, Hs = H * SCALE;
  const h = new Float32Array(W * Hs);
  const hole = new Float32Array(W * Hs); // 针孔凹痕，单独一层最后叠进去（比线本身更深、更窄）
  const tension = tensionCurve(seed);
  const radiusWob = tensionCurve(seed + 1);
  const centerY = Hs / 2;
  const baseR = 2.3 * SCALE;

  for (let px = 0; px < W; px++) {
    const x = px / SCALE;
    const period = 18;
    const local = ((x % period) + period) % period; // 0..18，落在这一针的哪个位置
    const inStitch = local < STITCH_LEN;
    // 针脚段内：截面存在；边缘用 smoothstep 收细，避免生硬截断
    let profile = 0;
    if (inStitch) {
      const t = local / STITCH_LEN;
      const edge = Math.min(t, 1 - t) * STITCH_LEN;
      profile = Math.min(1, edge / 1.6);
      profile = profile * profile * (3 - 2 * profile);
    }
    const r = baseR * (0.82 + 0.22 * (1 + radiusWob(x)) / 1.4);
    const cy = centerY + tension(x) * SCALE * 1.6;

    for (let py = 0; py < Hs; py++) {
      const dy = py - cy;
      let v = 0;
      if (profile > 0 && Math.abs(dy) < r) {
        v = Math.sqrt(Math.max(0, r * r - dy * dy)) / r * profile;
      }
      h[py * W + px] = v;
      // 针孔：每一针脚段的两端各一个小凹痕（线从皮革里"钻出/钻入"的地方）
      const distToEdge = Math.min(Math.abs(local - 0), Math.abs(local - STITCH_LEN));
      if (inStitch && distToEdge < 2.2) {
        const holeProfile = 1 - distToEdge / 2.2;
        const dh = Math.hypot(dy, 0) ;
        if (Math.abs(dy) < r * 1.3) {
          hole[py * W + px] = Math.max(hole[py * W + px], holeProfile * 0.55 * (1 - Math.abs(dy) / (r * 1.3)));
        }
      }
    }
  }
  return { h, hole, W, Hs };
}

// ---------- 光照（跟皮革同一套公式，光源方向一致，线和皮革才像在同一个场景里）----------
function shadeStitch({ h, hole, W, Hs }, seed) {
  const buf = Buffer.alloc(W * Hs * 4); // RGBA
  const L = (() => {
    const v = [-0.55, -0.6, 0.58];
    const m = Math.hypot(...v);
    return v.map((c) => c / m);
  })();
  const base = [0xC7 / 255 * 255, 0x9A / 255 * 255, 0x45 / 255 * 255].map(c => c); // брас金
  const baseRGB = [199, 154, 69];
  const highlight = [246, 221, 168];
  const shadow = [122, 88, 42];
  const at = (arr, x, y) => arr[y * W + ((x + W) % W)] || 0; // 横向回绕，纵向不回绕（边缘本来就该是0）
  const atY = (arr, x, y) => (y < 0 || y >= Hs) ? 0 : arr[y * W + ((x + W) % W)];

  for (let y = 0; y < Hs; y++) {
    for (let x = 0; x < W; x++) {
      const v = atY(h, x, y);
      if (v <= 0.001 && atY(hole, x, y) <= 0.001) {
        buf[(y * W + x) * 4 + 3] = 0; // 完全透明，露出底下皮革
        continue;
      }
      const dx = (atY(h, x + 1, y) - atY(h, x - 1, y)) * 3.4;
      const dy = (atY(h, x, y + 1) - atY(h, x, y - 1)) * 3.4;
      const nl = Math.hypot(dx, dy, 1);
      const nx = -dx / nl, ny = -dy / nl, nz = 1 / nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const hv = [L[0], L[1], L[2] + 1];
      const hm = Math.hypot(...hv);
      const sp = Math.pow(Math.max(0, (nx * hv[0] + ny * hv[1] + nz * hv[2]) / hm), 24) * 0.85;
      const lit = 0.55 + diff * 0.85;
      const holeV = atY(hole, x, y);
      const o = (y * W + x) * 4;
      if (v > 0.001) {
        for (let c = 0; c < 3; c++) {
          const val = baseRGB[c] * lit + highlight[c] * sp * 0.5;
          buf[o + c] = Math.max(0, Math.min(255, Math.round(val)));
        }
        buf[o + 3] = 255;
      } else if (holeV > 0.001) {
        // 针孔凹痕：没有线覆盖，只在皮革上压一个深色小坑
        for (let c = 0; c < 3; c++) buf[o + c] = shadow[c];
        buf[o + 3] = Math.round(holeV * 200);
      }
      // 线体边缘投在皮革上的小阴影（线是凸起的，边缘之外一圈皮革会被遮一点光）
      if (v <= 0.001 && holeV <= 0.001) {
        const nearby = Math.max(atY(h, x - 1, y), atY(h, x + 1, y), atY(h, x, y - 1), atY(h, x, y + 1));
        if (nearby > 0.15) {
          for (let c = 0; c < 3; c++) buf[o + c] = shadow[c];
          buf[o + 3] = Math.round(Math.min(1, nearby) * 60);
        }
      }
    }
  }
  return buf;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'img');
  const preview = process.argv.includes('--preview');
  // 两个 seed：边缘长边（top/bottom）用一个，短边（left/right，会被竖排使用）用另一个——
  // 两条线看起来节奏不同，不是同一张图四个方向复制。
  const RECIPES = { edge: 9101, edgeAlt: 9202 };
  for (const [name, seed] of Object.entries(RECIPES)) {
    const field = buildStitchHeight(seed);
    const rgba = shadeStitch(field, seed);
    // 先落地成真正的 PNG buffer，再从这个 buffer 建立新的 sharp 实例去旋转——
    // 不能在同一条"raw 输入 + resize + clone"的管线上直接 .clone().rotate(90)，
    // 这样会踩到 sharp 的一个真实 bug：旋转结果会退化成 22x22 的正方形而不是
    // 22x54 的竖条（在真正的图片文件上重新 rotate 就没有这个问题）。
    const baseBuf = await sharp(rgba, { raw: { width: field.W, height: field.Hs, channels: 4 } })
      .resize(TILE_W, H, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const file = `stitch-${name}-v1.png`;
    await sharp(baseBuf).toFile(path.join(outDir, file));
    // 竖版：旋转90度给左右两条边用——不是简单复制，旋转后针脚节奏自然是错开的
    await sharp(baseBuf).rotate(90).png({ compressionLevel: 9 }).toFile(path.join(outDir, `stitch-${name}-vert-v1.png`));
    if (preview) {
      await sharp(baseBuf)
        .resize(TILE_W * 8, H * 8, { kernel: 'nearest' })
        .png().toFile(`/tmp/stitch-${name}-preview.png`);
    }
    console.log(`[stitch] ${file} 已生成`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
