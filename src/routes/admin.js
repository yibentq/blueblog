const express = require('express');
const fs = require('fs');
const router = express.Router();

const { requireAuth, redirectIfAuthed } = require('../middleware/auth');
const { loginLimiter, previewLimiter } = require('../middleware/security');
const { generateToken, doubleCsrfProtection } = require('../middleware/csrf');
const { upload, uploadDir } = require('../middleware/upload');
const { applyWatermark } = require('../utils/watermark');
const { renderMarkdown, estimateReadingMinutes } = require('../utils/markdown');
const { toSlug } = require('../utils/slug');

const adminModel = require('../models/admin');
const postModel = require('../models/post');
const tagModel = require('../models/tag');
const commentModel = require('../models/comment');
const settingsModel = require('../models/settings');

// robots.txt 已经 Disallow /admin/ 了，这里再加一层：直接在响应头上声明 noindex——
// 万一后台某个页面的链接被别处意外引用到，搜索引擎爬到时也不会收录它。双保险，不冲突。
router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// 所有写操作（POST/PUT/DELETE）都过 CSRF 校验；GET 不需要，但要能拿到 token 塞进表单。
// /upload 是例外：它是 multipart/form-data 请求，express.urlencoded/json 都解析不了这种请求体，
// 这里做的通用校验这时候还读不到 req.body._csrf（要等 multer 先解析完 body 才有）。
// 所以 /upload 放到路由自己里面、在 multer 解析完之后手动校验（见下面的 router.post('/upload', ...)）。
router.use('/preview', previewLimiter); // 放在 CSRF/登录校验之前，未登录的请求也算额度

router.use((req, res, next) => {
  if (req.method === 'GET' || req.path === '/upload') return next();
  return doubleCsrfProtection(req, res, next);
});

// ---------- 登录 / 登出 ----------

router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('admin/login', { error: null, csrfToken: generateToken(req, res), layout: false });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const admin = await adminModel.findByUsername((username || '').trim());
    const ok = admin && (await adminModel.verifyPassword(admin, password || ''));
    if (!ok) {
      // 故意用同一句提示，不透露"用户名不存在"还是"密码错误"，减少账号枚举面
      return res.status(401).render('admin/login', {
        error: '用户名或密码不正确', csrfToken: generateToken(req, res), layout: false,
      });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.adminId = admin.id;
      adminModel.updateLastLogin(admin.id);
      res.redirect('/admin');
    });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// 以下全部需要登录
router.use(requireAuth);

// 侧栏"评论"上的待审数字：每个后台页面都要，所以放在这里统一算一次。
// 只对 GET 页面算（POST 的 JSON 接口用不到）；查询失败就当 0，不能因为一个角标拖垮整个后台页面。
router.use(async (req, res, next) => {
  if (req.method === 'GET') {
    try { res.locals.pendingBadge = await commentModel.countPending(); }
    catch (e) { res.locals.pendingBadge = 0; }
  }
  next();
});

// ---------- 仪表盘 ----------

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [posts, total, pendingCount] = await Promise.all([
      postModel.listAll({ page, perPage: 20 }),
      postModel.countAll(),
      commentModel.countPending(),
    ]);
    // 每篇文章各自的评论数（一次查完，不是每行一次查询）
    const commentCounts = await commentModel.countsByPostIds(posts.map((p) => p.id));
    res.render('admin/dashboard', {
      posts, page, totalPages: Math.max(1, Math.ceil(total / 20)),
      pendingCount, commentCounts,
      csrfToken: generateToken(req, res),
    });
  } catch (err) { next(err); }
});

// ---------- 文章：新建 / 编辑 ----------

router.get('/posts/new', async (req, res, next) => {
  try {
    const tags = await tagModel.listAll();
    res.render('admin/editor', {
      post: null, tags, tagValue: '', query: req.query, csrfToken: generateToken(req, res),
    });
  } catch (err) { next(err); }
});

