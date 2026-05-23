const assert = require('assert');
const moment = require('moment-timezone');
const { createAttendanceService } = require('../src/services/attendanceService');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    POINTS: { NORMAL_IN: 10, LATE: -5, EARLY_OUT: -10, OT: 15, ABSENT: -20 },
    PURGE_MANUAL_OT: 40,
    LIVE_OFF_CLOCK_OUT_MINS: 30
};

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
}

function createMember(overrides = {}) {
    return {
        id: 'user1',
        displayName: 'Tester',
        user: { username: 'tester-user' },
        voice: null,
        ...overrides
    };
}

const state = {
    attendanceData: {},
    overtimeUsers: []
};

const service = createAttendanceService({
    CONFIG,
    moment,
    getAttendanceData: () => state.attendanceData,
    getOvertimeUsers: () => state.overtimeUsers,
    determineShift: () => 'night',
    getShiftSessionKey: (shift, now) => `${shift}:${moment(now).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm')}`,
    getShiftBounds: (shift, now) => {
        const start = moment(now).tz(CONFIG.TIMEZONE).hour(21).minute(0).second(0).millisecond(0);
        const end = start.clone().add(12, 'hours');
        return { start, end };
    }
});

{
    const user = service.ensureUserData(createMember(), 'night');

    assert.strictEqual(user.id, 'user1', 'user id is assigned');
    assert.strictEqual(user.name, 'Tester', 'display name is assigned');
    assert.strictEqual(user.shift, 'night', 'shift is assigned');
    assert.strictEqual(user.attendanceStatus, 'PRE_SHIFT', 'new user starts PRE_SHIFT');
    assert.strictEqual(Array.isArray(user.sessions), true, 'sessions array is initialized');
    assert.strictEqual(state.attendanceData.user1, user, 'user is stored by reference');
}

{
    const user = state.attendanceData.user1;
    user.sessions.push({ id: 'session1', clockInAt: at('2026-05-21 21:00').toISOString(), clockOutAt: null });

    const added = service.addOvertimeUser(user, 'MANUAL', at('2026-05-22 09:00'));
    const addedAgain = service.addOvertimeUser(user, 'AUTO', at('2026-05-22 09:05'));

    assert.strictEqual(added, true, 'first OT insert succeeds');
    assert.strictEqual(addedAgain, false, 'duplicate OT insert is ignored');
    assert.strictEqual(state.overtimeUsers.length, 1, 'one OT entry exists');
    assert.strictEqual(state.overtimeUsers[0].type, 'MANUAL', 'original OT type is preserved');
    assert.strictEqual(user.sessions[0].otType, 'MANUAL', 'open session receives OT type');
}

{
    const user = state.attendanceData.user1;
    const changed = service.transitionRecordedStatus(user, {
        attendanceStatus: 'OVERTIME',
        voiceStatus: 'LIVE_ON'
    }, at('2026-05-22 09:00'), 'test', 'unit-test');

    assert.strictEqual(changed, true, 'status transition reports changed');
    assert.strictEqual(user.attendanceStatus, 'OVERTIME', 'attendance status changes');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'voice status changes');
    assert.strictEqual(user.attendanceEvents.at(-1).type, 'recorded_status_changed', 'transition event is recorded');
    assert.strictEqual(user.attendanceEvents.at(-1).meta.transitionId, 1, 'status transition receives a sequence id');
}

{
    const user = state.attendanceData.user1;
    user.dayOff = true;
    user.attendanceStatus = 'DAY_OFF';
    user.voiceStatus = 'OFFLINE';
    const changed = service.transitionRecordedStatus(user, {
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_ON'
    }, at('2026-05-22 09:10'), 'unit-test', 'bad-dayoff-transition');

    assert.strictEqual(changed, true, 'unusual transition is still recorded');
    assert.ok(user.statusTransitionWarnings.length > 0, 'unusual transition is stored in warning history');
    assert.ok(user.attendanceEvents.at(-1).meta.policyWarnings.some(w => w.startsWith('dayoff-user-attendance-change')), 'event includes policy warning');

    user.dayOff = false;
}

