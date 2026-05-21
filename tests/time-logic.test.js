const assert = require('assert');
const moment = require('moment-timezone');
const createTimeLogic = require('../time-logic');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    PRE_SHIFT_LIVE_BUFFER_MINS: 10
};

const SHIFT_SCHEDULE = {
    day: {
        default: { start: '09:00', end: '21:00', endOffsetDays: 0 },
        Tuesday: { start: '09:00', end: '19:00', endOffsetDays: 0 }
    },
    night: {
        default: { start: '21:00', end: '09:00', endOffsetDays: 1 },
        Tuesday: { start: '19:00', end: '04:00', endOffsetDays: 1 }
    }
};

const MAINTENANCE_WINDOWS = [
    { day: 'Wednesday', start: '04:00', end: '09:00' }
];

const time = createTimeLogic({ CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS, moment });

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
}

function assertBounds(label, shift, ref, expectedStart, expectedEnd) {
    const bounds = time.getShiftBounds(shift, at(ref));
    assert.strictEqual(bounds.start.format('YYYY-MM-DD HH:mm'), expectedStart, `${label} start`);
    assert.strictEqual(bounds.end.format('YYYY-MM-DD HH:mm'), expectedEnd, `${label} end`);
}

assertBounds('Tuesday day', 'day', '2026-05-19 12:00', '2026-05-19 09:00', '2026-05-19 19:00');
assertBounds('Tuesday night', 'night', '2026-05-19 20:00', '2026-05-19 19:00', '2026-05-20 04:00');
assertBounds('Wednesday night carry', 'night', '2026-05-20 03:30', '2026-05-19 19:00', '2026-05-20 04:00');
assertBounds('Normal night', 'night', '2026-05-21 22:00', '2026-05-21 21:00', '2026-05-22 09:00');

assert.strictEqual(time.getOperationalShift(at('2026-05-20 06:00')), null, 'Wednesday maintenance has no operational shift');
assert.strictEqual(time.isMaintenanceWindow(at('2026-05-20 06:00')), true, 'Wednesday 06:00 is maintenance');
assert.strictEqual(time.isMaintenanceWindow(at('2026-05-20 09:00')), false, 'Wednesday 09:00 exits maintenance');
assert.strictEqual(time.isWithinPreShiftWindow('day', at('2026-05-20 08:50')), true, '08:50 is day pre-shift buffer');
assert.strictEqual(time.isWithinPreShiftWindow('day', at('2026-05-20 08:49')), false, '08:49 is before day pre-shift buffer');
assert.strictEqual(time.getDashboardShift(at('2026-05-20 08:55')), 'day', 'day pre-shift takes over dashboard before 09:00');
assert.strictEqual(time.getDashboardShift(at('2026-05-21 20:55')), 'night', 'night pre-shift takes over dashboard before 21:00');
assert.strictEqual(time.getDashboardShift(at('2026-05-19 18:55')), 'night', 'Tuesday night pre-shift takes over dashboard before 19:00');

const early = time.getRecognizedClockInMoment('day', at('2026-05-20 08:50'));
assert.strictEqual(early.ok, true, 'pre-shift clock-in is accepted');
assert.strictEqual(early.recognizedAt.format('YYYY-MM-DD HH:mm'), '2026-05-20 09:00', 'pre-shift clock-in is recognized at shift start');

const tooEarly = time.getRecognizedClockInMoment('day', at('2026-05-20 08:40'));
assert.strictEqual(tooEarly.ok, false, 'too early clock-in is rejected');

assert.strictEqual(time.getDayOffLogicalDateForShift('night', at('2026-05-20 03:30')), '2026-05-19', 'night day-off logical date carries back before 09:00');

console.log('time-logic tests passed');
