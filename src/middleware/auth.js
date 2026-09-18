// 单用户系统，session 里只存一个 adminId。
// 任何 /admin/* 路由（除了登录页本身）都要过这一关。
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.redirect('/admin/login');
}

// 已登录的人不需要再看登录页
function redirectIfAuthed(req, res, next) {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  return next();
}

module.exports = { requireAuth, redirectIfAuthed };
