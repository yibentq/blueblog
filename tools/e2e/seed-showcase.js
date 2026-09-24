// 视觉走查用的数据：一篇把所有写作语法（mark/引用/hr/表格/提示框/代码块/列表/图片）都用上的文章 + 若干普通文章 + 一条已通过的评论。
// 用法：DATABASE_URL=（本机库） node tools/e2e/seed-showcase.js ；然后起 node src/app.js，访问 / 、/p/t0 、/sitemap 、任意不存在的路径截图。
// 只在一次性/本机数据库上跑；会往 posts / comments / settings 里写东西。
const path = require('path');
const root = path.resolve(__dirname, '../..');
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || '')) { console.error('拒绝在非本机数据库上运行'); process.exit(2); }
const pool=require(root+'/src/config/db'); const {renderMarkdown}=require(root+'/src/utils/markdown');
const md=`## 一张蓝晒的照片

正文一段，里面有==被划出来的重点==，还有\`行内代码\`和[一个链接](https://example.com)。

> 一段引用的文字，看看装饰引号和左侧墨线在真实页面里的样子。

---

| 名称 | 数量 | 备注 |
|---|---|---|
| 甲 | 12 | 第一行 |
| 乙 | 7 | 第二行 |

> [!NOTE]
> 这是一个提示框。

> [!WARNING]
> 这是警告提示框。

\`\`\`js
const a = 1;
console.log(a);
\`\`\`

- 列表一
- 列表二

![一张图](/img/og-default.png)

结尾一段。`;
(async()=>{
  const html=renderMarkdown(md); const h= typeof html==='string'?html:html.html;
  await pool.query(`INSERT INTO settings(key,value) VALUES('comments_enabled','true') ON CONFLICT (key) DO UPDATE SET value='true'`);
  const titles=['蓝晒的一张照片','雨后的电线','h in','把旧底片扫描出来','山顶的一块石头','123','海边的锈铁'];
  let first;
  for(let i=0;i<titles.length;i++){
    const slug='t'+i;
    const r=await pool.query(`INSERT INTO posts (slug,title,summary,content_md,content_html,status,published_at) VALUES ($1,$2,$3,$4,$5,'published', now() - ($6 || ' days')::interval) ON CONFLICT (slug) DO UPDATE SET title=EXCLUDED.title RETURNING id`,[slug,titles[i],i%3===2?'':'一句摘要，说明这一篇在讲什么，看目录卡片的样子。',i===0?md:'x',i===0?h:'<p>x</p>',String(i*20)]);
    if(i===0) first=r.rows[0].id;
  }
  const cm=require(root+'/src/models/comment');
  const c1=await cm.create({postId:first,parentId:null,authorName:'小林',content:'这篇写得真好。\n第二行。',ip:'10.0.0.1'});
  await pool.query(`UPDATE comments SET status='approved'`);
  console.log('seeded',first); await pool.end();
})().catch(e=>{console.error(e);process.exit(1)});