router.get('/posts/:id/edit', async (req, res, next) => {
  try {
    const post = await postModel.getById(req.params.id);
    if (!post) return res.status(404).render('admin/error', { message: '文章不存在' });
    const [postTags, commentCounts] = await Promise.all([
      postModel.getTagsForPost(post.id),
      commentModel.countsForPost(post.id),
    ]);
    res.render('admin/editor', {
      post, tags: [], tagValue: postTags.map((t) => t.name).join(', '), query: req.query,
      commentCounts, csrfToken: generateToken(req, res),
    });
  } catch (err) { next(err); }
});

router.post('/posts', async (req, res, next) => {
  try {
    const saved = await savePost(null, req.body);
    res.redirect(`/admin/posts/${saved.id}/edit?saved=1`);
  } catch (err) { next(err); }
});

router.post('/posts/:id', async (req, res, next) => {
  try {
    await savePost(req.params.id, req.body);
    res.redirect(`/admin/posts/${req.params.id}/edit?saved=1`);
  } catch (err) { next(err); }
});

router.post('/posts/:id/delete', async (req, res, next) => {
  try {
    await postModel.remove(req.params.id);
    res.redirect('/admin?deleted=1');
  } catch (err) { next(err); }
});

async function savePost(id, body) {
  const title = (body.title || '').trim().slice(0, 300);
  if (!title) throw Object.assign(new Error('标题不能为空'), { status: 400 });
  const contentMd = body.content_md || '';
  const contentHtml = renderMarkdown(contentMd);
  const readingMinutes = estimateReadingMinutes(contentMd);

  let slug = (body.slug || '').trim();
  slug = slug ? toSlug(slug) : toSlug(title);
  const clash = await postModel.getBySlugAny(slug, id);
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const data = {
    slug,
    title,
    summary: (body.summary || '').trim().slice(0, 500) || null,
    contentMd,
    contentHtml,
    coverImage: (body.cover_image || '').trim() || null,
    status: ['draft', 'published', 'archived'].includes(body.status) ? body.status : 'draft',
    isPinned: body.is_pinned === 'on',
    readingMinutes,
    seoTitle: (body.seo_title || '').trim().slice(0, 300) || null,
    seoDescription: (body.seo_description || '').trim().slice(0, 500) || null,
  };

  const saved = id ? await postModel.update(id, data) : await postModel.create(data);
  const tagIds = await tagModel.findOrCreateByNames(body.tags);
  await postModel.setTags(saved.id, tagIds);
  return saved;
}

// ---------- 实时预览 ----------
// 编辑器里的预览走的是和"保存"完全相同的 renderMarkdown（同一套扩展语法 + 同一份净化白名单），
// 不在浏览器里另写一套渲染——那样必然出现"预览正常、发布后走样"。
// 只做渲染，不落库、不改任何状态。
router.post('/preview', (req, res) => {
  const md = typeof req.body.content_md === 'string' ? req.body.content_md : '';
  res.json({
    html: renderMarkdown(md),
    minutes: estimateReadingMinutes(md),
  });
});

// ---------- 图片上传（供编辑器插入封面图 / 正文图片）----------

// 不直接把 upload.single(...) 当中间件用——那样 multer 的错误（比如超出大小限制）
// 会被 Express 的通用错误处理接住，最后渲染成一个和上传毫无关系的"服务器开小差了"页面。
// 手动包一层，把 multer 的错误原样转成前端能读懂的 JSON；multer 解析完 body 之后再手动做 CSRF 校验
// （原因见上面 router.use 里的注释：multipart 请求这时候才有 req.body._csrf 可读）。
router.post('/upload', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `文件太大，最大允许 ${Number(process.env.MAX_UPLOAD_MB) || 8}MB`,
        });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    doubleCsrfProtection(req, res, async (csrfErr) => {
      if (csrfErr) {
        // 文件已经存到磁盘了，但请求本身没通过校验，不能留着这个孤儿文件
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: '请求已过期，刷新页面后重试' });
      }
      if (!req.file) return res.status(400).json({ error: '没有收到文件' });
      await applyWatermark(req.file.path, req.file.mimetype);
      res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
    });
  });
});

