const pool = require('../config/db');
const crypto = require('crypto');

function hashIp(ip) {
  // 不存明文 IP：哈希后仍能用于「同一访客短期内是否重复」之类的判断，但不构成可逆的个人信息存储
  return crypto.createHash('sha256').update(String(ip) + (process.env.SESSION_SECRET || '')).digest('hex');
}

async function listApprovedForPost(postId) {
  const { rows } = await pool.query(
    `SELECT id, parent_id, author_name, content, created_at
     FROM comments WHERE post_id = $1 AND status = 'approved'
     ORDER BY created_at ASC`,
    [postId]
  );
  return rows;
}

async function create({ postId, parentId, authorName, authorEmail, content, ip }) {
  const { rows } = await pool.query(
    `INSERT INTO comments (post_id, parent_id, author_name, author_email, content, ip_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
    [postId, parentId || null, authorName, authorEmail || null, content, hashIp(ip)]
  );
  return rows[0].id;
}

async function listPending() {
  const { rows } = await pool.query(
    `SELECT c.id, c.author_name, c.content, c.created_at, p.title AS post_title, p.slug AS post_slug
     FROM comments c JOIN posts p ON p.id = c.post_id
     WHERE c.status = 'pending' ORDER BY c.created_at DESC`
  );
  return rows;
}

async function setStatus(id, status) {
  await pool.query(`UPDATE comments SET status = $1 WHERE id = $2`, [status, id]);
}

module.exports = { listApprovedForPost, create, listPending, setStatus };
