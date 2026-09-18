#!/usr/bin/env bash
# ============================================================
# blog.blue 一键部署脚本 —— 目标环境: Ubuntu 24.04 全新 VPS
# 在服务器上以 root 身份运行:
#   curl -fsSL https://raw.githubusercontent.com/yibentq/blueblog/main/deploy.sh -o deploy.sh
#   bash deploy.sh
# 或者先 scp 上去再跑。脚本幂等——重复运行不会重复建库建用户，但会覆盖 Nginx 配置。
# ============================================================

set -euo pipefail

# ---------- 0. 基本检查 ----------

if [[ $EUID -ne 0 ]]; then
  echo "请用 root 运行（sudo bash deploy.sh）" >&2
  exit 1
fi

if ! grep -q "24.04" /etc/os-release 2>/dev/null; then
  echo "警告：本脚本是按 Ubuntu 24.04 写的，你的系统可能不完全匹配，出问题自己排查。"
  read -rp "仍要继续吗？[y/N] " CONTINUE
  [[ "$CONTINUE" == "y" || "$CONTINUE" == "Y" ]] || exit 1
fi

echo "============================================"
echo " blog.blue 一键部署"
echo "============================================"

# ---------- 1. 交互式收集配置 ----------

read -rp "域名（例如 blog.blue，不带 http:// ）: " DOMAIN
DOMAIN=${DOMAIN:-blog.blue}

REPO_URL="https://github.com/yibentq/blueblog.git"
APP_DIR="/var/www/blog-blue"
APP_USER="blogblue"

read -rp "是否把这台服务器接在 Cloudflare 橙云后面？[Y/n] " USE_CF
USE_CF=${USE_CF:-Y}

read -rp "SSH 端口（用于防火墙放行，不确定就看服务商面板，默认 22）: " SSH_PORT
SSH_PORT=${SSH_PORT:-22}

read -rp "后台管理员用户名（默认 admin）: " ADMIN_USERNAME
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}

read -rp "后台管理员邮箱: " ADMIN_EMAIL

# 密码和密钥全部脚本内随机生成，不需要你手动输入、也不会回显到终端历史——
# 生成后一次性打印在最终摘要里，自己截图存好。
DB_PASSWORD=$(openssl rand -hex 16)
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)
SESSION_SECRET=$(openssl rand -hex 32)
CSRF_SECRET=$(openssl rand -hex 32)

echo ""
echo "配置确认："
echo "  域名: $DOMAIN"
echo "  仓库: $REPO_URL"
echo "  Cloudflare: $USE_CF"
echo "  SSH 端口: $SSH_PORT"
read -rp "确认开始部署？[y/N] " GO
[[ "$GO" == "y" || "$GO" == "Y" ]] || { echo "已取消"; exit 0; }

# ---------- 2. 系统更新 + 基础包 ----------

echo ">> 更新系统并安装基础依赖..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git build-essential ufw fail2ban ca-certificates gnupg

# ---------- 3. 防火墙（先开好，别把自己锁在外面）----------

echo ">> 配置防火墙..."
ufw allow "${SSH_PORT}/tcp" comment 'ssh'
ufw allow 80/tcp comment 'http'
ufw allow 443/tcp comment 'https'
ufw --force enable

# fail2ban 默认规则足够防基础的 SSH 暴力破解，开机自启即可，不用额外配置
systemctl enable --now fail2ban

# ---------- 4. Node.js 20 LTS ----------

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  echo ">> 安装 Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo ">> Node.js 已是较新版本，跳过安装：$(node -v)"
fi

npm install -g pm2

# ---------- 5. PostgreSQL ----------

echo ">> 安装 PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

# ---------- 6. Nginx + certbot ----------

echo ">> 安装 Nginx..."
apt-get install -y nginx
systemctl enable --now nginx

if [[ "$USE_CF" != "y" && "$USE_CF" != "Y" ]]; then
  apt-get install -y certbot python3-certbot-nginx
fi

# ---------- 7. 应用专用系统用户（不用 root 跑 Node 进程）----------

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  echo ">> 创建应用运行用户 $APP_USER..."
  useradd -m -s /bin/bash "$APP_USER"
fi

# ---------- 8. 数据库：建角色 + 建库（幂等）----------

echo ">> 配置 PostgreSQL 数据库..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='blog_blue'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE USER blog_blue WITH PASSWORD '${DB_PASSWORD}';\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='blog_blue'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE DATABASE blog_blue OWNER blog_blue;\""
su - postgres -c "psql -d blog_blue -c \"GRANT ALL ON SCHEMA public TO blog_blue;\""

# ---------- 9. 拉代码 ----------

if [[ -d "$APP_DIR/.git" ]]; then
  echo ">> 已存在部署目录，拉取最新代码..."
  su - "$APP_USER" -c "cd $APP_DIR && git pull"
else
  echo ">> 克隆仓库到 $APP_DIR ..."
  mkdir -p "$APP_DIR"
  chown "$APP_USER":"$APP_USER" "$APP_DIR"
  su - "$APP_USER" -c "git clone $REPO_URL $APP_DIR"
