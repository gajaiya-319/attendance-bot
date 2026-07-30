'use strict';

module.exports = {
    apps: [{
        name: 'attendance-bot',
        script: 'index.js',
        cwd: __dirname,
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        restart_delay: 3000,
        min_uptime: '10s',
        max_restarts: 10,
        max_memory_restart: '400M',
        kill_timeout: 15000,
        listen_timeout: 15000,
        env: {
            NODE_ENV: 'production'
        }
    }]
};
