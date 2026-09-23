const express = require('express');
const router = express.Router();
const RSS = require('rss');
const postModel = require('../models/post');
const tagModel = require('../models/tag');
const commentModel = require('../models/comment');
const settingsModel = require('../models/settings');

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
    res.render('index', {
      posts, page, totalPages: Math.max(1, Math.ceil(total / perPage)),
      tagSlug: null, tagName: null, basePath: '/',
      pageTitle: null, pageDescription: process.env.SITE_DESCRIPTION,
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
    res.render('post', {
      post, tags, comments, query: req.query,
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

// ---- 首页"翻书"改版用的 JSON 接口（步骤4：目录翻页接入真实数据） ----
// 注意：这三个接口只读已发布文章，不含权限校验，和 /feed.xml 一个安全等级。
// 首页本体 `/` 的服务端渲染列表不受这几个接口影响——那才是无 JS / 爬虫看到的兜底，
// 这里是纯粹给桌面端翻书视觉层用的数据源，前端还没接（见 experiments/notebook-spread/）。

// 书脊分册标签：有文章的年/季度列表，新到旧
router.get('/api/notebook/volumes', async (req, res, next) => {
  try {
    const volumes = await postModel.listVolumes();
    res.json({ volumes });
  } catch (err) { next(err); }
});

// 目录页：某个分册（年+季度）某一页的文章条目
router.get('/api/notebook/toc', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    const quarter = parseInt(req.query.quarter, 10);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    if (!year || !quarter || quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'year/quarter 参数无效' });
    }
    const perPage = 6; // 对应 BOOK_DESIGN.md 第3节"每页目录页放4-6篇"
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
        hasImage: !!p.cover_image,
      })),
    });
  } catch (err) { next(err); }
});

// 点击目录条目 → 全文页翻页动效用：只要内容片段，不要整页布局。
// 故意不复用 /p/:slug 的渲染逻辑、单独开一个轻量接口——避免为了这个视觉增强层
// 改动已经上线、测过的 /p/:slug 主路由，降低风险面。
router.get('/api/notebook/article/:slug', async (req, res, next) => {
  try {
    const post = await postModel.getPublishedBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: '文章不存在' });
    const tags = await postModel.getTagsForPost(post.id);
    // 阅读量故意不在这里累加：真正的一次阅读应该发生在访问 /p/:slug 时。
    // 翻书动效把内容换上去之后，前端应该再补一次静默计数（比如 sendBeacon 打
    // /p/:slug 的一个轻量端点），这里先不做，是步骤4遗留的一个小 TODO。
    res.json({
      slug: post.slug,
      title: post.title,
      html: post.content_html,
      publishedAt: post.published_at,
      readingMinutes: post.reading_minutes,
      tags: tags.map((t) => t.name),
    });
  } catch (err) { next(err); }
});

// 翻页动效看完全文后的静默计数：真正的一次阅读应该算在这里，而不是 /p/:slug——
// 那条路由渲染的是整页布局，翻书动效走的是这个轻量接口换内容，两者是同一次阅读的
// 两种入口，所以复用同一个 incrementViewCount，不新增字段、不做去重（和 /p/:slug
// 现有口径保持一致：每次访问都计一次，不做"同一用户只算一次"这种判断）。
router.post('/api/notebook/article/:slug/view', async (req, res, next) => {
  try {
    const post = await postModel.getPublishedBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: '文章不存在' });
    postModel.incrementViewCount(post.id); // 不阻塞响应，失败也无所谓——阅读量不是关键路径
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---- 仅开发环境：把 experiments/notebook-spread/ 里的原型 HTML 用同源方式提供出来 ----
// 目的：这些原型现在会用 fetch() 打上面那三个只读接口，file:// 直接双击打开会因为
// 跨源被浏览器拦掉；挂在这里之后本地跑 `npm run dev`，浏览器打开
// http://localhost:3000/dev/notebook/<文件名>.html 就是同源，fetch 能正常工作。
// 生产环境完全不挂这段路由（连 require('path') 都不执行），不会暴露实验目录。
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  const express2 = require('express');
  router.use('/dev/notebook', express2.static(path.join(__dirname, '..', '..', 'experiments', 'notebook-spread')));
}

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
