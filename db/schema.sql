-- blog.blue 数据库结构（PostgreSQL 14+）
-- 设计原则：够用就好，不做用不到的多用户/多租户抽象。
-- 一个站长（admin），文章 + 标签 + 简单统计 + 评论（默认关闭，可开）。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 管理员（单用户，但留了扩展空间）
CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(64)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- 文章
CREATE TABLE IF NOT EXISTS posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           VARCHAR(200) UNIQUE NOT NULL,
  title          VARCHAR(300) NOT NULL,
  summary        VARCHAR(500),
  content_md     TEXT NOT NULL,          -- 原始 Markdown（唯一真实来源）
  content_html   TEXT NOT NULL,          -- 渲染并净化后的 HTML（读多写少，落地缓存）
  cover_image    VARCHAR(500),
  status         VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | published | archived
  is_pinned      BOOLEAN NOT NULL DEFAULT false,
  reading_minutes SMALLINT NOT NULL DEFAULT 1,
  view_count     INTEGER NOT NULL DEFAULT 0,
  seo_title      VARCHAR(300),
  seo_description VARCHAR(500),
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts (is_pinned, published_at DESC);

-- 标签
CREATE TABLE IF NOT EXISTS tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug  VARCHAR(100) UNIQUE NOT NULL,
  name  VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- 评论（默认在 settings 中整体关闭；表结构先留着）
CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
  author_name VARCHAR(80) NOT NULL,
  author_email VARCHAR(255),
  content     TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | approved | spam
  ip_hash     VARCHAR(128),                            -- 存哈希而非明文 IP
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post_status ON comments (post_id, status);

-- 站点设置（键值表，供后台“设置”页读写，避免改代码改配置）
CREATE TABLE IF NOT EXISTS settings (
  key   VARCHAR(100) PRIMARY KEY,
  value TEXT
);
INSERT INTO settings (key, value) VALUES
  ('comments_enabled', 'false'),
  ('posts_per_page', '10')
ON CONFLICT (key) DO NOTHING;

-- session 表由 connect-pg-simple 在启动时自动建表（见 src/app.js）
