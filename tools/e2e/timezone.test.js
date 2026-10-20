// 站点时区测试（src/utils/datefmt.js + src/models/post.js 的分册 SQL）。
//   DATABASE_URL=（本机库） node tools/e2e/timezone.test.js
// 只在一次性/本机数据库上跑：会插入并删除几篇 slug 以 tz-test- 开头的文章。
const path = require('path');
const root = path.resolve(__dirname, '../..');
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || '')) { console.error('拒绝在非本机数据库上运行'); process.exit(2); }
delete process.env.SITE_TIMEZONE; // 默认 Asia/Shanghai
const df = require(root + '/src/utils/datefmt');
const pool = require(root + '/src/config/db');
const post = require(root + '/src/models/post');
const fails = [];
const chk = (n, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + extra)); if (!ok) fails.push(n); };

(async () => {
  // —— 纯函数 ——
  chk('默认时区是 Asia/Shanghai', df.TZ === 'Asia/Shanghai', df.TZ);
  chk('UTC 凌晨 2 点（上海 10 点）同一天', df.dot('2026-10-20T02:00:00Z') === '2026.10.20', df.dot('2026-10-20T02:00:00Z'));
  chk('UTC 20:00 = 上海次日 04:00 → 显示次日', df.dot('2026-10-19T20:00:00Z') === '2026.10.20', df.dot('2026-10-19T20:00:00Z'));
  chk('跨年：UTC 12-31 18:00 → 上海 1-1', df.year('2026-12-31T18:00:00Z') === 2027 && df.ymd('2026-12-31T18:00:00Z') === '2027-01-01');
  chk('dateTime 格式', df.dateTime('2026-10-19T20:05:00Z') === '2026-10-20 04:05', df.dateTime('2026-10-19T20:05:00Z'));
  chk('午夜是 00 不是 24', df.dateTime('2026-10-19T16:00:00Z') === '2026-10-20 00:00', df.dateTime('2026-10-19T16:00:00Z'));

  // —— 数据库分册：季度交界 ——
  // 2026-09-30 20:00 UTC = 上海 2026-10-01 04:00 → 页面显示 10.01，目录必须归在 Q4，而不是 Q3
  await pool.query(`DELETE FROM posts WHERE slug LIKE 'tz-test-%'`);
  const ins = (slug, ts) => pool.query(
    `INSERT INTO posts (slug,title,summary,content_md,content_html,status,published_at) VALUES ($1,$1,'','x','<p>x</p>','published',$2)`, [slug, ts]);
  await ins('tz-test-boundary', '2026-09-30T20:00:00Z');
  await ins('tz-test-q3', '2026-08-15T04:00:00Z');
  try {
    const vols = await post.listVolumes();
    const q4 = vols.find((v) => v.year === 2026 && v.quarter === 4);
    chk('分册列表里出现 2026 Q4（边界那篇算进去了）', !!q4, JSON.stringify(vols));
    const inQ4 = await post.listByVolume({ year: 2026, quarter: 4, page: 1, perPage: 50 });
    chk('边界文章在 Q4 列表里', inQ4.some((p) => p.slug === 'tz-test-boundary'), inQ4.map((p) => p.slug).join());
    const inQ3 = await post.listByVolume({ year: 2026, quarter: 3, page: 1, perPage: 50 });
    chk('边界文章不在 Q3 列表里', !inQ3.some((p) => p.slug === 'tz-test-boundary'), inQ3.map((p) => p.slug).join());
    chk('Q3 里仍有普通的 8 月文章', inQ3.some((p) => p.slug === 'tz-test-q3'));
    const n4 = await post.countByVolume(2026, 4), n4list = (await post.listByVolume({ year: 2026, quarter: 4, page: 1, perPage: 500 })).length;
    chk('countByVolume 与 listByVolume 一致', n4 === n4list, `${n4} vs ${n4list}`);
  } finally {
    await pool.query(`DELETE FROM posts WHERE slug LIKE 'tz-test-%'`);
    await pool.end();
  }
  console.log('\nFAILS:', fails);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
