const { doubleCsrf } = require('csrf-csrf');

// 双重提交 Cookie 模式：不需要服务端存 token，适合单实例/小型部署。
// cookie 本身加了 __Host- 前缀（生产环境下，见 app.js 中的条件判断），
// 浏览器强制要求这类 cookie 必须 Secure + Path=/ + 无 Domain 属性，能防一大类 cookie 注入攻击。
const isProd = process.env.NODE_ENV === 'production';

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  cookieName: isProd ? '__Host-csrf' : 'csrf-token',
  cookieOptions: {
    sameSite: 'strict',
    secure: isProd,
    path: '/',
  },
  size: 64,
  getTokenFromRequest: (req) => req.body._csrf,
});

module.exports = { generateToken, doubleCsrfProtection };
