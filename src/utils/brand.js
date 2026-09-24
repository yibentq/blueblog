'use strict';

/**
 * blog.blue 品牌标识（签名式词标）+ 防伪层的唯一真源。
 *
 * 为什么要有这个文件：网页页眉的词标、favicon、上传图片的水印，以前是三份各自独立
 * 手写的 SVG，改一处忘两处。现在统一从这里生成——网页端和服务端（sharp/librsvg）
 * 用的是同一组路径数据，视觉上不可能走样。
 *
 * 字形说明：整个 "blog.blue" 不是任何一款字体，是手工拟合的单线条（monoline）
 * 连笔签名，全部由三次贝塞尔曲线构成。这一点很重要——
 *   1）它是专属的，别人装不上"同一款字体"就复刻不了；
 *   2）服务端渲染水印时不依赖服务器上装了什么字体（以前退化成 DejaVu Serif 很难看）；
 *   3）它本身就是第一道防伪：手写曲线的控制点是不规则的，肉眼描摹必然走形。
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 1. 签名字形
// ---------------------------------------------------------------------------
// 设计坐标系固定为 660 x 210：基线 y=132，x 高度顶 y≈96，上伸部 y≈44，下伸部 y≈186。
// 所有输出尺寸都是对这个坐标系整体缩放，不重新排版，避免任何"改尺寸就跑位"的问题。
const VIEW_W = 660;
const VIEW_H = 210;

const GLYPHS = [
  // b —— 上伸部走一个细长的环（签名感来源），下来直接接一个闭合碗形（可读性来源）
  'M54 132 C46 102, 58 54, 72 44 C81 38, 86 46, 80 62 C72 84, 58 110, 54 126 C58 108, 88 96, 100 110 C112 124, 92 142, 70 137 C62 135, 56 131, 54 126',
  'M102 120 C106 128, 112 131, 120 126',
  // l
  'M128 130 C132 100, 144 58, 158 46 C168 37, 174 46, 168 64 C160 88, 146 112, 142 124 C137 138, 150 142, 162 132 C168 127, 172 122, 176 116',
  // o
  'M214 110 C210 98, 194 94, 186 106 C178 118, 180 134, 192 136 C206 138, 216 122, 212 108 C210 101, 206 97, 203 96',
  'M212 106 C216 114, 220 118, 228 118',
  // g —— 碗形 + 向左兜回的下伸环
  'M272 110 C268 98, 252 94, 244 106 C236 118, 238 134, 250 136 C262 138, 272 124, 270 110 C269 103, 266 98, 263 96',
  'M271 104 C274 124, 278 152, 270 170 C262 186, 240 184, 238 170 C237 161, 246 156, 258 158',
  // b
  'M346 132 C338 102, 350 54, 364 44 C373 38, 378 46, 372 62 C364 84, 350 110, 346 126 C350 108, 380 96, 392 110 C404 124, 384 142, 362 137 C354 135, 348 131, 346 126',
  'M394 120 C398 128, 404 131, 412 126',
  // l
  'M420 130 C424 100, 436 58, 450 46 C460 37, 466 46, 460 64 C452 88, 438 112, 434 124 C429 138, 442 142, 454 132 C460 127, 464 122, 468 116',
  // u
  'M482 104 C476 118, 472 130, 480 136 C490 143, 500 128, 504 112 C506 104, 507 100, 507 100 C504 116, 502 130, 510 136 C518 142, 526 132, 532 124',
  // e
  'M540 124 C552 118, 566 112, 564 104 C562 97, 550 100, 546 112 C542 126, 552 138, 566 134 C574 132, 582 126, 588 118',
];

// 收尾的一笔：从 e 甩出去绕一个结，再向左横扫回整个词的下方。
// 这一笔同时充当"防伪基线"——刻度码和微缩文字都挂在它上面（见下）。
const FLOURISH =
  'M588 118 C608 104, 628 114, 630 128 C632 142, 614 150, 590 148 C542 144, 400 156, 300 158 C200 160, 110 158, 54 148';

// 域名里的那个点。不是普通圆点，而是一枚微缩玫瑰花饰（见 rosette()）。
const DOT = { x: 302, y: 132, r: 6 };

// ---------------------------------------------------------------------------
// 2. 防伪层
// ---------------------------------------------------------------------------
// 设计原则（来自防伪印刷的常规做法，只是搬到了 SVG 里）：
//   真正管用的防伪从来不是"加个显眼的封条"，而是几层彼此独立、
//   单独看都像装饰、合起来才能判真伪的细节。任何一层被漏掉，就说明是仿的。
//
//   L1 手工曲线字形     —— 描摹必走形（上面已述）
//   L2 扭索纹 guilloché —— 数学曲线，参数写死在代码里，肉眼无法反推
//   L3 微缩文字         —— 缩放后是一条发丝线，放大原图才读得出
//   L4 刻度暗码         —— 每张图唯一的序列号，编码成基线上的长短刻度
//   L5 陷阱             —— 微缩文字里有一处按序列号决定位置的"错字"，
//                          翻印者重排文字时只会得到一行干净的正确文本
//
// L4/L5 依赖 WATERMARK_SECRET：序列号 = HMAC-SHA256(secret, 文件名)。
// 不入库、不存表——只要 secret 没变，任何时候拿着原图都能重新算出来比对。

function rosette(cx, cy, r, color, opacity, sw) {
  // 微缩玫瑰花饰：外摆线（hypotrochoid），钞票扭索纹里最经典的那一类。
  // R/rr/d 三个参数决定花瓣数量和形状——改任何一个都是完全不同的一朵花，
  // 而从一张图片上是反推不出这三个数的，只能重新拟合，拟合就会有肉眼可见的偏差。
  const R = 13, rr = 5, d = 7, turns = 5;
  const s = r / (R - rr + d);
  const pts = [];
  for (let i = 0; i <= 420; i++) {
    const t = (i / 420) * Math.PI * 2 * turns;
    const x = (R - rr) * Math.cos(t) + d * Math.cos(((R - rr) / rr) * t);
    const y = (R - rr) * Math.sin(t) - d * Math.sin(((R - rr) / rr) * t);
    pts.push(`${(cx + x * s).toFixed(2)},${(cy + y * s).toFixed(2)}`);
  }
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${(sw || 0.7).toFixed(2)}" stroke-opacity="${opacity}"/>`;
}

/**
 * 分页箭头：不是发明新图形语言，是签名同一套"罗盘花饰"(rosette) 的延伸——
 * 花饰本身当指针的轴心，一根指针状的针从花心指向翻页方向，针尖是一个三角箭头。
 * 花饰半径故意比指针细得多、透明度也压低一档，眼睛第一时间抓到的是"指针指向哪"，
 * 花饰只是轴心处的一点装饰，不会和指针抢注意力（这是第一版原型被推翻后调过的地方——
 * 花饰和指针一样粗时，两根"胡须"从花心戳出去，完全看不出方向）。
 */