{
    const user = state.attendanceData.user1;
    const before = user.attendanceEvents.length;
    const first = service.appendAttendanceEvent(user, 'duplicate_check', at('2026-05-22 09:01'), 'test');
    const second = service.appendAttendanceEvent(user, 'duplicate_check', at('2026-05-22 09:01'), 'test');

    assert.strictEqual(first, true, 'first event is appended');
    assert.strictEqual(second, false, 'duplicate event inside 30 seconds is skipped');
    assert.strictEqual(user.attendanceEvents.length, before + 1, 'only one duplicate-check event is stored');
}

{
    const user = service.ensureUserData(createMember({ id: 'clockin-user', displayName: 'Clock In User' }), 'night');
    const result = service.applyClockInCore(user, createMember({ id: 'clockin-user' }), 'night', at('2026-05-21 21:00'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:00'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, false);

    assert.strictEqual(result.ok, true, 'clock-in core succeeds');
    assert.strictEqual(user.checkedIn, true, 'clock-in core sets checkedIn');
    assert.strictEqual(user.attendanceStatus, 'WORKING', 'clock-in core records WORKING');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'clock-in core records LIVE_ON');
    assert.strictEqual(user.points, CONFIG.POINTS.NORMAL_IN, 'on-time clock-in awards normal points');
    assert.strictEqual(user.totalNormal, 1, 'on-time clock-in increments totalNormal');
    assert.strictEqual(Boolean(service.getOpenSession(user)), true, 'clock-in core opens a session');
}

{
    const user = service.ensureUserData(createMember({ id: 'too-early-user', displayName: 'Too Early User' }), 'night');
    const result = service.applyClockInCore(user, createMember({ id: 'too-early-user' }), 'night', at('2026-05-21 20:30'), {
        ok: false,
        recognizedAt: null,
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: true
    }, false);

    assert.strictEqual(result.ok, false, 'too-early clock-in core fails');
    assert.strictEqual(result.shouldLogPreShiftWait, true, 'too-early first attempt requests wait log');
    assert.strictEqual(user.checkedIn, false, 'too-early core does not check user in');
    assert.strictEqual(user.preShiftLiveAt, at('2026-05-21 20:30').toISOString(), 'too-early core records preShiftLiveAt');
}

{
    const user = service.ensureUserData(createMember({ id: 'session-user', displayName: 'Session User' }), 'night');
    const session = service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');

    service.startSessionPeriod(session.liveOffPeriods, at('2026-05-21 22:00'), 'live-off');
    service.closeOpenSessionPeriod(session.liveOffPeriods, at('2026-05-21 22:15'));

    const finished = service.finishAttendanceSession(user, at('2026-05-21 23:00'), 'unit-test-out', 'done', at('2026-05-21 23:01'));

    assert.strictEqual(finished.workedMinutes, 120, 'finished session records gross worked minutes');
    assert.strictEqual(finished.liveOffMinutes, 15, 'finished session records live-off minutes');
    assert.strictEqual(finished.creditedMinutes, 105, 'finished session subtracts non-working periods');
    assert.strictEqual(user.activeSessionId, null, 'finished session clears active session');

    const summary = service.getUserLatestSessionSummary(user, at('2026-05-21 23:30'));
    assert.strictEqual(summary.creditedMinutes, 105, 'latest session summary uses closed session totals');
}

{
    const member = createMember({ id: 'clockout-user', displayName: 'Clock Out User', voice: { channelId: 'voice1', streaming: false } });
    const user = service.ensureUserData(member, 'night');
    service.applyClockInCore(user, member, 'night', at('2026-05-21 21:00'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:00'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, false);
    state.overtimeUsers.push({ id: user.id, type: 'MANUAL' });

    const result = service.applyClockOutCore(member, user, at('2026-05-21 23:00'), 'done', null, { clockOutSource: 'unit-out' });

    assert.strictEqual(result.ok, true, 'clock-out core succeeds');
    assert.strictEqual(user.checkedIn, false, 'clock-out clears checkedIn');
    assert.strictEqual(user.isFinished, true, 'clock-out sets finished');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'clock-out records FINISHED');
    assert.strictEqual(user.voiceStatus, 'LIVE_OFF', 'clock-out records current voice status');
    assert.strictEqual(user.finishedPresence, 'in_voice', 'clock-out records finished voice presence');
    assert.strictEqual(service.getOpenSession(user), null, 'clock-out closes open session');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id), false, 'clock-out removes OT entry');
    assert.strictEqual(user.attendanceEvents.at(-1).type, 'clock_out_confirmed', 'clock-out event is recorded');
}

