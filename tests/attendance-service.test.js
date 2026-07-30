const assert = require('assert');
const moment = require('moment-timezone');
const { createAttendanceService } = require('../src/services/attendanceService');
const { auditStateInvariants } = require('../scripts/audit-state-invariants');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    POINTS: { NORMAL_IN: 10, LATE: -5, EXCESSIVE_LATE: -10, EARLY_OUT: -10, OT: 5, ABSENT: -25 },
    PURGE_MANUAL_OT: 40,
    MAX_AUTO_OT_MINS: 14 * 60,
    LIVE_OFF_IGNORE_MINS: 2,
    LIVE_OFF_CLOCK_OUT_MINS: 30,
    CLOCK_IN_GRACE_MINS: 0,
    PRE_SHIFT_VOICE_LIVE_GRACE_MINS: 10,
    PRE_SHIFT_VOICE_MEMORY_MINS: 7 * 60,
    PRE_SHIFT_RECONNECT_GRACE_MINS: 10,
    EXCEPTIONS: { EXCLUDED_USER_IDS: ['excluded-user'] }
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
        const startHour = shift === 'day' ? 9 : 21;
        const start = moment(now).tz(CONFIG.TIMEZONE).hour(startHour).minute(0).second(0).millisecond(0);
        const end = shift === 'day'
            ? start.clone().hour(21)
            : start.clone().add(12, 'hours');
        return { start, end };
    }
});