function paginationArrow(direction, opts = {}) {
  const { color = '#C79A45', size = 26, opacity = 0.95 } = opts;
  const cx = size / 2, cy = size / 2;
  const r = size * 0.19;
  const sw = Math.max(0.8, size * 0.032);
  const rosettePath = rosette(cx, cy, r, color, opacity * 0.9, sw);
  const dir = direction === 'prev' ? -1 : 1;
  const needleSW = Math.max(1.4, size * 0.06);
  const headLen = size * 0.22;
  const headW = size * 0.15;
  const baseX = cx + dir * (r * 0.85);
  const tipX = cx + dir * (size * 0.46);
  const hx = tipX - dir * headLen;
  const needle = `<line x1="${baseX.toFixed(2)}" y1="${cy.toFixed(2)}" x2="${hx.toFixed(2)}" y2="${cy.toFixed(2)}" stroke="${color}" stroke-width="${needleSW.toFixed(2)}" stroke-linecap="round" stroke-opacity="${opacity}"/>`;
  const arrowHead = `<path d="M${tipX.toFixed(2)} ${cy.toFixed(2)} L${hx.toFixed(2)} ${(cy - headW).toFixed(2)} L${hx.toFixed(2)} ${(cy + headW).toFixed(2)} Z" fill="${color}" fill-opacity="${opacity}"/>`;
  return `<svg class="pagination-arrow" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${rosettePath}${needle}${arrowHead}</svg>`;
}

