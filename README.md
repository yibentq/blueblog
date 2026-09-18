# blog.blue

一个只为 blog.blue 这个域名设计的极简单用户博客系统。原则：够用、安全、跑得动，不做用不上的抽象。

## 技术栈

Node.js (Express) · PostgreSQL · EJS 服务端渲染 · PM2 · Nginx · 可选 Cloudflare

没有用前端框架，没有 build 步骤——一个人写博客，不需要为此背上一整套前端工程化。

## 目录结构

```
blog-blue/
├── db/                # schema.sql + 迁移/初始化脚本
├── src/
│   ├── app.js          # 入口
│   ├── config/db.js     # PG 连接池
│   ├── middleware/       # auth / csrf / security(helmet+限流) / upload
│   ├── models/           # 数据访问层（post/tag/comment/settings/admin）
│   └── routes/            # public.js 前台，admin.js 后台
├── views/                 # EJS 模板（前台 + 后台）
├── public/                # 静态资源：css/js/favicon
├── deploy/nginx.conf.example
├── ecosystem.config.js    # PM2 配置
└── .env.example
```

## 本地/服务器部署步骤

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env：数据库连接串、SESSION_SECRET、CSRF_SECRET（用 openssl rand -hex 32 生成）、管理员账号密码

# 3. 建库建表
createdb blog_blue   # 或在你的 PG 管理工具里建好这个库
npm run migrate

# 4. 创建管理员账号 + 示例文章
npm run seed

# 5. 本地跑起来看看
npm run dev
# 打开 http://localhost:3000  后台在 /admin

# 6. 生产环境用 PM2 常驻
mkdir -p logs uploads
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # 让 PM2 开机自启

# 7. Nginx 反代 + Cloudflare
# 参考 deploy/nginx.conf.example，改成你自己的证书路径后启用站点
```

## 安全设计说明（写给未来的你，别忘了为什么这么写）

- **密码**：bcrypt cost 12，绝不明文/可逆存储；登录接口单独限流（15 分钟 8 次），失败提示不区分"用户不存在"和"密码错误"，减少账号枚举。
- **CSRF**：双重提交 Cookie 模式（`csrf-csrf` 库），所有后台写操作（POST）都校验；`__Host-` 前缀 cookie 在生产环境强制 Secure，防 cookie 注入。
- **CSP**：不开 `unsafe-inline`，每个请求生成一次性 nonce 给内联 `<script>`；图片/字体/脚本来源都写死白名单。
- **XSS**：Markdown 渲染后一定过 `sanitize-html`，允许的标签/属性都是显式列出的白名单，不是"默认全部禁止再一个个开"这种容易漏的写法。
- **文件上传**：只信 MIME 白名单（jpg/png/webp/gif），文件名用随机串+校验过的扩展名重新生成，绝不用用户提供的原始文件名——防路径穿越、防覆盖、防用双扩展名伪装可执行文件。
- **限流**：全站基础限流兜底 + 登录/评论接口各自更严格的限流；部署在 Cloudflare 后面时，Nginx 用 `real_ip_module` 还原真实 IP，否则限流会把 Cloudflare 边缘节点当成同一个"用户"，限流失效。
- **Session**：存 PostgreSQL（`connect-pg-simple`），不是内存 session store（重启就掉线，多实例也不共享）；`httpOnly` + `sameSite=lax` + 生产环境 `secure`。
- **评论反垃圾**：蜜罐字段（正常用户看不到，机器人脚本常常无差别填表单所有字段）+ 默认 `pending` 状态，站长审核后才公开显示，不做自动化内容审核（个人博客量级用不上，也没必要接三方审核 API 增加成本和依赖）。
- **IP 不留明文**：评论表只存 IP 的哈希值，够用来做"同一访客短期内重复提交"之类的判断，但不构成可逆的个人信息存储。

## 各专业视角的取舍说明

- **域名评估角度**：`blog.blue` 这类短域名的价值在于"好记 + 语义直白"，所以首页信息架构刻意做得极简——不堆砌导航项、不做分类矩阵，一个域名配一个纯粹的东西，博客本身就是内容，不需要产品说明书式的落地页。
- **资深博客使用者角度**：写作是唯一的核心功能。编辑器就是一个 Markdown textarea + 图片上传按钮，没有强迫你用复杂的块编辑器；RSS、sitemap、SEO 字段这些"内容分发"的基础设施从第一版就有，不是后加的。
- **设计师/美术师角度**：视觉概念是"blog + blue → 工程蓝图 / 蓝晒工艺"，深蓝底 + 白色线条注记 + 纸卡片裁角标记，刻意避开了 AI 生成页面常见的暖米色+衬线+陶土色套路，也避开了"科技感深色+荧光绿"套路。等宽字体只用在真正的"标注"场景（日期、阅读时长、代码），不是到处撒monospace装饰。
- **程序员角度**：分层清楚（routes → models → db），单文件都不长，没有过度抽象成微服务或引入你用不上的消息队列/缓存层——这个量级的博客，PostgreSQL 单实例配合合理索引就足够快。
- **产品评估工程师角度**：核心指标是"发一篇文章需要几步"和"页面加载够不够快"。发文流程是：写标题→写 Markdown→选状态→保存，4 步内完成；页面除 Google Fonts 外无其他外部请求，静态资源本地出且带 7-30 天缓存。
- **用户体验评测师角度**：键盘可访问性（可见 focus 样式）、`prefers-reduced-motion` 降级、移动端断点，都在基础 CSS 里覆盖了，不是"以后再加"的待办事项。

## 可选的后续扩展（当前版本刻意没做，量级不到之前别加）

- 全文搜索：文章量上百篇之后，可以加 PostgreSQL 的 `tsvector` 全文索引，不需要单独上 Elasticsearch。
- 图片存储换成对象存储（R2/S3）：流量大了再换，现在本地磁盘 + Nginx 直出完全够用。
- 多语言：如果 blog.blue 要做中英双语，需要在 posts 表加 `locale` 字段，现在没做是因为你目前的内容都是中文。
- Webmention / 评论回复通知邮件：锦上添花，不是地基。

## 首次登录

`npm run seed` 之后，用 `.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录 `/admin/login`，登录后立刻去"设置"页把密码改掉——种子脚本里的密码等于是明文写在你本地的 `.env` 文件里，长期使用不安全。
