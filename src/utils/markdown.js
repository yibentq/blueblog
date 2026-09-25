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
    // 单独成段的图片 → 相册里的一张照片：四角压相角、下方编号 FIG. 01（标题可选）。
    // 说明文字只取 Markdown 图片的 title（![alt](src \"说明\")）——alt 是给读屏用的，常常是文件名，不能直接当说明印出来。
    // 编号由 CSS 计数器生成，所以调整图片顺序编号自动跟着走。行内混排的图片（同一段里还有文字）保持原样。
    paragraph(text) {
      const m = /^\s*(<img\b[^>]*>)\s*$/i.exec(text);
      if (!m) return false;
      const tm = /\stitle="([^"]*)"/i.exec(m[1]);
      const title = tm ? tm[1] : '';
      const img = m[1].replace(/\stitle="[^"]*"/i, '');
      return `<figure class="print"><span class="mount">${img}</span><figcaption class="fig-cap${title ? '' : ' fig-empty'}">${title}</figcaption></figure>\n`;
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

// 让\"图片在行首/行尾/独占一行\"都算\"想放一张图\"：后台编辑器在光标处插入 `![](url)`，前后不带空行，
// 于是图片经常跟上下文字挤在同一个段落里（"文字\n![](x)"、"文字![](x)"、连着两张图），
// 这样的段落不是\"整段只有一张图\"，v22 的相册渲染就不会触发（站长 2026-09-24 反馈：新文章图片没有四个角）。
// 这里在解析前把这类图片各自提成独立段落。只处理行首/行尾的图片——行中间的图片仍是行内图；
// 代码围栏、缩进代码、列表/引用/表格/标题行原样不动。文字与图片的先后顺序不变。
const IMG_RE = '!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)';
const LEAD_IMG = new RegExp('^ {0,3}(' + IMG_RE + ')[ \\t]*');
const TRAIL_IMG = new RegExp('[ \\t]*(' + IMG_RE + ')[ \\t]*$');
function isolateImages(md) {
  const out = [];
  let fence = null;
  for (const line of String(md).split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      continue;
    }
    if (f) { fence = f[1]; out.push(line); continue; }
    if (/^( {4}|\t)/.test(line) || /^\s*([>|#]|[-*+]\s|\d+[.)]\s)/.test(line)) { out.push(line); continue; }
    let rest = line, m;
    const heads = [], tails = [];
    while ((m = LEAD_IMG.exec(rest))) { heads.push(m[1]); rest = rest.slice(m[0].length); }
    while ((m = TRAIL_IMG.exec(rest))) { tails.unshift(m[1]); rest = rest.slice(0, m.index); }
    if (!heads.length && !tails.length) { out.push(line); continue; }
    out.push('');
    for (const img of heads) out.push(img, '');
    if (rest.trim()) out.push(rest, '');
    for (const img of tails) out.push(img, '');
  }
  return out.join('\n');
}

function renderMarkdown(md) {
  headingSeen = {};
  // 浏览器提交表单时 textarea 的换行是 CRLF（\r\n），存进数据库的 content_md 就带着 \r。
  // 先统一成 \n，否则按行处理的逻辑（isolateImages）会被行尾的 \r 挡住——v24 第一版就栽在这：
  // 我在 node 里手写的测试串是 \n，真实浏览器提交的是 \r\n，\"图片在行尾\"的修正在线上根本不生效。
  const rawHtml = marked.parse(isolateImages(String(md || '').replace(/\r\n?/g, '\n')));
  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'h1', 'h2', 'del', 'input', 'mark', 'aside', 'figure', 'figcaption', 'span',
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

// 从渲染好的 content_html 里摘出 h2/h3 锚点，给文章页拼一份目录。
// 不是重新分析 Markdown——锚点 id 已经在 renderMarkdown 里生成过一次并存进了数据库，
// 这里只是把同一份 HTML 里已经有的 id 摘出来，不会跟正文的锚点错位。
// 标题里可能带行内标记（如 <code>、<mark>），目录只要纯文本，简单剥掉标签即可。
function extractToc(html) {
  const re = /<h([23])\sid="([^"]*)">([\s\S]*?)<\/h\1>/g;
  const toc = [];
  let m;
  while ((m = re.exec(String(html || '')))) {
    const text = m[3].replace(/<[^>]+>/g, '').trim();
    if (text) toc.push({ level: Number(m[1]), id: m[2], text });
  }
  return toc;
}

module.exports = { renderMarkdown, estimateReadingMinutes, extractToc };
