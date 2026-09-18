const slugify = require('slugify');

// 中文标题 slugify 会把中文字符整个丢掉，所以中文标题走「拼音风格不追求，直接用短随机后缀」策略：
// 有英文/数字就保留，没有就退化成 post-<8位随机>，保证一定可读且唯一。
function toSlug(title) {
  const base = slugify(title, { lower: true, strict: true, trim: true });
  if (base && base.length >= 3) return base;
  const rand = Math.random().toString(36).slice(2, 10);
  return `post-${rand}`;
}

module.exports = { toSlug };
