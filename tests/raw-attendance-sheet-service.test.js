const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {
    canonicalName,
    createAttendanceKey,
    createRawAttendanceSheetService,
    chooseFinalStatus,
    normalizeNoteText
} = require('../src/services/rawAttendanceSheetService');

assert.strictEqual(canonicalName('Ding-dong - H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding-dong - V Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding-dong - V Night Time🐲'), 'Ding dong');
assert.strictEqual(canonicalName('Ding-dong -H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding dong - H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding'), 'Ding dong');
assert.strictEqual(canonicalName('Zeki - P Day time'), 'Zeki');
assert.strictEqual(canonicalName('Gab - P Night Time🔥'), 'Gab');
assert.strictEqual(canonicalName('Zurin - Great Manager'), 'Zurin');
assert.strictEqual(canonicalName('Mitzu shin - Traine H Night Time'), 'Mitzu shin');
assert.strictEqual(canonicalName('Daba - P Night time(Ryuji)'), 'Daba');
assert.strictEqual(canonicalName('Lance * - P Day Time'), 'Lance *');
assert.strictEqual(canonicalName('Deia#1024'), 'Deia');
assert.strictEqual(canonicalName('Deia#7347'), 'Deia');
assert.strictEqual(chooseFinalStatus('\uC870\uD1F4', '\uC815\uCD9C', false), '\uC815\uCD9C');
assert.strictEqual(chooseFinalStatus('\uC870\uD1F4', '\uC9C0\uAC01', false), '\uC9C0\uAC01');
assert.strictEqual(chooseFinalStatus('\uC9C0\uAC01', '\uC870\uD1F4', false), '\uC870\uD1F4');
assert.strictEqual(
    normalizeNoteText('DC \u003f\uC88E\uC081 \u003f\uC493\uCED9 \u73E5\uB347\uB0B5 (\u003f\uBEA4\uAE3D \u003f\uB2FF\uB810)'),
    'DC 유예 시간 초과 (정상 퇴근)',
    'raw attendance notes auto-normalize mojibake before storage'
);

