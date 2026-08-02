'use strict';

const assert = require('assert');
const {
    applyCandidateStateRepair,
    buildDayOffRawRow,
    collectRepairCandidates
} = require('../scripts/repair-approved-dayoff-absences');

const state = {
    attendanceData: {
        leave: {
            id: 'leave',
            name: 'Leave User - P Day Time',
            points: -25,
            strikes: 1,
            totalAbsent: 1,
            finalAbsentSessionKey: 'day:2026-08-02 09:00',
            monthlyStats: { month: '2026-08', totalAbsent: 1, points: -25 },
            attendanceEvents: [{
                type: 'recorded_status_changed',
                source: 'final-absent',
                meta: { reason: 'shift-ended-without-clock-in' }
            }]
        }
    },
    dayOffReservations: {
        leave: {
            id: 'leave',
            messageId: 'leave',
            userId: 'leave',
            status: 'approved',
            shift: 'day',
            leaveDate: '2026-08-02',
            appliedDate: '2026-08-02'
        }
    }
};

const candidates = collectRepairCandidates(state, '2026-08-02');
assert.strictEqual(candidates.length, 1);
assert.deepStrictEqual(buildDayOffRawRow(candidates[0]), {
    date: '2026-08-02',
    server: 'PAAGRIO',
    shift: 'DAY',
    name: 'Leave User - P Day Time',
    status: 'day_off',
    inTime: '-',
    outTime: '-',
    note: '\uC2B9\uC778\uB41C \uD734\uAC00 \uAE30\uB85D \uBCF5\uAD6C - \uACB0\uC11D \uC624\uCC98\uB9AC \uC790\uB3D9 \uC815\uC815',
    forceStatus: true
});

const first = applyCandidateStateRepair(candidates[0], {
    rollbackPenalty: true,
    absentPoints: -25,
    repairedAt: '2026-08-02T15:00:00.000Z'
});
assert.deepStrictEqual(first, { changed: true, penaltyRolledBack: true });
assert.strictEqual(state.attendanceData.leave.points, 0);
assert.strictEqual(state.attendanceData.leave.strikes, 0);
assert.strictEqual(state.attendanceData.leave.totalAbsent, 0);
assert.strictEqual(state.attendanceData.leave.monthlyStats.totalAbsent, 0);
assert.strictEqual(state.attendanceData.leave.monthlyStats.points, 0);

const second = applyCandidateStateRepair(candidates[0], {
    rollbackPenalty: true,
    absentPoints: -25,
    repairedAt: '2026-08-02T15:01:00.000Z'
});
assert.deepStrictEqual(second, { changed: false, penaltyRolledBack: true });
assert.strictEqual(state.attendanceData.leave.points, 0, 'repair is idempotent');

console.log('repair-approved-dayoff-absences tests passed');
