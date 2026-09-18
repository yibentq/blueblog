const pool = require('../config/db');

// 所有查询都显式选择状态 = published 给公开页面用，避免草稿意外泄露——
// 这是内容型站点最常见的一类"越权"事故，宁可每次都写全，不要图省事做成默认查全部。

async function listPublished({ page = 1, perPage = 10, tagSlug = null } = {}) {
  const offset = (page - 1) * perPage;
  const params = [perPage, offset];
  let tagJoin = '';
  let tagWhere = '';
  if (tagSlug) {
    tagJoin = 'JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id';
    tagWhere = 'AND t.slug = $3';
    params.push(tagSlug);
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.slug, p.title, p.summary, p.cover_image, p.reading_minutes,
            p.view_count, p.is_pinned, p.published_at
     FROM posts p
     ${tagJoin}
     WHERE p.status = 'published' ${tagWhere}
     ORDER BY p.is_pinned DESC, p.published_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}

async function countPublished(tagSlug = null) {
  if (tagSlug) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM posts p
       JOIN post_tags pt ON pt.post_id = p.id JOIN tags t ON t.id = pt.tag_id
       WHERE p.status = 'published' AND t.slug = $1`,
      [tagSlug]
    );
    return rows[0].n;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM posts WHERE status = 'published'`);
  return rows[0].n;
}

async function getPublishedBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT * FROM posts WHERE slug = $1 AND status = 'published'`,
    [slug]
  );
  return rows[0] || null;
}

async function incrementViewCount(id) {
  // 阅读量不是关键数据，出错也不影响主流程，调用方无需 await 结果做判断
  await pool.query(`UPDATE posts SET view_count = view_count + 1 WHERE id = $1`, [id]);
}

async function getTagsForPost(postId) {
  const { rows } = await pool.query(
    `SELECT t.slug, t.name FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = $1`,
    [postId]
  );
  return rows;
}

// ---- 后台用（不过滤 status）----

async function listAll({ page = 1, perPage = 20 } = {}) {
  const offset = (page - 1) * perPage;
  const { rows } = await pool.query(
    `SELECT id, slug, title, status, is_pinned, view_count, published_at, updated_at
     FROM posts ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
    [perPage, offset]
  );
  return rows;
}

async function countAll() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM posts`);
  return rows[0].n;
}

async function getById(id) {
  const { rows } = await pool.query(`SELECT * FROM posts WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getBySlugAny(slug, excludeId = null) {
  const { rows } = await pool.query(
    excludeId ? `SELECT id FROM posts WHERE slug = $1 AND id <> $2` : `SELECT id FROM posts WHERE slug = $1`,
    excludeId ? [slug, excludeId] : [slug]
  );
  return rows[0] || null;
}

async function create(data) {
  const {
    slug, title, summary, contentMd, contentHtml, coverImage,
    status, isPinned, readingMinutes, seoTitle, seoDescription,
  } = data;
  const publishedAt = status === 'published' ? new Date() : null;
  const { rows } = await pool.query(
    `INSERT INTO posts
      (slug, title, summary, content_md, content_html, cover_image, status,
       is_pinned, reading_minutes, seo_title, seo_description, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [slug, title, summary, contentMd, contentHtml, coverImage, status,
      isPinned, readingMinutes, seoTitle, seoDescription, publishedAt]
  );
  return rows[0];
}

async function update(id, data) {
  const existing = await getById(id);
  if (!existing) return null;
  const {
    slug, title, summary, contentMd, contentHtml, coverImage,
    status, isPinned, readingMinutes, seoTitle, seoDescription,
  } = data;
  // 草稿 -> 发布 时第一次设置 published_at；之后再编辑不应该把发布时间往后推
  const publishedAt = existing.published_at || (status === 'published' ? new Date() : null);
  const { rows } = await pool.query(
    `UPDATE posts SET
       slug=$1, title=$2, summary=$3, content_md=$4, content_html=$5, cover_image=$6,
       status=$7, is_pinned=$8, reading_minutes=$9, seo_title=$10, seo_description=$11,
       published_at=$12, updated_at=now()
     WHERE id=$13 RETURNING *`,
    [slug, title, summary, contentMd, contentHtml, coverImage, status,
      isPinned, readingMinutes, seoTitle, seoDescription, publishedAt, id]
  );
  return rows[0];
}

async function remove(id) {
  await pool.query(`DELETE FROM posts WHERE id = $1`, [id]);
}

async function setTags(postId, tagIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
    for (const tagId of tagIds) {
      await client.query('INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)', [postId, tagId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listPublished, countPublished, getPublishedBySlug, incrementViewCount, getTagsForPost,
  listAll, countAll, getById, getBySlugAny, create, update, remove, setTags,
};