function assertUserStateClean(user, message) {
    const result = auditStateInvariants({ attendanceData: { [user.id]: user } });
    assert.deepStrictEqual(result.issues, [], message || `${user.name} has no impossible state combination`);
}

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
    const excluded = service.ensureUserData(createMember({ id: 'excluded-user' }), 'night');
    assert.strictEqual(excluded, null, 'excluded Discord user never receives attendance state');
    assert.strictEqual(state.attendanceData['excluded-user'], undefined, 'excluded Discord user is not persisted');
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
    const member = createMember({ id: 'clockin-clear', displayName: 'Clock Clear' });
    const user = service.ensureUserData(member, 'night');
    user.checkOutTime = '02:00 PM';
    user.checkOutRaw = at('2026-05-20 14:00').toISOString();
    user.lastClockOutSource = 'previous-shift';
    user.lastClockOutReason = 'previous out';
    user.lastClockOutDetectedAt = at('2026-05-20 14:00').toISOString();

    const result = service.applyClockInCore(user, member, 'night', at('2026-05-21 21:02'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:02'),
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'clock-in succeeds');
    assert.strictEqual(user.checkOutTime, null, 'new clock-in clears stale checkout display time');
    assert.strictEqual(user.checkOutRaw, null, 'new clock-in clears stale checkout raw time');
    assert.strictEqual(user.lastClockOutSource, null, 'new clock-in clears stale checkout source');
    assert.strictEqual(user.lastClockOutReason, null, 'new clock-in clears stale checkout reason');
    assert.strictEqual(user.lastClockOutDetectedAt, null, 'new clock-in clears stale checkout detected time');
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
    const user = service.ensureUserData(createMember({ id: 'post-start-clockin-user', displayName: 'Post Start Clock In User' }), 'night');
    const result = service.applyClockInCore(user, createMember({ id: 'post-start-clockin-user' }), 'night', at('2026-05-21 21:02'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:02'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'post-start clock-in succeeds');
    assert.strictEqual(result.status, 'late', 'post-start clock-in without pre-shift voice grace is late');
    assert.strictEqual(user.totalLate, 1, 'late count is awarded for post-start entry');
}

{
    const user = service.ensureUserData(createMember({ id: 'absent-return-user', displayName: 'Absent Return User' }), 'night');
    user.status = 'absent';
    user.attendanceStatus = 'ABSENT';
    user.strikeReceivedThisShift = true;
    user.points = CONFIG.POINTS.ABSENT;
    user.totalAbsent = 1;
    user.monthlyStats = {
        month: '2026-05',
        totalNormal: 0,
        totalLate: 0,
        totalExcessiveLate: 0,
        totalEarly: 0,
        totalAbsent: 1,
        totalOT: 0,
        points: CONFIG.POINTS.ABSENT
    };

    const result = service.applyClockInCore(user, createMember({ id: 'absent-return-user' }), 'night', at('2026-05-21 23:30'), {
        ok: true,
        recognizedAt: at('2026-05-21 23:30'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, false);

    assert.strictEqual(result.ok, true, 'late return after absent succeeds');
    assert.strictEqual(result.convertedAbsentToLate, true, 'late return converts final absent to late');
    assert.strictEqual(result.excessiveLate, true, 'late return is marked as 2h+ late');
    assert.strictEqual(user.status, 'late', 'late return is counted as late');
    assert.strictEqual(user.excessiveLateThisShift, true, 'user keeps 2h+ late flag for the dashboard');
    assert.strictEqual(user.totalAbsent, 0, 'late return removes the absent count');
    assert.strictEqual(user.totalLate, 1, 'late return adds a late count');
    assert.strictEqual(user.totalExcessiveLate, 1, 'late return adds a 2h+ late count');
    assert.strictEqual(user.points, CONFIG.POINTS.LATE + CONFIG.POINTS.EXCESSIVE_LATE, 'late return converts absent penalty to 2h+ late penalty');
    assert.strictEqual(user.monthlyStats.totalAbsent, 0, 'monthly absent count is corrected');
    assert.strictEqual(user.monthlyStats.totalLate, 1, 'monthly late count is corrected');
    assert.strictEqual(user.monthlyStats.totalExcessiveLate, 1, 'monthly 2h+ late count is recorded');
    assert.strictEqual(user.monthlyStats.points, CONFIG.POINTS.LATE + CONFIG.POINTS.EXCESSIVE_LATE, 'monthly points are corrected');
}

{
    const user = service.ensureUserData(createMember({ id: 'too-early-user', displayName: 'Too Early User' }), 'night');
    user.dayOff = true;
    user.isFinished = true;
    user.disconnected = true;
    user.disconnectedAt = at('2026-05-21 20:20').toISOString();
    user.attendanceStatus = 'DAY_OFF';
    user.voiceStatus = 'OFFLINE';
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
    assert.strictEqual(user.dayOff, true, 'too-early core preserves day-off state');
    assert.strictEqual(user.isFinished, true, 'too-early core preserves finished state');
    assert.strictEqual(user.disconnected, true, 'too-early core preserves disconnected state');
    assert.strictEqual(user.disconnectedAt, at('2026-05-21 20:20').toISOString(), 'too-early core preserves disconnected time');
    assert.strictEqual(user.attendanceStatus, 'DAY_OFF', 'too-early core preserves attendance status');
}

{
    const member = createMember({ id: 'pre-shift-reconnect-user', displayName: 'Pre Shift Reconnect User' });
    const user = service.ensureUserData(member, 'night');
    user.preShiftLiveAt = at('2026-05-21 20:40').toISOString();

    const result = service.applyClockInCore(user, member, 'night', at('2026-05-21 21:07'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:07'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'pre-shift reconnect clock-in succeeds');
    assert.strictEqual(result.status, 'ontime', 'pre-shift reconnect within grace is on time');
    assert.strictEqual(result.recognizedAt.format('YYYY-MM-DD HH:mm'), '2026-05-21 21:00', 'pre-shift reconnect is recognized at shift start');
    assert.strictEqual(result.preShiftReconnectGrace, true, 'result records pre-shift reconnect grace');
    assert.strictEqual(user.preShiftLiveAt, null, 'pre-shift live marker is cleared after clock-in');
    assert.strictEqual(user.totalNormal, 1, 'normal attendance is awarded');
}

{
    const member = createMember({ id: 'pre-shift-voice-user', displayName: 'Pre Shift Voice User' });
    const user = service.ensureUserData(member, 'night');
    user.preShiftVoiceAt = at('2026-05-21 20:20').toISOString();
    user.preShiftVoiceMode = 'regular';

    const result = service.applyClockInCore(user, member, 'night', at('2026-05-21 21:09'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:09'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'pre-shift voice grace clock-in succeeds');
    assert.strictEqual(result.status, 'ontime', 'pre-shift voice grace is on time');
    assert.strictEqual(result.recognizedAt.format('YYYY-MM-DD HH:mm'), '2026-05-21 21:00', 'pre-shift voice grace is recognized at shift start');
    assert.strictEqual(result.preShiftVoiceGrace, true, 'result records pre-shift voice grace');
    assert.strictEqual(result.preShiftVoiceMode, 'regular', 'regular pre-shift voice mode is preserved');
    assert.strictEqual(user.preShiftVoiceAt, null, 'pre-shift voice marker is cleared after clock-in');
}

{
    const member = createMember({ id: 'maintenance-pre-shift-voice-user', displayName: 'Maintenance Pre Shift Voice User' });
    const user = service.ensureUserData(member, 'day');
    user.preShiftVoiceAt = at('2026-05-20 04:00').toISOString();
    user.preShiftVoiceMode = 'maintenance';
    user.preShiftVoiceWindowStartAt = at('2026-05-20 04:00').toISOString();
    user.preShiftVoiceWindowEndAt = at('2026-05-20 09:00').toISOString();

    const result = service.applyClockInCore(user, member, 'day', at('2026-05-20 09:09'), {
        ok: true,
        recognizedAt: at('2026-05-20 09:09'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'maintenance pre-shift voice grace clock-in succeeds');
    assert.strictEqual(result.status, 'ontime', 'maintenance pre-shift voice grace is on time');
    assert.strictEqual(result.recognizedAt.format('YYYY-MM-DD HH:mm'), '2026-05-20 09:00', 'maintenance pre-shift voice grace is recognized at shift start');
    assert.strictEqual(result.preShiftVoiceMode, 'maintenance', 'maintenance pre-shift voice mode is preserved');
    assert.strictEqual(user.preShiftVoiceAt, null, 'maintenance pre-shift voice marker is cleared after clock-in');
}

{
    const member = createMember({ id: 'maintenance-window-mismatch-user', displayName: 'Maintenance Window Mismatch User' });
    const user = service.ensureUserData(member, 'day');
    user.preShiftVoiceAt = at('2026-05-20 04:00').toISOString();
    user.preShiftVoiceMode = 'maintenance';
    user.preShiftVoiceWindowStartAt = at('2026-05-20 04:00').toISOString();
    user.preShiftVoiceWindowEndAt = at('2026-05-20 08:30').toISOString();

    const result = service.applyClockInCore(user, member, 'day', at('2026-05-20 09:09'), {
        ok: true,
        recognizedAt: at('2026-05-20 09:09'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'maintenance mismatch clock-in succeeds');
    assert.strictEqual(result.status, 'late', 'maintenance window must end at shift start to grant on-time status');
    assert.strictEqual(result.preShiftVoiceGrace, false, 'mismatched maintenance window is ignored');
}

{
    const member = createMember({ id: 'stale-pre-shift-voice-user', displayName: 'Stale Pre Shift Voice User' });
    const user = service.ensureUserData(member, 'night');
    user.preShiftVoiceAt = at('2026-05-21 13:30').toISOString();
    user.preShiftVoiceMode = 'regular';

    const result = service.applyClockInCore(user, member, 'night', at('2026-05-21 21:09'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:09'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, true);

    assert.strictEqual(result.ok, true, 'stale pre-shift voice clock-in succeeds');
    assert.strictEqual(result.status, 'late', 'stale pre-shift voice marker does not create on-time status');
    assert.strictEqual(result.preShiftVoiceGrace, false, 'stale pre-shift voice marker is ignored');
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
    const user = service.ensureUserData(createMember({ id: 'short-live-off-user', displayName: 'Short Live Off User' }), 'night');
    const session = service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');

    service.startSessionPeriod(session.liveOffPeriods, at('2026-05-21 21:10'), 'live-off');
    service.closeOpenSessionPeriod(session.liveOffPeriods, at('2026-05-21 21:12'));
    service.startSessionPeriod(session.liveOffPeriods, at('2026-05-21 21:20'), 'live-off');
    service.closeOpenSessionPeriod(session.liveOffPeriods, at('2026-05-21 21:23'));

    const summary = service.calculateSessionWorkedMinutes(session, at('2026-05-21 22:00'));

    assert.strictEqual(service.sumSessionPeriods(session.liveOffPeriods, at('2026-05-21 22:00')), 5, 'raw live-off periods still keep short interruptions');
    assert.strictEqual(summary.liveOffMinutes, 3, 'short live-off interruptions at or below ignore threshold do not reduce credited time');
    assert.strictEqual(summary.creditedMinutes, 57, 'credited time subtracts only tracked live-off minutes');
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
    const user = service.ensureUserData(createMember({ id: 'core-dayoff-user', displayName: 'Core DayOff User' }), 'night');
    user.checkedIn = true;
    user.attendanceStatus = 'WORKING';
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');
    state.overtimeUsers.push({ id: user.id, type: 'AUTO' });

    const result = service.applyDayOffCore(user, at('2026-05-21 22:00'), 'unit-test', 'dayoff-core');

    assert.strictEqual(result.ok, true, 'day-off core succeeds');
    assert.strictEqual(user.dayOff, true, 'day-off core sets dayOff');
    assert.strictEqual(user.checkedIn, false, 'day-off core clears checkedIn');
    assert.strictEqual(user.attendanceStatus, 'DAY_OFF', 'day-off core records DAY_OFF');
    assert.strictEqual(user.voiceStatus, 'OFFLINE', 'day-off core records OFFLINE');
    assert.strictEqual(service.getOpenSession(user), null, 'day-off core closes open session');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id), false, 'day-off core removes OT entry');
}

{
    const user = service.ensureUserData(createMember({ id: 'core-finished-user', displayName: 'Core Finished User' }), 'night');
    user.checkedIn = true;
    user.disconnected = true;
    user.attendanceStatus = 'WORKING';
    user.voiceStatus = 'DISCONNECTED';
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');
    state.overtimeUsers.push({ id: user.id, type: 'MANUAL' });

    const result = service.applyFinishedStateCore(user, at('2026-05-21 22:00'), 'unit-test', 'finished-core');

    assert.strictEqual(result.ok, true, 'finished core succeeds');
    assert.strictEqual(user.checkedIn, false, 'finished core clears checkedIn');
    assert.strictEqual(user.disconnected, false, 'finished core clears disconnected');
    assert.strictEqual(user.isFinished, true, 'finished core sets finished');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'finished core records FINISHED');
    assert.strictEqual(user.voiceStatus, 'OFFLINE', 'finished core records OFFLINE');
    assert.strictEqual(service.getOpenSession(user), null, 'finished core closes open session');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id), false, 'finished core removes OT entry');
}

{
    const user = service.ensureUserData(createMember({ id: 'manual-finished-no-session', displayName: 'Manual Finished No Session' }), 'night');
    user.checkedIn = false;
    user.isFinished = true;
    user.attendanceStatus = 'FINISHED';
    user.checkOutRaw = at('2026-05-20 22:00').toISOString();
    user.shiftSessionKey = 'night:2026-05-20 21:00';
    user.activeSessionId = null;

    const result = service.applyFinishedStateCore(user, at('2026-05-21 22:00'), 'manual-adjust-command', 'manual-finished-true');

    assert.strictEqual(result.ok, true, 'manual finished without open session succeeds');
    assert.strictEqual(user.checkOutRaw, at('2026-05-21 22:00').toISOString(), 'manual finished refreshes checkout time');
    assert.strictEqual(user.shiftSessionKey, 'night:2026-05-21 22:00', 'manual finished refreshes shift session key');
    assert.strictEqual(user.lastClockOutSource, 'manual-adjust-command', 'manual finished records source');
}

{
    const user = service.ensureUserData({ id: 'missing-member-timeout', displayName: 'Missing Member Timeout' }, 'night');
    user.checkedIn = true;
    user.disconnected = true;
    user.pendingClockOut = {
        source: 'voice_leave',
        at: at('2026-05-21 22:00').toISOString(),
        expiresAt: at('2026-05-21 22:10').toISOString()
    };
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');

    const result = service.applyClockOutCore('missing-member-timeout', user, at('2026-05-21 22:10'), 'DC timeout', null, {
        clockOutSource: 'dc-timeout',
        effectiveTime: at('2026-05-21 22:00'),
        detectedAt: at('2026-05-21 22:10')
    });

    assert.strictEqual(result.ok, true, 'missing-member timeout clock-out succeeds');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'missing-member timeout records FINISHED');
    assert.strictEqual(user.voiceStatus, 'OFFLINE', 'missing-member timeout records OFFLINE');
    assert.strictEqual(user.checkOutRaw, at('2026-05-21 22:00').toISOString(), 'missing-member timeout records effective check-out');
    assert.strictEqual(user.lastClockOutSource, 'dc-timeout', 'missing-member timeout records source');
    assert.strictEqual(user.pendingClockOut, null, 'missing-member timeout clears pending clock-out');
    assert.strictEqual(service.getOpenSession(user), null, 'missing-member timeout closes open session');
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
    const user = service.ensureUserData(createMember({ id: 'restore-pre-shift-ot-user', displayName: 'Restore PRE_SHIFT OT User' }), 'night');
    user.checkedIn = false;
    user.isFinished = false;
    user.attendanceStatus = 'PRE_SHIFT';
    user.checkOutRaw = at('2026-05-22 09:30').toISOString();
    user.sessions = [{
        id: 'pre-shift-reset-ot-session',
        shift: 'night',
        clockInAt: at('2026-05-21 21:00').toISOString(),
        clockOutAt: at('2026-05-22 09:30').toISOString(),
        scheduledEndAt: at('2026-05-22 09:00').toISOString(),
        otStartedAt: at('2026-05-22 09:00').toISOString(),
        otType: 'AUTO'
    }];
    user.activeSessionId = null;

    const result = service.applyRestoreOvertimeAfterFinishCore(user, 'night', at('2026-05-22 10:30'), 'unit-test');

    assert.strictEqual(result.ok, true, 'PRE_SHIFT user with recent OT session is restorable');
    assert.strictEqual(user.checkedIn, true, 'PRE_SHIFT OT restore checks user in');
    assert.strictEqual(user.attendanceStatus, 'OVERTIME', 'PRE_SHIFT OT restore records OVERTIME');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id && ot.type === 'AUTO'), true, 'PRE_SHIFT OT restore adds overtime entry');
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
    user.pendingClockOut.finalizeAfterShiftEnd = true;
    user.pendingClockOut.shiftEndAt = at('2026-05-22 09:00').toISOString();
    user.pendingClockOut.timeoutNotifiedAt = at('2026-05-21 22:30').toISOString();
    const pointsBeforeRecovery = user.points;
    const earlyBeforeRecovery = user.totalEarly || 0;

    const onChanged = service.clearLiveOffState(user, at('2026-05-21 22:15'));

    assert.strictEqual(onChanged, true, 'live-on recovery reports changed');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'live-on recovery records LIVE_ON');
    assert.strictEqual(user.liveOffStartedAt, null, 'live-on recovery clears liveOffStartedAt');
    assert.strictEqual(user.pendingClockOut, null, 'live-on recovery clears held pending clock-out');
    assert.strictEqual(user.points, pointsBeforeRecovery, 'held live-off recovery does not change points');
    assert.strictEqual(user.totalEarly || 0, earlyBeforeRecovery, 'held live-off recovery does not add early-out');
    assert.strictEqual(service.getOpenSession(user).liveOffPeriods[0].minutes, 15, 'live-on recovery closes live-off period');
}

{
    const member = createMember({ id: 'dc-core-user', displayName: 'DC Core User' });
    const user = service.ensureUserData(member, 'night');
    service.applyClockInCore(user, member, 'night', at('2026-05-21 21:00'), {
        ok: true,
        recognizedAt: at('2026-05-21 21:00'),
        bounds: { start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') },
        preShift: false
    }, false);

    const dc = service.applyDisconnectedCore(user, at('2026-05-21 22:00'), 'unit-test', {
        graceMins: CONFIG.GRACE_PERIOD_MINS,
        pendingReason: 'unit dc'
    });

    assert.strictEqual(dc.ok, true, 'disconnected core succeeds');
    assert.strictEqual(user.disconnected, true, 'disconnected core sets disconnected');
    assert.strictEqual(user.voiceStatus, 'DISCONNECTED', 'disconnected core records DISCONNECTED');
    assert.strictEqual(user.pendingClockOut.source, 'voice_leave', 'disconnected core creates voice-leave pending clock-out');
    assert.strictEqual(service.getOpenSession(user).dcPeriods.length, 1, 'disconnected core starts dc period');
    user.pendingClockOut.finalizeAfterShiftEnd = true;
    user.pendingClockOut.shiftEndAt = at('2026-05-22 09:00').toISOString();
    user.pendingClockOut.timeoutNotifiedAt = at('2026-05-21 22:10').toISOString();
    const pointsBeforeRecovery = user.points;
    const earlyBeforeRecovery = user.totalEarly || 0;

    const live = service.applyLiveOnCore(user, at('2026-05-21 22:05'), 'unit-test', 'unit-live-on');

    assert.strictEqual(live.ok, true, 'live-on core succeeds');
    assert.strictEqual(user.disconnected, false, 'live-on core clears disconnected');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'live-on core records LIVE_ON');
    assert.strictEqual(user.pendingClockOut, null, 'live-on core clears held pending clock-out');
    assert.strictEqual(user.points, pointsBeforeRecovery, 'held dc recovery does not change points');
    assert.strictEqual(user.totalEarly || 0, earlyBeforeRecovery, 'held dc recovery does not add early-out');
    assert.strictEqual(service.getOpenSession(user).dcPeriods[0].minutes, 5, 'live-on core closes dc period');
    const recoveryEvents = user.attendanceEvents.filter(event => event.type === 'live_on_recovered').length;
    const stableLive = service.applyLiveOnCore(user, at('2026-05-21 22:06'), 'heartbeat', 'live-on-recovered');
    assert.strictEqual(stableLive.changed, false, 'stable live-on heartbeat is not treated as a recovery');
    assert.strictEqual(
        user.attendanceEvents.filter(event => event.type === 'live_on_recovered').length,
        recoveryEvents,
        'stable live-on heartbeat does not append a duplicate recovery event'
    );
}

{
    const user = service.ensureUserData(createMember({ id: 'exception-core', displayName: 'Exception Core' }), 'night');
    user.dayOff = true;
    user.dayOffExpireAt = at('2026-05-22 09:00').toISOString();
    user.isFinished = true;
    user.disconnected = true;
    user.disconnectedAt = at('2026-05-21 21:30').toISOString();
    user.pendingClockOut = { source: 'voice_leave', at: at('2026-05-21 21:30').toISOString() };

    const result = service.applyLiveExceptionCore(user, 'night', at('2026-05-21 22:00'), 'unit-test', 'unit-live-exception', {
        voiceStatus: 'EXCEPTION'
    });

    assert.strictEqual(result.ok, true, 'live exception core succeeds');
    assert.strictEqual(user.checkedIn, true, 'live exception core checks user in');
    assert.strictEqual(user.dayOff, false, 'live exception core clears dayOff');
    assert.strictEqual(user.dayOffExpireAt, null, 'live exception core clears dayOff expiry');
    assert.strictEqual(user.isFinished, false, 'live exception core clears finished');
    assert.strictEqual(user.disconnected, false, 'live exception core clears disconnected');
    assert.strictEqual(user.pendingClockOut, null, 'live exception core clears pending clock-out');
    assert.strictEqual(user.attendanceStatus, 'WORKING', 'live exception core records WORKING');
    assert.strictEqual(user.voiceStatus, 'EXCEPTION', 'live exception core records EXCEPTION');
    assert.ok(service.getOpenSession(user), 'live exception core starts a session');
}

{
    const user = service.ensureUserData(createMember({ id: 'stale-dayoff', displayName: 'Stale Dayoff' }), 'night');
    user.dayOff = true;
    user.dayOffExpireAt = at('2026-05-22 09:00').toISOString();
    user.isFinished = true;
    user.offCount = 1;
    user.dayOffPresenceNotifiedFor = 'night:old';
    user.dayOffClockInPromptSessionKey = 'night:old';
    user.dayOffClockInPromptStartedAt = at('2026-05-21 21:05').toISOString();
    user.dayOffClockInPromptMarks = [0, 10];

    const result = service.clearStaleDayOffCore(user, 'night', at('2026-05-21 22:00'), 'unit-test', 'current-regular-live-on-without-approved-reservation');

    assert.strictEqual(result.ok, true, 'stale day-off clear core succeeds');
    assert.strictEqual(user.dayOff, false, 'stale day-off clear removes dayOff');
    assert.strictEqual(user.dayOffExpireAt, null, 'stale day-off clear removes expiry');
    assert.strictEqual(user.isFinished, false, 'stale day-off clear allows clock-in flow');
    assert.strictEqual(user.offCount, 0, 'stale day-off clear decrements off count once');
    assert.strictEqual(user.attendanceStatus, 'PRE_SHIFT', 'stale day-off clear resets attendance status before clock-in');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'stale day-off clear records live presence');
    assert.strictEqual(user.dayOffPresenceNotifiedFor, null, 'stale day-off clear resets notification key');
    assert.deepStrictEqual(user.dayOffClockInPromptMarks, [], 'stale day-off clear resets prompt marks');
}

{
    const user = service.ensureUserData(createMember({ id: 'reservation-clear', displayName: 'Reservation Clear' }), 'night');
    user.dayOff = true;
    user.dayOffExpireAt = at('2026-05-22 09:00').toISOString();
    user.offCount = 2;
    user.attendanceStatus = 'DAY_OFF';
    user.voiceStatus = 'OFFLINE';

    const result = service.clearDayOffReservationStateCore(user, at('2026-05-21 22:00'), 'unit-test', 'reservation-cancelled');

    assert.strictEqual(result.ok, true, 'reservation clear core succeeds');
    assert.strictEqual(user.dayOff, false, 'reservation clear removes dayOff');
    assert.strictEqual(user.dayOffExpireAt, null, 'reservation clear removes expiry');
    assert.strictEqual(user.offCount, 1, 'reservation clear decrements off count once');
    assert.strictEqual(user.attendanceEvents.at(-1).type, 'dayoff_reservation_state_cleared', 'reservation clear records event');
}

{
    const user = service.ensureUserData(createMember({ id: 'manual-resume', displayName: 'Manual Resume' }), 'night');
    user.checkedIn = true;
    user.disconnected = true;
    user.pendingClockOut = { source: 'voice_leave', at: at('2026-05-21 22:00').toISOString() };

    const result = service.applyManualResumeRequiredCore(user, at('2026-05-21 22:15'), 'unit-test', 'manual-resume-live-required', {
        voiceStatus: 'LIVE_OFF'
    });

    assert.strictEqual(result.ok, true, 'manual resume required core succeeds');
    assert.strictEqual(user.checkedIn, false, 'manual resume required clears checkedIn');
    assert.strictEqual(user.isFinished, true, 'manual resume required keeps finished');
    assert.strictEqual(user.disconnected, false, 'manual resume required clears disconnected');
    assert.strictEqual(user.pendingClockOut, null, 'manual resume required clears pending clock-out');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'manual resume required records FINISHED');
    assert.strictEqual(user.voiceStatus, 'LIVE_OFF', 'manual resume required records voice status');
}

{
    const user = service.ensureUserData(createMember({ id: 'pending-ot-reservation', displayName: 'Pending OT Reservation' }), 'night');
    user.isFinished = true;
    user.checkedIn = true;

    const result = service.applyPendingOvertimeReservationCore(user, at('2026-05-21 22:15'), 'unit-test', 'manual-ot-reserved-live-off', {
        voiceConnected: true
    });

    assert.strictEqual(result.ok, true, 'pending OT reservation core succeeds');
    assert.strictEqual(user.pendingManualOT, true, 'pending OT reservation sets pending manual OT');
    assert.strictEqual(user.isFinished, false, 'pending OT reservation clears finished');
    assert.strictEqual(user.voiceStatus, 'LIVE_OFF', 'pending OT reservation records live-off when connected');
    assert.strictEqual(user.pendingClockOut.source, 'live_off', 'pending OT reservation creates live-off pending clock-out');
}

{
    const user = service.ensureUserData(createMember({ id: 'expired-dayoff', displayName: 'Expired Dayoff' }), 'night');
    user.dayOff = true;
    user.dayOffExpireAt = at('2026-05-22 09:00').toISOString();
    user.isFinished = true;
    user.attendanceStatus = 'DAY_OFF';

    const result = service.expireDayOffStateCore(user, at('2026-05-22 09:05'), 'unit-test', 'day-off-expired');

    assert.strictEqual(result.ok, true, 'expire day-off core succeeds');
    assert.strictEqual(user.dayOff, false, 'expire day-off core clears dayOff');
    assert.strictEqual(user.dayOffExpireAt, null, 'expire day-off core clears expiry');
    assert.strictEqual(user.isFinished, false, 'expire day-off core resets finished');
    assert.strictEqual(user.attendanceStatus, 'PRE_SHIFT', 'expire day-off core records PRE_SHIFT');
}

{
    const user = service.ensureUserData(createMember({ id: 'clockin-reset', displayName: 'ClockIn Reset' }), 'night');
    user.isFinished = true;
    user.finishedPresence = 'left_voice';
    user.finalLeftAt = at('2026-05-21 22:00').toISOString();

    const result = service.resetFinishedForPreClockInCore(user, at('2026-05-21 22:10'), 'unit-test', 'clock-in-retry-before-live', {
        voiceStatus: 'LIVE_OFF'
    });

    assert.strictEqual(result.ok, true, 'clock-in reset core succeeds');
    assert.strictEqual(user.isFinished, false, 'clock-in reset core clears finished');
    assert.strictEqual(user.finishedPresence, null, 'clock-in reset core clears finished presence');
    assert.strictEqual(user.attendanceStatus, 'PRE_SHIFT', 'clock-in reset core records PRE_SHIFT');
    assert.strictEqual(user.voiceStatus, 'LIVE_OFF', 'clock-in reset core records current voice status');
}

{
    const user = service.ensureUserData(createMember({ id: 'current-shift-live', displayName: 'Current Shift Live' }), 'night');
    user.isFinished = true;
    user.disconnected = true;
    user.shift = 'night';

    const result = service.applyCurrentShiftLiveOnCore(user, 'day', at('2026-05-21 10:00'), 'unit-test', 'current-shift-live-on');

    assert.strictEqual(result.ok, true, 'current shift live core succeeds');
    assert.strictEqual(user.shift, 'day', 'current shift live core updates shift');
    assert.strictEqual(user.checkedIn, true, 'current shift live core checks user in');
    assert.strictEqual(user.isFinished, false, 'current shift live core clears finished');
    assert.strictEqual(user.disconnected, false, 'current shift live core clears disconnected');
    assert.strictEqual(user.attendanceStatus, 'WORKING', 'current shift live core records WORKING');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'current shift live core records LIVE_ON');
}

{
    const user = service.ensureUserData(createMember({ id: 'smart-reset', displayName: 'Smart Reset' }), 'night');
    user.checkedIn = true;
    user.dayOff = true;
    user.disconnected = true;
    user.isFinished = true;
    user.pendingClockOut = { source: 'voice_leave' };
    state.overtimeUsers.push({ id: user.id, type: 'AUTO' });

    const result = service.applySmartResetCore(user, at('2026-05-21 10:00'), 'unit-test', 'smart-reset');

    assert.strictEqual(result.ok, true, 'smart reset core succeeds');
    assert.strictEqual(user.checkedIn, false, 'smart reset clears checkedIn');
    assert.strictEqual(user.dayOff, false, 'smart reset clears dayOff');
    assert.strictEqual(user.disconnected, false, 'smart reset clears disconnected');
    assert.strictEqual(user.isFinished, false, 'smart reset clears finished');
    assert.strictEqual(user.pendingClockOut, null, 'smart reset clears pending clock-out');
    assert.strictEqual(user.attendanceStatus, 'PRE_SHIFT', 'smart reset records PRE_SHIFT');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id), false, 'smart reset removes overtime entry');
}

