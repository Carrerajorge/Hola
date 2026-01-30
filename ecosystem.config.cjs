/**
 * PM2 Ecosystem Configuration for ILIAGPT/MICHAT Production
 * 
 * This file defines the production deployment configuration for PM2.
 * It ensures the application runs from the correct directory with
 * proper environment variables and restart policies.
 * 
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload ecosystem.config.cjs --env production
 */

module.exports = {
    apps: [
        {
            name: 'michat',
            script: 'npm',
            args: 'start',
            cwd: '/var/www/michat',

            // Environment
            env_production: {
                NODE_ENV: 'production',
                PORT: 5001,
            },

            // Process management
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,

            // Restart policy with exponential backoff
            max_restarts: 10,
            min_uptime: '10s',
            restart_delay: 4000,
            exp_backoff_restart_delay: 100,

            // Memory management
            max_memory_restart: '1G',

            // Logging
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            error_file: '/var/www/michat/logs/pm2-error.log',
            out_file: '/var/www/michat/logs/pm2-out.log',
            merge_logs: true,

            // Graceful shutdown
            kill_timeout: 30000,
            wait_ready: true,
            listen_timeout: 10000,
        },
        {
            name: 'michat-worker',
            script: 'npm',
            args: 'run worker',
            cwd: '/var/www/michat',

            env_production: {
                NODE_ENV: 'production',
            },

            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,

            max_restarts: 10,
            min_uptime: '10s',
            restart_delay: 4000,

            error_file: '/var/www/michat/logs/worker-error.log',
            out_file: '/var/www/michat/logs/worker-out.log',
            merge_logs: true,
        }
    ],

    // Deployment configuration (optional, for pm2 deploy)
    deploy: {
        production: {
            user: 'root',
            host: '69.62.98.126',
            ref: 'origin/main',
            repo: 'https://github.com/Carrerajorge/Hola.git',
            path: '/var/www/michat',
            'pre-deploy-local': '',
            'post-deploy': 'npm install && npm run build && npm run db:push && pm2 reload ecosystem.config.cjs --env production',
            'pre-setup': 'mkdir -p /var/www/michat/logs',
        }
    }
};
