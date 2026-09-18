// 创建第一个（也是唯一一个）管理员账号，并写入一篇示例文章。
// 幂等：重复运行不会报错也不会重复插入。
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_EMAIL) {
    console.error('[seed] 请先在 .env 中设置 ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_EMAIL');
    process.exit(1);
  }

  const existing = await pool.query('SELECT id FROM admins WHERE username = $1', [ADMIN_USERNAME]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(
      'INSERT INTO admins (username, email, password_hash) VALUES ($1, $2, $3)',
      [ADMIN_USERNAME, ADMIN_EMAIL, hash]
    );
    console.log(`[seed] 管理员账号已创建：${ADMIN_USERNAME}`);
  } else {
    console.log('[seed] 管理员账号已存在，跳过');
  }

  const postExists = await pool.query('SELECT id FROM posts WHERE slug = $1', ['hello-blog-blue']);
  if (postExists.rowCount === 0) {
    const md = `# 你好，blog.blue

这是第一篇文章。用来确认部署没问题，删掉它，开始写点真正想写的东西。

一些你可以立刻试的 Markdown 功能：

- 列表
- **加粗** 和 *斜体*
- \`行内代码\`

\`\`\`js
console.log('代码块也支持高亮前的原样展示');
\`\`\`

> 引用块。

写作是这个系统唯一要做好的事。`;
    const html = sanitizeHtml(marked.parse(md), {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
      allowedAttributes: { '*': ['class', 'id'], a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'title'] },
    });
    await pool.query(
      `INSERT INTO posts (slug, title, summary, content_md, content_html, status, reading_minutes, published_at)
       VALUES ($1, $2, $3, $4, $5, 'published', 1, now())`,
      ['hello-blog-blue', '你好，blog.blue', '第一篇文章，确认部署成功。', md, html]
    );
    console.log('[seed] 示例文章已创建');
  }

  await pool.end();
})();
