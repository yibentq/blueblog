const pool = require('../config/db');
const slugify = require('slugify');

async function listAll() {
  const { rows } = await pool.query(
    `SELECT t.id, t.slug, t.name, COUNT(pt.post_id)::int AS post_count
     FROM tags t LEFT JOIN post_tags pt ON pt.tag_id = t.id
     GROUP BY t.id ORDER BY t.name`
  );
  return rows;
}

async function getBySlug(slug) {
  const { rows } = await pool.query(`SELECT * FROM tags WHERE slug = $1`, [slug]);
  return rows[0] || null;
}

// 传入逗号分隔的标签名字符串（后台表单里最自然的输入方式），
// 没有就创建，有就复用，返回对应的 tag id 数组。
async function findOrCreateByNames(namesCsv) {
  const names = (namesCsv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10); // 单篇文章标签数上限，防止滥用
  const ids = [];
  for (const name of names) {
    const slug = slugify(name, { lower: true, strict: true });
    if (!slug) continue;
    const { rows } = await pool.query(
      `INSERT INTO tags (slug, name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [slug, name]
    );
    ids.push(rows[0].id);
  }
  return ids;
}

module.exports = { listAll, getBySlug, findOrCreateByNames };
