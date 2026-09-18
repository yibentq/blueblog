const express = require('express');
const router = express.Router();

const { requireAuth, redirectIfAuthed } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/security');
const { generateToken, doubleCsrfProtection } = require('../middleware/csrf');
const { upload, uploadDir } = require('../middleware/upload');
const { renderMarkdown, estimateReadingMinutes } = require('../utils/markdown');
const { toSlug } = require('../utils/slug');

const adminModel = require('../models/admin');
const postModel = require('../models/post');
const tagModel = require('../models/tag');
const commentModel = require('../models/comment');
const settingsModel = require('../models/settings');

// 所有写操作（POST/PUT/DELETE）都过 CSRF 校验；GET 不需要，但要能拿到 token 塞进表单
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
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

// ---------- 仪表盘 ----------

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [posts, total, pendingComments] = await Promise.all([
      postModel.listAll({ page, perPage: 20 }),
      postModel.countAll(),
      commentModel.listPending(),
    ]);
    res.render('admin/dashboard', {
      posts, page, totalPages: Math.max(1, Math.ceil(total / 20)),
      pendingCount: pendingComments.length,
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
    const postTags = await postModel.getTagsForPost(post.id);
    res.render('admin/editor', {
      post, tags: [], tagValue: postTags.map((t) => t.name).join(', '), query: req.query,
      csrfToken: generateToken(req, res),
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

// ---------- 图片上传（供编辑器插入封面图 / 正文图片）----------

router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到文件' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ---------- 评论审核 ----------

router.get('/comments', async (req, res, next) => {
  try {
    const pending = await commentModel.listPending();
    res.render('admin/comments', { pending, csrfToken: generateToken(req, res) });
  } catch (err) { next(err); }
});

router.post('/comments/:id/approve', async (req, res, next) => {
  try { await commentModel.setStatus(req.params.id, 'approved'); res.redirect('/admin/comments'); }
  catch (err) { next(err); }
});

router.post('/comments/:id/spam', async (req, res, next) => {
  try { await commentModel.setStatus(req.params.id, 'spam'); res.redirect('/admin/comments'); }
  catch (err) { next(err); }
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