// ---------- 评论 ----------
//
// 设计：评论按"文章"组织，而不是一个孤立的待审队列。
//   /admin/comments                  全站收件箱（默认看待审）
//   /admin/comments?post=<文章id>     绑定到某篇文章：顶部有文章上下文，评论按对话顺序排列，可以直接回复
// 所有动作（通过/垃圾/删除/回复/批量）都是 fetch 调用 + JSON 返回，页面不刷新，
// 返回值里带着最新的数字和重新渲染好的卡片，前端只负责替换——卡片长什么样只有一处模板说了算。

const COMMENT_STATUS_TABS = ['pending', 'approved', 'spam', 'all'];

function renderCommentCard(req, row, depth) {
  return new Promise((resolve, reject) => {
    req.app.render('partials/comment-card', { c: row, depth: depth || 0 }, (err, html) => (err ? reject(err) : resolve(html)));
  });
}

router.get('/comments', async (req, res, next) => {
  try {
    const status = COMMENT_STATUS_TABS.includes(req.query.status) ? req.query.status : 'pending';
    const postId = commentModel.isUuid(req.query.post) ? req.query.post : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = postId ? 50 : 30;

    let post = null;
    if (postId) {
      post = await postModel.getById(postId);
      if (!post) return res.redirect('/admin/comments');
    }

    const [{ rows, total }, globalCounts, rail, settings, postCounts] = await Promise.all([
      commentModel.list({ status, postId, page, perPage }),
      commentModel.counts(),
      commentModel.postsWithComments(),
      settingsModel.getAll(),
      postId ? commentModel.countsForPost(postId) : Promise.resolve(null),
    ]);

    // 标签页上的数字跟着范围走：选了文章就是这篇文章的数字
    const tabCounts = postCounts
      ? { ...postCounts, all: postCounts.pending + postCounts.approved + postCounts.spam }
      : globalCounts;

    // 文章绑定视图里，"全部/已通过"按对话排（回复跟在上级后面）；待审和垃圾队列保持平铺
    const threaded = !!postId && (status === 'all' || status === 'approved');
    const cards = threaded ? commentModel.threadOrder(rows) : rows.map((r) => ({ ...r, depth: 0 }));

    res.render('admin/comments', {
      status, post, cards, total, page, perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      tabCounts, rail, commentsEnabled: settings.comments_enabled === 'true',
      csrfToken: generateToken(req, res),
    });
  } catch (err) { next(err); }
});

// 改状态：通过 / 标垃圾 / 退回待审（"撤销"和"恢复"都走这里）
router.post('/comments/:id/status', async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!['pending', 'approved', 'spam'].includes(status)) return res.status(400).json({ error: '状态不合法' });
    const row = await commentModel.setStatus(req.params.id, status);
    if (!row) return res.status(404).json({ error: '评论不存在（可能已被删除）' });
    const depth = req.body.depth === '1' ? 1 : 0;
    const [counts, postCounts, card] = await Promise.all([
      commentModel.counts(), commentModel.countsForPost(row.post_id), commentModel.getCard(row.id),
    ]);
    res.json({ ok: true, status, counts, postId: row.post_id, postCounts, html: await renderCommentCard(req, card, depth) });
  } catch (err) { next(err); }
});

// 永久删除（前端只在"垃圾"和"站长自己的回复"上给这个按钮，并且二次确认）
router.post('/comments/:id/delete', async (req, res, next) => {
  try {
    const gone = await commentModel.remove(req.params.id);
    if (!gone) return res.status(404).json({ error: '评论不存在（可能已被删除）' });
    const [counts, postCounts] = await Promise.all([commentModel.counts(), commentModel.countsForPost(gone.post_id)]);
    res.json({ ok: true, replies: gone.replies, counts, postId: gone.post_id, postCounts });
  } catch (err) { next(err); }
});

