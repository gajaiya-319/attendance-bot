const assert = require('assert');
const moment = require('moment-timezone');
const {
    auditAndRepairAttendanceState,
    collapseNoisyHeartbeatEvents
} = require('../src/services/attendanceAutoRepairService');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    ATTENDANCE_EVENT_LOG_MAX: 10000,
    POINTS: { NORMAL_IN: 10, LATE: -5, EXCESSIVE_LATE: -10, EARLY_OUT: -10, OT: 5, ABSENT: -25 }
};

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
}

{
    const events = [
        { at: at('2026-06-30 09:00').toISOString(), type: 'live_on_recovered', source: 'heartbeat' },
        { at: at('2026-06-30 09:01').toISOString(), type: 'live_on_recovered', source: 'heartbeat' },
        { at: at('2026-06-30 09:02').toISOString(), type: 'live_on_recovered', source: 'heartbeat' },
        { at: at('2026-06-30 09:10').toISOString(), type: 'live_on_recovered', source: 'heartbeat' },
        { at: at('2026-06-30 09:11').toISOString(), type: 'clock_in_confirmed', source: 'heartbeat' }
    ];
    const compacted = collapseNoisyHeartbeatEvents(events, {
        moment,
        timezone: CONFIG.TIMEZONE,
        userId: 'u-noise'
    });
    assert.strictEqual(compacted.removed, 2, 'continuous noisy heartbeat events are collapsed');
    assert.deepStrictEqual(
        compacted.events.map(event => event.at),
        [events[0].at, events[3].at, events[4].at],
        'a new event run and non-noisy events are preserved'
    );
}

{
    const firstEvent = {
        at: at('2026-06-30 09:00').toISOString(),
        type: 'live_on_recovered',
        source: 'heartbeat',
        userId: 'u-idempotent',
        meta: { reason: 'live-on-recovered' }
    };
    const secondEvent = {
        ...firstEvent,
        at: at('2026-06-30 09:01').toISOString()
    };
    const state = {
        attendanceData: {
            'u-idempotent': {
                id: 'u-idempotent',
                name: 'Idempotent User',
                checkedIn: false,
                dayOff: false,
                isFinished: true,
                sessions: [],
                attendanceEvents: [firstEvent, secondEvent]
            }
        },
        overtimeUsers: [],
        attendanceEventLog: [firstEvent, secondEvent]
    };
    const first = auditAndRepairAttendanceState(state, {
        CONFIG,
        moment,
        now: at('2026-06-30 09:05'),
        reason: 'unit-test-compaction'
    });
    const second = auditAndRepairAttendanceState(state, {
        CONFIG,
        moment,
        now: at('2026-06-30 09:06'),
        reason: 'unit-test-compaction-repeat'
    });
    assert.strictEqual(first.changed, true, 'first noisy heartbeat compaction changes state');
    assert.strictEqual(second.changed, false, 'heartbeat compaction is idempotent on the next repair cycle');
    assert.strictEqual(
        state.attendanceData['u-idempotent'].attendanceEvents.filter(event => event.type === 'live_on_recovered').length,
        1,
        'user heartbeat run is compacted to one boundary event'
    );
    assert.strictEqual(
        state.attendanceEventLog.filter(event => event.type === 'live_on_recovered').length,
        1,
        'central heartbeat run remains compacted after backfill'
    );
}

