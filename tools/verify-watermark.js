#!/usr/bin/env node
'use strict';

/**
 * 水印查证工具。
 *
 *   npm run wm:verify -- 1767225600000-a1b2c3d4e5f6a7b8.jpg
 *   npm run wm:verify -- ./uploads/xxx.jpg --png /tmp/ref.png
 *
 * 用途：在网上看到一张疑似盗用的图，想确认是不是从 blog.blue 出去的、是哪一张。
 *
 * 原理：序列号 = HMAC-SHA256(WATERMARK_SECRET, 文件名)，不入库、不存表。
 * 只要 .env 里的 WATERMARK_SECRET 没变过，任何时候都能重新算出来，
 * 所以这个工具必须在服务器上（能读到 .env 的地方）跑，本地跑算出来的是另一套数。
 *
 * 比对的三样东西，从易到难：
 *   1. 短序列号     —— 拿去跟上传日志里那行 [watermark] 对
 *   2. 刻度暗码     —— 放大原图数基线下那排刻度的长短，跟这里打印的 ▮▯ 串逐位对
 *   3. 微缩文字陷阱 —— 放大到 300% 以上读那行小字，看"错字"是不是出现在预期的位置
 * 三样全中才算是真的。只中第一样说明对方可能只是知道文件名。
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { serialFor, buildSignature } = require('../src/utils/brand');

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('用法: npm run wm:verify -- <文件名或路径> [--png 输出对照图路径]');
  process.exit(args.length === 0 ? 1 : 0);
}

const target = args[0];
// 序列号的依据永远是"文件名"，不是完整路径——传路径进来也只取文件名，
// 这样在服务器上和在本地拿着下载下来的图算出来的结果是一致的。
const name = path.basename(target);
const serial = serialFor(name);

const ticks = [];
for (let i = 0; i < 16; i++) ticks.push((serial.bits >> (15 - i)) & 1 ? '▮' : '▯');

const base = 'blog.blue';
const trapChar = base[serial.trapIndex] === 'l' ? '1' : 'ı';
const trapped =
  base.slice(0, serial.trapIndex) + trapChar + base.slice(serial.trapIndex + 1);

console.log('');
console.log(`  文件名        ${name}`);
console.log(`  短序列号      ${serial.code}`);
console.log(`  刻度暗码      ${ticks.join('')}   （▮=长刻度=1，▯=短刻度=0，从左往右）`);
console.log(`  16 位原值     ${serial.bits}  (0x${serial.bits.toString(16).padStart(4, '0')})`);
console.log(`  微缩文字陷阱  第 ${serial.trapIndex + 1} 个字符 → "${trapped}"（每 4 个循环节出现一次）`);
console.log(
  `  密钥状态      ${serial.signed ? '已用 WATERMARK_SECRET 签名' : '⚠ 未配置 WATERMARK_SECRET，当前是公共序列，任何人都能算出来'}`
);
console.log('');

const pngIdx = args.indexOf('--png');
if (pngIdx !== -1) {
  const out = args[pngIdx + 1];
  if (!out) {
    console.error('--png 后面要跟输出路径');
    process.exit(1);
  }
  // 生成一张"这张图本应长什么样"的对照水印，放大了跟疑似盗图逐笔比。
  const mark = buildSignature({ width: 900, security: true, halo: true, serialFrom: name });
  const sharp = require('sharp');
  sharp(Buffer.from(mark.svg))
    .flatten({ background: '#0F2E52' })
    .png()
    .toFile(out)
    .then(() => console.log(`  对照图已生成: ${out}\n`))
    .catch((e) => {
      console.error('生成对照图失败：', e.message);
      process.exit(1);
    });
}

if (!fs.existsSync(target) && !fs.existsSync(path.join(process.env.UPLOAD_DIR || './uploads', name))) {
  console.log('  提示：本机上没找到这个文件，以上结果是纯按文件名算出来的（这也是预期用法）。\n');
}
