'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const { padWidth, truncateWidth, formatDuration } = require('../src/utils/textFormat');
const { createDashboardRenderHelpers } = require('../src/utils/dashboardRenderHelpers');

const helpers = createDashboardRenderHelpers({
    moment,
    timezone: 'Asia/Manila',
    padWidth,
    truncateWidth,
    formatDuration,
    getShiftBounds: (shift, now) => ({
        start: now.clone().subtract(90, 'minutes'),
        end: now.clone().add(8, 'hours'),
        shift
    }),
    getLiveException: id => ({
        robin: { expiresAt: moment.tz('2026-05-29T23:31:15', 'Asia/Manila').toISOString() }
    })[id],
    getAttendanceUser: id => ({
        z: { name: 'Zurin - Great manager', otStartedAt: moment.tz('2026-05-29T21:01:15', 'Asia/Manila').toISOString() }
    })[id],
    getLiveOffSummary: user => ({
        liveoff: { trackedMinutes: 17, clockOutInMinutes: 13 }
    })[user?.id] || null
});

assert.strictEqual(helpers.getDashboardName({ dashboardName: 'Robin - Night', name: 'Ignored' }), 'Robin');
assert.strictEqual(helpers.getDashboardName({ name: '  Daba - P Night time' }), 'Daba');
assert.strictEqual(helpers.getDashboardName({}), 'Unknown');

assert.strictEqual(helpers.renderCleanGrid([], 'OK'), 'NONE');
assert.strictEqual(
    helpers.renderCleanGrid([
        { name: 'Zurin - Great manager', checkInTime: '09:03 PM' },
        { dashboardName: 'AB', checkInTime: '09:02' },
        { name: 'LongWorkerNameHere - Shift', checkInTime: null }
    ], 'OK'),
    "```\nOK 09:02 AB           OK 00:00 LongWorker \nOK 09:03 Zurin      \n```"
);

assert.strictEqual(
    helpers.renderSummaryBox([['TOTAL', 13], ['ACTIVE', 8]]),
    "```text\nTOTAL      13\nACTIVE      8\n             \n             \n             \n```"
);

assert.strictEqual(
    helpers.renderShiftSummary('DAY', {
        absent: [1],
        disconnected: [1, 2],
        standby: [],
        active: [1, 2, 3],
        leave: [1]
    }),
    'DAY | ABSENT 1 | DC 2 | WAITING 0 | ACTIVE 3 | OFF 1'
);

const now = moment.tz('2026-05-29T23:01:15', 'Asia/Manila');
assert.strictEqual(helpers.renderStatusList([], 'X', now), 'NONE');
assert.strictEqual(
    helpers.renderStatusList([
        { name: 'Tonstar - Night', disconnectedAt: moment.tz('2026-05-29T22:52:15', 'Asia/Manila').toISOString() }
    ], 'DC', now, 'dc'),
    "```\nDC Tonstar           DC 0시간 9분\n```"
);
assert.strictEqual(
    helpers.renderStatusList([
        { name: 'Waiting Off', shift: 'night', voiceJoinedAt: moment.tz('2026-05-29T22:50:15', 'Asia/Manila').toISOString() },
        { name: 'Waiting Live', shift: 'night', preShiftLiveAt: moment.tz('2026-05-29T22:55:15', 'Asia/Manila').toISOString() }
    ], 'S', now, 'standby'),
    "```\nS Waiting Live      LIVE     10:55 PM | ABS 30m\nS Waiting Off       WAIT NO LIVE 10:50 PM | ABS 30m\n```"
);
assert.strictEqual(
    helpers.renderStatusList([
        {
            name: 'Offline Waiting',
            voiceJoinedAt: moment.tz('2026-05-29T08:46:15', 'Asia/Manila').toISOString(),
            shift: 'night',
            dashboardVoiceConnected: false
        }
    ], 'S', now, 'standby'),
    "```\nS Offline Waiting   NO VOICE CH --:-- | ABS 30m\n```"
);
assert.strictEqual(
    helpers.renderStatusList([{ id: 'robin', name: 'ROBIN - Night' }], 'EX', now, 'exception'),
    "```\nEX ROBIN             0시간 30분 남음\n```"
);
assert.strictEqual(
    helpers.renderStatusList([{
        id: 'liveoff',
        name: 'Live Off Worker',
        liveOffStartedAt: moment.tz('2026-05-29T22:49:15', 'Asia/Manila').toISOString(),
        liveOffWarningMarks: [10]
    }], 'LO', now, 'liveoff'),
    "```\nLO Live Off Worker   NOW 12m | TOT 17m | W10 | OUT 13m\n```"
);
assert.strictEqual(helpers.renderAttentionSummary({}, now), 'NONE');
assert.strictEqual(
    helpers.renderAttentionSummary({
        liveOff: [{
            id: 'liveoff',
            name: 'Live Off Worker',
            liveOffWarningMarks: [10]
        }],
        disconnected: [{
            name: 'Disconnected Worker',
            disconnectedAt: moment.tz('2026-05-29T22:41:15', 'Asia/Manila').toISOString()
        }],
        absent: [{
            name: 'Absent Worker',
            shift: 'night'
        }],
        earlyFinished: [{
            name: 'Early Worker',
            dashboardEarlyOutMins: 83
        }],
        excessiveLate: [{
            name: 'Over Late Worker',
            shift: 'night'
        }],
        standby: [{
            name: 'Standby Worker',
            shift: 'night',
            voiceJoinedAt: moment.tz('2026-05-29T22:50:15', 'Asia/Manila').toISOString()
        }]
    }, now),
    "```\n📴LIVEOFF  Live Off Work  OFF 17m -> LIVE ON\n⚡DC       Disconnected   DC 20m -> REJOIN\n❌ABSENT   Absent Worker  NO SHOW 1h30 -> ABSENT\n⚠️EARLYOUT Early Worker   EARLY 1h23 -> Mgr chk\n⚠️2H LATE Over Late Wor  LATE 1h30 -> Mgr chk\n⏳WAIT     Standby Worke  WAIT NO LIVE | ABS 30m\n```"
);
assert.strictEqual(
    helpers.renderOvertimeList(now, [{ id: 'z', type: 'AUTO' }]),
    "```\nA-OT  Zurin             2시간 0분\n```"
);
assert.strictEqual(helpers.renderOvertimeList(now, []), 'NONE');