{
    const member = createMember({ id: 'scenario-robin', displayName: 'ROBIN Scenario' });
    const user = service.ensureUserData(member, 'night');

    const exception = service.applyLiveExceptionCore(user, 'night', at('2026-05-21 22:00'), 'scenario-test', 'live-exception-approved', {
        voiceStatus: 'EXCEPTION'
    });
    assert.strictEqual(exception.ok, true, 'scenario live exception starts');
    assert.strictEqual(user.attendanceStatus, 'WORKING', 'scenario exception is working');
    assert.strictEqual(user.voiceStatus, 'EXCEPTION', 'scenario exception is visible as exception');
    assertUserStateClean(user, 'live exception state is clean');

    const dc = service.applyDisconnectedCore(user, at('2026-05-21 22:15'), 'scenario-test', {
        graceMins: 10,
        pendingReason: 'scenario dc'
    });
    assert.strictEqual(dc.ok, true, 'scenario DC starts');
    assert.strictEqual(user.disconnected, true, 'scenario user moves to DC');
    assert.strictEqual(user.voiceStatus, 'DISCONNECTED', 'scenario exception DC overrides exception voice status');
    assertUserStateClean(user, 'live exception disconnected state is clean');

    const timeout = service.applyClockOutCore(member, user, at('2026-05-21 22:25'), 'DC timeout', null, {
        clockOutSource: 'dc-timeout',
        effectiveTime: at('2026-05-21 22:15'),
        detectedAt: at('2026-05-21 22:25')
    });
    assert.strictEqual(timeout.ok, true, 'scenario DC timeout clocks out');
    assert.strictEqual(user.checkedIn, false, 'scenario timeout clears checkedIn');
    assert.strictEqual(user.isFinished, true, 'scenario timeout moves to finished');
    assert.strictEqual(user.disconnected, false, 'scenario timeout clears DC');
    assert.strictEqual(user.attendanceStatus, 'FINISHED', 'scenario timeout records FINISHED');
    assert.strictEqual(user.voiceStatus, 'OFFLINE', 'scenario timeout records OFFLINE');
    assert.strictEqual(service.getOpenSession(user), null, 'scenario timeout closes session');
    assertUserStateClean(user, 'live exception DC timeout final state is clean');
}

