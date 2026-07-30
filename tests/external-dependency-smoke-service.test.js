'use strict';

const assert = require('assert');
const {
    criticalDiscordChannelIds,
    runExternalDependencySmoke
} = require('../src/services/externalDependencySmokeService');

(async () => {
    const CONFIG = {
        GUILD_ID: 'guild',
        LOG_CHANNEL: 'log',
        STATUS_CHANNEL: 'status',
        PURCHASE_CHANNEL_ID: 'purchase',
        END_ADENA_CHANNEL_IDS: { PAAGRIO: 'adena', VALAKAS: 'adena-v' },
        DEATH_PENALTY_CHANNEL_IDS: { PAAGRIO: 'death' },
        PURCHASE_SPREADSHEET_ID: 'purchase-sheet',
        PAYROLL_SUMMARY_SPREADSHEET_ID: 'payroll-sheet',
        PAYROLL_ARCHIVE_SPREADSHEET_ID: 'payroll-sheet',
        RAW_ATTENDANCE_SPREADSHEET_ID: 'payroll-sheet',
        PURCHASE_SERVER_TABS: { PAAGRIO: 'Paagrio Great', VALAKAS: 'Valakas Great' },
        RAW_ATTENDANCE_WEBAPP_URL: 'https://script.google.com/macros/s/test/exec'
    };
    const channelIds = criticalDiscordChannelIds(CONFIG);
    assert(channelIds.includes('adena'));
    assert.strictEqual(new Set(channelIds).size, channelIds.length);

    const fetchFn = async url => {
        if (url.endsWith('/users/@me')) return { ok: true, status: 200, json: async () => ({ id: 'bot', username: 'Attendance' }) };
        if (url.endsWith('/guilds/guild')) return { ok: true, status: 200, json: async () => ({ id: 'guild', name: 'Great' }) };
        if (url.includes('/channels/')) {
            const id = url.split('/').at(-1);
            return { ok: true, status: 200, json: async () => ({ id, name: id, type: 0 }) };
        }
        return { ok: true, status: 200, json: async () => ([{ name: 'Gab' }]) };
    };
    const createSheetsClient = async () => ({
        spreadsheets: {
            get: async ({ spreadsheetId }) => ({
                data: {
                    spreadsheetId,
                    properties: { title: spreadsheetId },
                    sheets: spreadsheetId === 'purchase-sheet'
                        ? [
                            { properties: { title: 'Paagrio Great' } },
                            { properties: { title: 'Valakas Great' } }
                        ]
                        : [{ properties: { title: 'Raw_Data' } }]
                }
            })
        }
    });
    const healthy = await runExternalDependencySmoke({
        CONFIG,
        token: 'token',
        fetchFn,
        createSheetsClient,
        now: new Date('2026-07-30T00:00:00.000Z')
    });
    assert.strictEqual(healthy.ok, true);
    assert.strictEqual(healthy.failureCount, 0);
    assert.strictEqual(healthy.recoveredCount, 0);
    assert(healthy.checks.some(item => item.name === 'raw-attendance-webapp'));

    let forbiddenStatusCalls = 0;
    const failed = await runExternalDependencySmoke({
        CONFIG,
        token: 'token',
        fetchFn: async url => {
            if (url.endsWith('/channels/status')) {
                forbiddenStatusCalls += 1;
                return { ok: false, status: 403, json: async () => ({ message: 'Missing Access' }) };
            }
            return fetchFn(url);
        },
        createSheetsClient,
        now: new Date('2026-07-30T00:00:00.000Z')
    });
    assert.strictEqual(failed.ok, false);
    assert(failed.failures.some(item => item.name === 'discord-channel:status' && item.status === 403 && item.attempts === 1));
    assert.strictEqual(forbiddenStatusCalls, 1);

    let transientRawCalls = 0;
    const retryDelays = [];
    const recovered = await runExternalDependencySmoke({
        CONFIG,
        token: 'token',
        fetchFn: async url => {
            if (url.startsWith(CONFIG.RAW_ATTENDANCE_WEBAPP_URL)) {
                transientRawCalls += 1;
                if (transientRawCalls === 1) {
                    throw Object.assign(new Error('The operation was aborted due to timeout'), { code: 'ETIMEDOUT' });
                }
            }
            return fetchFn(url);
        },
        createSheetsClient,
        now: new Date('2026-07-30T00:00:00.000Z'),
        retryBaseDelayMs: 25,
        sleepFn: async delayMs => retryDelays.push(delayMs)
    });
    const recoveredRaw = recovered.checks.find(item => item.name === 'raw-attendance-webapp');
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.recoveredCount, 1);
    assert.strictEqual(recoveredRaw.attempts, 2);
    assert.strictEqual(recoveredRaw.recovered, true);
    assert.deepStrictEqual(retryDelays, [25]);

    let persistentTimeoutCalls = 0;
    const persistentRetryDelays = [];
    const persistentFailure = await runExternalDependencySmoke({
        CONFIG,
        token: 'token',
        fetchFn: async url => {
            if (url.startsWith(CONFIG.RAW_ATTENDANCE_WEBAPP_URL)) {
                persistentTimeoutCalls += 1;
                throw Object.assign(new Error('Raw API timed out'), { code: 'ETIMEDOUT' });
            }
            return fetchFn(url);
        },
        createSheetsClient,
        now: new Date('2026-07-30T00:00:00.000Z'),
        maxAttempts: 3,
        retryBaseDelayMs: 10,
        sleepFn: async delayMs => persistentRetryDelays.push(delayMs)
    });
    const timedOutRaw = persistentFailure.failures.find(item => item.name === 'raw-attendance-webapp');
    assert.strictEqual(persistentFailure.ok, false);
    assert.strictEqual(timedOutRaw.attempts, 3);
    assert.strictEqual(timedOutRaw.status, 'ETIMEDOUT');
    assert.strictEqual(persistentTimeoutCalls, 3);
    assert.deepStrictEqual(persistentRetryDelays, [10, 20]);
    console.log('external-dependency-smoke-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
