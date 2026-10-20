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

// 照片落盘前的"整理"：把 EXIF 方向烤进像素、去掉元数据（含 GPS 拍摄位置）、过长的边缩到上限。
//
// 为什么必须有这一步（v30 实测出来的真 bug）：手机竖拍的照片，像素其实是横的，只靠 EXIF 里一个
// Orientation 标记让浏览器转正。sharp 重新编码时默认会丢掉所有元数据——标记没了，像素没转——
// 于是**每一张手机竖拍的照片经过水印之后都会横躺着显示**。这里先 .rotate()（无参数 = 按 EXIF 自动转正，
// 并且转完把标记清掉），后面的尺寸、落点、亮度测量就都是转正之后的真实尺寸了。
//
// 顺带的两个好处：① 默认输出里不再带 EXIF，拍摄地点（GPS）不会随图片公开；
// ② 长边超过 MAX_IMAGE_EDGE（默认 2560px，0 = 不限制）就等比缩小——正文栏宽只有 42rem，
// 8MB 的原图整张传给读者只是白白浪费流量，对一个以图为主的博客来说这是最大的加载成本。
// 水印是缩完之后才贴的，所以水印大小按"读者实际看到的"那个宽度算，不会被缩小一遍变糊。
function maxEdge() {
  const raw = process.env.MAX_IMAGE_EDGE;
  if (raw === undefined || raw === '') return 2560;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 2560;
}

function encode(pipeline, mimeType) {
  if (mimeType === 'image/png') return pipeline.png();
  if (mimeType === 'image/webp') return pipeline.webp({ quality: 88 });
  return pipeline.jpeg({ quality: 88, mozjpeg: true });
}

async function normalize(filePath, mimeType) {
  let pipeline = sharp(filePath).rotate();
  const edge = maxEdge();
  if (edge > 0) pipeline = pipeline.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
  return encode(pipeline, mimeType).toBuffer();
}

// 量一块区域的平均亮度（0~1）。
// 注意 sharp 的坑：stats() 只认输入图，**不理会前面链上的 extract()**——老代码写的是
// sharp(file).extract(region).stats()，量到的其实一直是整张图的平均亮度，不是水印落点那一角。
// 一张整体偏暗、右下角却是亮天空的照片，会因此拿到白笔、白字落在白天空上。
// 必须先把区域真的裁成一块 buffer，再对这块 buffer 求 stats。
async function measureLuma(buf, region) {
  try {
    const crop = await sharp(buf).extract(region).toBuffer();
    const st = await sharp(crop).stats();
    const [r, g, b] = st.channels;
    return (0.299 * r.mean + 0.587 * g.mean + 0.114 * b.mean) / 255;
  } catch {
    return 0; // 量不出来就当深色处理，白笔 + 深色底衬在多数情况下都还能看
  }
}

async function applyWatermark(filePath, mimeType) {
  if (!WATERMARKABLE.has(mimeType)) return null;

  const tempPath = `${filePath}.tmp`;
  // 只在最后一步落盘；中途任何地方失败，磁盘上的原图都原封不动。
  const commit = (buf) => { fs.writeFileSync(tempPath, buf); fs.renameSync(tempPath, filePath); };
  try {
    // 动图（多帧 WebP）不碰：sharp 默认只读第一帧，处理完动画就没了——跟 GIF 不打水印是同一个理由。
    const orig = await sharp(filePath).metadata();
    if (orig.pages && orig.pages > 1) return null;

    const base = await normalize(filePath, mimeType);
    const meta = await sharp(base).metadata();
    if (!meta.width || !meta.height) return null;

    // 水印宽度按图片宽度走比例，两头设上下限：太小了微缩文字会被栅格化成一团灰（防伪层失效），
    // 太大了喧宾夺主。下限 150px 是实测微缩文字还能在原图上放大读出来的最小尺寸。
    const targetWidth = Math.max(150, Math.min(320, Math.round(meta.width * 0.26)));

    const serialFrom = path.basename(filePath);
    // 先按默认配色量一版尺寸，用来算落点；真正的配色要等量完落点区域的明暗才能定。
    const probe = buildSignature({ width: targetWidth, security: true, serialFrom });

    // 图太小就不打水印：水印比内容还显眼没有意义，
    // 而且缩到那个尺寸防伪层也已经不成立了，不如不打。照片本身照样整理（转正、去 GPS）。
    if (probe.width > meta.width * 0.55 || probe.height > meta.height * 0.4) {
      commit(base);
      return null;
    }

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
    const luma = await measureLuma(base, region);
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

    const out = await encode(
      sharp(base).composite([
        {
          input: Buffer.from(mark.svg),
          // 用显式 left/top 而不是 gravity：gravity 会把水印死贴到边上（旧版看起来"没放正"
          // 就是这个原因之一），而且没法控制留白。
          left: Math.max(0, left),
          top: Math.max(0, top),
        },
      ]),
      mimeType
    ).toBuffer();
    commit(out);

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

module.exports = { applyWatermark, serialFor, measureLuma };
