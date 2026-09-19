'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const { buildSignature, serialFor } = require('./brand');

// 水印 = 品牌签名（src/utils/brand.js 里的手绘曲线）+ 四层防伪。
// 这里只负责"贴到哪、贴多大"，字形和防伪细节全部在 brand.js，不在这儿重复一份。

const WATERMARKABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
// GIF 故意不处理——sharp 合成水印会把动图压成单帧静态图，丢掉动画本身就是价值的一部分。

// 合法的贴法。默认右下角：既不挡主体，裁掉又会明显破坏构图比例。
// 想换成正中央盖章式（防盗图更狠，但更挡画面），把 .env 里的 WATERMARK_POSITION 改成 center。
const POSITIONS = new Set(['southeast', 'southwest', 'northeast', 'northwest', 'center']);

function placement(position, imgW, imgH, wmW, wmH, margin) {
  switch (position) {
    case 'center':
      return { left: Math.round((imgW - wmW) / 2), top: Math.round((imgH - wmH) / 2) };
    case 'southwest':
      return { left: margin, top: imgH - wmH - margin };
    case 'northeast':
      return { left: imgW - wmW - margin, top: margin };
    case 'northwest':
      return { left: margin, top: margin };
    case 'southeast':
    default:
      return { left: imgW - wmW - margin, top: imgH - wmH - margin };
  }
}

async function applyWatermark(filePath, mimeType) {
  if (!WATERMARKABLE.has(mimeType)) return null;

  const tempPath = `${filePath}.tmp`;
  try {
    const image = sharp(filePath);
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;

    // 水印宽度按图片宽度走比例，两头设上下限：太小了微缩文字会被栅格化成一团灰（防伪层失效），
    // 太大了喧宾夺主。下限 150px 是实测微缩文字还能在原图上放大读出来的最小尺寸。
    const targetWidth = Math.max(150, Math.min(320, Math.round(meta.width * 0.26)));

    const serialFrom = path.basename(filePath);
    // 先按默认配色量一版尺寸，用来算落点；真正的配色要等量完落点区域的明暗才能定。
    const probe = buildSignature({ width: targetWidth, security: true, serialFrom });

    // 图太小就整个跳过：水印比内容还显眼没有意义，
    // 而且缩到那个尺寸防伪层也已经不成立了，不如不打。
    if (probe.width > meta.width * 0.55 || probe.height > meta.height * 0.4) return null;

    const position = POSITIONS.has(process.env.WATERMARK_POSITION)
      ? process.env.WATERMARK_POSITION
      : 'southeast';
    // 留白按短边算，不按宽算——竖图和横图看起来才是"同一个留白"。
    const margin = Math.max(10, Math.round(Math.min(meta.width, meta.height) * 0.035));
    const { left, top } = placement(position, meta.width, meta.height, probe.width, probe.height, margin);

    // 量一下水印将要落到的那块区域有多亮，再决定用白笔还是墨笔。
    // 固定用白色的老做法在浅色照片（雪景、白墙、米色纸面）上会直接消失——
    // 水印看不见等于没有水印，防伪层也就一起没了。
    const region = {
      left: Math.max(0, Math.min(left, meta.width - 1)),
      top: Math.max(0, Math.min(top, meta.height - 1)),
      width: Math.max(1, Math.min(probe.width, meta.width - Math.max(0, left))),
      height: Math.max(1, Math.min(probe.height, meta.height - Math.max(0, top))),
    };
    let luma = 0;
    try {
      const st = await sharp(filePath).extract(region).stats();
      const [r, g, b] = st.channels;
      luma = (0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean) / 255;
    } catch {
      luma = 0; // 量不出来就当深色处理，白笔 + 深色底衬在多数情况下都还能看
    }
    const onLight = luma > 0.55;

    const mark = buildSignature({
      width: targetWidth,
      security: true,
      halo: true, // 笔画下垫一层反色描边，浅底深底都读得清
      haloColor: onLight ? '#FBFAF5' : '#0B1F35',
      ink: onLight ? '#16233A' : '#EAF0F8',
      accent: onLight ? '#9C7A38' : '#C79A45',
      opacity: onLight ? 0.82 : 0.9,
      serialFrom,
    });

    await image
      .composite([
        {
          input: Buffer.from(mark.svg),
          // 用显式 left/top 而不是 gravity：gravity 会把水印死贴到边上（旧版看起来"没放正"
          // 就是这个原因之一），而且没法控制留白。
          left: Math.max(0, left),
          top: Math.max(0, top),
        },
      ])
      .toFile(tempPath);

    fs.renameSync(tempPath, filePath);

    // 把序列号打进日志：以后有人盗图，拿图片文件名就能对上是哪一张、什么时候发的。
    console.log(
      `[watermark] ${serialFrom} 序列号 ${mark.serial.code}${mark.serial.signed ? '' : '（未配置 WATERMARK_SECRET，用的是公共序列）'}`
    );
    return mark.serial;
  } catch (err) {
    // 打水印失败不该让整次上传失败——清理临时文件，原图保持不变，静默降级
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    console.error('[watermark] 处理失败，跳过水印：', err.message);
    return null;
  }
}

module.exports = { applyWatermark, serialFor };
