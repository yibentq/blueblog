const pool = require('../config/db');
const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const STATUSES = ['pending', 'approved', 'spam'];

function hashIp(ip) {
  // 不存明文 IP：哈希后仍能用于「同一访客短期内是否重复」之类的判断，但不构成可逆的个人信息存储
  return crypto.createHash('sha256').update(String(ip) + (process.env.SESSION_SECRET || '')).digest('hex');
}

// 启动时兜底：如果忘了跑 `npm run migrate`，评论页不会因为缺 is_author 列直接 500。
// 和 db/schema.sql 里的语句一致，可重复执行。
async function ensureSchema() {
  await pool.query(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_author BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_status_created ON comments (status, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash) WHERE ip_hash IS NOT NULL`);
}

// ---------------------------------------------------------------------------
// 前台
// ---------------------------------------------------------------------------

async function listApprovedForPost(postId) {
  const { rows } = await pool.query(
    `SELECT id, parent_id, author_name, content, is_author, created_at
     FROM comments WHERE post_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [postId]
  );
  return rows;
}

async function create({ postId, parentId, authorName, authorEmail, content, ip }) {
  // parent_id 来自前台表单，不能信：必须是合法 UUID，并且是"同一篇文章里已通过的评论"。
  // 否则一个乱写的值会让 Postgres 抛类型错误（500），或者把评论挂到别的文章下面。
  let safeParent = null;
  if (isUuid(parentId)) {
    const { rows } = await pool.query(
      `SELECT id FROM comments WHERE id = $1 AND post_id = $2 AND status = 'approved'`,
      [parentId, postId]
    );
    if (rows.length) safeParent = rows[0].id;
  }
  const { rows } = await pool.query(
    `INSERT INTO comments (post_id, parent_id, author_name, author_email, content, ip_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
    [postId, safeParent, authorName, authorEmail || null, content, hashIp(ip)]
  );
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// 后台：统计
// ---------------------------------------------------------------------------

async function counts() {
  const { rows } = await pool.query(`SELECT status, COUNT(*)::int AS n FROM comments GROUP BY status`);
  const out = { pending: 0, approved: 0, spam: 0, all: 0 };
  for (const r of rows) { out[r.status] = r.n; out.all += r.n; }
  return out;
}

async function countPending() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM comments WHERE status = 'pending'`);
  return rows[0].n;
}

// 左侧"文章栏"：只列有评论的文章，待审多的排前面，其次按最近有动静排
async function postsWithComments() {
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.slug, p.status,
            COUNT(*) FILTER (WHERE c.status = 'pending')::int  AS pending,
            COUNT(*) FILTER (WHERE c.status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE c.status = 'spam')::int     AS spam,
            MAX(c.created_at) AS last_at
     FROM posts p JOIN comments c ON c.post_id = p.id
     GROUP BY p.id
     ORDER BY pending DESC, last_at DESC`
  );
  return rows;
}

async function countsForPost(postId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int  AS pending,
            COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE status = 'spam')::int     AS spam
     FROM comments WHERE post_id = $1`,
    [postId]
  );
  return rows[0];
}

// 文章列表 / 编辑页用：一批文章各自的评论数
async function countsByPostIds(ids) {
  const valid = (ids || []).filter(isUuid);
  const map = {};
  if (!valid.length) return map;
  const { rows } = await pool.query(
    `SELECT post_id,
            COUNT(*) FILTER (WHERE status = 'pending')::int  AS pending,
            COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
     FROM comments WHERE post_id = ANY($1::uuid[]) GROUP BY post_id`,
    [valid]
  );
  for (const r of rows) map[r.post_id] = { pending: r.pending, approved: r.approved };
  return map;
}

// ---------------------------------------------------------------------------
// 后台：列表
// ---------------------------------------------------------------------------

const SELECT_CARD = `
  SELECT c.id, c.post_id, c.parent_id, c.author_name, c.author_email, c.content, c.status,
         c.is_author, c.created_at,
         LEFT(c.ip_hash, 6) AS visitor,
         p.title AS post_title, p.slug AS post_slug,
         par.author_name AS parent_author, LEFT(par.content, 90) AS parent_excerpt,
         CASE WHEN c.ip_hash IS NULL THEN 0 ELSE
           (SELECT COUNT(*)::int FROM comments x WHERE x.ip_hash = c.ip_hash) END AS visitor_total,
         CASE WHEN c.ip_hash IS NULL THEN 0 ELSE
           (SELECT COUNT(*)::int FROM comments x WHERE x.ip_hash = c.ip_hash AND x.status = 'pending') END AS visitor_pending
  FROM comments c
  JOIN posts p ON p.id = c.post_id
  LEFT JOIN comments par ON par.id = c.parent_id`;

