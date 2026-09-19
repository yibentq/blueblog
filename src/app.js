require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const compression = require('compression');
const cookieParser = require('cookie-parser');

const pool = require('./config/db');
const { buildHelmet, globalLimiter } = require('./middleware/security');
const { buildSignature } = require('./utils/brand');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();

// 每次进程启动（也就是每次 pm2 restart / 部署）都会变一次，用来给静态资源做 cache-busting——
// 静态资源本身仍然可以让浏览器长期缓存（见下面 express.static 的 maxAge），
// 但只要 URL 带的版本号变了，浏览器就会当成新资源重新请求，不需要每次改完 CSS/JS 都手动清缓存。
const ASSET_VERSION = Date.now();

// 部署在 Cloudflare / Nginx 反代之后，必须信任第一跳代理，
// 否则 req.ip、req.secure、限流用的 IP 全部会是反代自己的地址——限流形同虚设。
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(compression());

// 每个请求生成一个 CSP nonce，供内联 <script>/<style> 使用——
// 不给整站开 'unsafe-inline'，同时又不强求把每一行样式都拆成外部文件。
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(buildHelmet());
app.use(globalLimiter);

app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser()); // csrf-csrf 用双重提交 Cookie 模式，必须能读到 req.cookies

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    name: 'blog_blue_sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 天
    },
  })
);

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), { maxAge: '30d' }));

// 全站通用的模板变量
app.use((req, res, next) => {
  res.locals.siteName = process.env.SITE_NAME || 'blog.blue';
  res.locals.siteDescription = process.env.SITE_DESCRIPTION || '';
  res.locals.siteAuthor = process.env.SITE_AUTHOR || '';
  res.locals.siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  res.locals.siteLaunchDate = process.env.SITE_LAUNCH_DATE || new Date().toISOString();
  res.locals.assetVersion = ASSET_VERSION;
  res.locals.maxUploadMb = Number(process.env.MAX_UPLOAD_MB) || 8;
  res.locals.currentPath = req.path;
  // 模板里画签名词标用的助手。EJS 里没法 require，所以在这里挂到 locals 上。
  res.locals.signatureMark = (opts = {}) =>
    buildSignature({ ink: '#EAF0F8', accent: '#C79A45', stroke: 5, ...opts }).svg;
  next();
});

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

// 统一错误处理：生产环境绝不把 err.stack 吐给用户
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status);
  if (req.path.startsWith('/admin')) {
    res.render('admin/error', { message: status === 500 ? '服务器开小差了' : err.message });
  } else {
    res.render('404', { serverError: status === 500 });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[blog.blue] 正在监听 http://127.0.0.1:${PORT}`);
});

module.exports = app;
