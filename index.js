'use strict';

require('dotenv').config({ override: true });
require('dns').setDefaultResultOrder?.('ipv4first');

const { createAttendanceBotApp } = require('./src/app/createAttendanceBotApp');

const app = createAttendanceBotApp();
let shutdownPromise = null;

async function shutdown(signal, { exitCode = 0, save = true } = {}) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
        console.log(`[SHUTDOWN] ${signal || 'shutdown'}`);
        if (save) {
            try {
                await app.saveSystemAsync();
            } catch (error) {
                console.error('[SHUTDOWN SAVE ERROR]', error?.message || error);
            }
        }
        try {
            await app.shutdown();
        } catch (error) {
            console.error('[SHUTDOWN ERROR]', error?.message || error);
        }
        process.exit(exitCode);
    })();
    return shutdownPromise;
}

process.once('SIGINT', () => { shutdown('SIGINT'); });
process.once('SIGTERM', () => { shutdown('SIGTERM'); });
process.once('uncaughtException', error => {
    console.error('[FATAL UNCAUGHT EXCEPTION]', error?.stack || error);
    setTimeout(() => process.exit(1), 15_000).unref?.();
    shutdown('uncaughtException', { exitCode: 1, save: false });
});
process.once('unhandledRejection', reason => {
    console.error('[FATAL UNHANDLED REJECTION]', reason?.stack || reason);
    setTimeout(() => process.exit(1), 15_000).unref?.();
    shutdown('unhandledRejection', { exitCode: 1, save: false });
});

app.login().catch(error => {
    console.error('[BOOT ERROR]', error?.message || error);
    process.exit(1);
});
