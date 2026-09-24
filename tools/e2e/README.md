# tools/e2e —— 集成 / 端到端测试（手动跑）

这个项目没有 CI，也没有 `npm test`。这里放的是**开发时用来验证真实行为**的脚本：
评论模型的 SQL、编辑器的前端交互、评论收件箱的完整流程。改了对应模块，先跑一遍再提交。

| 脚本 | 测什么 | 需要 |
|---|---|---|
| `model.test.js` | `src/models/comment.js` 的真实 SQL：线程排序、parent 校验、批量、级联删除、非法 id | 一次性 Postgres |
| `editor-stub.js` + `editor.test.py` | 后台编辑器：工具栏命令、快捷键、智能回车/Tab、预览、草稿暂存、大纲、粘贴上传占位符 | Playwright；**不连数据库、不走登录** |
| `seed-comments.js` + `comments.test.py` | 评论收件箱：通过/撤销/键盘/批量/同访客/回复线程/文章绑定/前台线程 | 一次性 Postgres + 真实应用 + Playwright |
| `seed-showcase.js` | 视觉走查：一篇用满所有写作语法的文章 + 普通文章 + 一条评论，起真实应用后截首页/文章/站点地图/404 | 一次性 Postgres + 真实应用 + Playwright |

## ⚠️ 安全

`model.test.js` 和 `seed-comments.js` 会写库（前者会 `TRUNCATE comments, posts`）。
脚本里加了"只允许本机数据库"的检查，**但别把 `DATABASE_URL` 指向生产**，也别在生产服务器上跑。

## 准备环境（Ubuntu 例）

```bash
# 1) 一次性 Postgres（不要动系统里那个）
sudo apt-get update && sudo apt-get install -y postgresql
PGBIN=/usr/lib/postgresql/16/bin
mkdir -p /tmp/pgdata && sudo chown postgres /tmp/pgdata
sudo -u postgres $PGBIN/initdb -D /tmp/pgdata -A trust
sudo -u postgres $PGBIN/pg_ctl -D /tmp/pgdata -o '-p 5544 -k /tmp' -l /tmp/pg.log start
sudo -u postgres psql -h /tmp -p 5544 -c 'CREATE DATABASE bb'

# 2) 环境变量（只用于测试）
export DATABASE_URL=postgres://postgres@127.0.0.1:5544/bb
export SESSION_SECRET=testsecret_testsecret_testsecret_00
export CSRF_SECRET=csrfsecret_csrfsecret_csrfsecret_0
export ADMIN_USERNAME=admin ADMIN_PASSWORD=Passw0rd-test-123 ADMIN_EMAIL=a@b.c
export NODE_ENV=development PORT=3999 SITE_AUTHOR=AAAduo SITE_URL=http://127.0.0.1:3999

# 3) 测试用的浏览器（Playwright for Python）
pip install playwright --break-system-packages && python3 -m playwright install chromium
```

`NODE_ENV=development` 是必须的：生产模式下 session cookie 带 `secure`，http://127.0.0.1 上登录不了。

## 跑

```bash
# 评论模型（清空并重建 posts/comments 测试数据）
node db/migrate.js && node tools/e2e/model.test.js

# 编辑器（不需要数据库）
node tools/e2e/editor-stub.js &        # 默认 4317，可用 STUB_PORT 改
python3 tools/e2e/editor.test.py

# 评论收件箱（真实应用）
node db/seed.js                        # 建管理员
node tools/e2e/seed-comments.js
node src/app.js &                      # 监听 3999
python3 tools/e2e/comments.test.py
```

输出里每一行是 `PASS`/`FAIL`，最后一行 `FAILS: []` 表示全过。截图写到 `E2E_OUT`（默认 `/tmp`）。

## 已知的环境限制

- Google Fonts 在很多沙箱里访问不到（返回 403），页面会退回系统字体。测试里已经过滤了这类控制台报错，
  但**字体的最终观感只能在真机上看**。
- `comments.test.py` 的部分断言依赖 `seed-comments.js` 的数据（例如"Third spam"这条要存在），
  改了种子数据要同步改断言。
- 测试之间不完全独立：跑一遍会改变评论状态（通过/删除）。要重跑请 `TRUNCATE comments, posts CASCADE` 后重新 seed。

## 沙箱里的实测记录（2026-09-24）

- `apt-get update && apt-get install -y postgresql` **可行**（apt 源在允许域名内；`deb.nodesource.com` 的签名报错可忽略）；用 root 时 `initdb` 要 `su postgres -c`，见上面的步骤。
- Playwright 的 Chromium **可以启动**——HANDOFF 里早先写的"沙箱没有无头浏览器"已过时；真实页面截图是可行的（Google Fonts 仍 403，字体回退系统字体）。
- 沙箱里**后台进程不会跨命令存活**（Postgres、`node src/app.js` 都要在同一条命令里确认在跑，不在就重启）。
- 截整页（`full_page=True`）时 `body` 的 `background-attachment: fixed` 会在每个视口高度处出现一道明暗接缝，是截图伪影，不是真 bug。
