const assert = require('assert');
const moment = require('moment-timezone');
const createStatePolicy = require('../state-policy');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    GRACE_PERIOD_MINS: 10,
    LIVE_OFF_CLOCK_OUT_MINS: 10,
    PURGE_MANUAL_OT: 40
};

const policy = createStatePolicy({ CONFIG, moment });

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
}

function finishedUser(overrides = {}) {
    return {
        id: 'user-finished',
        shift: 'day',
        checkedIn: false,
        dayOff: false,
        disconnected: false,
        isFinished: true,
        attendanceStatus: 'FINISHED',
        voiceStatus: 'OFFLINE',
        checkOutRaw: at('2026-05-19 14:00').toISOString(),
        lastFinishedReturnPromptKey: null,
        attendanceEvents: [],
        sessions: [],
        ...overrides
    };
}

function workingUser(overrides = {}) {
    return {
        id: 'user-working',
        shift: 'day',
        checkedIn: true,
        dayOff: false,
        disconnected: false,
        isFinished: false,
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_ON',
        checkInRaw: at('2026-05-19 09:00').toISOString(),
        attendanceEvents: [],
        sessions: [],
        ...overrides
    };
}

{
    const result = policy.applyFinishedVoiceSnapshot(finishedUser(), {
        wasConnected: false,
        isConnected: true,
        wasStreaming: false,
        isStreaming: true
    }, at('2026-05-19 14:05'));

    assert.strictEqual(result.user.checkedIn, false, 'finished live-on does not auto clock in');
    assert.strictEqual(result.user.isFinished, true, 'finished live-on keeps finished');
    assert.strictEqual(result.user.attendanceStatus, 'FINISHED', 'finished live-on keeps FINISHED status');
    assert.deepStrictEqual(result.prompts, ['finished-return-to-voice', 'after-finish-live-on'], 'finished live-on sends guidance prompts');
}

{
    const first = policy.applyFinishedVoiceSnapshot(finishedUser(), {
        wasConnected: false,
        isConnected: true,
        wasStreaming: false,
        isStreaming: false
    }, at('2026-05-19 14:05'));

    const second = policy.applyFinishedVoiceSnapshot(first.user, {
        wasConnected: false,
        isConnected: true,
        wasStreaming: false,
        isStreaming: false
    }, at('2026-05-19 14:06'));

    assert.strictEqual(first.user.isFinished, true, 'voice return keeps FINISHED');
    assert.deepStrictEqual(first.prompts, ['finished-return-to-voice'], 'first voice return sends one prompt');
    assert.deepStrictEqual(second.prompts, [], 'second voice return does not duplicate prompt');
}

{
    const user = policy.applyDcTimeout(workingUser({
        disconnected: true,
        disconnectedAt: at('2026-05-19 14:00').toISOString(),
        voiceStatus: 'DISCONNECTED'
    }), at('2026-05-19 14:10'));

    assert.strictEqual(user.checkedIn, false, 'dc timeout clears checkedIn');
    assert.strictEqual(user.isFinished, true, 'dc timeout finishes user');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'dc timeout records FINISHED');
    assert.strictEqual(user.lastClockOutSource, 'dc-timeout', 'dc timeout source is recorded');
}

{
    const user = policy.applyLiveOffTimeout(workingUser({
        liveOffStartedAt: at('2026-05-19 14:00').toISOString(),
        voiceStatus: 'LIVE_OFF'
    }), at('2026-05-19 14:10'));

    assert.strictEqual(user.checkedIn, false, 'live-off timeout clears checkedIn');
    assert.strictEqual(user.isFinished, true, 'live-off timeout finishes user');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'live-off timeout records FINISHED');
    assert.strictEqual(user.lastClockOutSource, 'live-off-timeout', 'live-off timeout source is recorded');
}

{
    const otUser = finishedUser({
        id: 'user-ot',
        shift: 'night',
        sessions: [{
            id: 'night:2026-05-18',
            shift: 'night',
            scheduledEndAt: at('2026-05-19 09:00').toISOString(),
            otStartedAt: at('2026-05-19 09:00').toISOString(),
            otType: 'AUTO',
            clockOutAt: at('2026-05-19 11:30').toISOString()
        }]
    });
    const result = policy.restoreOvertime(otUser, at('2026-05-19 14:00'));

    assert.strictEqual(result.restored, true, 'restorable OT session is restored');
    assert.strictEqual(result.user.checkedIn, true, 'restored OT checks user in');
    assert.strictEqual(result.user.isFinished, false, 'restored OT clears finished');
    assert.strictEqual(result.user.attendanceStatus, 'OVERTIME', 'restored OT records OVERTIME');
    assert.strictEqual(result.user.voiceStatus, 'LIVE_ON', 'restored OT records LIVE_ON');
}

console.log('state-policy tests passed');