{
    const state = {
        attendanceData: {
            u1: {
                id: 'u1',
                name: 'Erzie',
                shift: 'day',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                attendanceStatus: 'WORKING',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 'closed',
                points: 3755,
                totalOT: 250,
                monthlyStats: {
                    month: '2026-06',
                    totalNormal: 2,
                    totalLate: 1,
                    totalExcessiveLate: 1,
                    totalEarly: 1,
                    totalAbsent: 0,
                    totalOT: 250,
                    points: 3755
                },
                attendanceEvents: [{
                    at: at('2026-06-30 13:00').toISOString(),
                    type: 'clock_in_confirmed',
                    source: 'unit-test',
                    meta: { sessionId: 'open2' }
                }],
                sessions: [
                    {
                        id: 'closed',
                        clockInAt: at('2026-06-30 09:00').toISOString(),
                        clockOutAt: at('2026-06-30 10:00').toISOString()
                    },
                    {
                        id: 'open1',
                        clockInAt: at('2026-06-30 11:00').toISOString(),
                        clockOutAt: null
                    },
                    {
                        id: 'open2',
                        clockInAt: at('2026-06-30 13:00').toISOString(),
                        clockOutAt: null,
                        otStartedAt: at('2026-06-30 21:00').toISOString()
                    }
                ]
            }
        },
        overtimeUsers: [
            { id: 'u1', name: 'Erzie', type: 'AUTO' },
            { id: 'u1', name: 'Erzie duplicate', type: 'AUTO' },
            { id: 'missing', name: 'Missing', type: 'AUTO' }
        ],
        attendanceEventLog: []
    };

    const result = auditAndRepairAttendanceState(state, {
        CONFIG,
        moment,
        now: at('2026-06-30 14:00'),
        reason: 'unit-test'
    });

    const user = state.attendanceData.u1;
    assert.strictEqual(result.changed, true, 'auto repair applies safe repairs');
    assert.strictEqual(user.sessions.filter(session => !session.clockOutAt).length, 1, 'duplicate open sessions are closed');
    assert.strictEqual(user.activeSessionId, 'open2', 'active session id points to the open session');
    assert.strictEqual(user.monthlyStats.totalOT, 1, 'monthly overtime is reconciled from sessions');
    assert.strictEqual(user.monthlyStats.points, 0, 'monthly points are recalculated');
    assert.strictEqual(user.totalOT, 1, 'user total overtime is capped');
    assert.deepStrictEqual(state.overtimeUsers.map(ot => ot.id), ['u1'], 'overtime list is deduped and pruned');
    assert.ok(
        state.attendanceEventLog.some(event => event.type === 'clock_in_confirmed'),
        'user event is backfilled into central ledger'
    );
    assert.ok(
        state.attendanceEventLog.some(event => event.type === 'auto_repair_applied'),
        'auto repair action is recorded in central ledger'
    );
}

{
    const state = {
        attendanceData: {
            u2: {
                id: 'u2',
                name: 'Duplicate Session User',
                shift: 'night',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                attendanceStatus: 'WORKING',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 'night:dupe',
                sessions: [
                    {
                        id: 'night:dupe',
                        clockInAt: at('2026-06-29 21:00').toISOString(),
                        clockOutAt: at('2026-06-30 02:00').toISOString()
                    },
                    {
                        id: 'night:dupe',
                        clockInAt: at('2026-06-30 03:00').toISOString(),
                        clockOutAt: null
                    }
                ]
            }
        },
        overtimeUsers: [],
        attendanceEventLog: []
    };

    const result = auditAndRepairAttendanceState(state, {
        CONFIG,
        moment,
        now: at('2026-06-30 04:00'),
        reason: 'unit-test-duplicate-session-id'
    });

    const user = state.attendanceData.u2;
    assert.strictEqual(result.changed, true, 'duplicate session ids are repaired');
    assert.strictEqual(user.activeSessionId, 'night:dupe', 'active session id remains on the open session');
    assert.strictEqual(user.sessions.find(session => session.id === user.activeSessionId).clockOutAt, null, 'active id resolves to the open session');
    assert.ok(user.sessions[0].id.startsWith('night:dupe:repair:'), 'closed duplicate session is renamed');
}

{
    const state = {
        attendanceData: {
            u3: {
                id: 'u3',
                name: 'Stale OT User',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                attendanceStatus: 'OVERTIME',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 'stale-ot-session',
                checkOutRaw: at('2026-07-01 11:00').toISOString(),
                checkOutTime: '11:00 AM',
                lastClockOutSource: 'old-auto-out',
                sessions: [{
                    id: 'stale-ot-session',
                    sessionKey: 'day:2026-06-30 09:00',
                    clockInAt: at('2026-06-30 09:00').toISOString(),
                    scheduledEndAt: at('2026-06-30 19:00').toISOString(),
                    otType: 'AUTO',
                    otStartedAt: at('2026-06-30 19:00').toISOString(),
                    clockOutAt: null
                }],
                attendanceEvents: []
            }
        },
        overtimeUsers: [
            {
                id: 'u3',
                name: 'Stale OT User',
                type: 'AUTO',
                shiftSessionKey: 'day:2026-06-30 09:00',
                startedAt: at('2026-06-30 19:00').toISOString()
            }
        ],
        attendanceEventLog: []
    };

    const result = auditAndRepairAttendanceState(state, {
        CONFIG: { ...CONFIG, MAX_AUTO_OT_MINS: 14 * 60 },
        moment,
        now: at('2026-07-01 12:00'),
        reason: 'unit-test-stale-auto-ot'
    });

    assert.strictEqual(result.changed, true, 'stale auto overtime is repaired');
    assert.deepStrictEqual(state.overtimeUsers, [], 'stale auto overtime entry is removed');
    const user = state.attendanceData.u3;
    assert.strictEqual(user.checkedIn, false, 'stale overtime without another open session is no longer treated as working');
    assert.strictEqual(user.isFinished, true, 'stale overtime without another open session is finalized');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'stale overtime status is finalized when no open session remains');
    assert.strictEqual(user.activeSessionId, null, 'stale active session is cleared');
    assert.strictEqual(user.checkOutRaw, at('2026-06-30 19:00').toISOString(), 'stale checkout time is set to the OT boundary');
    assert.strictEqual(user.checkOutTime, '07:00 PM', 'stale checkout display time is restored');
    assert.strictEqual(user.sessions[0].clockOutAt, at('2026-06-30 19:00').toISOString(), 'stale OT session is closed at the OT start boundary');
    assert.strictEqual(user.sessions[0].clockOutSource, 'auto-repair-stale-overtime', 'stale OT close source is recorded');
}