fi

su - "$APP_USER" -c "cd $APP_DIR && npm install --omit=dev"
su - "$APP_USER" -c "mkdir -p $APP_DIR/uploads $APP_DIR/logs"

# ---------- 10. 写 .env ----------

echo ">> 生成 .env ..."
cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=3000
SITE_URL=https://${DOMAIN}

DATABASE_URL=postgres://blog_blue:${DB_PASSWORD}@127.0.0.1:5432/blog_blue

SESSION_SECRET=${SESSION_SECRET}
CSRF_SECRET=${CSRF_SECRET}

ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_EMAIL=${ADMIN_EMAIL}

SITE_NAME=blog.blue
SITE_DESCRIPTION=一个只做一件事的博客
SITE_AUTHOR=AAAduo

UPLOAD_DIR=${APP_DIR}/uploads
MAX_UPLOAD_MB=8

TRUST_PROXY=true
EOF
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

# ---------- 11. 建表 + 种子数据 ----------

echo ">> 初始化数据库结构与管理员账号..."
su - "$APP_USER" -c "cd $APP_DIR && npm run migrate"
su - "$APP_USER" -c "cd $APP_DIR && npm run seed"

# ---------- 12. PM2 常驻 ----------

echo ">> 用 PM2 启动应用..."
su - "$APP_USER" -c "cd $APP_DIR && pm2 delete blog-blue 2>/dev/null || true"
su - "$APP_USER" -c "cd $APP_DIR && pm2 start ecosystem.config.js --env production"
su - "$APP_USER" -c "pm2 save"
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | tail -1 | bash

# ---------- 13. Nginx 站点配置 ----------

echo ">> 配置 Nginx..."
NGINX_CONF="/etc/nginx/sites-available/blog-blue"

if [[ "$USE_CF" == "y" || "$USE_CF" == "Y" ]]; then
  # Cloudflare 橙云模式：源站先用自签证书占位（Cloudflare SSL 模式设为 Flexible 也能跑，
  # 但强烈建议之后换成 Full/Full Strict + Cloudflare Origin Certificate，比 Flexible 安全得多）
  mkdir -p /etc/nginx/ssl
  if [[ ! -f /etc/nginx/ssl/blog-blue.pem ]]; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/blog-blue.key -out /etc/nginx/ssl/blog-blue.pem \
      -subj "/CN=${DOMAIN}"
  fi
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://${DOMAIN}\$request_uri;
}
server {
    listen 443 ssl;
    server_name ${DOMAIN} www.${DOMAIN};
    ssl_certificate     /etc/nginx/ssl/blog-blue.pem;
    ssl_certificate_key /etc/nginx/ssl/blog-blue.key;

    set_real_ip_from 173.245.48.0/20;
    set_real_ip_from 103.21.244.0/22;
    set_real_ip_from 103.22.200.0/22;
    set_real_ip_from 103.31.4.0/22;
    set_real_ip_from 141.101.64.0/18;
    set_real_ip_from 108.162.192.0/18;
    set_real_ip_from 190.93.240.0/20;
    set_real_ip_from 188.114.96.0/20;
    set_real_ip_from 197.234.240.0/22;
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 162.158.0.0/15;
    set_real_ip_from 104.16.0.0/13;
    set_real_ip_from 104.24.0.0/14;
    set_real_ip_from 172.64.0.0/13;
    set_real_ip_from 131.0.72.0/22;
    real_ip_header CF-Connecting-IP;

    client_max_body_size 10m;

    location /uploads/ {
        alias ${APP_DIR}/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
else
  # 不用 Cloudflare：先起 http，certbot 会自动帮你改成 https 并补全跳转
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 10m;

    location /uploads/ {
        alias ${APP_DIR}/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
fi

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/blog-blue
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [[ "$USE_CF" != "y" && "$USE_CF" != "Y" ]]; then
  echo ">> 申请 Let's Encrypt 证书..."
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect || \
    echo "证书申请失败，多半是域名还没解析到这台服务器，稍后手动运行: certbot --nginx -d $DOMAIN"
fi

# ---------- 14. 完成 ----------

echo ""
echo "============================================"
echo " 部署完成"
echo "============================================"
echo "站点地址: https://${DOMAIN}"
echo "后台地址: https://${DOMAIN}/admin/login"
echo ""
echo "后台管理员账号: ${ADMIN_USERNAME}"
echo "后台管理员密码: ${ADMIN_PASSWORD}"
echo "数据库密码:     ${DB_PASSWORD}"
echo ""
echo "！把上面这段截图或存进密码管理器，这个终端窗口关掉就再也看不到了。"
echo "！登录后台后第一件事：去「设置」页把管理员密码改掉。"
if [[ "$USE_CF" == "y" || "$USE_CF" == "Y" ]]; then
  echo "！Cloudflare SSL/TLS 模式记得设成 Full 或 Full (strict)，不要用 Flexible（那样 CF-源站之间是明文）。"
fi
echo "============================================"