{
    const member = createMember({ id: 'scenario-erzie', displayName: 'Erzie Scenario' });
    const user = service.ensureUserData(member, 'night');
    user.checkedIn = true;
    user.attendanceStatus = 'WORKING';
    user.voiceStatus = 'LIVE_ON';
    user.status = 'late';
    user.strikeReceivedThisShift = true;
    user.points = -15;
    user.totalLate = 1;
    user.totalEarly = 1;
    user.earlyOut = true;
    user.monthlyStats = {
        month: '2026-05',
        totalNormal: 0,
        totalLate: 1,
        totalExcessiveLate: 0,
        totalEarly: 1,
        totalAbsent: 0,
        totalOT: 0,
        points: -15
    };
    service.startAttendanceSession(user, 'night', at('2026-05-21 21:08'), 'unit-test');
    service.applyDisconnectedCore(user, at('2026-05-22 02:00'), 'unit-test', {
        graceMins: 10,
        pendingReason: 'scenario dc'
    });
    const timeout = service.applyClockOutCore(member, user, at('2026-05-22 02:10'), 'DC timeout', null, {
        clockOutSource: 'dc-timeout',
        effectiveTime: at('2026-05-22 02:00'),
        detectedAt: at('2026-05-22 02:10')
    });
    service.closeOpenSessionPeriod(user.sessions[0].dcPeriods, at('2026-05-22 02:00'));
    user.reversibleEarlyPenaltyKey = timeout.reversibleEarlyPenaltyKey;
    user.reversibleEarlyPenaltyPoints = Math.abs(CONFIG.POINTS.EARLY_OUT);

    const resumed = service.applyAutoTimeoutResumeCore(user, 'night', at('2026-05-22 03:20'), 'unit-test');

    assert.strictEqual(resumed.ok, true, 'auto timeout session is resumable before shift end');
    assert.strictEqual(user.checkedIn, true, 'resume keeps worker checked in');
    assert.strictEqual(user.isFinished, false, 'resume clears finished state');
    assert.strictEqual(user.checkOutRaw, null, 'resume removes temporary checkout');
    assert.strictEqual(service.getOpenSession(user)?.id, timeout.session.id, 'resume reopens the original session');
    assert.strictEqual(user.totalEarly, 0, 'resume reverses early-out count');
    assert.strictEqual(user.monthlyStats.totalEarly, 0, 'resume reverses monthly early-out count');
    assert.strictEqual(user.monthlyStats.points, -5, 'resume reverses only the early-out penalty');
    assert.strictEqual(user.monthlyStats.totalLate, 1, 'resume preserves the original attendance status');
    assert.strictEqual(user.sessions[0].dcPeriods[0].minutes, 80, 'resume records full DC duration until recovery');
    assert.strictEqual(user.sessions[0].clockOutAt, null, 'original session is no longer closed');
}

