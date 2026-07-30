'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const {
    markMonthlyOvertimeAward,
    reconcileMonthlyOvertimeStats
} = require('../src/utils/monthlyAttendanceStats');

const timezone = 'Asia/Manila';
const at = moment.tz('2026-06-30 14:28', 'YYYY-MM-DD HH:mm', timezone);

{
    const user = {};
    assert.strictEqual(markMonthlyOvertimeAward(user, {
        moment,
        at,
        timezone,
        sourceKey: 'auto:2026-06-30T13:00:00.000Z'
    }), true);
    assert.strictEqual(markMonthlyOvertimeAward(user, {
        moment,
        at,
        timezone,
        sourceKey: 'auto:2026-06-30T13:00:00.000Z'
    }), false);
}

{
    const user = {
        totalOT: 250,
        points: 3755,
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
        sessions: [{
            id: 'real-ot-session',
            otStartedAt: moment.tz('2026-06-30 21:00', 'YYYY-MM-DD HH:mm', timezone).toISOString()
        }]
    };
    const stats = reconcileMonthlyOvertimeStats(user, {
        moment,
        at,
        timezone,
        overtimePoints: 5,
        points: { NORMAL_IN: 10, LATE: -5, EXCESSIVE_LATE: -10, EARLY_OUT: -10, OT: 5, ABSENT: -25 }
    });
    assert.strictEqual(stats.totalOT, 1);
    assert.strictEqual(stats.points, 0);
    assert.strictEqual(user.totalOT, 1);
    assert.strictEqual(user.points, 0);
}

console.log('monthly-overtime-stats tests passed');
