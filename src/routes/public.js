const express = require('express');
const router = express.Router();
const RSS = require('rss');
const postModel = require('../models/post');
const tagModel = require('../models/tag');
const commentModel = require('../models/comment');
const settingsModel = require('../models/settings');
const { extractToc } = require('../utils/markdown');

function siteUrl() {
  return (process.env.SITE_URL || '').replace(/\/$/, '');
}

// 首页 + 分页
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const settings = await settingsModel.getAll();
    const perPage = parseInt(settings.posts_per_page, 10) || 10;
    const [posts, total] = await Promise.all([
      postModel.listPublished({ page, perPage }),
      postModel.countPublished(),
    ]);
    // 首页"日记目录"视觉层只在真正的首页第1页启用（不含标签页、不含深链到第2页
    // 及以后）。底下这份 posts/totalPages 服务端渲染列表照常传给模板，无 JS/爬虫
    // 看到的还是它——JS 版只是在桌面宽度下把它换成更像目录页的外观，
    // 每条仍然是真实的 /p/:slug 链接，不建一套平行的内容系统。
    const notebookEnabled = page === 1;
    res.render('index', {
      posts, page, totalPages: Math.max(1, Math.ceil(total / perPage)),
      tagSlug: null, tagName: null, basePath: '/',
      pageTitle: null, pageDescription: process.env.SITE_DESCRIPTION,
      notebookEnabled,
    });
  } catch (err) { next(err); }
});

// 按标签筛选
router.get('/tag/:slug', async (req, res, next) => {
  try {
    const tag = await tagModel.getBySlug(req.params.slug);
    if (!tag) return res.status(404).render('404');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const settings = await settingsModel.getAll();
    const perPage = parseInt(settings.posts_per_page, 10) || 10;
    const [posts, total] = await Promise.all([
      postModel.listPublished({ page, perPage, tagSlug: tag.slug }),
      postModel.countPublished(tag.slug),
    ]);
    res.render('index', {
      posts, page, totalPages: Math.max(1, Math.ceil(total / perPage)),
      tagSlug: tag.slug, tagName: tag.name, basePath: `/tag/${tag.slug}`,
      pageTitle: `标签：${tag.name}`, pageDescription: `打了「${tag.name}」标签的文章`,
      notebookEnabled: false, // 日记目录视觉层只在真正首页启用，标签页保留原卡片列表
    });
  } catch (err) { next(err); }
});

// 文章详情
router.get('/p/:slug', async (req, res, next) => {
  try {
    const post = await postModel.getPublishedBySlug(req.params.slug);
    if (!post) return res.status(404).render('404');
    postModel.incrementViewCount(post.id); // 不阻塞渲染，失败也无所谓
    const settings = await settingsModel.getAll();
    const [tags, comments] = await Promise.all([
      postModel.getTagsForPost(post.id),
      // 已通过的评论按对话顺序排好（回复跟在上级后面，只缩进一层），每条带 depth
      settings.comments_enabled === 'true'
        ? commentModel.listApprovedForPost(post.id).then((rows) => commentModel.threadOrder(rows))
        : [],
    ]);
    // 目录只在标题够多时才有意义，太少（0/1 个）摆一个目录框反而是噪音；
    // 阈值 2 是"够不够撑起一份目录"的最低线，不是任何精确调研出来的数字
    const toc = extractToc(post.content_html);
    res.render('post', {
      post, tags, comments, query: req.query,
      toc: toc.length >= 2 ? toc : [],
      commentsEnabled: settings.comments_enabled === 'true',
      pageTitle: post.seo_title || post.title,
      pageDescription: post.seo_description || post.summary,
    });
  } catch (err) { next(err); }
});

// 提交评论
router.post('/p/:slug/comments', async (req, res, next) => {
  try {
    const settings = await settingsModel.getAll();
    if (settings.comments_enabled !== 'true') return res.status(403).send('评论功能未开启');
    const post = await postModel.getPublishedBySlug(req.params.slug);
    if (!post) return res.status(404).render('404');

    const authorName = (req.body.author_name || '').trim().slice(0, 80);
    const content = (req.body.content || '').trim().slice(0, 2000);
    // 蜜罐字段：正常用户看不到也不会填，机器人脚本往往会无差别填所有 input
    const honeypot = (req.body.website || '').trim();
    if (honeypot) return res.redirect(`/p/${post.slug}`);
    if (!authorName || !content) return res.status(400).send('昵称和内容不能为空');

    await commentModel.create({
      postId: post.id,
      parentId: req.body.parent_id || null,
      authorName,
      authorEmail: (req.body.author_email || '').trim().slice(0, 255) || null,
      content,
      ip: req.ip,
    });
    res.redirect(`/p/${post.slug}?comment=pending`);
  } catch (err) { next(err); }
});

