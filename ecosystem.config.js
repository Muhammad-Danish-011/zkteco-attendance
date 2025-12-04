module.exports = {
  apps: [{
    name: 'zkteco-service',
    script: './app.js', 
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_file: './logs/combined.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    time: true
  }]
};