function guilloche(color, opacity, sw) {
  // 横贯整个签名下方的扭索纹带。故意压到很低的不透明度：
  // 正常观看它只是纸面上的一点织纹，放大才看得出是一条连续的数学曲线。
  const R = 13, rr = 5, d = 9;
  const pts = [];
  for (let i = 0; i <= 900; i++) {
    const t = (i / 900) * Math.PI * 2 * 5;
    const x = (R - rr) * Math.cos(t) + d * Math.cos(((R - rr) / rr) * t);
    const y = (R - rr) * Math.sin(t) - d * Math.sin(((R - rr) / rr) * t);
    pts.push(`${(330 + x * 17).toFixed(2)},${(120 + y * 2.1).toFixed(2)}`);
  }
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${(sw || 0.6).toFixed(2)}" stroke-opacity="${opacity}"/>`;
}

/** 由文件名推出这张图专属的序列号。没有配 secret 就退化成固定的品牌序列号。 */
function serialFor(name) {
  const secret = process.env.WATERMARK_SECRET || '';
  const basis = String(name || 'blog.blue');
  const mac = secret
    ? crypto.createHmac('sha256', secret).update(basis).digest()
    : crypto.createHash('sha256').update(`blog.blue:${basis}`).digest();
  // 取 16 bit 做刻度码（16 个刻度），再取一个字节决定陷阱位置
  const bits = ((mac[0] << 8) | mac[1]) & 0xffff;
  const trapIndex = mac[2] % 9; // "blog.blue" 9 个字符里的第几个被动手脚
  // 人类可读的短序列号，查证时用（Crockford Base32 风格，去掉易混字符）
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[mac[3 + i] % 32];
  return { bits, trapIndex, code, signed: Boolean(secret) };
}

function tickCode(bits, color, opacity, u) {
  // 把 16 bit 编码成基线上的一排刻度：长刻度 = 1，短刻度 = 0。
  // 视觉上它就是蓝图上的一段比例尺，跟整站的制图语言是一路的，
  // 不知道规则的人不会意识到这排刻度是"有内容"的。
  const out = [];
  const x0 = 70, x1 = 560, y = 170;
  for (let i = 0; i < 16; i++) {
    const x = x0 + ((x1 - x0) * i) / 15;
    const long = (bits >> (15 - i)) & 1;
    const h = (long ? 9 : 4.5) * Math.max(1, u * 0.55);
    out.push(
      `<line x1="${x.toFixed(1)}" y1="${y}" x2="${x.toFixed(1)}" y2="${(y + h).toFixed(1)}" stroke="${color}" stroke-width="${(1.0 * u).toFixed(2)}" stroke-opacity="${opacity}"/>`
    );
  }
  return out.join('');
}

function microtext(trapIndex, color, opacity, u) {
  // 微缩文字。渲染尺寸下（水印通常只有 200px 宽）这一行的字高不到一个像素，
  // 看起来就是一条发丝线；把原图放大到 400% 以上才能读出内容。
  // 陷阱：重复串里每隔一段就有一处字符被替换掉，位置由序列号决定——
  // 翻印者照着"看起来像 blog.blue 的一行小字"重排，只会得到一行干净的正确文本。
  const base = 'blog.blue';
  const swapped =
    base.slice(0, trapIndex) + (base[trapIndex] === 'l' ? '1' : 'ı') + base.slice(trapIndex + 1);
  // 关键：字号是按"输出像素"定的，不是按设计坐标系定的。
  // 微缩文字要真的能在原图上放大读出来，就必须在最终位图里落到 4 像素上下——
  // 太小会被栅格化成一团灰，太大就不叫微缩文字了。u = 每个输出像素对应多少设计单位。
  const fs = 4.0 * u;
  const span = 560;
  const per = fs * 0.62 * 12; // 等宽字体：一个 "blog.blue · " 循环节的宽度
  const repeats = Math.max(2, Math.floor(span / per));
  let line = '';
  for (let i = 0; i < repeats; i++) line += (i % 4 === 2 ? swapped : base) + ' · ';
  return `<text x="66" y="${(188 + fs * 0.2).toFixed(1)}" font-family="'DejaVu Sans Mono','Liberation Mono','Courier New',monospace" font-size="${fs.toFixed(2)}" fill="${color}" fill-opacity="${opacity}">${line.trim()}</text>`;
}

// ---------------------------------------------------------------------------
// 3. 组装
// ---------------------------------------------------------------------------

