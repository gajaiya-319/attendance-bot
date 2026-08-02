'use strict';

const assert = require('assert');
const {
    buildAuditRows,
    classifyAuditRow,
    detectDuplicateSegments,
    enumerateItemSaleEntries,
    resolvePostContext,
    summarizeRows
} = require('../scripts/audit-end-adena-range');

function post(messageId, amount, submissionType = 'REGULAR') {
    return {
        messageId,
        amount,
        rawAmount: amount,
        state: 'APPROVED',
        submissionType,
        declaredStartAt: `2026-08-01T0${messageId}:00:00.000Z`,
        createdAt: `2026-08-01T0${messageId}:30:00.000Z`,
        businessDate: '2026-08-01',
        shift: 'DAY',
        server: 'PAAGRIO',
        sheet: {
            ok: true,
            businessDate: '2026-08-01',
            shift: 'DAY',
            server: 'PAAGRIO',
            userName: 'Kauchinrei',
            range: "'Paagrio Great'!I10",
            value: 230000
        }
    };
}

{
    const context = resolvePostContext({
        parsed: {
            startDate: '8/1/2026',
            startTime: '10:00 AM',
            startTimezone: 'Asia/Seoul'
        },
        message: { timestamp: '2026-08-02T12:56:15.329Z' },
        attendanceUser: { shift: 'day' },
        operation: {
            shift: 'DAY',
            payload: { audit: {
                attendanceSessionId: 'day:2026-08-01-09-00:regular',
                shiftStartAt: '2026-08-01T01:00:00.000Z',
                shiftEndAt: '2026-08-01T13:00:00.000Z'
            } }
        },
        timeLogic: { getShiftBounds: () => { throw new Error('trusted bounds should be used'); } }
    });
    assert.strictEqual(context.ok, true);
    assert.strictEqual(context.businessDate, '2026-08-02');
    assert.strictEqual(context.dateSource, 'message-created-at');
    assert.strictEqual(context.declaredStartAt, null);
    assert.strictEqual(context.declaredDateConflict, false);
}

{
    const entries = enumerateItemSaleEntries({
        PAAGRIO: {
            tab: 'Paagrio Great',
            rows: [
                ['Day', '', 'Giru Kun', 'BONUS', 'D&C'],
                [30, 'Day Time', 200000],
                ['OT', 'Day Time', 150000],
                ['Total Gain Adena', '', 350000]
            ]
        }
    });
    assert.deepStrictEqual(entries, [{
        server: 'PAAGRIO',
        tab: 'Paagrio Great',
        shift: 'DAY',
        userName: 'Giru Kun',
        range: "'Paagrio Great'!C3",
        value: 150000
    }]);
}

{
    const duplicate = detectDuplicateSegments([post('1', 100000), post('2', 130000, 'OVERTIME')]);
    assert.strictEqual(duplicate.duplicate, false);
    assert.strictEqual(duplicate.regularCount, 1);
    assert.strictEqual(duplicate.overtimeCount, 1);
}

{
    const duplicate = detectDuplicateSegments([post('1', 100000), post('2', 130000)]);
    assert.strictEqual(duplicate.duplicate, true);
}

{
    const result = classifyAuditRow({
        actualValue: 170000,
        approvedPosts: [post('1', 160000), post('2', 170000)],
        attendanceExpected: true,
        sheetResolved: true
    });
    assert.strictEqual(result.status, 'DUPLICATE_REVIEW');
    assert.strictEqual(result.expectedValue, 170000, 'latest regular submission is the canonical amount');
}

{
    const rows = buildAuditRows({
        sheetEntries: [{
            businessDate: '2026-08-01',
            shift: 'DAY',
            server: 'PAAGRIO',
            userName: 'Kauchinrei',
            range: "'Paagrio Great'!I10",
            value: 230000
        }],
        expectedEntries: [{
            businessDate: '2026-08-01',
            shift: 'DAY',
            server: 'PAAGRIO',
            userName: 'Kauchinrei'
        }],
        posts: [post('1', 100000), post('2', 130000, 'OVERTIME')]
    });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'MATCH');
    assert.strictEqual(rows[0].expectedValue, 230000);
    assert.deepStrictEqual(summarizeRows(rows).statusCounts, { MATCH: 1 });
}

{
    const result = classifyAuditRow({
        actualValue: 382000,
        approvedPosts: [post('1', 191000)],
        attendanceExpected: true,
        sheetResolved: true
    });
    assert.strictEqual(result.status, 'MISMATCH');
    assert.strictEqual(result.expectedValue, 191000);
}

console.log('end-adena-range-audit tests passed');