{
    const member = createMember({ id: 'timeout-user', displayName: 'Timeout User', voice: null });
    const user = service.ensureUserData(member, 'night');
    user.checkedIn = true;
    user.disconnected = false;
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');

    const result = service.applyClockOutCore(member, user, at('2026-05-21 22:00'), 'timeout', null, { clockOutSource: 'live-off-timeout' });

    assert.strictEqual(result.reversibleEarlyPenaltyKey, `live-off-timeout:${at('2026-05-21 22:00').toISOString()}`, 'timeout clock-out creates reversible key');
    assert.strictEqual(result.recordLogOptions.effectiveTime.toISOString(), at('2026-05-21 22:00').toISOString(), 'record log effective time is returned');
}

{
    const member = createMember({ id: 'preot-user', displayName: 'Pre OT User' });
    const user = service.ensureUserData(member, 'night');
    user.isFinished = true;
    user.finishedPresence = 'in_voice';
    user.finalLeftAt = at('2026-05-21 18:00').toISOString();
    user.pendingManualOT = true;

    const result = service.applyPreShiftOvertimeCore(member, user, 'night', at('2026-05-21 20:30'), 'unit-test');

    assert.strictEqual(result.ok, true, 'pre-shift OT core succeeds before shift start');
    assert.strictEqual(user.checkedIn, true, 'pre-shift OT checks user in');
    assert.strictEqual(user.isFinished, false, 'pre-shift OT clears finished');
    assert.strictEqual(user.finishedPresence, null, 'pre-shift OT clears finished presence');
    assert.strictEqual(user.finalLeftAt, null, 'pre-shift OT clears finalLeftAt');
    assert.strictEqual(user.pendingManualOT, false, 'pre-shift OT clears pending manual OT');
    assert.strictEqual(user.attendanceStatus, 'OVERTIME', 'pre-shift OT records OVERTIME');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'pre-shift OT records LIVE_ON');
    assert.strictEqual(user.totalOT, 1, 'pre-shift OT increments totalOT');
    assert.strictEqual(user.points, CONFIG.POINTS.OT, 'pre-shift OT awards OT points');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id && ot.type === 'PRE_OT'), true, 'pre-shift OT adds PRE_OT entry');
    assert.strictEqual(Boolean(service.getOpenSession(user)), true, 'pre-shift OT opens session');
}

{
    const member = createMember({ id: 'not-preot-user', displayName: 'Not Pre OT User' });
    const user = service.ensureUserData(member, 'night');
    const result = service.applyPreShiftOvertimeCore(member, user, 'night', at('2026-05-21 21:30'), 'unit-test');

    assert.strictEqual(result.ok, false, 'pre-shift OT is rejected after shift start');
    assert.strictEqual(user.checkedIn, false, 'rejected pre-shift OT does not check user in');
}

{
    const user = service.ensureUserData(createMember({ id: 'pending-too-soon', displayName: 'Pending Too Soon' }), 'night');
    user.pendingManualOT = true;
    user.checkInRaw = at('2026-05-21 21:00').toISOString();
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');

    const result = service.applyPendingManualOvertimeCore(user, at('2026-05-22 08:30'));

    assert.strictEqual(result.ok, false, 'pending manual OT is rejected before scheduled end');
    assert.strictEqual(result.reason, 'not-overtime-window', 'pending manual OT reports window reason');
    assert.strictEqual(user.pendingManualOT, true, 'pending manual OT remains pending before scheduled end');
}

