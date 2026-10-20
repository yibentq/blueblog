'use strict';

// 读文章时对"已经存好的 content_html"做的一道轻量加工（服务端、请求时、不写回数据库）。
//
// 为什么放在"读"而不是"存"：文章的 HTML 是保存时渲染好存库的，渲染规则一改，老文章不重新保存就不会变
// （要跑 tools/rerender-posts.js）。这里要做的几件事都是"只加属性/加一层包裹"，输入又是已经过
// sanitize-html 净化的 HTML，所以放在读取时做：已发布的老文章**立刻**受益，不用任何迁移，
// 也不会出现"新旧文章表现不一样"。这里不改任何已有的标签内容，也不会放进新的可执行内容。
//
//   ① 表格包一层 .table-wrap（可横向滚动）——列太多的表在手机上不能把整页撑宽
//   ② 很长的行内代码打上 class="long"——允许它换行（行内代码平时 nowrap，一条长命令会把整页撑到上千 px 宽）
//   ③ 图片：除第一张外加 loading="lazy" decoding="async"；本地上传的图补上 width/height，
//      浏览器在图片还没下载时就能留好位置，往下滚动时内容不会因为图片陆续加载而跳动
//
// 这几处在手机上的实际后果见 docs/HANDOFF.md v30。

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const uploadDir = () => process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');

// 上传文件名是随机串、内容不会再变，尺寸算一次就可以永远缓存（进程重启后重算一次）。
const sizeCache = new Map();
async function localImageSize(src) {
  const m = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(src);
  if (!m) return null;
  const name = m[1];
  if (sizeCache.has(name)) return sizeCache.get(name);
  let size = null;
  try {
    const file = path.join(uploadDir(), name);
    if (fs.existsSync(file)) {
      const meta = await sharp(file).metadata();
      // 带 EXIF 方向的老文件（水印修复前上传的）宽高要对调；新文件在上传时已经转正，orientation 为空
      const swap = meta.orientation && meta.orientation >= 5;
      if (meta.width && meta.height) size = swap ? { w: meta.height, h: meta.width } : { w: meta.width, h: meta.height };
    }
  } catch { size = null; }
  if (sizeCache.size > 2000) sizeCache.clear();
  sizeCache.set(name, size);
  return size;
}

const LONG_CODE_CHARS = 24;

async function enhanceHtml(html) {
  let out = String(html || '');
  if (!out) return out;

  // ① 表格
  out = out.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

  // ② 长行内代码：只处理行内的（前面紧挨 <pre> 的是代码块）。内容里不会有标签（已转义），[^<] 足够。
  out = out.replace(/(<pre>)?<code>([^<]*)<\/code>/g, (all, pre, text) =>
    (!pre && text.length >= LONG_CODE_CHARS) ? `<code class="long">${text}</code>` : all);

  // ③ 图片
  const imgs = [...out.matchAll(/<img\b[^>]*>/g)];
  if (imgs.length) {
    const replacements = await Promise.all(imgs.map(async (m, i) => {
      const tag = m[0];
      const src = (/\ssrc="([^"]*)"/i.exec(tag) || [])[1] || '';
      let extra = '';
      if (i > 0 && !/\sloading=/i.test(tag)) extra += ' loading="lazy" decoding="async"';
      if (!/\swidth=/i.test(tag) && !/\sheight=/i.test(tag)) {
        const size = await localImageSize(src);
        if (size) extra += ` width="${size.w}" height="${size.h}"`;
      }
      return extra ? tag.replace(/^<img\b/, '<img' + extra) : tag;
    }));
    let k = 0;
    out = out.replace(/<img\b[^>]*>/g, () => replacements[k++]);
  }
  return out;
}

module.exports = { enhanceHtml };
