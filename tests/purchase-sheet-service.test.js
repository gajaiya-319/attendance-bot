const assert = require('assert');
const {
    createPurchaseSheetService,
    resolvePurchaseCell,
    resolveAdenaCell,
    resolveAdenaSummaryCell,
    collectAdenaSummaryResetCells,
    findSectionHeader,
    findUserColumnInHeader,
    findDayRow,
    getColumnLetter,
    parseNumber,
    getNextSummaryAdenaValue,
    resolveServerSheetId,
    normalizeAliasMap,
    resolveSheetName,
    resolveSheetNameCandidates,
    getSectionCandidates
} = require('../src/services/purchaseSheetService');

const rows = [
    ['Great Team (Day Time)'],
    [],
    ['Day', '', 'Ryuji', 'BONUS', 'D&C', 'Gab', 'BONUS', 'D&C'],
    ['31', 'Day Time', '', '', '1000', '', '', ''],
    ['1', 'Day Time', '', '', '', '', '', '2000'],
    ['Great Team (Night Time)'],
    ['Night', '', 'Daba', 'BONUS', 'D&C', 'Gab', 'BONUS', 'D&C'],
    ['31', 'Night Time', '', '', '', '', '', '3000'],
    ['1', 'Night Time', '', '', '4000', '', '', ''],
    [],
    [],
    ['', 'Day Time', '', '', '', 'Night Time', '', '', 'Player', 'P', '', 'Adena', '', 'Gain Adena', '', '', 'Player', 'P', '', 'Adena', '', 'Gain Adena'],
    ['', '', '', '', '', '', '', '', 'Ryuji', '', '', '250000', '', '=N59', '', '', 'Daba', '', '', '230000', '', '=V59'],
    ['', '', '', '', '', '', '', '', 'Gab', '', '', '140884', '', '=N60', '', '', 'Gab', '', '', '261000', '', '=V60'],
    ['', '', '', '', '', '', '', '', 'Total', '0', '', '=SUM(L59:L60)', '', '=SUM(N59:N60)', '', '', 'Total', '0', '', '=SUM(T59:T60)', '', '=SUM(V59:V60)']
];

assert.strictEqual(findSectionHeader(rows, 'Day'), 2);
assert.strictEqual(findSectionHeader(rows, 'Night'), 6);
assert.strictEqual(findUserColumnInHeader(rows[2], 'gab'), 5);
assert.strictEqual(findUserColumnInHeader(rows[2], 'Gab Great'), 5);
assert.strictEqual(findUserColumnInHeader(['Day', '', 'Lance'], 'Lance *'), 2);
assert.strictEqual(findUserColumnInHeader(['Day', '', 'Shijiro'], 'Shijiro OVER TIME'), 2);
assert.strictEqual(findUserColumnInHeader(['Day', '', 'Shijiro'], 'Shijiro OT'), 2);
assert.strictEqual(findUserColumnInHeader(['Night', '', 'Shijiro'], 'Shijiro (OT)', { shijiro: 'shiijiro' }), 2);
assert.strictEqual(findUserColumnInHeader(['Night', '', 'Shiijiro'], 'Shijiro (OT)', { shijiro: 'shiijiro' }), 2);
assert.strictEqual(findDayRow(rows, 31, 3, 5), 3);
assert.deepStrictEqual(getSectionCandidates(rows, { sectionLabels: { DAY: 'Day', NIGHT: 'Night' }, userName: 'Daba OT' }).map(item => item.shift), ['NIGHT']);
assert.strictEqual(getColumnLetter(0), 'A');
assert.strictEqual(getColumnLetter(27), 'AB');
assert.strictEqual(parseNumber('1,234'), 1234);
assert.strictEqual(parseNumber(''), 0);
assert.strictEqual(getNextSummaryAdenaValue(358000, 188000), 546000);
assert.strictEqual(getNextSummaryAdenaValue(188000, -188000), 0);
assert.strictEqual(getNextSummaryAdenaValue(500000, -188000), 312000);
assert.strictEqual(getNextSummaryAdenaValue(100000, -188000), 0);
assert.strictEqual(resolveServerSheetId({ VALAKAS: 140599828 }, 'HEINE'), 140599828);
assert.strictEqual(resolveServerSheetId({ HEINE: 140599828 }, 'VALAKAS'), 140599828);
assert.deepStrictEqual(normalizeAliasMap({ kramthespark: 'kram' }), { kramthespark: 'kram' });
assert.strictEqual(resolveSheetName('KramTheSpark', { kramthespark: 'kram' }), 'kram');
assert.strictEqual(resolveSheetName('Shijiro (OT)', { shijiro: 'shiijiro' }), 'shiijiro');
assert.deepStrictEqual(resolveSheetNameCandidates('Shijiro (OT)', { shijiro: 'shiijiro' }), ['shijiro', 'shiijiro']);
assert.strictEqual(findUserColumnInHeader(rows[6], 'Daba (OT)'), 2);

