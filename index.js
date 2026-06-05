'use strict';

require('dotenv').config({ override: true });
require('dns').setDefaultResultOrder?.('ipv4first');

const { createAttendanceBotApp } = require('./src/app/createAttendanceBotApp');

const app = createAttendanceBotApp();

async function shutdown(signal) {
    console.log(`[SHUTDOWN] ${signal || 'shutdown'}`);
    try {
        await app.saveSystemAsync();
    } catch (error) {
        console.error('[SHUTDOWN SAVE ERROR]', error?.message || error);
    }
    try {
        await app.shutdown();
    } catch (error) {
        console.error('[SHUTDOWN ERROR]', error?.message || error);
    }
    process.exit(0);
}

process.once('SIGINT', () => { shutdown('SIGINT'); });
process.once('SIGTERM', () => { shutdown('SIGTERM'); });

app.login().catch(error => {
    console.error('[BOOT ERROR]', error?.message || error);
    process.exit(1);
});
