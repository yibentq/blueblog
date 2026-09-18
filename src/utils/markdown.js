const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

// marked 只负责“文本转结构”，绝不相信它输出的 HTML 是安全的——
// 任何允许用户（哪怕只有站长自己）写 Markdown 的系统，都必须在存库前净化一次。
// 存的是净化后的 HTML，读多写少，避免每次请求都重新渲染 Markdown。
marked.setOptions({
  gfm: true,
  breaks: false,
});

function renderMarkdown(md) {
  const rawHtml = marked.parse(md || '');
  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'h1', 'h2', 'del', 'input',
    ]),
    allowedAttributes: {
      '*': ['class', 'id'],
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'loading', 'width', 'height'],
      input: ['type', 'checked', 'disabled'], // 支持 GFM 任务列表
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
}

// 粗略估算阅读时长：中文按字符数/300字每分钟，英文按词数/200词每分钟，取较大值
function estimateReadingMinutes(md) {
  const text = (md || '').replace(/```[\s\S]*?```/g, '');
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const wordCount = (text.replace(/[\u4e00-\u9fff]/g, '').match(/\S+/g) || []).length;
  const minutes = Math.max(1, Math.round(cjkCount / 300 + wordCount / 200));
  return minutes;
}

module.exports = { renderMarkdown, estimateReadingMinutes };