// status: pending | approved | spam | all；postId 可选（文章绑定视图）
async function list({ status = 'pending', postId = null, page = 1, perPage = 30 } = {}) {
  const st = STATUSES.includes(status) ? status : null;
  const pid = isUuid(postId) ? postId : null;
  const where = [];
  const params = [];
  if (st) { params.push(st); where.push(`c.status = $${params.length}`); }
  if (pid) { params.push(pid); where.push(`c.post_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 排序：待审队列先来先处理（不让老评论被新的压在下面）；其他按最新在前；
  // 文章绑定视图按时间正序，这样读起来就是一场对话
  const order = st === 'pending' || pid ? 'ASC' : 'DESC';

  const totalQ = await pool.query(`SELECT COUNT(*)::int AS n FROM comments c ${whereSql}`, params);
  const total = totalQ.rows[0].n;

  params.push(perPage, (page - 1) * perPage);
  const { rows } = await pool.query(
    `${SELECT_CARD} ${whereSql} ORDER BY c.created_at ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total };
}

async function getCard(id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(`${SELECT_CARD} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

// 文章绑定视图里把回复排到各自的上级后面（只缩进一层：更深的回复都挂在根评论下面，
// 一个博客评论区不需要无限嵌套）。pending/spam 队列是平铺的，不走这里。
function threadOrder(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rootOf = (r) => {
    let cur = r, guard = 0;
    while (cur.parent_id && byId.has(cur.parent_id) && guard++ < 50) cur = byId.get(cur.parent_id);
    return cur;
  };
  const roots = [], kids = new Map();
  for (const r of rows) {
    const root = rootOf(r);
    if (root === r) { roots.push(r); continue; }
    if (!kids.has(root.id)) kids.set(root.id, []);
    kids.get(root.id).push(r);
  }
  const out = [];
  for (const r of roots) {
    out.push({ ...r, depth: 0 });
    for (const k of kids.get(r.id) || []) out.push({ ...k, depth: 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 后台：动作
// ---------------------------------------------------------------------------

async function setStatus(id, status) {
  if (!isUuid(id) || !STATUSES.includes(status)) return null;
  const { rows } = await pool.query(
    `UPDATE comments SET status = $1 WHERE id = $2 RETURNING id, post_id, status`,
    [status, id]
  );
  return rows[0] || null;
}

async function setStatusMany(ids, status) {
  const valid = (ids || []).filter(isUuid).slice(0, 200);
  if (!valid.length || !STATUSES.includes(status)) return 0;
  const r = await pool.query(`UPDATE comments SET status = $1 WHERE id = ANY($2::uuid[])`, [status, valid]);
  return r.rowCount;
}

// 永久删除。注意 parent_id 是 ON DELETE CASCADE：删一条评论会连它下面的回复一起删。
async function remove(id) {
  if (!isUuid(id)) return null;
  const kids = await pool.query(`SELECT COUNT(*)::int AS n FROM comments WHERE parent_id = $1`, [id]);
  const { rows } = await pool.query(`DELETE FROM comments WHERE id = $1 RETURNING id, post_id`, [id]);
  return rows[0] ? { ...rows[0], replies: kids.rows[0].n } : null;
}

async function removeMany(ids) {
  const valid = (ids || []).filter(isUuid).slice(0, 200);
  if (!valid.length) return 0;
  const r = await pool.query(`DELETE FROM comments WHERE id = ANY($1::uuid[])`, [valid]);
  return r.rowCount;
}

// 把"和这条评论同一访客、且还在待审"的评论全部标为垃圾。已通过的不动——那是你已经认可过的。
async function spamPendingFromSameVisitor(id) {
  if (!isUuid(id)) return 0;
  const r = await pool.query(
    `UPDATE comments SET status = 'spam'
     WHERE status = 'pending' AND ip_hash IS NOT NULL
       AND ip_hash = (SELECT ip_hash FROM comments WHERE id = $1)`,
    [id]
  );
  return r.rowCount;
}

// 站长回复：直接通过，标记 is_author。回复一条"待审"的评论，等于认可了它，所以顺手把上级也通过。
async function replyAsAuthor({ parentId, content, authorName }) {
  if (!isUuid(parentId)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const par = await client.query(`SELECT id, post_id, status FROM comments WHERE id = $1 FOR UPDATE`, [parentId]);
    if (!par.rows.length) { await client.query('ROLLBACK'); return null; }
    const parent = par.rows[0];
    let parentApproved = false;
    if (parent.status !== 'approved') {
      await client.query(`UPDATE comments SET status = 'approved' WHERE id = $1`, [parent.id]);
      parentApproved = true;
    }
    const ins = await client.query(
      `INSERT INTO comments (post_id, parent_id, author_name, content, status, is_author)
       VALUES ($1,$2,$3,$4,'approved',true) RETURNING id`,
      [parent.post_id, parent.id, authorName, content]
    );
    await client.query('COMMIT');
    return { id: ins.rows[0].id, postId: parent.post_id, parentId: parent.id, parentApproved };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  isUuid, ensureSchema,
  listApprovedForPost, create,
  counts, countPending, postsWithComments, countsForPost, countsByPostIds,
  list, getCard, threadOrder,
  setStatus, setStatusMany, remove, removeMany, spamPendingFromSameVisitor, replyAsAuthor,
};
