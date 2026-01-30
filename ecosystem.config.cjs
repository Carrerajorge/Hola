module.exports = {
  apps: [
    {
      name: "michat",
      script: "npm",
      args: "start",
      cwd: "/var/www/michat",
      // Restart policy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      // Logging
      error_file: "/root/.pm2/logs/michat-error.log",
      out_file: "/root/.pm2/logs/michat-out.log",
      merge_logs: true,
      // Environment
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