{
    const user = service.ensureUserData(createMember({ id: 'scenario-daba', displayName: 'Daba Scenario' }), 'night');
    user.dayOff = true;
    user.dayOffExpireAt = at('2026-05-22 09:00').toISOString();
    user.isFinished = true;
    user.attendanceStatus = 'DAY_OFF';
    user.voiceStatus = 'OFFLINE';
    user.offCount = 1;

    const cleared = service.clearStaleDayOffCore(user, 'night', at('2026-05-21 22:00'), 'scenario-test', 'current-regular-live-on-without-approved-reservation');
    assert.strictEqual(cleared.ok, true, 'scenario stale day-off clears');
    assert.strictEqual(user.dayOff, false, 'scenario dayOff clears');
    assert.strictEqual(user.isFinished, false, 'scenario finished clears so clock-in flow can proceed');
    assert.strictEqual(user.attendanceStatus, 'PRE_SHIFT', 'scenario user is not absent after stale day-off clear');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'scenario live presence is retained');
    assertUserStateClean(user, 'stale day-off clear state is clean');
}

{
    const user = service.ensureUserData(createMember({ id: 'scenario-tonstar', displayName: 'Tonstar Scenario' }), 'night');
    user.checkedIn = false;
    user.isFinished = false;
    user.attendanceStatus = 'PRE_SHIFT';
    user.sessions = [{
        id: 'scenario-tonstar-ot-session',
        shift: 'night',
        clockInAt: at('2026-05-21 21:00').toISOString(),
        clockOutAt: at('2026-05-22 09:30').toISOString(),
        scheduledEndAt: at('2026-05-22 09:00').toISOString(),
        otStartedAt: at('2026-05-22 09:00').toISOString(),
        otType: 'AUTO'
    }];
    user.activeSessionId = null;

    const restored = service.applyRestoreOvertimeAfterFinishCore(user, 'night', at('2026-05-22 10:30'), 'scenario-test');
    assert.strictEqual(restored.ok, true, 'scenario overtime restores from PRE_SHIFT');
    assert.strictEqual(user.checkedIn, true, 'scenario restored OT checks in');
    assert.strictEqual(user.isFinished, false, 'scenario restored OT clears finished');
    assert.strictEqual(user.attendanceStatus, 'OVERTIME', 'scenario restored OT records OVERTIME');
    assert.strictEqual(user.voiceStatus, 'LIVE_ON', 'scenario restored OT records LIVE_ON');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id && ot.type === 'AUTO'), true, 'scenario restored OT appears in overtime list');
    assertUserStateClean(user, 'restored overtime state is clean');
}

