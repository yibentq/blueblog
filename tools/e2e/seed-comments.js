// 给 comments.test.py 准备数据：两篇文章 + 若干评论（含一段 XSS 试探内容、一个重复刷屏的访客）。
// 用法：DATABASE_URL=... SESSION_SECRET=... node tools/e2e/seed-comments.js
// 只在一次性/本机数据库上跑；会往 posts / comments / settings 里写东西。
const path = require('path');
const root = path.resolve(__dirname, '../..');
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || '')) {
  console.error('拒绝在非本机数据库上运行'); process.exit(2);
}
const pool = require(root + '/src/config/db');
const cm = require(root + '/src/models/comment');

(async () => {
  await pool.query(`INSERT INTO settings(key,value) VALUES('comments_enabled','true')
                    ON CONFLICT (key) DO UPDATE SET value='true'`);
  const mk = async (slug, title) => (await pool.query(
    `INSERT INTO posts (slug,title,content_md,content_html,status,published_at)
     VALUES ($1,$2,'x','<p>x</p>','published',now())
     ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title RETURNING id`, [slug, title])).rows[0].id;
  const a = await mk('e2e-a', '文章A');
  const b = await mk('e2e-b', '关于蓝晒工艺');
  const add = (p, n, c, ip) => cm.create({ postId: p, parentId: null, authorName: n, content: c, ip });
  await add(a, '小林', '这篇写得真好，部署成功了！\n第二行也测试一下换行。', '10.0.0.1');
  await add(a, 'Spammer', 'Buy cheap <script>alert(1)</script> pills http://spam.example', '9.9.9.9');
  await add(a, 'Spammer', 'Another spam message', '9.9.9.9');
  await add(a, 'Spammer', 'Third spam', '9.9.9.9');
  await add(b, '阿明', '蓝晒工艺原来是这样，想看更多。', '10.0.0.2');
  await add(b, 'Zoe', 'Great post!', '10.0.0.3');
  console.log('[e2e] 评论测试数据已就绪');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
