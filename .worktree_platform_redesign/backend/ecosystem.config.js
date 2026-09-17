// PM2 ecosystem — DigiTronics backend
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 logs digitronics-backend
//   pm2 restart digitronics-backend
// Log rotation: install the rotating module once —
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 10M
//   pm2 set pm2-logrotate:retain 7
module.exports = {
  apps: [
    {
      name: 'digitronics-backend',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,              // JSON fileStore persistence: single instance only
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '512M',
      kill_timeout: 10000,       // allow graceful shutdown (flush + close)
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      out_file: './logs/backend-out.log',
      error_file: './logs/backend-error.log',
      merge_logs: true,
      time: true
    }
  ]
};