{
    const user = service.ensureUserData(createMember({ id: 'scenario-denxie-stale', displayName: 'denxie stale' }), 'night');
    user.checkedIn = false;
    user.isFinished = true;
    user.attendanceStatus = 'FINISHED';
    user.voiceStatus = 'LIVE_ON';
    user.lastClockOutSource = 'auto-repair-stale-overtime';
    user.sessions = [{
        id: 'scenario-denxie-stale-ot-session',
        shift: 'night',
        clockInAt: at('2026-06-30 09:00').toISOString(),
        clockOutAt: at('2026-06-30 09:00').toISOString(),
        clockOutSource: 'auto-repair-stale-overtime',
        scheduledEndAt: at('2026-06-30 09:00').toISOString(),
        otStartedAt: at('2026-06-30 09:00').toISOString(),
        otType: 'AUTO'
    }];
    user.activeSessionId = null;

    const restored = service.applyRestoreOvertimeAfterFinishCore(user, 'night', at('2026-07-01 13:00'), 'scenario-test');
    assert.strictEqual(restored.ok, false, 'stale auto-repaired overtime is not restored after finish');
    assert.strictEqual(user.checkedIn, false, 'stale auto-repaired overtime does not check user back in');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id), false, 'stale auto-repaired overtime is not re-added');
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

