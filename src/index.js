'use strict';

// Production entry is project root index.js (PM2: attendance-bot).
// This stub remains so older references fail loudly instead of booting a partial bot.

if (require.main === module) {
    console.error('[BOOT ERROR] Use project root index.js, not src/index.js');
    process.exit(1);
}

module.exports = {};
