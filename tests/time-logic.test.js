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

const maintenanceOverrides = {
    '2026-06-02': { enabled: false, reason: 'holiday' },
    '2026-06-03': { enabled: true, reason: 'delayed maintenance' }
};
const overrideTime = createTimeLogic({ CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS, MAINTENANCE_OVERRIDES: maintenanceOverrides, moment });

function assertOverrideBounds(label, shift, ref, expectedStart, expectedEnd) {
    const bounds = overrideTime.getShiftBounds(shift, at(ref));
    assert.strictEqual(bounds.start.format('YYYY-MM-DD HH:mm'), expectedStart, `${label} start`);
    assert.strictEqual(bounds.end.format('YYYY-MM-DD HH:mm'), expectedEnd, `${label} end`);
}

assertOverrideBounds('Cancelled Tuesday maintenance day shift', 'day', '2026-06-02 19:30', '2026-06-02 09:00', '2026-06-02 21:00');
assertOverrideBounds('Cancelled Tuesday maintenance night shift', 'night', '2026-06-02 20:30', '2026-06-02 21:00', '2026-06-03 09:00');
assert.strictEqual(overrideTime.getOperationalShift(at('2026-06-02 19:30')), 'day', 'cancelled Tuesday update keeps day shift active until 21:00');
assert.strictEqual(overrideTime.isMaintenanceWindow(at('2026-06-03 06:00')), false, 'cancelled Tuesday update suppresses default Wednesday maintenance');

assertOverrideBounds('Delayed Wednesday maintenance day shift', 'day', '2026-06-03 12:00', '2026-06-03 09:00', '2026-06-03 19:00');
assertOverrideBounds('Delayed Wednesday maintenance night shift', 'night', '2026-06-03 20:00', '2026-06-03 19:00', '2026-06-04 04:00');
assert.strictEqual(overrideTime.isMaintenanceWindow(at('2026-06-04 06:00')), true, 'delayed Wednesday update opens maintenance on the next morning');
assertOverrideBounds('Next Tuesday returns to normal maintenance day shift', 'day', '2026-06-09 12:00', '2026-06-09 09:00', '2026-06-09 19:00');
assertOverrideBounds('Next Tuesday returns to normal maintenance night shift', 'night', '2026-06-09 20:00', '2026-06-09 19:00', '2026-06-10 04:00');
assert.strictEqual(overrideTime.isMaintenanceWindow(at('2026-06-10 06:00')), true, 'next Tuesday default maintenance window still applies');

const overnightWindowTime = createTimeLogic({
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS,
    MAINTENANCE_OVERRIDES: {
        '2026-06-03': {
            enabled: true,
            windowDate: '2026-06-04',
            windowStart: '23:00',
            windowEnd: '01:00'
        }
    },
    moment
});
assert.strictEqual(overnightWindowTime.isMaintenanceWindow(at('2026-06-04 23:30')), true, 'override maintenance window can cross midnight');
assert.strictEqual(overnightWindowTime.isMaintenanceWindow(at('2026-06-05 00:30')), true, 'override maintenance remains active after midnight');
assert.strictEqual(overnightWindowTime.isMaintenanceWindow(at('2026-06-05 01:00')), false, 'override maintenance exits at next-day end');

console.log('time-logic tests passed');