{
    const member = createMember({
        id: 'normalize-stale-checkin',
        displayName: 'Normalize Stale CheckIn',
        voice: { channelId: 'voice1', streaming: true }
    });
    const user = service.ensureUserData(member, 'night');
    user.shiftSessionKey = 'night:2026-05-21 21:00';
    user.checkedIn = true;
    user.checkInRaw = at('2026-05-21 02:36').toISOString();
    user.checkInTime = '02:36 AM';
    user.attendanceStatus = 'WORKING';
    user.voiceStatus = 'LIVE_ON';

    const result = service.normalizeCurrentShiftSessionCore(member, user, 'night', at('2026-05-21 21:02'));

    assert.strictEqual(result.changed, true, 'normalize repairs stale check-in from before current shift start');
    assert.strictEqual(result.action, 'clock-in', 'streaming stale session is clocked into the new shift');
    assert.strictEqual(user.checkInRaw, null, 'stale check-in time is cleared before new clock-in');
    assert.strictEqual(user.activeSessionId, null, 'stale active session is cleared');
}

{
    const user = service.ensureUserData(createMember({
        id: 'post-shift-ot',
        displayName: 'Post Shift OT'
    }), 'night');
    user.checkedIn = false;
    user.isFinished = false;
    user.dayOff = false;
    user.attendanceStatus = 'PRE_SHIFT';
    user.lastClockOutSource = 'shift-handoff-auto-finish';
    user.lastLiveOnAt = at('2026-05-22 08:50').toISOString();
    user.sessions = [{
        id: 'post-shift-session',
        shift: 'night',
        scheduledStartAt: at('2026-05-21 21:00').toISOString(),
        scheduledEndAt: at('2026-05-22 09:00').toISOString(),
        clockInAt: at('2026-05-21 21:00').toISOString(),
        clockOutAt: at('2026-05-22 09:00').toISOString(),
        clockOutSource: 'shift-handoff-auto-finish'
    }];

    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 09:10')),
        true,
        'post-shift live user closed by handoff can enter auto OT'
    );

    user.isFinished = true;
    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 09:10')),
        true,
        'finished users closed by handoff can continue into post-shift OT when live is still on'
    );

    user.manualResumeRequired = true;
    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 09:10')),
        false,
        'manual-resume-required users are not silently moved into post-shift OT'
    );

    user.manualResumeRequired = false;
    user.postShiftOtInterruptedAt = at('2026-05-22 09:03').toISOString();
    user.postShiftOtInterruptedReason = 'left_voice_after_shift_end';
    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 09:10')),
        false,
        'post-shift live break blocks automatic continuous OT'
    );
}

