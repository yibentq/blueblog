const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // 连接池里空闲连接出错不应该拖垮整个进程
  console.error('[db] 意外的连接池错误', err);
});

module.exports = pool;
