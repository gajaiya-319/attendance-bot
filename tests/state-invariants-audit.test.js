const assert = require('assert');
const { auditStateInvariants } = require('../scripts/audit-state-invariants');

{
    const result = auditStateInvariants({
        attendanceData: {
            active: {
                id: 'active',
                name: 'Active User',
                shift: 'day',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                disconnected: false,
                attendanceStatus: 'WORKING',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 's1',
                sessions: [{ id: 's1', clockInAt: '2026-06-03T00:00:00.000Z', clockOutAt: null }]
            },
            ot: {
                id: 'ot',
                name: 'OT User',
                shift: 'night',
                checkedIn: true,
                dayOff: false,
                isFinished: false,
                disconnected: false,
                attendanceStatus: 'OVERTIME',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 's2',
                sessions: [{ id: 's2', clockInAt: '2026-06-03T00:00:00.000Z', clockOutAt: null }]
            }
        },
        overtimeUsers: [{ id: 'ot', name: 'OT User', type: 'AUTO' }]
    });
    assert.deepStrictEqual(result.issues, [], 'valid working and overtime state has no issues');
}

{
    const result = auditStateInvariants({
        attendanceData: {
            bad: {
                id: 'bad',
                name: 'Unknown',
                shift: 'swing',
                checkedIn: true,
                dayOff: true,
                isFinished: true,
                disconnected: true,
                attendanceStatus: 'FINISHED',
                voiceStatus: 'LIVE_ON',
                activeSessionId: 'closed',
                sessions: [
                    { id: 'closed', clockInAt: '2026-06-03T00:00:00.000Z', clockOutAt: '2026-06-03T01:00:00.000Z' },
                    { id: 'open1', clockInAt: '2026-06-03T02:00:00.000Z', clockOutAt: null }
                ]
            }
        },
        overtimeUsers: []
    });
    const types = result.issues.map(issue => issue.type);
    assert(types.includes('missing-name'), 'audit catches Unknown name');
    assert(types.includes('invalid-shift'), 'audit catches invalid shift');
    assert(types.includes('activeSessionId-closed-session'), 'audit catches closed active session id');
    assert(types.includes('dayOff-open-session'), 'audit catches day-off with open session');
    assert(types.includes('checkedIn-dayOff'), 'audit catches checked-in day-off');
    assert(types.includes('checkedIn-finished'), 'audit catches checked-in finished');
    assert(types.includes('checkedIn-invalid-attendanceStatus'), 'audit catches checked-in FINISHED status');
    assert(types.includes('dayOff-invalid-attendanceStatus'), 'audit catches day-off non DAY_OFF status');
    assert(types.includes('dc-invalid-voiceStatus'), 'audit catches disconnected non DISCONNECTED voice status');
}

{
    const result = auditStateInvariants({
        attendanceData: {
            inactive: {
                id: 'inactive',
                name: 'Inactive Open',
                shift: 'day',
                checkedIn: false,
                dayOff: false,
                isFinished: false,
                disconnected: false,
                attendanceStatus: 'PRE_SHIFT',
                voiceStatus: 'OFFLINE',
                activeSessionId: null,
                sessions: [{ id: 'open', clockInAt: '2026-06-03T00:00:00.000Z', clockOutAt: null }]
            },
            otBad: {
                id: 'otBad',
                name: 'Bad OT',
                shift: 'night',
                checkedIn: false,
                dayOff: false,
                isFinished: true,
                disconnected: false,
                attendanceStatus: 'FINISHED',
                voiceStatus: 'OFFLINE',
                sessions: []
            }
        },
        overtimeUsers: [
            { id: 'otBad', name: 'Bad OT', type: 'AUTO' },
            { id: 'missing', name: 'Missing OT', type: 'AUTO' },
            { id: 'otBad', name: 'Bad OT Duplicate', type: 'AUTO' }
        ]
    });
    const types = result.issues.map(issue => issue.type);
    assert(types.includes('inactive-open-session'), 'audit catches inactive open session');
    assert(types.includes('overtime-not-checkedIn'), 'audit catches OT entry for checked-out user');
    assert(types.includes('overtime-invalid-attendanceStatus'), 'audit catches OT entry with non-OT status');
    assert(types.includes('overtime-user-missing'), 'audit catches OT entry without user');
    assert(types.includes('duplicate-overtime-entry'), 'audit catches duplicate OT entry');
}

console.log('state-invariants-audit tests passed');