{
    const user = service.ensureUserData(createMember({
        id: 'post-shift-late-return',
        displayName: 'Post Shift Late Return'
    }), 'night');
    user.checkedIn = false;
    user.isFinished = true;
    user.dayOff = false;
    user.attendanceStatus = 'FINISHED';
    user.lastClockOutSource = 'shift-handoff-auto-finish';
    user.checkInRaw = at('2026-05-21 21:00').toISOString();
    user.checkInTime = '09:00 PM';
    user.sessions = [{
        id: 'post-shift-late-return-session',
        shift: 'night',
        scheduledStartAt: at('2026-05-21 21:00').toISOString(),
        scheduledEndAt: at('2026-05-22 09:00').toISOString(),
        clockInAt: at('2026-05-21 21:00').toISOString(),
        clockOutAt: at('2026-05-22 09:00').toISOString(),
        clockOutSource: 'shift-handoff-auto-finish'
    }];

    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 18:30')),
        false,
        'late post-shift return is not silently attached to the old shift'
    );
    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 18:30'), { allowLateReturn: true }),
        true,
        'explicit live re-entry can start a detached post-shift overtime'
    );
    assert.strictEqual(
        service.getPostShiftOvertimeStartMoment(user, at('2026-05-22 18:30'), { allowLateReturn: true }).format('HH:mm'),
        '18:30',
        'detached post-shift overtime starts at the live re-entry time'
    );

    const result = service.applyOvertimeCore(user, at('2026-05-22 18:30'), 'AUTO', 'unit-test', 'late-post-shift-return', {
        startedAt: at('2026-05-22 18:30'),
        sessionSource: 'post-shift-auto-ot',
        resetClockInForOvertime: true,
        sessionScheduledStartAt: at('2026-05-22 18:30'),
        sessionScheduledEndAt: at('2026-05-22 18:30'),
        monthlyAt: at('2026-05-22 18:30')
    });

    assert.strictEqual(result.ok, true, 'detached post-shift overtime starts');
    assert.strictEqual(user.checkInRaw, at('2026-05-22 18:30').toISOString(), 'detached overtime replaces display clock-in time');
    assert.strictEqual(user.checkOutRaw, null, 'detached overtime clears stale checkout raw time');
    assert.strictEqual(user.checkOutTime, null, 'detached overtime clears stale checkout display time');
    assert.strictEqual(user.lastClockOutSource, null, 'detached overtime clears stale checkout source');
    assert.strictEqual(result.session.scheduledStartAt, at('2026-05-22 18:30').toISOString(), 'detached overtime does not reuse the old shift start');
}

{
    const user = service.ensureUserData(createMember({
        id: 'stale-repaired-live-return',
        displayName: 'Stale Repaired Live Return'
    }), 'night');
    user.checkedIn = false;
    user.isFinished = true;
    user.attendanceStatus = 'FINISHED';
    user.lastClockOutSource = 'auto-repair-stale-overtime';
    user.sessions = [{
        id: 'stale-repaired-auto-ot',
        shift: 'night',
        scheduledStartAt: at('2026-05-21 21:00').toISOString(),
        scheduledEndAt: at('2026-05-22 09:00').toISOString(),
        clockInAt: at('2026-05-22 09:00').toISOString(),
        clockInSource: 'post-shift-auto-ot',
        clockOutAt: at('2026-05-22 09:00').toISOString(),
        clockOutSource: 'auto-repair-stale-overtime',
        otStartedAt: at('2026-05-22 09:00').toISOString(),
        otType: 'AUTO'
    }];

    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 18:30')),
        false,
        'stale repaired overtime is not silently restored'
    );
    assert.strictEqual(
        service.canStartPostShiftOvertime(user, at('2026-05-22 18:30'), { allowLateReturn: true }),
        true,
        'actual live return after stale repair can start a new detached overtime'
    );
}

{
    const user = service.ensureUserData(createMember({
        id: 'month-boundary-ot',
        displayName: 'Month Boundary OT'
    }), 'night');
    user.sessions = [{
        id: 'regular-night-2026-06-30',
        shift: 'night',
        sessionKey: 'night:2026-06-30 21:00',
        scheduledStartAt: at('2026-06-30 21:00').toISOString(),
        scheduledEndAt: at('2026-07-01 09:00').toISOString(),
        clockInAt: at('2026-06-30 21:00').toISOString(),
        clockOutAt: at('2026-07-01 09:00').toISOString(),
        clockOutSource: 'shift-handoff-auto-finish'
    }];

    const result = service.applyOvertimeCore(user, at('2026-07-01 09:05'), 'AUTO', 'unit-test', 'month-boundary-auto-ot', {
        startedAt: at('2026-07-01 09:00'),
        sessionSource: 'post-shift-auto-ot'
    });

    assert.strictEqual(result.ok, true, 'month boundary overtime starts');
    assert.strictEqual(user.monthlyStats.month, '2026-06', 'overtime points use shift work month');
    assert.strictEqual(user.monthlyStats.totalOT, 1, 'overtime count is assigned to work month');
    assert.strictEqual(result.session.sessionKey, 'night:2026-06-30 21:00', 'overtime session keeps source shift session key');
    assert.strictEqual(state.overtimeUsers.some(ot => ot.id === user.id && ot.shiftSessionKey === 'night:2026-06-30 21:00'), true, 'overtime entry keeps source shift session key');
}

{
    const user = service.ensureUserData(createMember({
        id: 'continuous-live-heartbeat',
        displayName: 'Continuous Live Heartbeat'
    }), 'day');
    user.checkedIn = true;
    user.voiceStatus = 'LIVE_ON';
    user.lastLiveOnAt = at('2026-07-30 09:00').toISOString();
    service.startAttendanceSession(user, 'day', at('2026-07-30 09:00'), 'unit-test');

    service.applyLiveOnCore(user, at('2026-07-30 20:55'), 'heartbeat', 'live-on-confirmed');
    assert.strictEqual(
        user.lastLiveOnAt,
        at('2026-07-30 09:00').toISOString(),
        'continuous LIVE heartbeat preserves the uninterrupted LIVE start time'
    );

    service.markLiveOffState(user, at('2026-07-30 20:56'));
    service.applyLiveOnCore(user, at('2026-07-30 20:58'), 'voice-state', 'live-on-recovered');
    assert.strictEqual(
        user.lastLiveOnAt,
        at('2026-07-30 20:58').toISOString(),
        'LIVE recovery records a new uninterrupted LIVE start time'
    );
}

console.log('attendance-service tests passed');
