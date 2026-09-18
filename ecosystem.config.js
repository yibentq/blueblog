// PM2 部署配置。用法：pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'blog-blue',
      script: 'src/app.js',
      cwd: __dirname,
      instances: 1, // 单实例足够：博客读多写少，且 session 用 PG 存储，扩多实例也没有粘性问题，
                     // 但没有必要在一个人的博客上过度设计，先跑单实例，流量真的起来了再考虑 cluster
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      time: true,
      // 崩溃自动重启，但 1 分钟内重启超过 10 次就停止，避免死循环疯狂重启刷日志
      min_uptime: '10s',
      max_restarts: 10,
    },
  ],
};
