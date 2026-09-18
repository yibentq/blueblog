const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// CSP 写死允许的来源，不用 'unsafe-inline' 兜底——
// 页面内联样式/脚本一律通过 nonce 传入（见 app.js 里的 res.locals.cspNonce）。
function buildHelmet() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // 上传图片走同源，不需要
  });
}

// 登录接口单独限流：15 分钟内最多 8 次尝试，防暴力破解密码
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '尝试次数过多，请 15 分钟后再试' },
});

// 评论接口限流：防刷屏，1 分钟最多 5 条
const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '发送太快了，慢一点' },
});

// 全站基础限流，兜底防爬虫/DoS 级别的滥用（正常访客不会碰到这个上限）
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { buildHelmet, loginLimiter, commentLimiter, globalLimiter };