const overtimeFallbackNow = moment.tz('2026-05-29T20:45:00', 'Asia/Manila');
const overtimeFallbackHelpers = createDashboardRenderHelpers({
    moment,
    timezone: 'Asia/Manila',
    padWidth,
    truncateWidth,
    formatDuration,
    getShiftBounds: () => ({
        start: overtimeFallbackNow.clone().subtract(11, 'hours'),
        end: overtimeFallbackNow.clone().subtract(45, 'minutes')
    }),
    getAttendanceUser: id => ({
        g: {
            name: 'Giru Kun - P Day Time',
            shift: 'day',
            checkInRaw: overtimeFallbackNow.clone().subtract(11, 'hours').toISOString()
        }
    })[id]
});
assert.strictEqual(
    overtimeFallbackHelpers.renderOvertimeList(overtimeFallbackNow, [{ id: 'g', type: 'AUTO' }]),
    "```\nA-OT  Giru Kun          0시간 45분\n```",
    'AUTO OT without startedAt uses scheduled shift end instead of check-in time'
);
assert.strictEqual(
    overtimeFallbackHelpers.renderAttentionSummary({ overtime: [{ id: 'g', type: 'AUTO' }] }, overtimeFallbackNow),
    "```\n🔥OT       Giru Kun       OT 45m -> WORKING\n```",
    'admin attention shows active overtime elapsed time'
);

assert.match(helpers.renderDashboardHeader(now), /PH TIME: \*\*11:01:15 PM\*\*/);
assert.match(helpers.renderDashboardHeader(now), /\[\s*FRI, MAY 29, 2026\s*\]/);
assert.match(helpers.renderDashboardHeader(now), /\u2800{20,}/);
assert.match(helpers.renderDashboardHeader(now, true), /MAINTENANCE - WORK CLOSED/);
assert.match(
    helpers.renderDashboardHeader(now, false, 'pid:12345 | attention-no-issues-v6'),
    /🤖 pid:12345 \| attention-no-issues-v6/
);

assert.strictEqual(helpers.formatKoreanDateTime('2026-05-29T15:01:00Z'), '2026년 05월 29일 23:01');
assert.strictEqual(helpers.renderPercentBar(55), '[######....]  55%');
assert.strictEqual(helpers.renderPercentBar(120, 5), '[#####] 100%');
assert.strictEqual(helpers.renderPercentBar(-10, 5), '[.....]   0%');

console.log('dashboard-render-helpers tests passed');
