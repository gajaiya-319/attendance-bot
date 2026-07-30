const assert = require('assert');
const moment = require('moment-timezone');
const {
    getLogicalWorkDate,
    projectAttendanceFromEventLog
} = require('../src/services/attendanceProjectionService');

const timezone = 'Asia/Manila';

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', timezone).toISOString();
}

function getShiftBounds(shift, value) {
    const ref = moment(value).tz(timezone);
    if (shift === 'night') {
        const start = ref.hour() < 12
            ? ref.clone().subtract(1, 'day').hour(21).minute(0).second(0).millisecond(0)
            : ref.clone().hour(21).minute(0).second(0).millisecond(0);
        return { start, end: start.clone().add(12, 'hours') };
    }
    const start = ref.clone().hour(9).minute(0).second(0).millisecond(0);
    return { start, end: start.clone().add(12, 'hours') };
}

{
    const event = {
        at: at('2026-06-30 06:30'),
        type: 'clock_out_confirmed',
        userId: 'u1',
        shift: 'night'
    };
    assert.strictEqual(
        getLogicalWorkDate(event, { moment, timezone }),
        '2026-06-29',
        'night shift morning events belong to previous work date'
    );
}

{
    const previousDayOvertime = {
        at: at('2026-07-30 02:19'),
        type: 'clock_out_confirmed',
        userId: 'u-day-cross-midnight',
        shift: 'day'
    };
    const nextDayClockIn = {
        at: at('2026-07-30 09:22'),
        type: 'clock_in_confirmed',
        userId: 'u-day-cross-midnight',
        shift: 'day'
    };
    assert.strictEqual(
        getLogicalWorkDate(previousDayOvertime, { moment, timezone }),
        '2026-07-29',
        'day-shift overtime after midnight belongs to the previous work date'
    );
    assert.strictEqual(
        getLogicalWorkDate(nextDayClockIn, { moment, timezone }),
        '2026-07-30',
        'the next day clock-in starts a new work date at 09:00 or later'
    );
}

{
    const events = [
        {
            at: at('2026-06-30 21:00'),
            type: 'recorded_status_changed',
            source: 'final-absent',
            userId: 'u1',
            userName: 'Daba',
            shift: 'night',
            meta: { attendanceStatus: { to: 'ABSENT' } }
        },
        {
            at: at('2026-06-30 23:30'),
            type: 'clock_in_confirmed',
            source: 'button',
            userId: 'u1',
            userName: 'Daba',
            shift: 'night'
        },
        {
            at: at('2026-07-01 07:00'),
            type: 'clock_out_confirmed',
            source: 'button',
            userId: 'u1',
            userName: 'Daba',
            shift: 'night'
        }
    ];

    const [record] = projectAttendanceFromEventLog(events, {
        moment,
        timezone,
        getShiftBounds,
        clockOutGraceMins: 5
    });

    assert.strictEqual(record.workDate, '2026-06-30');
    assert.strictEqual(record.finalStatus, 'FINISHED');
    assert.strictEqual(record.lateMinutes, 150);
    assert(record.flags.includes('EXCESSIVE_LATE'), '2h+ late is projected');
    assert(record.flags.includes('ABSENT_CONVERTED_TO_LATE'), 'absent-then-clock-in is visible');
    assert(record.flags.includes('EARLY_OUT'), 'early out is projected');
}

{
    const events = [
        {
            at: at('2026-06-30 09:00'),
            type: 'clock_in_confirmed',
            source: 'button',
            userId: 'u2',
            userName: 'Erzie',
            shift: 'day'
        },
        {
            at: at('2026-06-30 21:20'),
            type: 'overtime_started',
            source: 'auto',
            userId: 'u2',
            userName: 'Erzie',
            shift: 'day'
        },
        {
            at: at('2026-06-30 21:40'),
            type: 'clock_out_confirmed',
            source: 'button',
            userId: 'u2',
            userName: 'Erzie',
            shift: 'day'
        }
    ];

    const [record] = projectAttendanceFromEventLog(events, {
        moment,
        timezone,
        getShiftBounds
    });

    assert.strictEqual(record.finalStatus, 'FINISHED');
    assert(record.flags.includes('ON_TIME'), 'on-time flag is projected');
    assert(record.flags.includes('OVERTIME'), 'overtime flag is projected');
    assert.strictEqual(record.overtimeMinutes, 40, 'post-shift worked minutes are projected');
}

{
    const [record] = projectAttendanceFromEventLog([
        {
            at: at('2026-07-30 09:03'),
            type: 'recorded_status_changed',
            source: 'voice_state',
            userId: 'u-stale-finished',
            userName: 'Worker',
            shift: 'day',
            meta: { attendanceStatus: { to: 'FINISHED' } }
        },
        {
            at: at('2026-07-30 09:22'),
            type: 'clock_in_confirmed',
            source: 'live_on',
            userId: 'u-stale-finished',
            userName: 'Worker',
            shift: 'day'
        }
    ], {
        moment,
        timezone,
        getShiftBounds
    });

    assert.strictEqual(record.clockOutAt, null, 'stale finished state before first clock-in is discarded');
    assert.strictEqual(record.finalStatus, 'WORKING');
    assert.strictEqual(record.lateMinutes, 22);
}

console.log('attendance-projection-service tests passed');
