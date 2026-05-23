const assert = require('assert');
const {
    evaluateStatusTransition,
    collectStatusTransitionWarnings
} = require('../src/services/stateTransitionPolicy');

{
    const result = evaluateStatusTransition({
        user: { attendanceStatus: 'PRE_SHIFT', voiceStatus: 'OFFLINE', dayOff: false },
        next: { attendanceStatus: 'WORKING', voiceStatus: 'LIVE_ON' },
        source: 'clock-in',
        reason: 'unit-test'
    });

    assert.deepStrictEqual(result.warnings, [], 'normal clock-in transition has no warning');
}

{
    const result = evaluateStatusTransition({
        user: { attendanceStatus: 'DAY_OFF', voiceStatus: 'OFFLINE', dayOff: true },
        next: { attendanceStatus: 'WORKING', voiceStatus: 'LIVE_ON' },
        source: 'voice-state',
        reason: 'unexpected-live-on'
    });

    assert.ok(result.warnings.some(w => w.startsWith('dayoff-user-attendance-change')), 'day-off user transition is warned');
    assert.ok(result.warnings.some(w => w.startsWith('leaving-dayoff')), 'leaving day-off status is warned');
}

{
    const result = evaluateStatusTransition({
        user: { attendanceStatus: 'WORKING', voiceStatus: 'LIVE_ON', dayOff: false },
        next: { attendanceStatus: 'MYSTERY', voiceStatus: 'UNKNOWN' },
        source: 'unit-test',
        reason: 'bad-status'
    });

    assert.ok(result.warnings.includes('unknown-attendance-status:MYSTERY'), 'unknown attendance status is warned');
    assert.ok(result.warnings.includes('unknown-voice-status:UNKNOWN'), 'unknown voice status is warned');
}

{
    const rows = collectStatusTransitionWarnings({
        user1: {
            id: 'user1',
            name: 'Robin',
            statusTransitionWarnings: [
                {
                    at: '2026-05-22T01:00:00.000Z',
                    source: 'voice-state',
                    reason: 'older',
                    warnings: ['older-warning']
                },
                {
                    at: '2026-05-22T02:00:00.000Z',
                    source: 'clock-in',
                    reason: 'newer',
                    warnings: ['newer-warning']
                }
            ]
        },
        user2: {
            id: 'user2',
            name: 'K3nchin',
            statusTransitionWarnings: []
        }
    }, { limit: 1 });

    assert.strictEqual(rows.length, 1, 'collector respects limit');
    assert.strictEqual(rows[0].userName, 'Robin', 'collector keeps user name');
    assert.deepStrictEqual(rows[0].warnings, ['newer-warning'], 'collector sorts newest first');
}

console.log('state-transition-policy tests passed');