assert.deepStrictEqual(
    resolvePurchaseCell(rows, {
        sectionLabel: 'Day',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'Gab',
        dayOfMonth: 1
    }),
    { ok: true, rowIndex: 4, colIndex: 7, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolveAdenaCell(rows, {
        sectionLabel: 'Day',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'gabriel',
        aliases: { gabriel: 'gab' },
        dayOfMonth: 1
    }),
    { ok: true, rowIndex: 4, colIndex: 5, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolvePurchaseCell(rows, {
        sectionLabel: 'Night',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'Daba',
        dayOfMonth: 1
    }),
    { ok: true, rowIndex: 8, colIndex: 4, inferredShift: 'NIGHT' }
);

assert.strictEqual(
    resolvePurchaseCell(rows, {
        sectionLabel: 'Night',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'Missing',
        dayOfMonth: 1
    }).code,
    'user-not-found'
);

assert.deepStrictEqual(
    resolveAdenaSummaryCell(rows, {
        shift: 'DAY',
        userName: 'gabriel',
        aliases: { gabriel: 'gab' }
    }),
    { ok: true, rowIndex: 13, colIndex: 11, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolveAdenaSummaryCell(rows, {
        shift: 'NIGHT',
        userName: 'Daba'
    }),
    { ok: true, rowIndex: 12, colIndex: 19, inferredShift: 'NIGHT' }
);

const compactSummaryRows = [
    ['', 'Day Time', '', '', '', 'Night Time'],
    ['Player', 'P', 'Adena', 'Gain Adena', '', 'Player', 'P', 'Adena', 'Gain Adena'],
    ['Zurin', '', '1000', '=D3', '', 'Jure', '', '2000', '=I3'],
    ['BitShelby', '', '', '', '', 'denxie', '', '', ''],
    ['Total', '0', '=SUM(C3:C4)', '=SUM(D3:D4)', '', 'Total', '0', '=SUM(H3:H4)', '=SUM(I3:I4)']
];

assert.deepStrictEqual(
    resolveAdenaSummaryCell(compactSummaryRows, {
        shift: 'DAY',
        userName: 'BitShelby'
    }),
    { ok: true, rowIndex: 3, colIndex: 2, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolveAdenaSummaryCell(compactSummaryRows, {
        shift: 'NIGHT',
        userName: 'Jure'
    }),
    { ok: true, rowIndex: 2, colIndex: 7, inferredShift: 'NIGHT' }
);

assert.strictEqual(
    resolveAdenaSummaryCell(rows, {
        shift: 'NIGHT',
        userName: 'Missing'
    }).code,
    'summary-user-not-found'
);

assert.deepStrictEqual(
    collectAdenaSummaryResetCells(rows, 'DAY'),
    [
        { rowIndex: 12, colIndex: 11, userName: 'Ryuji', previousValue: 250000 },
        { rowIndex: 13, colIndex: 11, userName: 'Gab', previousValue: 140884 }
    ]
);
assert.deepStrictEqual(
    collectAdenaSummaryResetCells(rows, 'NIGHT'),
    [
        { rowIndex: 12, colIndex: 19, userName: 'Daba', previousValue: 230000 },
        { rowIndex: 13, colIndex: 19, userName: 'Gab', previousValue: 261000 }
    ]
);
assert.deepStrictEqual(collectAdenaSummaryResetCells(rows, 'UNKNOWN'), []);

(async () => {
    const calls = [];
    const operationEntries = [];
    const writtenValues = new Map();
    let forceBatchVerificationFailure = false;
    const google = {
        auth: {
            GoogleAuth: class {}
        },
        sheets: () => ({
            spreadsheets: {
                get: async request => {
                    calls.push(`meta:${request.spreadsheetId}`);
                    return {
                        data: {
                            sheets: [
                                { properties: { sheetId: 354531306, title: 'Paagrio Great' } },
                                { properties: { sheetId: 140599828, title: 'Valakas Great' } }
                            ]
                        }
                    };
                },
                values: {
                    get: async request => {
                        calls.push(`get:${request.range}`);
                        if (request.range === "'Valakas Great'!F5") {
                            return { data: { values: [[1000]] } };
                        }
                        return { data: { values: rows } };
                    },
                    update: async request => {
                        calls.push(`update:${request.range}:${request.requestBody.values[0][0]}`);
                        return {};
                    },
                    batchUpdate: async request => {
                        calls.push(`batchUpdate:${request.requestBody.data.map(item => item.range).join(',')}`);
                        for (const item of request.requestBody.data) {
                            writtenValues.set(item.range, item.values[0][0]);
                        }
                        return {};
                    },
                    batchGet: async request => {
                        calls.push(`batchGet:${request.ranges.join(',')}`);
                        return {
                            data: {
                                valueRanges: request.ranges.map(range => ({
                                    range,
                                    values: [[forceBatchVerificationFailure ? 999999 : (writtenValues.get(range) ?? 0)]]
                                }))
                            }
                        };
                    }
                }
            }
        })
    };
    const service = createPurchaseSheetService({
        google,
        keyFile: 'key.json',
        spreadsheetId: 'sheet-id',
        serverTabs: { VALAKAS: 'Valacas Great', HEINE: 'Valacas Great', PAAGRIO: 'Paagrio Great' },
        serverSheetIds: { VALAKAS: 140599828, HEINE: 140599828, PAAGRIO: 354531306 },
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        operationLog: { record: async entry => operationEntries.push(entry) },
        logger: { warn: () => {}, error: () => {} }
    });

    const result = await service.addAdena({
        server: 'VALAKAS',
        shift: 'DAY',
        userName: 'Gab',
        amount: 1000,
        dayOfMonth: 1
    });

    assert.strictEqual(result.ok, true);
    assert(calls.includes('meta:sheet-id'));
    assert(calls.includes("get:'Valakas Great'!A1:ZZ120"));
    assert(calls.includes("update:'Valakas Great'!F5:1000"));
    assert(calls.includes("get:'Valakas Great'!F5"));

    const resetBounds = {
        start: { toISOString: () => '2026-07-29T01:00:00.000Z' },
        end: { toISOString: () => '2026-07-29T13:00:00.000Z' }
    };
    const reset = await service.resetAdenaSummary({
        shift: 'DAY',
        bounds: resetBounds,
        scheduledAt: '2026-07-29T12:50:00.000Z'
    });
    assert.strictEqual(reset.ok, true);
    assert.strictEqual(reset.shift, 'DAY');
    assert.strictEqual(reset.results.length, 2, 'HEINE and VALAKAS must be deduplicated');
    assert.strictEqual(reset.inspected, 4);
    assert.strictEqual(reset.cleared, 4);
    assert(calls.some(call => call.includes("batchUpdate:'Valakas Great'!L13,'Valakas Great'!L14")));
    assert(calls.some(call => call.includes("batchUpdate:'Paagrio Great'!L13,'Paagrio Great'!L14")));
    const resetLog = operationEntries.find(entry => entry.kind === 'end-adena-summary-reset');
    assert.strictEqual(resetLog.status, 'success');
    assert.deepStrictEqual(resetLog.payload, {
        shift: 'DAY',
        scheduledAt: '2026-07-29T12:50:00.000Z',
        shiftStartAt: '2026-07-29T01:00:00.000Z',
        shiftEndAt: '2026-07-29T13:00:00.000Z'
    });

    const invalidReset = await service.resetAdenaSummary({ shift: 'OTHER' });
    assert.deepStrictEqual(invalidReset, { ok: false, code: 'invalid-shift', shift: 'OTHER' });

    const summary = await service.readAdenaSummary({ shift: 'DAY' });
    assert.strictEqual(summary.ok, true);
    assert.strictEqual(summary.cells.length, 4);
    assert(summary.cells.some(cell => cell.server === 'VALAKAS' && cell.userName === 'Ryuji' && cell.value === 250000));

    const repaired = await service.repairAdenaSummary({
        shift: 'DAY',
        expectedValues: [
            { server: 'VALAKAS', userName: 'Ryuji', value: 123000 },
            { server: 'PAAGRIO', userName: 'Gab', value: 0 }
        ]
    });
    assert.strictEqual(repaired.ok, true);
    assert.strictEqual(repaired.corrected, 2);

    forceBatchVerificationFailure = true;
    const rolledBack = await service.repairAdenaSummary({
        shift: 'DAY',
        expectedValues: [{ server: 'VALAKAS', userName: 'Gab', value: 555000 }]
    });
    assert.strictEqual(rolledBack.ok, false);
    assert.strictEqual(rolledBack.corrected, 0);
    assert.strictEqual(rolledBack.failures[0].rolledBack, true);
    assert.strictEqual(writtenValues.get("'Valakas Great'!L14"), 140884, 'failed repair restores the previous value');
    forceBatchVerificationFailure = false;

    {
        const concurrentRows = rows.map(row => [...row]);
        concurrentRows[4][5] = 0;
        concurrentRows[13][11] = 0;
        const concurrentOperations = [];
        const concurrentService = createPurchaseSheetService({
            google: {
                auth: {
                    GoogleAuth: class {}
                },
                sheets: () => ({
                    spreadsheets: {
                        values: {
                            get: async request => {
                                if (request.range.endsWith('!A1:ZZ160')) {
                                    return { data: { values: concurrentRows.map(row => [...row]) } };
                                }
                                if (request.range.endsWith('!F5')) {
                                    return { data: { values: [[concurrentRows[4][5]]] } };
                                }
                                if (request.range.endsWith('!L14')) {
                                    return { data: { values: [[concurrentRows[13][11]]] } };
                                }
                                throw new Error(`Unexpected range: ${request.range}`);
                            },
                            batchUpdate: async request => {
                                await new Promise(resolve => setTimeout(resolve, 15));
                                for (const item of request.requestBody.data) {
                                    if (item.range.endsWith('!F5')) concurrentRows[4][5] = item.values[0][0];
                                    if (item.range.endsWith('!L14')) concurrentRows[13][11] = item.values[0][0];
                                }
                                return {};
                            }
                        }
                    }
                })
            },
            keyFile: 'key.json',
            spreadsheetId: 'sheet-id',
            serverTabs: { PAAGRIO: 'Paagrio Great' },
            sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
            operationLog: {
                listRecent: async () => concurrentOperations,
                record: async entry => concurrentOperations.push({
                    ...entry,
                    messageId: entry.messageId || entry.payload?.messageId || null
                })
            },
            logger: { warn: () => {}, error: () => {} }
        });
        const [regular, overtime] = await Promise.all([
            concurrentService.addAdenaWithSummary({
                server: 'PAAGRIO',
                shift: 'DAY',
                userName: 'Gab',
                amount: 210000,
                rawAmount: 210000,
                dayOfMonth: 1,
                messageId: 'summary-regular'
            }),
            concurrentService.addAdenaWithSummary({
                server: 'PAAGRIO',
                shift: 'DAY',
                userName: 'Gab (OT)',
                amount: 60000,
                rawAmount: 60000,
                dayOfMonth: 1,
                messageId: 'summary-overtime'
            })
        ]);

        assert.strictEqual(regular.ok, true);
        assert.strictEqual(overtime.ok, true);
        assert.strictEqual(regular.summaryNextValue, 210000);
        assert.strictEqual(overtime.summaryPreviousValue, 210000);
        assert.strictEqual(overtime.summaryNextValue, 270000);
        assert.strictEqual(concurrentRows[4][5], 270000);
        assert.strictEqual(concurrentRows[13][11], 270000);
        assert.strictEqual(concurrentOperations.filter(entry => entry.status === 'success').length, 2);
    }

    {
        const resetRaceRows = rows.map(row => [...row]);
        resetRaceRows[4][5] = 0;
        resetRaceRows[12][11] = 0;
        resetRaceRows[13][11] = 100000;
        const resetRaceOperations = [{
            kind: 'end-adena',
            action: 'approve',
            status: 'success',
            createdAt: '2026-07-29T12:40:00.000Z',
            server: 'PAAGRIO',
            shift: 'DAY',
            userName: 'Gab',
            messageId: 'summary-before-reset',
            payload: {
                server: 'PAAGRIO',
                shift: 'DAY',
                userName: 'Gab',
                messageId: 'summary-before-reset',
                rawAmount: 70000,
                audit: {
                    shiftStartAt: resetBounds.start.toISOString(),
                    shiftEndAt: resetBounds.end.toISOString()
                }
            },
            result: { summaryNextValue: 100000 }
        }];
        const resetRaceService = createPurchaseSheetService({
            google: {
                auth: {
                    GoogleAuth: class {}
                },
                sheets: () => ({
                    spreadsheets: {
                        values: {
                            get: async request => {
                                if (request.range.endsWith('!A1:ZZ160')) {
                                    return { data: { values: resetRaceRows.map(row => [...row]) } };
                                }
                                if (request.range.endsWith('!F5')) {
                                    return { data: { values: [[resetRaceRows[4][5]]] } };
                                }
                                if (request.range.endsWith('!L14')) {
                                    return { data: { values: [[resetRaceRows[13][11]]] } };
                                }
                                throw new Error(`Unexpected range: ${request.range}`);
                            },
                            batchUpdate: async request => {
                                const isReset = request.requestBody.data.some(item => (
                                    item.range.endsWith('!L14')
                                ));
                                if (isReset) await new Promise(resolve => setTimeout(resolve, 30));
                                for (const item of request.requestBody.data) {
                                    if (item.range.endsWith('!F5')) resetRaceRows[4][5] = item.values[0][0];
                                    if (item.range.endsWith('!L14')) resetRaceRows[13][11] = item.values[0][0];
                                }
                                return {};
                            },
                            batchGet: async request => ({
                                data: {
                                    valueRanges: request.ranges.map(range => ({
                                        range,
                                        values: [[range.endsWith('!L14') ? resetRaceRows[13][11] : 0]]
                                    }))
                                }
                            })
                        }
                    }
                })
            },
            keyFile: 'key.json',
            spreadsheetId: 'sheet-id',
            serverTabs: { PAAGRIO: 'Paagrio Great' },
            sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
            operationLog: {
                listRecent: async () => resetRaceOperations,
                record: async entry => resetRaceOperations.push(entry)
            },
            logger: { warn: () => {}, error: () => {} }
        });

        const resetPromise = resetRaceService.resetAdenaSummary({
            shift: 'DAY',
            bounds: resetBounds,
            scheduledAt: '2026-07-29T12:50:00.000Z'
        });
        const approvalPromise = resetRaceService.addAdenaWithSummary({
            server: 'PAAGRIO',
            shift: 'DAY',
            userName: 'Gab',
            amount: 50000,
            rawAmount: 50000,
            dayOfMonth: 1,
            messageId: 'summary-after-reset'
        });
        const [resetResult, approvalResult] = await Promise.all([resetPromise, approvalPromise]);

        assert.strictEqual(resetResult.ok, true);
        assert.strictEqual(resetResult.preserved, 1);
        assert.strictEqual(resetResult.corrected, 1);
        assert.strictEqual(approvalResult.ok, true);
        assert.strictEqual(approvalResult.summaryPreviousValue, 70000);
        assert.strictEqual(approvalResult.summaryNextValue, 120000);
        assert.strictEqual(resetRaceRows[4][5], 50000);
        assert.strictEqual(resetRaceRows[13][11], 120000);
    }

    {
        const concurrentRows = rows.map(row => [...row]);
        const concurrentOperations = [];
        let updateCount = 0;
        const concurrentDuplicateService = createPurchaseSheetService({
            google: {
                auth: {
                    GoogleAuth: class {}
                },
                sheets: () => ({
                    spreadsheets: {
                        values: {
                            get: async request => {
                                if (request.range.endsWith('!A1:ZZ120')) {
                                    return { data: { values: concurrentRows.map(row => [...row]) } };
                                }
                                if (request.range.endsWith('!H5')) {
                                    return { data: { values: [[concurrentRows[4][7]]] } };
                                }
                                throw new Error(`Unexpected range: ${request.range}`);
                            },
                            update: async request => {
                                updateCount += 1;
                                await new Promise(resolve => setTimeout(resolve, 15));
                                concurrentRows[4][7] = request.requestBody.values[0][0];
                                return {};
                            }
                        }
                    }
                })
            },
            keyFile: 'key.json',
            spreadsheetId: 'sheet-id',
            serverTabs: { PAAGRIO: 'Paagrio Great' },
            sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
            operationLog: {
                listRecent: async () => concurrentOperations,
                record: async entry => concurrentOperations.push({
                    ...entry,
                    messageId: entry.messageId || entry.payload?.messageId || null
                })
            },
            logger: { warn: () => {}, error: () => {} }
        });
        const payload = {
            payrollKind: 'death-penalty',
            messageId: 'msg-concurrent-duplicate',
            server: 'PAAGRIO',
            shift: 'DAY',
            userName: 'Gab',
            amount: 1000,
            dayOfMonth: 1
        };
        const results = await Promise.all([
            concurrentDuplicateService.addPurchase(payload),
            concurrentDuplicateService.addPurchase(payload)
        ]);

        assert.strictEqual(results.filter(result => result.duplicate).length, 1);
        assert.strictEqual(updateCount, 1, 'concurrent duplicate approval writes to the sheet once');
        assert.strictEqual(concurrentOperations.length, 1, 'concurrent duplicate approval records one successful operation');
        assert.strictEqual(concurrentRows[4][7], 3000);
    }

    {
        const duplicateCalls = [];
        const duplicateService = createPurchaseSheetService({
            google: {
                auth: {
                    GoogleAuth: class {}
                },
                sheets: () => ({
                    spreadsheets: {
                        values: {
                            get: async request => {
                                duplicateCalls.push(`get:${request.range}`);
                                return { data: { values: rows } };
                            },
                            update: async request => {
                                duplicateCalls.push(`update:${request.range}`);
                                return {};
                            }
                        }
                    }
                })
            },
            keyFile: 'key.json',
            spreadsheetId: 'sheet-id',
            serverTabs: { PAAGRIO: 'Paagrio Great' },
            sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
            operationLog: {
                listRecent: async () => [{
                    kind: 'death-penalty',
                    action: 'approve',
                    messageId: 'msg-dup',
                    server: 'PAAGRIO',
                    status: 'success',
                    result: { ok: true }
                }],
                record: async () => {
                    duplicateCalls.push('record');
                }
            },
            logger: { warn: () => {}, error: () => {} }
        });
        const duplicate = await duplicateService.addPurchase({
            payrollKind: 'death-penalty',
            messageId: 'msg-dup',
            server: 'PAAGRIO',
            shift: 'DAY',
            userName: 'Gab',
            amount: 1000,
            dayOfMonth: 1
        });
        assert.strictEqual(duplicate.ok, true);
        assert.strictEqual(duplicate.duplicate, true);
        assert.deepStrictEqual(duplicateCalls, []);
    }

    console.log('purchase-sheet-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});








