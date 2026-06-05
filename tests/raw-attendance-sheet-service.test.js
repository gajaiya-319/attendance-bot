const assert = require('assert');
const {
    canonicalName,
    createAttendanceKey,
    createRawAttendanceSheetService
} = require('../src/services/rawAttendanceSheetService');

assert.strictEqual(canonicalName('Ding-dong - H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding-dong -H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding dong - H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding'), 'Ding dong');
assert.strictEqual(canonicalName('Zeki - P Day time'), 'Zeki');
assert.strictEqual(canonicalName('Zurin - Great Manager'), 'Zurin');
assert.strictEqual(canonicalName('Mitzu shin - Traine H Night Time'), 'Mitzu shin');
assert.strictEqual(canonicalName('Daba - P Night time(Ryuji)'), 'Daba');
assert.strictEqual(canonicalName('Lance * - P Day Time'), 'Lance *');

assert.strictEqual(
    createAttendanceKey({
        date: '2026-06-02',
        server: 'heine',
        shift: 'night',
        name: canonicalName('Ding-dong - H Night Time')
    }),
    '2026-06-02|HEINE|NIGHT|ding dong'
);

(async () => {
    let directAttempts = 0;
    const directGoogle = {
        auth: {
            GoogleAuth: function GoogleAuth() {}
        },
        sheets: () => ({
            spreadsheets: {
                get: async () => {
                    directAttempts += 1;
                    const error = new Error('missing key');
                    error.code = 'ENOENT';
                    throw error;
                },
                values: {
                    get: async () => ({ data: { values: [] } }),
                    update: async () => ({ data: {} }),
                    clear: async () => ({ data: {} })
                },
                batchUpdate: async () => ({ data: {} })
            }
        })
    };
    const posts = [];
    const service = createRawAttendanceSheetService({
        google: directGoogle,
        keyFile: './missing-key.json',
        spreadsheetId: 'sheet-id',
        webAppUrl: 'https://example.test/raw',
        fetchImpl: async (url, options) => {
            posts.push({ url, body: JSON.parse(options.body) });
            return {
                ok: true,
                text: async () => JSON.stringify({ success: true })
            };
        },
        logger: { log() {}, warn() {}, error() {} }
    });

    const profileResult = await service.sendWorkerProfile({
        name: 'Ding-dong - H Night Time',
        server: 'heine',
        shift: 'night'
    });
    assert.strictEqual(profileResult.ok, true, 'profile sync falls back to web app after direct failure');
    assert.strictEqual(posts[0].body.mode, 'profile');
    assert.strictEqual(posts[0].body.name, 'Ding dong');
    assert.strictEqual(posts[0].body.server, 'HEINE');
    assert.strictEqual(posts[0].body.shift, 'NIGHT');

    const removeResult = await service.removeWorkerProfile({
        name: 'Ding-dong - H Night Time'
    });
    assert.strictEqual(removeResult.ok, true, 'profile removal falls back to web app after direct failure');
    assert.strictEqual(posts[1].body.mode, 'removeProfile');
    assert.strictEqual(posts[1].body.name, 'Ding dong');

    const bulkResult = await service.syncWorkerProfiles([
        { name: 'Ding-dong - H Night Time', server: 'heine', shift: 'night' },
        { name: 'Ding dong', server: 'heine', shift: 'night' },
        { name: 'Unknown', server: 'heine', shift: 'night' },
        { name: 'Gab - P Day Time', server: 'paagrio', shift: 'day' }
    ]);
    assert.strictEqual(bulkResult.ok, true, 'bulk profile sync falls back to web app after direct failure');
    assert.strictEqual(bulkResult.count, 2, 'bulk profile fallback deduplicates and skips invalid profiles');
    assert.deepStrictEqual(posts.slice(2).map(post => post.body.name), ['Ding dong', 'Gab']);
    assert.deepStrictEqual(posts.slice(2).map(post => post.body.mode), ['profile', 'profile']);
    assert.strictEqual(directAttempts, 2, 'direct profile failures pause later direct attempts during the same burst');

    const calls = [];
    const successfulGoogle = {
        auth: {
            GoogleAuth: function GoogleAuth() {}
        },
        sheets: () => ({
            spreadsheets: {
                get: async () => {
                    calls.push('spreadsheets.get');
                    return { data: { sheets: [{ properties: { title: 'Current_Workers', sheetId: 1 } }] } };
                },
                values: {
                    get: async ({ range }) => {
                        calls.push(`values.get:${range}`);
                        if (range === 'Current_Workers!A1:E1') {
                            return { data: { values: [['이름', '서버', '근무조', '키', '수정시간']] } };
                        }
                        return { data: { values: [] } };
                    },
                    update: async ({ range }) => {
                        calls.push(`values.update:${range}`);
                        return { data: {} };
                    },
                    clear: async ({ range }) => {
                        calls.push(`values.clear:${range}`);
                        return { data: {} };
                    }
                },
                batchUpdate: async () => {
                    calls.push('spreadsheets.batchUpdate');
                    return { data: {} };
                }
            }
        })
    };
    const cachedService = createRawAttendanceSheetService({
        google: successfulGoogle,
        keyFile: './sheet-bot-key.json',
        spreadsheetId: 'sheet-id',
        webAppUrl: 'https://example.test/raw',
        logger: { log() {}, warn() {}, error() {} }
    });

    await cachedService.syncWorkerProfiles([
        { name: 'Ding dong', server: 'heine', shift: 'night' }
    ]);
    const getCountAfterBulk = calls.filter(call => call.startsWith('values.get:Current_Workers!A2:E')).length;
    await cachedService.sendWorkerProfile({ name: 'Gab', server: 'paagrio', shift: 'day' });
    await cachedService.removeWorkerProfile({ name: 'Ding dong' });
    const getCountAfterSingleOps = calls.filter(call => call.startsWith('values.get:Current_Workers!A2:E')).length;
    assert.strictEqual(getCountAfterSingleOps, getCountAfterBulk, 'profile cache prevents extra Current_Workers reads after bulk sync');
    assert(calls.includes('values.update:Current_Workers!A3:E3'), 'cached profile upsert appends without rereading rows');
    assert(calls.includes('values.clear:Current_Workers!A2:E2'), 'cached profile remove clears without rereading rows');

    console.log('raw-attendance-sheet-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