{
    const state = {
        attendanceData: {
            u4: {
                id: 'u4',
                name: 'No Open Session User',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                attendanceStatus: 'WORKING',
                voiceStatus: 'LIVE_ON',
                activeSessionId: null,
                sessions: [{
                    id: 'closed-stale-session',
                    clockInAt: at('2026-06-30 09:00').toISOString(),
                    clockOutAt: at('2026-06-30 19:00').toISOString(),
                    clockOutSource: 'auto-repair-stale-overtime'
                }],
                attendanceEvents: []
            }
        },
        overtimeUsers: [],
        attendanceEventLog: []
    };

    const result = auditAndRepairAttendanceState(state, {
        CONFIG: { ...CONFIG, MAX_AUTO_OT_MINS: 14 * 60 },
        moment,
        now: at('2026-07-01 12:00'),
        reason: 'unit-test-no-open-session'
    });

    const user = state.attendanceData.u4;
    assert.strictEqual(result.changed, true, 'checked-in user without open session is repaired');
    assert.strictEqual(user.checkedIn, false, 'checked-in flag is cleared');
    assert.strictEqual(user.isFinished, true, 'user is finalized');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'attendance status is finalized');
    assert.strictEqual(user.checkOutRaw, at('2026-06-30 19:00').toISOString(), 'checkout is restored from latest closed session');
}

{
    const state = {
        attendanceData: {
            u5: {
                id: 'u5',
                name: 'Duplicate Stale OT User',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                attendanceStatus: 'OVERTIME',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 'stale-ot-session',
                sessions: [
                    {
                        id: 'stale-ot-session',
                        sessionKey: 'day:2026-06-30 09:00',
                        clockInAt: at('2026-06-30 09:00').toISOString(),
                        scheduledEndAt: at('2026-06-30 19:00').toISOString(),
                        otType: 'AUTO',
                        otStartedAt: at('2026-06-30 19:00').toISOString(),
                        clockOutAt: null
                    },
                    {
                        id: 'stale-ot-session',
                        sessionKey: 'day:2026-06-30 09:00',
                        clockInAt: at('2026-06-30 09:00').toISOString(),
                        scheduledEndAt: at('2026-06-30 19:00').toISOString(),
                        otType: 'AUTO',
                        otStartedAt: at('2026-06-30 19:00').toISOString(),
                        clockOutAt: null
                    }
                ],
                attendanceEvents: []
            }
        },
        overtimeUsers: [
            {
                id: 'u5',
                name: 'Duplicate Stale OT User',
                type: 'AUTO',
                shiftSessionKey: 'day:2026-06-30 09:00',
                startedAt: at('2026-06-30 19:00').toISOString()
            }
        ],
        attendanceEventLog: []
    };

    const result = auditAndRepairAttendanceState(state, {
        CONFIG: { ...CONFIG, MAX_AUTO_OT_MINS: 14 * 60 },
        moment,
        now: at('2026-07-01 12:00'),
        reason: 'unit-test-duplicate-stale-auto-ot'
    });

    const user = state.attendanceData.u5;
    assert.strictEqual(result.changed, true, 'duplicate stale auto overtime is repaired');
    assert.deepStrictEqual(state.overtimeUsers, [], 'duplicate stale auto overtime entry is removed');
    assert.strictEqual(user.sessions.filter(session => !session.clockOutAt).length, 0, 'all duplicate stale OT sessions are closed');
    assert.strictEqual(user.checkedIn, false, 'user is finalized after all stale OT sessions are closed');
    assert.strictEqual(user.isFinished, true, 'user is marked finished after duplicate stale OT repair');
}

console.log('attendance-auto-repair-service tests passed');
