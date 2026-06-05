'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const {
    STATUS,
    mapClockInStatus,
    mapClockOutStatus,
    calculateAttendanceRates,
    compareAttendanceRows
} = require('../src/utils/rawAttendanceRules');

assert.strictEqual(mapClockInStatus('ontime'), STATUS.ON_TIME);
assert.strictEqual(mapClockInStatus('late'), STATUS.LATE);
assert.strictEqual(mapClockInStatus('absent'), STATUS.LATE);

assert.strictEqual(
    mapClockOutStatus({
        user: { status: 'late' },
        outMoment: moment.tz('2026-06-01T20:00:00', 'Asia/Manila'),
        session: { scheduledEndAt: moment.tz('2026-06-01T22:00:00', 'Asia/Manila').toISOString() },
        moment
    }),
    STATUS.EARLY_OUT
);

assert.strictEqual(
    mapClockOutStatus({
        user: { status: 'ontime' },
        outMoment: moment.tz('2026-06-01T22:30:00', 'Asia/Manila'),
        session: { otStartedAt: moment.tz('2026-06-01T22:00:00', 'Asia/Manila').toISOString() },
        moment
    }),
    STATUS.OVERTIME
);

assert.deepStrictEqual(
    calculateAttendanceRates({ jung: 1, ji: 1, jo: 1, yeon: 1, gyul: 1, hyu: 99 }),
    {
        attended: 4,
        base: 5,
        attRate: 80,
        absRate: 20,
        lateRate: 20
    }
);

const rows = [
    { name: 'late', order: 0, jung: 0, ji: 1, gyul: 0, jo: 0, yeon: 0, ...calculateAttendanceRates({ ji: 1 }) },
    { name: 'normal', order: 1, jung: 1, ji: 0, gyul: 0, jo: 0, yeon: 0, ...calculateAttendanceRates({ jung: 1 }) },
    { name: 'absent', order: 2, jung: 0, ji: 0, gyul: 1, jo: 0, yeon: 0, ...calculateAttendanceRates({ gyul: 1 }) }
].sort((a, b) => compareAttendanceRows('ATT', a, b));

assert.deepStrictEqual(rows.map(row => row.name), ['normal', 'late', 'absent']);

console.log('raw-attendance-rules tests passed');