// 以站长身份回复：直接通过；回复的是一条待审评论时，上级也一并通过
router.post('/comments/:id/reply', async (req, res, next) => {
  try {
    const content = (req.body.content || '').trim().slice(0, 2000);
    if (!content) return res.status(400).json({ error: '回复内容不能为空' });
    const authorName = (res.locals.siteAuthor || '').trim().slice(0, 80) || '作者';
    const made = await commentModel.replyAsAuthor({ parentId: req.params.id, content, authorName });
    if (!made) return res.status(404).json({ error: '要回复的评论不存在' });
    const [counts, postCounts, card, parentCard] = await Promise.all([
      commentModel.counts(), commentModel.countsForPost(made.postId), commentModel.getCard(made.id),
      made.parentApproved ? commentModel.getCard(made.parentId) : Promise.resolve(null),
    ]);
    const parentDepth = req.body.depth === '1' ? 1 : 0;
    res.json({
      ok: true, parentId: made.parentId, parentApproved: made.parentApproved,
      counts, postId: made.postId, postCounts,
      html: await renderCommentCard(req, card, 1),
      // 回复一条待审评论会顺手把它通过：把更新后的上级卡片一起带回去，前端原地替换
      parentHtml: parentCard ? await renderCommentCard(req, parentCard, parentDepth) : null,
    });
  } catch (err) { next(err); }
});

// 批量：ids 用逗号分隔，最多 200 条
router.post('/comments/bulk', async (req, res, next) => {
  try {
    const ids = String(req.body.ids || '').split(',').map((x) => x.trim()).filter(commentModel.isUuid).slice(0, 200);
    const action = req.body.action;
    if (!ids.length) return res.status(400).json({ error: '没有选中任何评论' });
    let n = 0;
    if (action === 'approve') n = await commentModel.setStatusMany(ids, 'approved');
    else if (action === 'spam') n = await commentModel.setStatusMany(ids, 'spam');
    else if (action === 'pending') n = await commentModel.setStatusMany(ids, 'pending');
    else if (action === 'delete') n = await commentModel.removeMany(ids);
    else return res.status(400).json({ error: '不支持的操作' });
    res.json({ ok: true, n, counts: await commentModel.counts() });
  } catch (err) { next(err); }
});

// 同一访客的所有"待审"评论一次性标为垃圾（已通过的不动）
router.post('/comments/:id/spam-visitor', async (req, res, next) => {
  try {
    const n = await commentModel.spamPendingFromSameVisitor(req.params.id);
    res.json({ ok: true, n, counts: await commentModel.counts() });
  } catch (err) { next(err); }
});

// ---------- 设置 ----------

router.get('/settings', async (req, res, next) => {
  try {
    const settings = await settingsModel.getAll();
    res.render('admin/settings', { settings, csrfToken: generateToken(req, res), error: null });
  } catch (err) { next(err); }
});

router.post('/settings', async (req, res, next) => {
  try {
    await settingsModel.set('comments_enabled', req.body.comments_enabled === 'on' ? 'true' : 'false');
    const perPage = Math.min(50, Math.max(1, parseInt(req.body.posts_per_page, 10) || 10));
    await settingsModel.set('posts_per_page', perPage);
    res.redirect('/admin/settings?saved=1');
  } catch (err) { next(err); }
});

router.post('/settings/password', async (req, res, next) => {
  try {
    // 改密码只信任当前 session 对应的账号，不接受表单里传来的用户名/id——
    // 否则一个能过 CSRF 校验的请求就可能被诱导去改别的账号（此处只有一个账号，但这是通用的正确写法）。
    const { rows } = await require('../config/db').query('SELECT * FROM admins WHERE id = $1', [req.session.adminId]);
    const meRow = rows[0];
    const ok = meRow && (await adminModel.verifyPassword(meRow, req.body.current_password || ''));
    if (!ok) {
      const settings = await settingsModel.getAll();
      return res.status(400).render('admin/settings', {
        settings, csrfToken: generateToken(req, res), error: '当前密码不正确',
      });
    }
    if ((req.body.new_password || '').length < 10) {
      const settings = await settingsModel.getAll();
      return res.status(400).render('admin/settings', {
        settings, csrfToken: generateToken(req, res), error: '新密码至少 10 位',
      });
    }
    await adminModel.changePassword(req.session.adminId, req.body.new_password);
    res.redirect('/admin/settings?password_changed=1');
  } catch (err) { next(err); }
});

module.exports = router;
