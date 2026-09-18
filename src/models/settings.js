const pool = require('../config/db');

async function getAll() {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

module.exports = { getAll, set };
