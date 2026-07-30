'use strict';

const assert = require('assert');
const messages = require('../src/utils/attendanceDmMessages');

const workerMessages = [
    messages.buildLiveOffClockOutDm(30),
    messages.buildDcTimeoutClockOutDm(10, 60),
    messages.buildManualResumeRequiredDm(1),
    messages.buildLiveOffWarningDm(1, 10, 20),
    messages.buildDayOffClockInPromptMessage(1, 10),
    messages.buildDayOffPresenceDm(),
    messages.buildAfterFinishPresenceDm(),
    messages.buildFinishedReturnWithinShiftDm(),
    messages.buildFinishedReturnDefaultDm(),
    messages.buildStandbyClockInRequiredDm(),
    messages.buildAbsentWarningDm(1, 30, 120),
    messages.buildAbsentWarningDm(4, 120, 120),
    messages.buildLiveOffGuidanceDm(),
    messages.buildLiveOffGuidanceDm({ final: true, minutes: 30 }),
    messages.buildFinishedLiveOffReminderDm(1, 4, messages.buildLiveOffGuidanceDm()),
    messages.buildDayOffApprovedDm({
        name: 'Worker',
        shiftLabel: 'Night Time',
        leaveDate: '2026-06-15'
    }),
    messages.buildDayOffRejectedDm({
        name: 'Worker',
        shiftLabel: 'Night Time',
        leaveDate: '2026-06-15'
    })
];

for (const message of workerMessages) {
    assert.strictEqual(/[^\x00-\x7F]/.test(message), false, `worker DM contains non-ASCII text:\n${message}`);
}

assert.match(messages.buildLiveOffWarningDm(1, 10, 20), /Your live stream is OFF/);
assert.match(messages.buildLiveOffWarningDm(1, 10, 20), /LIVE ON while working/);
assert.match(messages.buildLiveOffClockOutDm(30), /LIVE STREAM ON is mandatory/);
assert.match(messages.buildLiveOffClockOutDm(30), /NOT counted as work/);
assert.match(messages.buildAbsentWarningDm(4, 120, 120), /marked ABSENT/);
assert.match(messages.buildAbsentWarningDm(4, 120, 120), /may result in termination/);
assert.match(messages.buildDayOffApprovedDm({
    name: 'Worker',
    shiftLabel: 'Night Time',
    leaveDate: '2026-06-15'
}), /approved/i);

console.log('attendance-dm-messages tests passed');
