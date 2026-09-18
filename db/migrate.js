// 极简迁移：读 schema.sql 并执行。生产上足够了——这个项目没有复杂到需要迁移框架。
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('[migrate] 数据库结构已就绪');
  } catch (err) {
    console.error('[migrate] 失败:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
