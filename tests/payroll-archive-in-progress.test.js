const assert = require('assert');
const {
    createPayrollArchiveService,
    createPeriodStateFromEndDate,
    findLatestWorklistDateFromDayRows,
    normalizeDateCell,
    PAYROLL_PERIOD_STATE_SHEET,
    parseWorklistDayNumber
} = require('../src/services/payrollArchiveService');

(async () => {
    {
        const base = new Date('2026-06-04T00:00:00Z');
        assert.strictEqual(parseWorklistDayNumber(3), 3);
        assert.strictEqual(parseWorklistDayNumber('3'), 3);
        assert.strictEqual(parseWorklistDayNumber('OT'), null);
        assert.strictEqual(findLatestWorklistDateFromDayRows([[3], [4], [5]], base).toISOString().slice(0, 10), '2026-06-05');
        assert.strictEqual(normalizeDateCell(46178), '2026-06-05', 'Google serial dates are normalized before payroll close scheduling');
    }

    let saveCalls = 0;
    const stateUpdateOptions = [];
    const stateRows = [];
    const service = createPayrollArchiveService({
        google: {
            auth: { GoogleAuth: class {} },
            sheets: () => ({
                spreadsheets: {
                    values: {
                        get: async ({ range }) => {
                            const text = String(range || '');
                            if (text.includes(PAYROLL_PERIOD_STATE_SHEET)) {
                                return { data: { values: text.includes('A1:K1') ? [] : stateRows } };
                            }
                            if (text.includes('A8:A10') || text.includes('A34:A36')) {
                                return { data: { values: [[3], [4], [5]] } };
                            }
                            if (text.includes('Raw_Data')) {
                                return { data: { values: [['2026-01-01 12:00:00']] } };
                            }
                            if (text.includes('B5:H6')) {
                                return { data: { values: [
                                    ['PAAGRIO', 1, 1, 0, 1, 0, 1],
                                    ['HEINE', 1, 1, 0, 1, 0, 1]
                                ] } };
                            }
                            return { data: { values: [['x', '1', 'PAAGRIO', 1, 1, 1, 1, 1, 1, '']] } };
                        },
                        update: async ({ range, requestBody, valueInputOption }) => {
                            const text = String(range || '');
                            if (text.includes(PAYROLL_PERIOD_STATE_SHEET) && !text.includes('A1:K1')) {
                                stateUpdateOptions.push(valueInputOption);
                                const match = text.match(/A(\d+):K\1/);
                                const rowIndex = match ? Number(match[1]) - 2 : stateRows.length;
                                stateRows[rowIndex] = requestBody.values[0];
                            } else if (text.includes('Raw_Data')) {
                                saveCalls += 1;
                            }
                            await new Promise(resolve => setTimeout(resolve, 50));
                            return {};
                        }
                    },
                    get: async () => ({
                        data: {
                            sheets: [
                                { properties: { title: 'Raw_Data' } },
                                { properties: { title: PAYROLL_PERIOD_STATE_SHEET } }
                            ]
                        }
                    }),
                    batchUpdate: async () => ({})
                }
            })
        },
        keyFile: 'key.json',
        spreadsheetId: 'payroll-sheet',
        greatSpreadsheetId: 'worklist-sheet',
        serverTabs: { PAAGRIO: 'P', HEINE: 'H' },
        logger: { warn: () => {}, error: () => {}, log: () => {} }
    });

    const first = service.saveCurrent({ savedBy: 'a' });
    const second = await service.saveCurrent({ savedBy: 'b' });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.code, 'archive-in-progress');
    await first;
    assert(saveCalls >= 1);
    assert.strictEqual(stateRows[0][3], 'CLOSED', 'successful save closes the payroll period state');
    assert(stateUpdateOptions.every(option => option === 'RAW'), 'payroll period state dates are written as RAW strings');

    {
        const closedState = createPeriodStateFromEndDate(new Date('2026-06-05T00:00:00Z'), {
            now: new Date('2026-06-04T00:00:00Z'),
            status: 'CLOSED'
        });
        closedState.rowNumber = 2;
        const result = await service.saveCurrent({ savedBy: 'c', periodState: closedState });
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.code, 'period-already-closed');
    }

    console.log('payroll-archive-in-progress tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
