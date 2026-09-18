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
      settings.comments_enabled === 'true' ? commentModel.listApprovedForPost(post.id) : [],
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
router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const posts = await postModel.listPublished({ page: 1, perPage: 1000 });
    const urls = [
      `${siteUrl()}/`,
      ...posts.map((p) => `${siteUrl()}/p/${p.slug}`),
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${u}</loc></url>`)
      .join('\n')}\n</urlset>`;
    res.type('application/xml').send(body);
  } catch (err) { next(err); }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${siteUrl()}/sitemap.xml\n`);
});

module.exports = router;
