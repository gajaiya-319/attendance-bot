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
    })[id]
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
    "```text\nTOTAL      13\nACTIVE      8\n             \n             \n```"
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
        { name: 'Waiting Off', voiceJoinedAt: moment.tz('2026-05-29T22:50:15', 'Asia/Manila').toISOString() },
        { name: 'Waiting Live', preShiftLiveAt: moment.tz('2026-05-29T22:55:15', 'Asia/Manila').toISOString() }
    ], 'S', now, 'standby'),
    "```\nS Waiting Live      LIVE 10:55 PM [pre-shift live]\nS Waiting Off       OFF  10:50 PM [not checked in]\n```"
);
assert.strictEqual(
    helpers.renderStatusList([{ id: 'robin', name: 'ROBIN - Night' }], 'EX', now, 'exception'),
    "```\nEX ROBIN             0시간 30분 남음\n```"
);
assert.strictEqual(
    helpers.renderOvertimeList(now, [{ id: 'z', type: 'AUTO' }]),
    "```\nA-OT  Zurin             2시간 0분\n```"
);
assert.strictEqual(helpers.renderOvertimeList(now, []), 'NONE');

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