{
    const user = service.ensureUserData(createMember({ id: 'pending-manual-user', displayName: 'Pending Manual User' }), 'night');
    user.pendingManualOT = true;
    user.checkInRaw = at('2026-05-21 21:00').toISOString();
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');

    const result = service.applyPendingManualOvertimeCore(user, at('2026-05-22 09:00'));

    assert.strictEqual(result.ok, true, 'pending manual OT activates at scheduled end');
    assert.strictEqual(user.pendingManualOT, false, 'pending manual OT flag clears after activation');
    assert.strictEqual(user.checkedIn, true, 'manual OT keeps user checked in');
    assert.strictEqual(user.isFinished, false, 'manual OT clears finished');
    assert.strictEqual(user.attendanceStatus, 'OVERTIME', 'manual OT records OVERTIME');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'manual OT records LIVE_ON');
    assert.strictEqual(user.totalOT, 1, 'manual OT increments totalOT');
    assert.strictEqual(user.points, CONFIG.POINTS.OT, 'manual OT awards OT points');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id && ot.type === 'MANUAL'), true, 'manual OT adds overtime entry');
    assert.strictEqual(result.session.otType, 'MANUAL', 'manual OT marks active session');
}

{
    const user = service.ensureUserData(createMember({ id: 'restore-ot-user', displayName: 'Restore OT User' }), 'night');
    user.checkedIn = false;
    user.isFinished = true;
    user.attendanceStatus = 'FINISHED';
    user.checkOutRaw = at('2026-05-22 10:00').toISOString();
    user.sessions = [{
        id: 'old-ot-session',
        shift: 'night',
        clockInAt: at('2026-05-21 21:00').toISOString(),
        clockOutAt: at('2026-05-22 10:00').toISOString(),
        scheduledEndAt: at('2026-05-22 09:00').toISOString(),
        otStartedAt: at('2026-05-22 09:00').toISOString(),
        otType: 'AUTO'
    }];
    user.activeSessionId = null;

    const result = service.applyRestoreOvertimeAfterFinishCore(user, 'night', at('2026-05-22 10:30'), 'unit-test');

    assert.strictEqual(result.ok, true, 'restorable overtime after finish is restored');
    assert.strictEqual(user.checkedIn, true, 'restored OT checks user in');
    assert.strictEqual(user.isFinished, false, 'restored OT clears finished');
    assert.strictEqual(user.attendanceStatus, 'OVERTIME', 'restored OT records OVERTIME');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'restored OT records LIVE_ON');
    assert.strictEqual(user.finishedPresence, null, 'restored OT clears finished presence');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id && ot.type === 'AUTO'), true, 'restored OT adds overtime entry');
    assert.strictEqual(result.session.restoredFromSessionId, 'old-ot-session', 'restored OT session points to source session');
    assert.strictEqual(user.attendanceEvents.at(-1).type, 'overtime_restored_after_finish', 'restore event is recorded');
}

{
    const user = service.ensureUserData(createMember({ id: 'stale-restore-user', displayName: 'Stale Restore User' }), 'night');
    user.checkedIn = false;
    user.isFinished = true;
    user.sessions = [{
        id: 'stale-ot-session',
        shift: 'night',
        clockInAt: at('2026-05-19 21:00').toISOString(),
        clockOutAt: at('2026-05-20 10:00').toISOString(),
        scheduledEndAt: at('2026-05-20 09:00').toISOString(),
        otStartedAt: at('2026-05-20 09:00').toISOString(),
        otType: 'AUTO'
    }];
    user.activeSessionId = null;

    const result = service.applyRestoreOvertimeAfterFinishCore(user, 'night', at('2026-05-22 10:30'), 'unit-test');

    assert.strictEqual(result.ok, false, 'stale overtime session is not restored');
    assert.strictEqual(result.reason, 'not-restorable', 'stale restore reports not-restorable');
    assert.strictEqual(user.checkedIn, false, 'stale restore keeps user checked out');
}

