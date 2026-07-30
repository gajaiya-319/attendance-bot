const assert = require('assert');
const moment = require('moment-timezone');
const {
    appendAttendanceEventLog,
    backfillAttendanceEventLog,
    ensureAttendanceEventLog
} = require('../src/services/attendanceEventLedger');

const timezone = 'Asia/Manila';

{
    const state = {};
    const log = ensureAttendanceEventLog(state);
    assert.strictEqual(Array.isArray(log), true, 'missing ledger is initialized');
    assert.strictEqual(state.attendanceEventLog, log, 'ledger is stored on state');
}

{
    const state = { attendanceEventLog: [] };
    const result = appendAttendanceEventLog(state, {
        at: '2026-06-30T01:00:00.000Z',
        type: 'clock_in_confirmed',
        source: 'unit-test',
        userId: 'u1',
        userName: 'Tester',
        shift: 'day',
        meta: { sessionId: 's1' }
    }, { moment, timezone });
    const duplicate = appendAttendanceEventLog(state, result.event, { moment, timezone });

    assert.strictEqual(result.appended, true, 'new ledger event is appended');
    assert.strictEqual(duplicate.appended, false, 'same ledger event is deduped');
    assert.strictEqual(state.attendanceEventLog.length, 1, 'duplicate does not increase length');
}

{
    const state = {
        attendanceEventLog: [],
        attendanceData: {
            u1: {
                id: 'u1',
                name: 'Tester',
                shift: 'night',
                attendanceStatus: 'WORKING',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 's1',
                attendanceEvents: [{
                    at: '2026-06-30T13:00:00.000Z',
                    type: 'recorded_status_changed',
                    source: 'unit-test',
                    meta: { transitionId: 1 }
                }]
            }
        }
    };

    const first = backfillAttendanceEventLog(state, { moment, timezone });
    const second = backfillAttendanceEventLog(state, { moment, timezone });

    assert.strictEqual(first.added, 1, 'user events are backfilled once');
    assert.strictEqual(second.added, 0, 'backfill is idempotent');
    assert.strictEqual(state.attendanceEventLog[0].userId, 'u1', 'ledger event keeps user id');
    assert.strictEqual(state.attendanceEventLog[0].sessionId, 's1', 'ledger event keeps session id');
}

{
    const at = '2026-06-30T13:00:00.000Z';
    const state = {
        attendanceEventLog: [{
            id: 'evt-original-session',
            at,
            type: 'live_on_recovered',
            source: 'heartbeat',
            userId: 'u1',
            sessionId: 'old-session'
        }],
        attendanceData: {
            u1: {
                id: 'u1',
                name: 'Tester',
                shift: 'night',
                activeSessionId: 'new-session',
                attendanceEvents: [{
                    at,
                    type: 'live_on_recovered',
                    source: 'heartbeat',
                    meta: { reason: 'live-on-recovered' }
                }]
            }
        }
    };

    const result = backfillAttendanceEventLog(state, { moment, timezone });
    assert.strictEqual(result.added, 0, 'same observed event is not re-added when mutable session metadata changed');
    assert.strictEqual(state.attendanceEventLog.length, 1, 'semantic duplicate does not grow the ledger');
}

{
    const state = {
        attendanceEventLog: Array.from({ length: 100 }, (_, index) => ({
            id: `evt_existing_${index}`,
            at: `2026-07-01T01:${String(index).padStart(2, '0')}:00.000Z`,
            type: 'existing',
            source: 'unit-test'
        })),
        attendanceData: {
            u1: {
                id: 'u1',
                name: 'Old Event User',
                shift: 'night',
                attendanceEvents: [{
                    at: '2026-06-30T23:00:00.000Z',
                    type: 'clock_in_attempt',
                    source: 'live_on',
                    meta: { shift: 'night' }
                }]
            }
        }
    };

    const result = backfillAttendanceEventLog(state, { moment, timezone, maxEvents: 100 });

    assert.strictEqual(result.added, 0, 'full ledger skips events older than the retained window');
    assert.strictEqual(state.attendanceEventLog.length, 100, 'ledger length remains capped');
}

{
    const state = {
        attendanceEventLog: Array.from({ length: 100 }, (_, index) => ({
            id: `evt_existing_newer_${index}`,
            at: `2026-07-01T01:${String(index).padStart(2, '0')}:00.000Z`,
            type: 'existing',
            source: 'unit-test'
        })),
        attendanceData: {
            u1: {
                id: 'u1',
                name: 'New Event User',
                shift: 'day',
                attendanceEvents: [{
                    at: '2026-07-01T03:00:00.000Z',
                    type: 'clock_in_confirmed',
                    source: 'button_or_command',
                    meta: { sessionId: 'new-session' }
                }]
            }
        }
    };

    const result = backfillAttendanceEventLog(state, { moment, timezone, maxEvents: 100 });

    assert.strictEqual(result.added, 1, 'full ledger still accepts events newer than the retained window');
    assert.strictEqual(state.attendanceEventLog.length, 100, 'ledger is trimmed back to the cap');
    assert.ok(state.attendanceEventLog.some(event => event.sessionId === 'new-session'), 'new retained event remains visible');
}

console.log('attendance-event-ledger tests passed');
