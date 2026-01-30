const path = require('path');

// Load environment variables from .env.production
require('dotenv').config({ path: path.join(__dirname, '.env.production') });

module.exports = {
    apps: [
        {
            name: 'michat',
            script: 'npm',
            args: 'start',
            cwd: '/var/www/michat',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '1G',

            // Inject loaded environment variables into the process
            env_production: {
                NODE_ENV: 'production',
                PORT: process.env.PORT || 5001,
                DATABASE_URL: process.env.DATABASE_URL,
                SESSION_SECRET: process.env.SESSION_SECRET,
            },

            error_file: '/var/www/michat/logs/pm2-error.log',
            out_file: '/var/www/michat/logs/pm2-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        },
        {
            name: 'michat-worker',
            script: 'npm',
            args: 'run worker',
            cwd: '/var/www/michat',
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',

            env_production: {
                NODE_ENV: 'production',
                DATABASE_URL: process.env.DATABASE_URL,
            },

            error_file: '/var/www/michat/logs/worker-error.log',
            out_file: '/var/www/michat/logs/worker-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            merge_logs: true,
        }
    ],
    deploy: {
        production: {
            user: 'root',
            host: '69.62.98.126',
            ref: 'origin/main',
            repo: 'https://github.com/Carrerajorge/Hola.git',
            path: '/var/www/michat',
            'post-deploy': 'npm install && npm run build && npm run db:push && pm2 reload ecosystem.config.cjs --env production',
            'pre-setup': 'mkdir -p /var/www/michat/logs',
        }
    }
};