{
    const member = createMember({ id: 'liveoff-user', displayName: 'Live Off User' });
    const user = service.ensureUserData(member, 'night');
    service.applyClockInCore(user, member, 'night', at('2026-05-21 21:00'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:00'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, false);

    const offChanged = service.markLiveOffState(user, at('2026-05-21 22:00'));

    assert.strictEqual(offChanged, true, 'live-off state reports changed');
    assert.strictEqual(user.voiceStatus, 'LIVE_OFF', 'live-off state records LIVE_OFF');
    assert.strictEqual(user.liveOffStartedAt, at('2026-05-21 22:00').toISOString(), 'live-off state records start time');
    assert.strictEqual(user.pendingClockOut.source, 'live_off', 'live-off state creates pending clock-out');
    assert.strictEqual(service.getOpenSession(user).liveOffPeriods.length, 1, 'live-off state starts live-off period');

    const onChanged = service.clearLiveOffState(user, at('2026-05-21 22:15'));

    assert.strictEqual(onChanged, true, 'live-on recovery reports changed');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'live-on recovery records LIVE_ON');
    assert.strictEqual(user.liveOffStartedAt, null, 'live-on recovery clears liveOffStartedAt');
    assert.strictEqual(user.pendingClockOut, null, 'live-on recovery clears pending clock-out');
    assert.strictEqual(service.getOpenSession(user).liveOffPeriods[0].minutes, 15, 'live-on recovery closes live-off period');
}

{
    const member = createMember({
        id: 'normalize-clockin',
        displayName: 'Normalize ClockIn',
        voice: { channelId: 'voice1', streaming: true }
    });
    const user = service.ensureUserData(member, 'night');
    const result = service.normalizeCurrentShiftSessionCore(member, user, 'night', at('2026-05-21 21:05'));

    assert.strictEqual(result.changed, true, 'normalize reports changed for new session');
    assert.strictEqual(result.action, 'clock-in', 'normalize requests clock-in for streaming new session');
    assert.strictEqual(user.shiftSessionKey, 'night:2026-05-21 21:05', 'normalize assigns session key');
}

{
    const member = createMember({
        id: 'normalize-finished',
        displayName: 'Normalize Finished',
        voice: { channelId: null, streaming: false }
    });
    const user = service.ensureUserData(member, 'night');
    user.isFinished = true;
    user.checkOutRaw = at('2026-05-21 22:00').toISOString();

    const result = service.normalizeCurrentShiftSessionCore(member, user, 'night', at('2026-05-21 23:00'));

    assert.strictEqual(result.changed, true, 'normalize reports changed for finished session');
    assert.strictEqual(result.action, 'working-role-off', 'normalize asks to remove working role for already finished session');
    assert.strictEqual(user.checkedIn, false, 'normalize keeps finished user checked out');
}

{
    const member = createMember({
        id: 'normalize-dayoff',
        displayName: 'Normalize Day Off',
        voice: { channelId: 'voice1', streaming: true }
    });
    const user = service.ensureUserData(member, 'night');
    user.dayOff = true;
    user.checkedIn = true;
    user.isFinished = false;
    user.attendanceStatus = 'ABSENT';
    user.voiceStatus = 'LIVE_ON';

    const result = service.normalizeCurrentShiftSessionCore(member, user, 'night', at('2026-05-21 21:30'));

    assert.strictEqual(result.changed, true, 'normalize reports changed for day-off session');
    assert.strictEqual(result.action, 'working-role-off', 'normalize removes working role for day-off user');
    assert.strictEqual(user.checkedIn, false, 'day-off user is not checked in');
    assert.strictEqual(user.isFinished, true, 'day-off user stays finished for work accounting');
    assert.strictEqual(user.attendanceStatus, 'DAY_OFF', 'day-off status is restored during normalize');
    assert.strictEqual(user.voiceStatus, 'OFFLINE', 'day-off voice status is kept out of live/off buckets');
}

{
    const member = createMember({
        id: 'normalize-checked',
        displayName: 'Normalize Checked',
        voice: { channelId: 'voice1', streaming: false }
    });
    const user = service.ensureUserData(member, 'night');
    user.checkedIn = true;
    user.checkInRaw = at('2026-05-21 21:10').toISOString();

    const result = service.normalizeCurrentShiftSessionCore(member, user, 'night', at('2026-05-21 22:00'));

    assert.strictEqual(result.changed, true, 'normalize reports changed for existing checked-in session');
    assert.strictEqual(result.action, 'working-role-on', 'normalize asks to keep working role for existing checked-in user');
    assert.strictEqual(user.voiceJoinedAt, at('2026-05-21 22:00').toISOString(), 'normalize records voice join when live is off');
}

console.log('attendance-service tests passed');
