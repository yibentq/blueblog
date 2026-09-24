#!/usr/bin/env node
/**
 * 用当前的渲染器把所有文章的 content_html 重新渲染一遍（content_md 不动）。
 *
 * 为什么需要：文章的 HTML 是**保存时**渲染好存进数据库的。渲染规则一改（比如 v22 的相册照片、
 * 这次\"图片独占段落\"的修正），老文章不重新保存就不会生效。这个脚本等于把每篇文章重新保存一次，
 * 但**不改 updated_at / 阅读数 / 发布时间 / 任何别的字段**，也不会碰 content_md。
 *
 * 用法（在服务器项目目录里，需要能读到 .env 里的 DATABASE_URL）：
 *   node tools/rerender-posts.js            只统计、不写（dry-run），列出哪些文章的 HTML 会变
 *   node tools/rerender-posts.js --apply    真正写入
 *
 * 安全：先 dry-run 看一眼；--apply 前建议先备份数据库（pg_dump）。可以重复运行（幂等）。
 */
require('dotenv').config();
const pool = require('../src/config/db');
const { renderMarkdown } = require('../src/utils/markdown');

(async () => {
  const apply = process.argv.includes('--apply');
  const { rows } = await pool.query('SELECT id, slug, title, content_md, content_html FROM posts ORDER BY created_at');
  let changed = 0;
  for (const p of rows) {
    const html = renderMarkdown(p.content_md || '');
    if (html === p.content_html) continue;
    changed++;
    console.log(`${apply ? '更新' : '将更新'}  /p/${p.slug}  ${p.title}`);
    if (apply) await pool.query('UPDATE posts SET content_html = $1 WHERE id = $2', [html, p.id]);
  }
  console.log(`\n共 ${rows.length} 篇，${changed} 篇的 HTML ${apply ? '已重新渲染' : '会变化（这是 dry-run，没有写入；加 --apply 才会写）'}。`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
