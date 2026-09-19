const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// 水印徽标和页眉词标用的是同一套设计语言（罗盘标记 + 烫金斜体 ".blue"），
// 但这里是服务端用 sharp/librsvg 渲染，拿不到网页里加载的 Fraunces webfont，
// 所以退回到服务器本身大概率装了的衬线字体（部署脚本里会装 fonts-dejavu-core 保底）。
function buildBadgeSvg(pxWidth) {
  // 内部固定用一个 402x160 的画布坐标系，右下角合成时按 pxWidth 整体缩放——
  // 这样不用重新计算文字位置，画布本身已经包含"徽标内边距"和"离图片边缘的间距"。
  const viewW = 402;
  const viewH = 160;
  const pxHeight = Math.round((pxWidth * viewH) / viewW);
  const font = "'DejaVu Serif', 'Liberation Serif', Georgia, serif";

  return {
    width: pxWidth,
    height: pxHeight,
    svg: `
<svg width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${viewW} ${viewH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="16" y="16" width="370" height="128" rx="16" fill="#0F2E52" fill-opacity="0.58"/>
  <g transform="translate(36,36)">
    <text x="0" y="52" font-family="${font}" font-weight="700" font-size="46" fill="#EAF0F8" letter-spacing="-0.5">blog</text>
    <g transform="translate(122,35)">
      <circle cx="0" cy="0" r="7" fill="none" stroke="#C79A45" stroke-width="1.8"/>
      <circle cx="0" cy="0" r="1.8" fill="#C79A45"/>
      <line x1="-11" y1="0" x2="-9" y2="0" stroke="#C79A45" stroke-width="1.4"/>
      <line x1="9" y1="0" x2="11" y2="0" stroke="#C79A45" stroke-width="1.4"/>
      <line x1="0" y1="-11" x2="0" y2="-9" stroke="#C79A45" stroke-width="1.4"/>
      <line x1="0" y1="9" x2="0" y2="11" stroke="#C79A45" stroke-width="1.4"/>
    </g>
    <text x="145" y="52" font-family="${font}" font-weight="400" font-style="italic" font-size="46" fill="#C79A45" letter-spacing="-0.5">blue</text>
  </g>
</svg>`.trim(),
  };
}

const WATERMARKABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
// GIF 故意不处理——sharp 合成水印会把动图压成单帧静态图，丢掉动画本身就是价值的一部分，
// 得不偿失，宁可这一种格式不打水印，也不破坏用户传的动图。

async function applyWatermark(filePath, mimeType) {
  if (!WATERMARKABLE.has(mimeType)) return;

  const tempPath = `${filePath}.tmp`;
  try {
    const image = sharp(filePath);
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return;

    // 水印宽度按图片宽度的比例走，太小的图（比如头像级别的小图）设个下限，
    // 太大的图（比如高清大图）设个上限，不然要么看不清、要么占比例过大喧宾夺主
    const targetWidth = Math.max(110, Math.min(260, Math.round(meta.width * 0.22)));
    const badge = buildBadgeSvg(targetWidth);

    // 水印本身的高度不能超过图片高度的 40%——极端的窄长图（比如截长图）要避免水印比内容还显眼
    if (badge.height > meta.height * 0.4) return;

    await image
      .composite([{ input: Buffer.from(badge.svg), gravity: 'southeast' }])
      .toFile(tempPath);

    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // 打水印失败不应该让整次上传失败——清理掉可能残留的临时文件，原图保持不变，静默降级
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    console.error('[watermark] 处理失败，跳过水印：', err.message);
  }
}

module.exports = { applyWatermark };
