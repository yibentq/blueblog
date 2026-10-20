'use strict';

// 分享卡片 / RSS 用的小工具：把相对地址变绝对、从正文里摘第一张图和一段摘要。
// 文章没填封面、没写摘要时，分享出去的卡片和订阅器里的条目也不该是空的或一张通用默认图。

const siteUrl = () => (process.env.SITE_URL || '').replace(/\/$/, '');

function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return siteUrl() + (u.startsWith('/') ? u : '/' + u);
}

function firstImage(html) {
  const m = /<img\b[^>]*\ssrc="([^"]+)"/i.exec(String(html || ''));
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// 正文前 N 个字的纯文本。跳过代码块、图注，标签全剥掉。
function excerptFromHtml(html, max = 110) {
  const text = decodeEntities(
    String(html || '')
      .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
      .replace(/<figcaption[\s\S]*?<\/figcaption>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).replace(/[\s，。、；：,.;:]+$/, '') + '…' : text;
}

// 正文里的站内相对链接/图片地址改成绝对地址（RSS 阅读器里相对地址是打不开的）
function absolutizeHtml(html) {
  return String(html || '').replace(/(\s(?:src|href)=")\/(?!\/)/g, `$1${siteUrl()}/`);
}

module.exports = { absUrl, firstImage, excerptFromHtml, absolutizeHtml };