assert.strictEqual(
    createAttendanceKey({
        date: '2026-06-02',
        server: 'heine',
        shift: 'night',
        name: canonicalName('Ding-dong - V Night Time')
    }),
    '2026-06-02|발라카스|NIGHT|ding dong'
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
        name: 'Ding-dong - V Night Time',
        server: 'heine',
        shift: 'night'
    });
    assert.strictEqual(profileResult.ok, true, 'profile sync falls back to web app after direct failure');
    assert.strictEqual(posts[0].body.mode, 'profile');
    assert.strictEqual(posts[0].body.name, 'Ding dong');
    assert.strictEqual(posts[0].body.server, '발라카스');
    assert.strictEqual(posts[0].body.shift, 'NIGHT');

    const removeResult = await service.removeWorkerProfile({
        name: 'Ding-dong - V Night Time'
    });
    assert.strictEqual(removeResult.ok, true, 'profile removal falls back to web app after direct failure');
    assert.strictEqual(posts[1].body.mode, 'removeProfile');
    assert.strictEqual(posts[1].body.name, 'Ding dong');

    const bulkResult = await service.syncWorkerProfiles([
        { name: 'Ding-dong - V Night Time', server: 'heine', shift: 'night' },
        { name: 'Ding dong', server: 'heine', shift: 'night' },
        { name: 'Unknown', server: 'heine', shift: 'night' },
        { name: 'Gab - P Day Time', server: 'paagrio', shift: 'day' }
    ]);
    assert.strictEqual(bulkResult.ok, true, 'bulk profile sync falls back to web app after direct failure');
    assert.strictEqual(bulkResult.count, 2, 'bulk profile fallback deduplicates and skips invalid profiles');
    assert.strictEqual(posts[2].body.mode, 'syncProfiles', 'bulk profile fallback uses full replacement mode');
    assert.deepStrictEqual(posts[2].body.profiles.map(profile => profile.name).sort(), ['Ding dong', 'Gab']);
    assert.deepStrictEqual(posts[2].body.profiles.map(profile => `${profile.name}:${profile.shift}`).sort(), ['Ding dong:NIGHT', 'Gab:DAY']);
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

    const readGoogle = {
        auth: {
            GoogleAuth: function GoogleAuth() {}
        },
        sheets: () => ({
            spreadsheets: {
                values: {
                    get: async ({ range }) => {
                        if (range === 'Raw_Attendance!A1:J') {
                            return { data: { values: [
                                ['날짜', '서버', '근무조', '이름', '상태', '출근시간', '퇴근시간', '비고', '키', '수정시간'],
                                ['2026-06-28', 'HEINE', 'NIGHT', 'Ding-dong - V Night Time', '정출', '21:00', '-', '-', '2026-06-28|HEINE|NIGHT|ding dong', 'old']
                            ] } };
                        }
                        if (range === 'Current_Workers!A2:E') {
                            return { data: { values: [
                                ['Gab', 'HEINE', 'DAY', 'HEINE|DAY|gab', 'now']
                            ] } };
                        }
                        return { data: { values: [] } };
                    }
                }
            }
        })
    };
    const readService = createRawAttendanceSheetService({
        google: readGoogle,
        keyFile: './sheet-bot-key.json',
        spreadsheetId: 'sheet-id',
        logger: { log() {}, warn() {}, error() {} }
    });
    const readRows = await readService.readRows();
    assert.strictEqual(readRows[0]['서버'], '발라카스', 'legacy HEINE raw row is normalized on read');
    assert.strictEqual(readRows[0]['키'], '2026-06-28|발라카스|NIGHT|ding dong', 'legacy HEINE raw key is normalized on read');
    assert.strictEqual(readRows[1]['서버'], '발라카스', 'legacy HEINE worker row is normalized on read');

    let rowPostAttempts = 0;
    const rowPosts = [];
    const retryingService = createRawAttendanceSheetService({
        webAppUrl: 'https://example.test/raw',
        fetchImpl: async (url, options) => {
            rowPostAttempts += 1;
            rowPosts.push(JSON.parse(options.body));
            if (rowPostAttempts === 1) {
                return {
                    ok: false,
                    status: 503,
                    text: async () => 'temporary outage'
                };
            }
            return {
                ok: true,
                text: async () => JSON.stringify({ success: true })
            };
        },
        logger: { log() {}, warn() {}, error() {} }
    });

    const firstRowResult = await retryingService.sendAttendanceRow({
        date: '2026-06-28',
        server: 'valakas',
        shift: 'night',
        name: 'BitShelby - V Night Time',
        status: 'normal',
        inTime: '21:00',
        outTime: '-',
        note: 'clock in'
    });
    assert.strictEqual(firstRowResult.ok, false, 'failed raw attendance write reports failure');
    assert.strictEqual(firstRowResult.queued, true, 'failed raw attendance write is queued');
    assert.strictEqual(retryingService.getPendingAttendanceRows().length, 1, 'pending attendance row is retained');

    const secondRowResult = await retryingService.sendAttendanceRow({
        date: '2026-06-28',
        server: 'valakas',
        shift: 'night',
        name: 'Zurin - V Night Time',
        status: 'normal',
        inTime: '21:05',
        outTime: '-',
        note: 'clock in'
    });
    assert.strictEqual(secondRowResult.ok, true, 'next raw attendance write succeeds');
    assert.strictEqual(retryingService.getPendingAttendanceRows().length, 0, 'pending attendance row is flushed before the next write');
    assert.strictEqual(rowPosts.length, 3, 'failed row is retried before the new row is posted');
    assert.strictEqual(rowPosts[1].name, 'BitShelby', 'queued row retries first');
    assert.strictEqual(rowPosts[2].name, 'Zurin', 'new row posts after queued retry');

    const pendingTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'raw-attendance-pending-'));
    const pendingFilePath = path.join(pendingTestDir, 'pending.json');
    try {
        const alwaysFail = async () => ({
            ok: false,
            status: 503,
            text: async () => 'temporary outage'
        });
        const persistentService = createRawAttendanceSheetService({
            webAppUrl: 'https://example.test/raw',
            fetchImpl: alwaysFail,
            pendingFilePath,
            pendingReviewAttempts: 1,
            logger: { log() {}, warn() {}, error() {} }
        });
        const persistentRow = {
            date: '2026-07-27',
            server: 'paagrio',
            shift: 'night',
            name: 'Kauchinrei - P Night Time',
            status: 'normal',
            inTime: '21:00',
            outTime: '-',
            note: 'clock in'
        };

        await persistentService.sendAttendanceRow(persistentRow);
        await persistentService.sendAttendanceRow({ ...persistentRow, note: 'duplicate event' });
        assert.strictEqual(
            persistentService.getPendingAttendanceRows().length,
            1,
            'duplicate failed attendance writes merge into one persistent queue item'
        );
        const savedQueue = JSON.parse(await fs.readFile(pendingFilePath, 'utf8'));
        assert.strictEqual(savedQueue.items.length, 1, 'pending attendance queue is written to disk');

        let reviewAlerts = 0;
        await persistentService.runPendingAttendanceRetryCycle({
            onNeedsReview: async items => {
                reviewAlerts += 1;
                assert.strictEqual(items.length, 1);
            }
        });
        await persistentService.runPendingAttendanceRetryCycle({
            onNeedsReview: async () => { reviewAlerts += 1; }
        });
        assert.strictEqual(reviewAlerts, 1, 'long-running pending row sends only one review alert');

        const restoredPosts = [];
        const restoredService = createRawAttendanceSheetService({
            webAppUrl: 'https://example.test/raw',
            fetchImpl: async (url, options) => {
                restoredPosts.push(JSON.parse(options.body));
                return {
                    ok: true,
                    text: async () => JSON.stringify({ success: true })
                };
            },
            pendingFilePath,
            logger: { log() {}, warn() {}, error() {} }
        });
        await restoredService.loadPendingAttendanceRows();
        assert.strictEqual(restoredService.getPendingAttendanceRows().length, 1, 'pending row is restored after restart');
        const restoredFlush = await restoredService.flushPendingAttendanceRows();
        assert.deepStrictEqual(restoredFlush, { total: 1, succeeded: 1, failed: 0 });
        assert.strictEqual(restoredPosts[0].name, 'Kauchinrei');
        assert.strictEqual(restoredService.getPendingAttendanceRows().length, 0, 'restored row is removed after success');
        const clearedQueue = JSON.parse(await fs.readFile(pendingFilePath, 'utf8'));
        assert.strictEqual(clearedQueue.items.length, 0, 'successful retry clears the persistent queue file');

        const repairedRows = [];
        const repairAuditFilePath = path.join(pendingTestDir, 'repair-audit.jsonl');
        const autoRepairGoogle = {
            auth: { GoogleAuth: function GoogleAuth() {} },
            sheets: () => ({
                spreadsheets: {
                    get: async () => ({ data: { sheets: [
                        { properties: { title: 'Current_Workers', sheetId: 1 } },
                        { properties: { title: 'Raw_Attendance', sheetId: 2 } }
                    ] } }),
                    values: {
                        get: async ({ range }) => {
                            if (range === 'Current_Workers!A2:E') {
                                return { data: { values: [['Kauchinrei', 'PAAGRIO', 'NIGHT', 'key', 'now']] } };
                            }
                            if (range === 'Raw_Attendance!A1:J1') return { data: { values: [[]] } };
                            if (range === 'Raw_Attendance!A2:J') return { data: { values: [] } };
                            return { data: { values: [] } };
                        },
                        update: async () => ({ data: {} }),
                        append: async ({ requestBody }) => {
                            repairedRows.push(requestBody.values[0]);
                            return { data: { updates: { updatedRange: "'Raw_Attendance'!A2:J2" } } };
                        }
                    },
                    batchUpdate: async () => ({ data: {} })
                }
            })
        };
        const autoRepairService = createRawAttendanceSheetService({
            google: autoRepairGoogle,
            keyFile: './sheet-bot-key.json',
            spreadsheetId: 'sheet-id',
            repairAuditFilePath,
            logger: { log() {}, warn() {}, error() {} }
        });
        const autoRepairResult = await autoRepairService.sendAttendanceRow({
            date: '2026-07-27',
            server: null,
            shift: null,
            name: 'Kauchinrei - P Night Time',
            status: 'normal',
            inTime: '21:00',
            outTime: '-',
            note: 'missing profile fields'
        });
        assert.strictEqual(autoRepairResult.ok, true, 'missing profile fields are repaired automatically');
        assert.notStrictEqual(autoRepairResult.preparedRow.server, '-', 'server is restored from Current_Workers');
        assert.strictEqual(autoRepairResult.preparedRow.shift, 'NIGHT', 'shift is restored from Current_Workers');
        assert.strictEqual(autoRepairResult.autoRepairs.length, 2, 'both missing profile fields are audited');
        assert.strictEqual(repairedRows.length, 1, 'repaired attendance row is written without administrator action');
        const auditLines = (await fs.readFile(repairAuditFilePath, 'utf8')).trim().split(/\r?\n/);
        assert.strictEqual(auditLines.length, 1, 'automatic correction writes an internal audit record');

        const ambiguousGoogle = {
            auth: { GoogleAuth: function GoogleAuth() {} },
            sheets: () => ({
                spreadsheets: {
                    get: async () => ({ data: { sheets: [{ properties: { title: 'Current_Workers', sheetId: 1 } }] } }),
                    values: {
                        get: async () => ({ data: { values: [
                            ['SameName', 'PAAGRIO', 'DAY', 'key-1', 'now'],
                            ['SameName', 'VALAKAS', 'NIGHT', 'key-2', 'now']
                        ] } })
                    },
                    batchUpdate: async () => ({ data: {} })
                }
            })
        };
        const ambiguousService = createRawAttendanceSheetService({
            google: ambiguousGoogle,
            keyFile: './sheet-bot-key.json',
            spreadsheetId: 'sheet-id',
            pendingFilePath: path.join(pendingTestDir, 'ambiguous-pending.json'),
            logger: { log() {}, warn() {}, error() {} }
        });
        const ambiguousResult = await ambiguousService.sendAttendanceRow({
            date: '2026-07-27',
            server: null,
            shift: null,
            name: 'SameName',
            status: 'normal',
            inTime: '21:00',
            outTime: '-',
            note: 'ambiguous profile'
        });
        assert.strictEqual(ambiguousResult.queued, true, 'ambiguous profile is retained for later self-healing');
        assert.strictEqual(ambiguousService.getPendingAttendanceRows()[0].failureClass, 'data');
        assert.deepStrictEqual(
            ambiguousService.getPendingAttendanceRows()[0].validationErrors.sort(),
            ['invalid-shift', 'missing-server'],
            'ambiguous profile is never guessed'
        );
    } finally {
        await fs.rm(pendingTestDir, { recursive: true, force: true });
    }

    const forceRows = [
        ['2026-06-29', '파아그리오', 'NIGHT', 'Daba', '결석', '-', '-', '최종 무단결근', '2026-06-29|파아그리오|NIGHT|daba', 'old']
    ];
    const forceGoogle = {
        auth: {
            GoogleAuth: function GoogleAuth() {}
        },
        sheets: () => ({
            spreadsheets: {
                get: async () => ({ data: { sheets: [{ properties: { title: 'Raw_Attendance', sheetId: 1 } }] } }),
                values: {
                    get: async ({ range }) => {
                        if (range === 'Raw_Attendance!A1:J1') return { data: { values: [require('../src/services/rawAttendanceSheetService').RAW_ATTENDANCE_HEADERS || []] } };
                        if (range === 'Raw_Attendance!A2:J') return { data: { values: forceRows } };
                        return { data: { values: [] } };
                    },
                    update: async ({ range, requestBody }) => {
                        if (range !== 'Raw_Attendance!A1:J1') {
                            forceRows[0] = requestBody.values[0];
                        }
                        return { data: {} };
                    },
                    append: async ({ requestBody }) => {
                        forceRows.push(requestBody.values[0]);
                        return { data: { updates: { updatedRange: "'Raw_Attendance'!A3:J3" } } };
                    },
                    clear: async () => ({ data: {} })
                },
                batchUpdate: async () => ({ data: {} })
            }
        })
    };
    const forceService = createRawAttendanceSheetService({
        google: forceGoogle,
        keyFile: './sheet-bot-key.json',
        spreadsheetId: 'sheet-id',
        logger: { log() {}, warn() {}, error() {} }
    });
    await forceService.sendAttendanceRow({
        date: '2026-06-29',
        server: '파아그리오',
        shift: 'night',
        name: 'Daba - P Night Time🔥',
        status: '지각',
        inTime: '00:27',
        outTime: '-',
        note: '2시간 이상 지각 - 결석 취소, 지각 처리',
        forceStatus: true
    });
    assert.strictEqual(forceRows[0][3], 'Daba', 'raw attendance row stores only the player name');
    assert.strictEqual(forceRows[0][4], '지각', 'late return force-updates an existing absent row');
    assert.strictEqual(forceRows[0][5], '00:27', 'late return stores the clock-in time');

    const appended = await forceService.sendAttendanceRow({
        date: '2026-06-29',
        server: 'paagrio',
        shift: 'night',
        name: 'New Worker',
        status: 'normal',
        inTime: '21:00',
        outTime: '-',
        note: 'new row'
    });
    assert.strictEqual(appended.ok, true);
    assert.strictEqual(appended.row, 3, 'new attendance rows use append so the sheet grid expands automatically');
    assert.strictEqual(forceRows[1][3], 'New Worker');

    console.log('raw-attendance-sheet-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