/**
 * 生成签名 SVG。
 *
 * @param {object} o
 * @param {number} o.width      输出像素宽（高度按比例算）
 * @param {string} o.ink        主笔色
 * @param {string} o.accent     点缀色（域名点 + 刻度）
 * @param {number} o.stroke     笔画粗细（设计坐标系下的值）
 * @param {boolean} o.security  是否叠加防伪层（网页词标不需要，水印需要）
 * @param {string} o.serialFrom 算序列号用的依据（一般是文件名）
 * @param {boolean} o.halo      是否在笔画下垫一层反色描边（贴到照片上时保可读）
 * @param {string} o.haloColor  反色描边的颜色（浅底图片上要换成浅色）
 * @param {number} o.opacity    整体不透明度
 * @param {boolean} o.bare      true=只输出内部元素，不含 <svg> 外壳（给 EJS 内联用）
 */
function buildSignature(o = {}) {
  const {
    width = 300,
    ink = '#EAF0F8',
    accent = '#C79A45',
    stroke = 5,
    security = false,
    serialFrom = 'blog.blue',
    halo = false,
    bare = false,
    opacity = 1,
    haloColor = '#0B1F35',
    className = 'wordmark',
  } = o;

  // 内容的真实包围盒（手工量过，不是猜的）：字形 x 46→632、y 37→160，
  // 带防伪层时底下还要留出刻度和微缩文字到 y≈196。
  // 旧版水印之所以看起来"没在正中"，根子就在这里：画布是固定的 402x160 矩形，
  // 而字形只占了左边一半，右边空出一大片——看上去就是贴歪了。
  // 现在改成按内容包围盒 + 四边等量留白反推 viewBox，居中是算出来的，不是眼估的。
  const PAD = 22;
  const box = {
    x: 46 - PAD,
    y: 37 - PAD,
    w: 632 - 46 + PAD * 2,
    h: (security ? 196 : 160) - 37 + PAD * 2,
  };
  const height = Math.round((width * box.h) / box.w);
  // u = 一个输出像素相当于多少个设计坐标单位。防伪层的尺寸全部由它反推，
  // 保证水印无论被缩放到多大，微缩文字和刻度在最终位图里都落在同一个物理尺度上。
  const u = box.w / width;
  const serial = security ? serialFor(serialFrom) : null;
  const paths = [...GLYPHS, FLOURISH];

  const strokeAttrs = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const body = [];

  if (security) {
    body.push(guilloche(ink, 0.16, Math.max(0.6, 0.55 * u)));
  }

  if (halo) {
    // 深色底衬：同样的路径先用更粗的深色描一遍，贴在浅色图片上也不会糊掉。
    // 用"描两遍"而不是 SVG 滤镜，是因为服务端 librsvg 对滤镜的支持比对描边脆弱得多。
    const h = [];
    for (const d of paths) h.push(`<path d="${d}"/>`);
    body.push(
      `<g ${strokeAttrs} stroke="${haloColor}" stroke-opacity="0.34" stroke-width="${stroke + 4.5}">${h.join('')}<circle cx="${DOT.x}" cy="${DOT.y}" r="${DOT.r + 2}" fill="${haloColor}" fill-opacity="0.34" stroke="none"/></g>`
    );
  }

  const glyphEls = GLYPHS.map((d) => `<path d="${d}"/>`).join('');
  body.push(
    `<g class="${className}-ink" ${strokeAttrs} stroke="${ink}" stroke-width="${stroke}">${glyphEls}</g>`
  );
  body.push(
    `<g class="${className}-rule" ${strokeAttrs} stroke="${ink}" stroke-opacity="0.72" stroke-width="${Math.max(1.6, stroke * 0.58)}"><path d="${FLOURISH}"/></g>`
  );
  body.push(
    `<g class="${className}-dot">${rosette(DOT.x, DOT.y, DOT.r, accent, 0.95, Math.max(0.7, 0.75 * u))}<circle cx="${DOT.x}" cy="${DOT.y}" r="${Math.max(1.7, 1.1 * u).toFixed(2)}" fill="${accent}"/></g>`
  );

  if (security) {
    body.push(tickCode(serial.bits, accent, 0.6, u));
    body.push(microtext(serial.trapIndex, ink, 0.45, u));
  }

  const viewBox = `${box.x} ${box.y} ${box.w} ${box.h}`;
  const inner = body.join('\n  ');
  if (bare) return { inner, width, height, serial, viewBox };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="${className}" width="${width}" height="${height}" viewBox="${viewBox}"${opacity !== 1 ? ` opacity="${opacity}"` : ''} role="img" aria-label="blog.blue">
  ${inner}
</svg>`;
  return { svg, width, height, serial, viewBox };
}

module.exports = {
  buildSignature,
  paginationArrow,
  serialFor,
  VIEW_W,
  VIEW_H,
};
