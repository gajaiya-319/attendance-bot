'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const { createAttendanceService } = require('../src/services/attendanceService');
const { createVoiceSyncWorkflow } = require('../src/workflows/voiceSyncWorkflow');

const CONFIG = {
    GUILD_ID: 'g1',
    TIMEZONE: 'Asia/Manila',
    LIVE_OFF_IGNORE_MINS: 2,
    LIVE_OFF_DM_INTERVAL_MINS: 10,
    LIVE_OFF_CLOCK_OUT_MINS: 30,
    GRACE_PERIOD_MINS: 10,
    CLOCK_OUT_GRACE_MINS: 5,
    AUTO_TIMEOUT_RESUME_WINDOW_MINS: 60,
    PRE_SHIFT_VOICE_LIVE_GRACE_MINS: 10,
    PRE_SHIFT_VOICE_MEMORY_MINS: 7 * 60,
    PRE_SHIFT_RECONNECT_GRACE_MINS: 10,
    ROLES: { DAY: 'day-role', NIGHT: 'night-role' }
};

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
}

function buildService(state) {
    return createAttendanceService({
        CONFIG,
        moment,
        getAttendanceData: () => state.attendanceData,
        getOvertimeUsers: () => state.overtimeUsers,
        determineShift: () => 'night',
        getShiftSessionKey: (shift, now) => `${shift}:${moment(now).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD')}`,
        getShiftBounds: () => ({ start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') })
    });
}

(async () => {
    const state = { attendanceData: {}, overtimeUsers: [] };
    const service = buildService(state);
    const sentMessages = [];
    const audits = [];
    const member = {
        id: 'live-policy-user',
        displayName: 'Live Policy User',
        user: { bot: false },
        voice: { channelId: 'voice1', streaming: false },
        send: async message => sentMessages.push(message)
    };
    const user = service.ensureUserData(member, 'night');
    user.checkedIn = true;
    user.attendanceStatus = 'WORKING';
    user.voiceStatus = 'LIVE_ON';
    const session = service.startAttendanceSession(user, 'night', at('2026-05-21 21:00'), 'unit-test');
    service.startSessionPeriod(session.liveOffPeriods, at('2026-05-21 21:30'), 'live-off');
    service.closeOpenSessionPeriod(session.liveOffPeriods, at('2026-05-21 21:38'));

    const voice = createVoiceSyncWorkflow({
        client: { guilds: { cache: { get: () => null } } },
        CONFIG,
        moment,
        getAttendanceData: () => state.attendanceData,
        getOvertimeUsers: () => state.overtimeUsers,
        saveSystemAsync: async () => {},
        refreshGuildMembers: async () => true,
        determineShift: () => 'night',
        ensureUserData: () => user,
        getMemberShiftRole: () => 'night',
        getActiveLiveException: () => null,
        getShiftBounds: () => ({ start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') }),
        getScheduledEndMoment: () => at('2026-05-22 09:00'),
        isMaintenanceWindow: () => false,
        isWithinPreShiftWindow: () => false,
        isCurrentShiftRegularWorker: () => true,
        canStartPostShiftOvertime: () => false,
        getRestorableOvertimeSession: () => null,
        getOpenSession: service.getOpenSession,
        sumCreditedLiveOffPeriods: service.sumCreditedLiveOffPeriods,
        appendAttendanceEvent: service.appendAttendanceEvent,
        transitionRecordedStatus: service.transitionRecordedStatus,
        setFinishedPresence: () => false,
        handleClockOut: async () => {},
        applyDisconnectedState: () => {},
        recordLog: async () => {},
        getActiveApprovedDayOffReservation: () => null,
        clearStaleDayOffState: () => {},
        applyLiveExceptionState: () => {},
        handleClockIn: async () => false,
        activatePendingManualOvertime: async () => false,
        restoreOvertimeAfterFinish: async () => false,
        notifyDayOffPresence: async () => false,
        notifyAfterFinishPresence: async () => false,
        notifyFinishedReturnToVoice: async () => false,
        notifyStandbyClockInRequired: async () => false,
        sendFinishedLiveOffReminder: async () => false,
        startPostShiftOvertime: async () => false,
        recordLiveConfirmation: async () => false,
        recordLiveRecovery: async () => false,
        markLiveOffState: service.markLiveOffState,
        clearLiveOffState: service.clearLiveOffState,
        applyLiveOnState: service.applyLiveOnCore,
        updateWorkingRole: async () => {},
        canStartOvertimeNow: () => false,
        startAttendanceSession: service.startAttendanceSession,
        appendAdminAudit: async (action, payload) => audits.push({ action, payload }),
        formatDuration: mins => `${mins}m`,
        logger: { warn: () => {}, error: () => {} }
    });

    await voice.applyVoiceSnapshot(member, user, 'night', {
        source: 'unit-test',
        wasConnected: true,
        isConnected: true,
        wasStreaming: true,
        isStreaming: false
    }, at('2026-05-21 22:00'));

    assert.strictEqual(sentMessages.length, 0, '8 cumulative tracked minutes does not send warning yet');
    const liveOffSnapshotEvents = user.attendanceEvents.filter(event => event.type === 'voice_live_off_snapshot').length;

    await voice.applyVoiceSnapshot(member, user, 'night', {
        source: 'unit-test',
        wasConnected: true,
        isConnected: true,
        wasStreaming: false,
        isStreaming: false
    }, at('2026-05-21 22:04'));

    assert.strictEqual(sentMessages.length, 1, 'cumulative tracked live-off minutes sends first warning after short interruptions are ignored');
    assert.match(sentMessages[0], /Reminder 1\/3/);
    assert.match(sentMessages[0], /Turn LIVE ON immediately/);
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].action, 'AUTO_DM_LIVE_OFF_WARNING');
    assert.strictEqual(audits[0].payload.targetId, 'live-policy-user');
    assert.strictEqual(audits[0].payload.mark, 10);
    assert.strictEqual(audits[0].payload.dmStatus, 'sent');
    assert.strictEqual(
        user.attendanceEvents.filter(event => event.type === 'voice_live_off_snapshot').length,
        liveOffSnapshotEvents,
        'stable live-off heartbeat does not append a duplicate snapshot event'
    );

    {
        const otMember = {
            id: 'continuous-post-shift-live-user',
            displayName: 'Continuous Post Shift Live User',
            user: { bot: false },
            voice: { channelId: 'voice1', streaming: true },
            send: async () => {}
        };
        const otUser = service.ensureUserData(otMember, 'night');
        otUser.checkedIn = false;
        otUser.isFinished = true;
        otUser.attendanceStatus = 'FINISHED';
        otUser.voiceStatus = 'LIVE_ON';
        otUser.lastLiveOnAt = at('2026-05-22 08:50').toISOString();
        let canStartOptions = null;
        let requested = false;
        const otVoice = createVoiceSyncWorkflow({
            client: { guilds: { cache: { get: () => null } } },
            CONFIG,
            moment,
            getAttendanceData: () => state.attendanceData,
            getOvertimeUsers: () => state.overtimeUsers,
            saveSystemAsync: async () => {},
            refreshGuildMembers: async () => true,
            determineShift: () => 'night',
            ensureUserData: () => otUser,
            getMemberShiftRole: () => 'night',
            getActiveLiveException: () => null,
            getShiftBounds: () => ({ start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') }),
            getScheduledEndMoment: () => at('2026-05-22 09:00'),
            isMaintenanceWindow: () => false,
            isWithinPreShiftWindow: () => false,
            isCurrentShiftRegularWorker: () => false,
            canStartPostShiftOvertime: (_user, _now, options) => {
                canStartOptions = options;
                return Boolean(options?.requireContinuousLive && options?.allowLateReturn === false);
            },
            getRestorableOvertimeSession: () => null,
            getOpenSession: service.getOpenSession,
            sumCreditedLiveOffPeriods: service.sumCreditedLiveOffPeriods,
            appendAttendanceEvent: service.appendAttendanceEvent,
            transitionRecordedStatus: service.transitionRecordedStatus,
            setFinishedPresence: () => false,
            handleClockOut: async () => {},
            applyDisconnectedState: () => {},
            recordLog: async () => {},
            getActiveApprovedDayOffReservation: () => null,
            clearStaleDayOffState: () => {},
            applyLiveExceptionState: () => {},
            handleClockIn: async () => false,
            activatePendingManualOvertime: async () => false,
            restoreOvertimeAfterFinish: async () => false,
            notifyDayOffPresence: async () => false,
            notifyAfterFinishPresence: async () => false,
            notifyFinishedReturnToVoice: async () => false,
            notifyStandbyClockInRequired: async () => false,
            sendFinishedLiveOffReminder: async () => false,
            requestPostShiftOvertimeConfirmation: async (_member, _user, _now, _source, options) => {
                requested = options?.scheduledEnd?.format?.('HH:mm') === '09:00';
                return { handled: true, changed: true };
            },
            recordLiveConfirmation: async () => false,
            recordLiveRecovery: async () => false,
            markLiveOffState: service.markLiveOffState,
            clearLiveOffState: service.clearLiveOffState,
            applyLiveOnState: service.applyLiveOnCore,
            updateWorkingRole: async () => {},
            canStartOvertimeNow: () => false,
            startAttendanceSession: service.startAttendanceSession,
            appendAdminAudit: async () => {},
            formatDuration: mins => `${mins}m`,
            logger: { warn: () => {}, error: () => {} }
        });

        const changed = await otVoice.applyVoiceSnapshot(otMember, otUser, 'night', {
            source: 'heartbeat',
            wasConnected: true,
            isConnected: true,
            wasStreaming: true,
            isStreaming: true
        }, at('2026-05-22 09:06'));

        assert.strictEqual(changed, true, 'continuous post-shift live can request automatic OT confirmation');
        assert.strictEqual(canStartOptions?.allowLateReturn, false, 'automatic OT does not use detached late-return mode');
        assert.strictEqual(canStartOptions?.requireContinuousLive, true, 'automatic OT requires continuous live evidence');
        assert.strictEqual(requested, true, 'post-shift overtime waits for DM confirmation before starting');
    }

    {
        const breakMember = {
            id: 'post-shift-break-return-user',
            displayName: 'Post Shift Break Return User',
            user: { bot: false },
            voice: { channelId: 'voice1', streaming: true },
            send: async () => {}
        };
        const breakUser = service.ensureUserData(breakMember, 'night');
        breakUser.checkedIn = false;
        breakUser.isFinished = true;
        breakUser.attendanceStatus = 'FINISHED';
        breakUser.voiceStatus = 'LIVE_ON';
        breakUser.lastLiveOnAt = at('2026-05-22 08:50').toISOString();
        let canStartOptions = null;
        let requested = false;
        const breakVoice = createVoiceSyncWorkflow({
            client: { guilds: { cache: { get: () => null } } },
            CONFIG,
            moment,
            getAttendanceData: () => state.attendanceData,
            getOvertimeUsers: () => state.overtimeUsers,
            saveSystemAsync: async () => {},
            refreshGuildMembers: async () => true,
            determineShift: () => 'night',
            ensureUserData: () => breakUser,
            getMemberShiftRole: () => 'night',
            getActiveLiveException: () => null,
            getShiftBounds: () => ({ start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') }),
            getScheduledEndMoment: () => at('2026-05-22 09:00'),
            isMaintenanceWindow: () => false,
            isWithinPreShiftWindow: () => false,
            isCurrentShiftRegularWorker: () => false,
            canStartPostShiftOvertime: (_user, _now, options) => {
                canStartOptions = options;
                return Boolean(options?.allowLateReturn && options?.requireContinuousLive === false);
            },
            getRestorableOvertimeSession: () => null,
            getOpenSession: service.getOpenSession,
            sumCreditedLiveOffPeriods: service.sumCreditedLiveOffPeriods,
            appendAttendanceEvent: service.appendAttendanceEvent,
            transitionRecordedStatus: service.transitionRecordedStatus,
            setFinishedPresence: service.setFinishedPresence,
            handleClockOut: async () => {},
            applyDisconnectedState: () => {},
            recordLog: async () => {},
            getActiveApprovedDayOffReservation: () => null,
            clearStaleDayOffState: () => {},
            applyLiveExceptionState: () => {},
            handleClockIn: async () => false,
            activatePendingManualOvertime: async () => false,
            restoreOvertimeAfterFinish: async () => false,
            notifyDayOffPresence: async () => false,
            notifyAfterFinishPresence: async () => false,
            notifyFinishedReturnToVoice: async () => false,
            notifyStandbyClockInRequired: async () => false,
            sendFinishedLiveOffReminder: async () => false,
            requestPostShiftOvertimeConfirmation: async () => {
                requested = true;
                return { handled: true, changed: true };
            },
            recordLiveConfirmation: async () => false,
            recordLiveRecovery: async () => false,
            markLiveOffState: service.markLiveOffState,
            clearLiveOffState: service.clearLiveOffState,
            applyLiveOnState: service.applyLiveOnCore,
            updateWorkingRole: async () => {},
            canStartOvertimeNow: () => false,
            startAttendanceSession: service.startAttendanceSession,
            appendAdminAudit: async () => {},
            formatDuration: mins => `${mins}m`,
            logger: { warn: () => {}, error: () => {} }
        });

        await breakVoice.applyVoiceSnapshot(breakMember, breakUser, 'night', {
            source: 'unit-test',
            wasConnected: true,
            isConnected: false,
            wasStreaming: true,
            isStreaming: false
        }, at('2026-05-22 09:03'));
        assert.strictEqual(breakUser.postShiftOtInterruptedReason, 'left_voice_after_shift_end', 'leaving after shift end marks post-shift OT interruption');

        await breakVoice.applyVoiceSnapshot(breakMember, breakUser, 'night', {
            source: 'unit-test',
            wasConnected: false,
            isConnected: true,
            wasStreaming: false,
            isStreaming: true
        }, at('2026-05-22 09:08'));

        assert.strictEqual(canStartOptions?.allowLateReturn, true, 'reconnected live after a post-shift break is evaluated as detached OT');
        assert.strictEqual(canStartOptions?.requireContinuousLive, false, 'detached OT does not require continuous live from shift end');
        assert.strictEqual(requested, true, 'reconnected live after a post-shift break requests OT confirmation');
    }

    {
        const personalMember = {
            id: 'finished-personal-live-user',
            displayName: 'Finished Personal Live User',
            user: { bot: false },
            voice: { channelId: 'voice1', streaming: true },
            send: async () => {}
        };
        const personalUser = service.ensureUserData(personalMember, 'night');
        personalUser.checkedIn = false;
        personalUser.isFinished = true;
        personalUser.attendanceStatus = 'FINISHED';
        personalUser.voiceStatus = 'LIVE_OFF';
        personalUser.lastLiveOnAt = at('2026-05-22 08:50').toISOString();
        let canStartOptions = null;
        let requested = false;
        const personalVoice = createVoiceSyncWorkflow({
            client: { guilds: { cache: { get: () => null } } },
            CONFIG,
            moment,
            getAttendanceData: () => state.attendanceData,
            getOvertimeUsers: () => state.overtimeUsers,
            saveSystemAsync: async () => {},
            refreshGuildMembers: async () => true,
            determineShift: () => 'night',
            ensureUserData: () => personalUser,
            getMemberShiftRole: () => 'night',
            getActiveLiveException: () => null,
            getShiftBounds: () => ({ start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') }),
            getScheduledEndMoment: () => at('2026-05-22 09:00'),
            isMaintenanceWindow: () => false,
            isWithinPreShiftWindow: () => false,
            isCurrentShiftRegularWorker: () => false,
            canStartPostShiftOvertime: (_user, _now, options) => {
                canStartOptions = options;
                return Boolean(options?.allowLateReturn && options?.requireContinuousLive === false);
            },
            getRestorableOvertimeSession: () => null,
            getOpenSession: service.getOpenSession,
            sumCreditedLiveOffPeriods: service.sumCreditedLiveOffPeriods,
            appendAttendanceEvent: service.appendAttendanceEvent,
            transitionRecordedStatus: service.transitionRecordedStatus,
            setFinishedPresence: () => false,
            handleClockOut: async () => {},
            applyDisconnectedState: () => {},
            recordLog: async () => {},
            getActiveApprovedDayOffReservation: () => null,
            clearStaleDayOffState: () => {},
            applyLiveExceptionState: () => {},
            handleClockIn: async () => false,
            activatePendingManualOvertime: async () => false,
            restoreOvertimeAfterFinish: async () => false,
            notifyDayOffPresence: async () => false,
            notifyAfterFinishPresence: async () => false,
            notifyFinishedReturnToVoice: async () => false,
            notifyStandbyClockInRequired: async () => false,
            sendFinishedLiveOffReminder: async () => false,
            requestPostShiftOvertimeConfirmation: async () => {
                requested = true;
                return { handled: true, changed: true };
            },
            recordLiveConfirmation: async () => false,
            recordLiveRecovery: async () => false,
            markLiveOffState: service.markLiveOffState,
            clearLiveOffState: service.clearLiveOffState,
            applyLiveOnState: service.applyLiveOnCore,
            updateWorkingRole: async () => {},
            canStartOvertimeNow: () => false,
            startAttendanceSession: service.startAttendanceSession,
            appendAdminAudit: async () => {},
            formatDuration: mins => `${mins}m`,
            logger: { warn: () => {}, error: () => {} }
        });

        await personalVoice.applyVoiceSnapshot(personalMember, personalUser, 'night', {
            source: 'unit-test',
            wasConnected: true,
            isConnected: true,
            wasStreaming: false,
            isStreaming: true
        }, at('2026-05-22 09:07'));

        assert.strictEqual(canStartOptions?.allowLateReturn, true, 'new live-on after finish is considered a detached OT candidate');
        assert.strictEqual(canStartOptions?.requireContinuousLive, false, 'new live-on after finish is not treated as continuous OT');
        assert.strictEqual(requested, true, 'new live-on after finish requests overtime confirmation');
        assert.strictEqual(personalUser.attendanceStatus, 'FINISHED', 'personal live keeps finished status');
    }

    {
        const resumeMember = {
            id: 'auto-timeout-resume-user',
            displayName: 'Auto Timeout Resume User',
            user: { bot: false },
            voice: { channelId: 'voice1', streaming: true },
            send: async () => {}
        };
        const resumeUser = service.ensureUserData(resumeMember, 'night');
        resumeUser.checkedIn = false;
        resumeUser.isFinished = true;
        resumeUser.attendanceStatus = 'FINISHED';
        resumeUser.lastClockOutSource = 'dc-timeout';
        resumeUser.checkOutRaw = at('2026-05-22 02:00').toISOString();
        resumeUser.sessions = [{
            id: 'auto-timeout-session',
            shift: 'night',
            scheduledStartAt: at('2026-05-21 21:00').toISOString(),
            scheduledEndAt: at('2026-05-22 09:00').toISOString(),
            clockInAt: at('2026-05-21 21:08').toISOString(),
            clockOutAt: at('2026-05-22 02:00').toISOString(),
            clockOutSource: 'dc-timeout',
            dcPeriods: [{ startedAt: at('2026-05-22 02:00').toISOString(), endedAt: at('2026-05-22 02:00').toISOString(), minutes: 0 }],
            liveOffPeriods: []
        }];
        resumeUser.activeSessionId = null;
        let resumed = false;
        const resumeVoice = createVoiceSyncWorkflow({
            client: { guilds: { cache: { get: () => null } } },
            CONFIG,
            moment,
            getAttendanceData: () => state.attendanceData,
            getOvertimeUsers: () => state.overtimeUsers,
            saveSystemAsync: async () => {},
            refreshGuildMembers: async () => true,
            determineShift: () => 'night',
            ensureUserData: () => resumeUser,
            getMemberShiftRole: () => 'night',
            getActiveLiveException: () => null,
            getShiftBounds: () => ({ start: at('2026-05-21 21:00'), end: at('2026-05-22 09:00') }),
            getScheduledEndMoment: () => at('2026-05-22 09:00'),
            isMaintenanceWindow: () => false,
            isWithinPreShiftWindow: () => false,
            isCurrentShiftRegularWorker: () => true,
            canStartPostShiftOvertime: () => false,
            getRestorableOvertimeSession: () => null,
            getOpenSession: service.getOpenSession,
            sumCreditedLiveOffPeriods: service.sumCreditedLiveOffPeriods,
            appendAttendanceEvent: service.appendAttendanceEvent,
            transitionRecordedStatus: service.transitionRecordedStatus,
            setFinishedPresence: () => false,
            handleClockOut: async () => {},
            applyDisconnectedState: () => {},
            recordLog: async () => {},
            getActiveApprovedDayOffReservation: () => null,
            clearStaleDayOffState: () => {},
            applyLiveExceptionState: () => {},
            handleClockIn: async () => {
                throw new Error('handleClockIn must not be used for auto-timeout resume');
            },
            activatePendingManualOvertime: async () => false,
            restoreOvertimeAfterFinish: async () => false,
            resumeAutoTimeoutShift: async () => {
                resumed = true;
                return true;
            },
            notifyDayOffPresence: async () => false,
            notifyAfterFinishPresence: async () => false,
            notifyFinishedReturnToVoice: async () => false,
            notifyStandbyClockInRequired: async () => false,
            sendFinishedLiveOffReminder: async () => false,
            startPostShiftOvertime: async () => false,
            recordLiveConfirmation: async () => false,
            recordLiveRecovery: async () => false,
            markLiveOffState: service.markLiveOffState,
            clearLiveOffState: service.clearLiveOffState,
            applyLiveOnState: service.applyLiveOnCore,
            updateWorkingRole: async () => {},
            canStartOvertimeNow: () => false,
            startAttendanceSession: service.startAttendanceSession,
            appendAdminAudit: async () => {},
            formatDuration: mins => `${mins}m`,
            logger: { warn: () => {}, error: () => {} }
        });

        const changed = await resumeVoice.applyVoiceSnapshot(resumeMember, resumeUser, 'night', {
            source: 'unit-test',
            wasConnected: true,
            isConnected: true,
            wasStreaming: false,
            isStreaming: true
        }, at('2026-05-22 03:20'));

        assert.strictEqual(changed, true, 'voice resume reports handled');
        assert.strictEqual(resumed, true, 'voice workflow resumes auto-timeout session before clock-in');
    }

    {
        const maintenanceMember = {
            id: 'maintenance-pre-shift-voice',
            displayName: 'Maintenance Pre Shift Voice',
            user: { bot: false },
            voice: { channelId: 'voice1', streaming: false },
            send: async () => {}
        };
        const maintenanceUser = service.ensureUserData(maintenanceMember, 'day');
        let clockInCalled = false;
        const maintenanceVoice = createVoiceSyncWorkflow({
            client: { guilds: { cache: { get: () => null } } },
            CONFIG,
            moment,
            getAttendanceData: () => state.attendanceData,
            getOvertimeUsers: () => state.overtimeUsers,
            saveSystemAsync: async () => {},
            refreshGuildMembers: async () => true,
            determineShift: () => 'day',
            ensureUserData: () => maintenanceUser,
            getMemberShiftRole: () => 'day',
            getActiveLiveException: () => null,
            getShiftBounds: () => ({ start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') }),
            getScheduledEndMoment: () => at('2026-05-20 21:00'),
            isMaintenanceWindow: () => true,
            getMaintenanceHandoffWindow: () => ({
                previousShift: 'night',
                targetShift: 'day',
                previousShiftEndAt: at('2026-05-20 04:00'),
                maintenanceStartAt: at('2026-05-20 04:00'),
                maintenanceEndAt: at('2026-05-20 09:00'),
                targetShiftStartAt: at('2026-05-20 09:00'),
                standbyStartAt: at('2026-05-20 04:00'),
                standbyEndAt: at('2026-05-20 09:00'),
                isDirectHandoff: true
            }),
            isWithinPreShiftWindow: () => false,
            isCurrentShiftRegularWorker: () => false,
            canStartPostShiftOvertime: () => false,
            getRestorableOvertimeSession: () => null,
            getOpenSession: service.getOpenSession,
            sumCreditedLiveOffPeriods: service.sumCreditedLiveOffPeriods,
            appendAttendanceEvent: service.appendAttendanceEvent,
            transitionRecordedStatus: service.transitionRecordedStatus,
            setFinishedPresence: () => false,
            handleClockOut: async () => {},
            applyDisconnectedState: () => {},
            recordLog: async () => {},
            getActiveApprovedDayOffReservation: () => null,
            clearStaleDayOffState: () => {},
            applyLiveExceptionState: () => {},
            handleClockIn: async () => {
                clockInCalled = true;
                return false;
            },
            activatePendingManualOvertime: async () => false,
            restoreOvertimeAfterFinish: async () => false,
            notifyDayOffPresence: async () => false,
            notifyAfterFinishPresence: async () => false,
            notifyFinishedReturnToVoice: async () => false,
            notifyStandbyClockInRequired: async () => false,
            sendFinishedLiveOffReminder: async () => false,
            startPostShiftOvertime: async () => false,
            recordLiveConfirmation: async () => false,
            recordLiveRecovery: async () => false,
            markLiveOffState: service.markLiveOffState,
            clearLiveOffState: service.clearLiveOffState,
            applyLiveOnState: service.applyLiveOnCore,
            updateWorkingRole: async () => {},
            canStartOvertimeNow: () => false,
            startAttendanceSession: service.startAttendanceSession,
            appendAdminAudit: async () => {},
            formatDuration: mins => `${mins}m`,
            logger: { warn: () => {}, error: () => {} }
        });

        const changed = await maintenanceVoice.applyVoiceSnapshot(maintenanceMember, maintenanceUser, 'day', {
            source: 'unit-test',
            wasConnected: false,
            isConnected: true,
            wasStreaming: false,
            isStreaming: false
        }, at('2026-05-20 04:00'));

        assert.strictEqual(changed, true, 'maintenance voice standby records state');
        assert.strictEqual(clockInCalled, false, 'maintenance standby does not clock in before shift start');
        assert.strictEqual(maintenanceUser.preShiftVoiceAt, at('2026-05-20 04:00').toISOString(), 'maintenance standby records pre-shift voice time');
        assert.strictEqual(maintenanceUser.preShiftVoiceMode, 'maintenance', 'maintenance standby records separate mode');
        assert.strictEqual(maintenanceUser.preShiftVoiceWindowStartAt, at('2026-05-20 04:00').toISOString(), 'maintenance standby records exact window start');
        assert.strictEqual(maintenanceUser.preShiftVoiceWindowEndAt, at('2026-05-20 09:00').toISOString(), 'maintenance standby records exact window end');
    }

    console.log('voice-live-off-policy tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
