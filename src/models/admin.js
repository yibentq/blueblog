const pool = require('../config/db');
const bcrypt = require('bcryptjs');

async function findByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
  return rows[0] || null;
}

async function verifyPassword(admin, plain) {
  return bcrypt.compare(plain, admin.password_hash);
}

async function updateLastLogin(id) {
  await pool.query('UPDATE admins SET last_login_at = now() WHERE id = $1', [id]);
}

async function changePassword(id, newPlain) {
  const hash = await bcrypt.hash(newPlain, 12);
  await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, id]);
}

module.exports = { findByUsername, verifyPassword, updateLastLogin, changePassword };