// ---- 首页"日记目录"改版用的 JSON 接口 ----
// 注意：这些接口只读已发布文章，不含权限校验，和 /feed.xml 一个安全等级。
// 首页本体 `/` 的服务端渲染列表不受这几个接口影响——那才是无 JS / 爬虫看到的兜底，
// 这里是纯粹给桌面端目录视觉层用的数据源。目录里每一条都是真实的 /p/:slug 链接，
// 点击就是普通页面跳转，不再有单独的"文章片段"接口。

// 季度筛选用：有文章的年/季度列表，新到旧
router.get('/api/notebook/volumes', async (req, res, next) => {
  try {
    const volumes = await postModel.listVolumes();
    res.json({ volumes });
  } catch (err) { next(err); }
});

// 目录列表：某个分册（年+季度）某一页的文章条目
router.get('/api/notebook/toc', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    const quarter = parseInt(req.query.quarter, 10);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    if (!year || !quarter || quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'year/quarter 参数无效' });
    }
    const perPage = 10;
    const [entries, total] = await Promise.all([
      postModel.listByVolume({ year, quarter, page, perPage }),
      postModel.countByVolume(year, quarter),
    ]);
    res.json({
      year, quarter, page, perPage, total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      entries: entries.map((p) => ({
        slug: p.slug,
        title: p.title,
        excerpt: p.summary,
        date: p.published_at,
      })),
    });
  } catch (err) { next(err); }
});

// 标签筛选用：标签云（只统计已发布文章，见 tagModel.listAllPublic 的说明）
router.get('/api/notebook/tags', async (req, res, next) => {
  try {
    const tags = await tagModel.listAllPublic();
    res.json({ tags });
  } catch (err) { next(err); }
});

// 搜索用：标题/摘要子串匹配，只读已发布文章，结果条数固定给个小上限（postModel.searchPublished）
router.get('/api/notebook/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().slice(0, 100); // 防止超长查询串
    if (!q.trim()) return res.json({ q: '', results: [] });
    const rows = await postModel.searchPublished(q, 8);
    res.json({
      q,
      results: rows.map((p) => ({
        slug: p.slug, title: p.title, excerpt: p.summary, date: p.published_at,
      })),
    });
  } catch (err) { next(err); }
});

// 2026-09-23：两页对开+翻页动效那版设计方向已经放弃，改成单页日记目录直接跳转
// （见 docs/HANDOFF.md v11）。原来这里挂载的 /dev/notebook 实验原型预览
// （experiments/notebook-spread/）对应的就是被放弃的那版结构，不再需要在线上
// 挂路由去访问它——原型代码本身还留在仓库里，只是不再通过 HTTP 提供访问。

// RSS 订阅
router.get('/feed.xml', async (req, res, next) => {
  try {
    const feed = new RSS({
      title: process.env.SITE_NAME || 'blog.blue',
      description: process.env.SITE_DESCRIPTION || '',
      feed_url: `${siteUrl()}/feed.xml`,
      site_url: siteUrl(),
      language: 'zh-CN',
    });
    const posts = await postModel.listPublished({ page: 1, perPage: 20 });
    for (const p of posts) {
      feed.item({
        title: p.title,
        description: p.summary || '',
        url: `${siteUrl()}/p/${p.slug}`,
        date: p.published_at,
      });
    }
    res.type('application/rss+xml').send(feed.xml({ indent: true }));
  } catch (err) { next(err); }
});

// sitemap.xml —— 搜索引擎收录的基础设施，静态站也不该缺
// 人看的站点地图——按年份分组全部文章 + 标签索引，蓝图"图纸目录"风格。
// 和下面的 sitemap.xml 不是一回事：那个是给爬虫的，这个是给访客/你自己回顾归档用的。
router.get('/sitemap', async (req, res, next) => {
  try {
    const [posts, tags] = await Promise.all([
      postModel.listAllPublishedForSitemap(),
      tagModel.listAll(),
    ]);

    const byYear = new Map();
    for (const p of posts) {
      const year = new Date(p.published_at).getFullYear();
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(p);
    }
    const years = [...byYear.keys()].sort((a, b) => b - a).map((year) => ({
      year, posts: byYear.get(year),
    }));

    res.render('sitemap', {
      years, tags, totalCount: posts.length,
      pageTitle: '站点地图', pageDescription: `${process.env.SITE_NAME || 'blog.blue'} 全部文章索引，按年份归档`,
    });
  } catch (err) { next(err); }
});

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const posts = await postModel.listPublished({ page: 1, perPage: 1000 });
    const iso = (d) => new Date(d).toISOString();
    const entries = [
      { loc: `${siteUrl()}/`, lastmod: posts[0] ? iso(posts[0].updated_at) : iso(new Date()), priority: '1.0' },
      ...posts.map((p) => ({
        loc: `${siteUrl()}/p/${p.slug}`,
        lastmod: iso(p.updated_at || p.published_at),
        priority: '0.7',
      })),
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
      .map((e) => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod><priority>${e.priority}</priority></url>`)
      .join('\n')}\n</urlset>`;
    res.type('application/xml').send(body);
  } catch (err) { next(err); }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${siteUrl()}/sitemap.xml\n`);
});

module.exports = router;
