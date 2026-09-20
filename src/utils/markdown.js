const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

// marked 只负责“文本转结构”，绝不相信它输出的 HTML 是安全的——
// 任何允许用户（哪怕只有站长自己）写 Markdown 的系统，都必须在存库前净化一次。
// 存的是净化后的 HTML，读多写少，避免每次请求都重新渲染 Markdown。
//
// 后台的"实时预览"走的也是这个函数（POST /admin/preview），
// 所以预览里看到的就是发布后读者看到的——不存在"预览一个样、发布一个样"。

// ---------- 扩展语法 ----------

// ==高亮== → <mark>。写作时想圈一句重点，比加粗更轻。
const markExtension = {
  name: 'mark',
  level: 'inline',
  start(src) { return src.indexOf('=='); },
  tokenizer(src) {
    const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
    if (m) return { type: 'mark', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
  },
  renderer(token) { return `<mark>${this.parser.parseInline(token.tokens)}</mark>`; },
};

// 提示框：> [!NOTE] / [!TIP] / [!WARN] / [!IMPORTANT]，语法和 GitHub 的 alert 一致，
// 在别处写过的文字搬过来不用改。普通 > 引用不受影响。
const CALLOUTS = { NOTE: '注', TIP: '技巧', WARN: '注意', WARNING: '注意', IMPORTANT: '重要' };

// 标题锚点 id：中文标题保留汉字，其余转成 -，同一篇里重复的标题自动加序号。
// 每次渲染前重置计数器（renderMarkdown 是同步的，不会串到别的请求）。
let headingSeen = {};
function headingId(raw) {
  const base = String(raw).trim().toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  headingSeen[base] = (headingSeen[base] || 0) + 1;
  return headingSeen[base] === 1 ? base : `${base}-${headingSeen[base]}`;
}

marked.use({
  gfm: true,
  breaks: false,
  extensions: [markExtension],
  renderer: {
    heading(text, level, raw) {
      // 只给 h2/h3 加锚点：文章标题是 h1（页面上已经有了），更深的层级不值得
      if (level === 2 || level === 3) return `<h${level} id="${headingId(raw)}">${text}</h${level}>\n`;
      return false; // 其余走默认渲染
    },
    blockquote(quote) {
      const m = /^\s*<p>\[!([A-Za-z]+)\]\s*(?:<br\s*\/?>\s*)?/.exec(quote);
      const kind = m && m[1].toUpperCase();
      if (!kind || !CALLOUTS[kind]) return false;
      const cls = kind === 'WARNING' ? 'warn' : kind.toLowerCase();
      const body = quote.replace(m[0], '<p>').replace(/<p>\s*<\/p>\n?/, '');
      return `<aside class="callout callout-${cls}"><p class="callout-title">${CALLOUTS[kind]}</p>${body}</aside>\n`;
    },
  },
});

function renderMarkdown(md) {
  headingSeen = {};
  const rawHtml = marked.parse(md || '');
  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'h1', 'h2', 'del', 'input', 'mark', 'aside',
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
