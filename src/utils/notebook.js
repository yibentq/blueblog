'use strict';

/**
 * 首页"翻书"改版用的确定性分配工具（步骤3/步骤7遗留的"分配机制"）。
 *
 * docs/BOOK_DESIGN.md 第4节要求"装饰方式按文章 ID 做确定性 hash 分配（同一篇文章
 * 每次显示的贴法一致，不随机刷新变化）"；第10节内页材质也留了同样的坑
 * （"哪篇文章配哪种痕迹变体，分配机制还没定"）。这里统一用一个简单、无依赖的
 * 字符串 hash（FNV-1a 变体）做种子，不用 Math.random——保证同一个 slug/id
 * 永远算出同一个结果，重启进程、换浏览器都不会变。
 */

function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // 转成无符号 32 位整数
}

// 内页"痕迹故事"材质（对应 docs/BOOK_DESIGN.md 第10节 P0~P4）。
// 权重刻意让 P0-clean 占大头——"大多数页应该是这种"是文档明确写的要求，
// 不是每一页都要有戏，否则"处处是戏"反而显得刻意、不可信。
const PAGE_TEXTURES = [
  { id: 'P0-clean', weight: 55 },
  { id: 'P1-tea-ring', weight: 14 },
  { id: 'P2-water-mark', weight: 13 },
  { id: 'P3-sun-fade', weight: 10 },
  { id: 'P4-handling-patina', weight: 8 },
];
const PAGE_TEXTURE_TOTAL = PAGE_TEXTURES.reduce((s, p) => s + p.weight, 0);

function pickPageTexture(key) {
  const h = hashString('page:' + key) % PAGE_TEXTURE_TOTAL;
  let acc = 0;
  for (const p of PAGE_TEXTURES) {
    acc += p.weight;
    if (h < acc) return p.id;
  }
  return PAGE_TEXTURES[0].id;
}

// 图片装饰方式（对应第4节：胶带贴 / 拍立得白框 / 大头针别住），均分三种，
// 大头针更适合竖版截图，但列表阶段拿不到图片真实宽高，先均分，
// 真要按图片长宽比再细分可以在步骤7后续迭代里加，不是这一步的阻塞项。
const IMAGE_DECORATIONS = ['tape', 'polaroid', 'pin'];

function pickImageDecoration(key) {
  const h = hashString('deco:' + key);
  return IMAGE_DECORATIONS[h % IMAGE_DECORATIONS.length];
}

// 胶带角度：±3°~±10°（第4节明确的范围），符号也由 hash 决定，不是每次都往一个方向斜。
function pickTapeAngle(key) {
  const h = hashString('angle:' + key);
  const magnitude = 3 + (h % 8); // 3~10
  const sign = (h & 0x10000) ? 1 : -1;
  return magnitude * sign;
}

module.exports = { hashString, pickPageTexture, pickImageDecoration, pickTapeAngle, PAGE_TEXTURES };
