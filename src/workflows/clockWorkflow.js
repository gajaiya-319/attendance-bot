'use strict';

const {
    buildDayOffClockInPromptMessage,
    buildDayOffPresenceDm,
    buildDayOffPresenceLogLines,
    buildAfterFinishPresenceDm,
    buildFinishedReturnWithinShiftDm,
    buildFinishedReturnDefaultDm,
    buildStandbyClockInRequiredDm
} = require('../utils/attendanceDmMessages');

function createClockWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        attendanceService,
        roleService,
        rawAttendanceSheetService,
        dashboardStateUtils,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        saveSystemAsync,
        updateWorkingRole,
        ensureUserData,
        getActiveLiveException,
        getOperationalShift,
        getDashboardShift,
        getShiftBounds,
        getShiftSessionKey,
        getRecognizedClockInMoment,
        isWithinPreShiftWindow,
        getTimeLogicRecentMaintenanceEnd,
        formatDuration,
        RAW_ATTENDANCE_STATUS,
        mapRawClockInStatus,
        mapRawClockOutStatus,
        logger = console
    } = deps;

function expireDayOffSessions(now = moment().tz(CONFIG.TIMEZONE)) {
    let changed = false;
    for (const user of Object.values(getAttendanceData())) {
        if (!user?.dayOff || !user.dayOffExpireAt) continue;
        if (now.isBefore(moment(user.dayOffExpireAt).tz(CONFIG.TIMEZONE))) continue;
        expireDayOffState(user, now, 'day-off-expiry', 'day-off-expired');
        changed = true;
    }
    return changed;
}

function getMemberShiftRole(member) {
    if (!member?.roles?.cache) return null;
    const hasD = member.roles.cache.has(CONFIG.ROLES.DAY);
    const hasN = member.roles.cache.has(CONFIG.ROLES.NIGHT);
    if (!hasD && !hasN) return null;
    if (hasD && hasN) return getOperationalShift() || getDashboardShift();
    return hasD ? 'day' : 'night';
}

function getRecentMaintenanceEnd(now = moment().tz(CONFIG.TIMEZONE), graceMins = CONFIG.FINISHED_VISIBLE_AFTER_MINS) {
    return getTimeLogicRecentMaintenanceEnd(now, graceMins);
}

function shouldShowPostMaintenanceFinished(member, user, activeShift, now = moment().tz(CONFIG.TIMEZONE)) {
    return dashboardStateUtils.shouldShowPostMaintenanceFinished(member, user, activeShift, now);
}

function shouldShowAsPreShiftStandby(member, user, now) {
    return dashboardStateUtils.shouldShowAsPreShiftStandby(member, user, now);
}

function ensureSessionStore(user) {
    return attendanceService.ensureSessionStore(user);
}

function appendAttendanceEvent(user, type, at, source = 'system', meta = {}) {
    return attendanceService.appendAttendanceEvent(user, type, at, source, meta);
}

function transitionRecordedStatus(user, next = {}, now = moment().tz(CONFIG.TIMEZONE), source = 'system', reason = null) {
    return attendanceService.transitionRecordedStatus(user, next, now, source, reason);
}

function getOpenSession(user) {
    return attendanceService.getOpenSession(user);
}

function getRelevantSessionForTime(user, at) {
    return attendanceService.getRelevantSessionForTime(user, at);
}

function getScheduledEndMoment(user, fallbackAt = moment().tz(CONFIG.TIMEZONE), options = {}) {
    return attendanceService.getScheduledEndMoment(user, fallbackAt, options);
}

function normalizeOpenSessions(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.normalizeOpenSessions(user, now);
}

function startAttendanceSession(user, shift, now, source = 'unknown') {
    return attendanceService.startAttendanceSession(user, shift, now, source);
}

function finishAttendanceSession(user, outMoment, source = 'unknown', reason = null, detectedAt = null) {
    return attendanceService.finishAttendanceSession(user, outMoment, source, reason, detectedAt);
}

function applyFinishedState(user, now, source = 'state-finish', reason = 'finished-state-applied') {
    return attendanceService.applyFinishedStateCore(user, now, source, reason);
}

function startSessionPeriod(periods, startedAt, reason = null) {
    return attendanceService.startSessionPeriod(periods, startedAt, reason);
}

function closeOpenSessionPeriod(periods, endedAt) {
    return attendanceService.closeOpenSessionPeriod(periods, endedAt);
}

function sumSessionPeriods(periods, fallbackEnd) {
    return attendanceService.sumSessionPeriods(periods, fallbackEnd);
}

function calculateSessionWorkedMinutes(session, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.calculateSessionWorkedMinutes(session, now);
}

function getUserLatestSessionSummary(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.getUserLatestSessionSummary(user, now);
}

function createPendingClockOut(user, source, at, graceMins, reason = null) {
    return attendanceService.createPendingClockOut(user, source, at, graceMins, reason);
}

function recoverPendingClockOut(user, recoveredAt, reason = 'recovered') {
    return attendanceService.recoverPendingClockOut(user, recoveredAt, reason);
}

function getClockOutStatus(user, outMoment) {
    const scheduledEnd = getScheduledEndMoment(user, outMoment);
    const earlyMins = scheduledEnd
        ? scheduledEnd.diff(moment(outMoment).tz(CONFIG.TIMEZONE), 'minutes')
        : 0;
    return {
        earlyMins,
        isEarly: earlyMins > CONFIG.CLOCK_OUT_GRACE_MINS,
        isNormal: earlyMins <= CONFIG.CLOCK_OUT_GRACE_MINS
    };
}

function setFinishedPresence(user, nextPresence, now, source = 'system') {
    if (!user || !['in_voice', 'left_voice'].includes(nextPresence)) return false;
    const at = moment(now).tz(CONFIG.TIMEZONE);
    if (user.finishedPresence === nextPresence) return false;
    const previous = user.finishedPresence || null;
    user.finishedPresence = nextPresence;
    if (nextPresence === 'left_voice') {
        user.finalLeftAt = at.toISOString();
    } else {
        user.finalLeftAt = null;
    }
    appendAttendanceEvent(user, 'finished_presence_changed', at, source, {
        from: previous,
        to: nextPresence
    });
    return true;
}

function getOvertimeStartMoment(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.getOvertimeStartMoment(user, now);
}

function canStartOvertimeNow(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.canStartOvertimeNow(user, now);
}

function canStartPreShiftOvertime(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.canStartPreShiftOvertime(user, now);
}

function canStartPostShiftOvertime(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.canStartPostShiftOvertime(user, now);
}

async function startPreShiftOvertime(member, user, shift, now, source = 'button-or-command') {
    const result = attendanceService.applyPreShiftOvertimeCore(member, user, shift, now, source);
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    await recordLog(user, 'ot', `사전 OT 시작 (정규 출근 ${result.shiftStart.format('hh:mm A')} 전)`);
    return true;
}

async function startPostShiftOvertime(member, user, now, source = 'voice_snapshot') {
    const overtimeStart = getOvertimeStartMoment(user, now) || now;
    const result = applyOvertimeState(user, now, 'AUTO', source, 'post-shift-live-auto-ot-started', {
        startedAt: overtimeStart,
        voiceStatus: 'LIVE_ON',
        sessionSource: 'post-shift-auto-ot'
    });
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    if (result.added) {
        await recordLog(user, 'ot', `교대 후 라이브 유지 자동 OT 감지 (${formatDuration(Math.max(0, now.diff(overtimeStart, 'minutes')))})`);
    }
    return true;
}

function isOvertimeEntryStillValid(ot, user, member, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!ot || !user || !member) return false;
    if (user.dayOff || user.isFinished) return false;
    if (!user.checkedIn && ot.type !== 'PRE_OT') return false;
    if (ot.type === 'FORCED') return true;

    const activeException = getActiveLiveException(ot.id, now);
    const voiceState = member.guild?.voiceStates?.cache?.get(ot.id);
    const isStreaming = Boolean(member.voice?.streaming || voiceState?.streaming);
    const isConnected = Boolean(member.voice?.channelId || voiceState?.channelId);
    const isDisconnectedInGrace = Boolean(
        user.disconnected &&
        user.pendingClockOut?.source === 'voice_leave' &&
        user.pendingClockOut.expiresAt &&
        now.isBefore(moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE))
    );
    const isLiveOffInGrace = Boolean(
        user.voiceStatus === 'LIVE_OFF' &&
        user.pendingClockOut?.source === 'live_off' &&
        user.pendingClockOut.expiresAt &&
        now.isBefore(moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE))
    );

    if (ot.type === 'PRE_OT') return Boolean(isStreaming || activeException || (isConnected && isLiveOffInGrace) || isDisconnectedInGrace);
    return Boolean(isStreaming || activeException || (isConnected && isLiveOffInGrace) || isDisconnectedInGrace);
}

function isFinishedBeforeCurrentShift(user, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!user?.isFinished || user.checkedIn || !shift) return false;
    const finishedAt = user.checkOutRaw || user.attendanceStatusChangedAt;
    if (!finishedAt) return false;
    const bounds = getShiftBounds(shift, now);
    return Boolean(bounds?.start && moment(finishedAt).tz(CONFIG.TIMEZONE).isBefore(bounds.start));
}

function isCurrentShiftRegularWorker(member, now = moment().tz(CONFIG.TIMEZONE), trackedShift = null) {
    if (!member?.roles?.cache) return false;
    const activeShift = getOperationalShift(now);
    if (!activeShift) return false;
    if (trackedShift && trackedShift !== activeShift) return false;
    const roleId = activeShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
    if (!member.roles.cache.has(roleId)) return false;
    const bounds = getShiftBounds(activeShift, now);
    return Boolean(bounds && now.isSameOrAfter(bounds.start) && now.isBefore(bounds.end));
}

function getLatestOvertimeSession(user) {
    return attendanceService.getLatestOvertimeSession(user);
}

function getRestorableOvertimeSession(user, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.getRestorableOvertimeSession(user, shift, now);
}

async function restoreOvertimeAfterFinish(member, user, shift, now, source = 'voice_snapshot') {
    if (isCurrentShiftRegularWorker(member, now)) return false;
    const result = attendanceService.applyRestoreOvertimeAfterFinishCore(user, shift, now, source);
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    await recordLog(user, 'ot', 'Overtime restored after bot restart / finished state recovery');
    return true;
}

async function activatePendingManualOvertime(user, now) {
    const result = attendanceService.applyPendingManualOvertimeCore(user, now);
    if (!result.ok) return false;
    const member = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(user.id);
    if (member) await updateWorkingRole(member, true);
    await recordLog(user, 'ot', '수동 연장 근무 시작');
    return true;
}

function markLiveOffState(user, now) {
    return attendanceService.markLiveOffState(user, now);
}

function clearLiveOffState(user, now) {
    return attendanceService.clearLiveOffState(user, now);
}

async function recordLiveConfirmation(member, user, shift, now, text = '라이브 방송 확인 (출근 상태 동기화)') {
    if (!member || !user || !shift) return false;
    const key = getShiftSessionKey(shift, now);
    if (user.lastLiveLogKey === key) return false;
    user.lastLiveLogKey = key;
    await recordLog(user, 'reconnect', text);
    return true;
}

async function recordLiveRecovery(member, user, shift, now, startedAt, text) {
    if (!member || !user || !shift) return false;
    const started = startedAt ? moment(startedAt).tz(CONFIG.TIMEZONE) : moment(now).tz(CONFIG.TIMEZONE);
    const key = `${getShiftSessionKey(shift, now)}:${started.format('YYYY-MM-DD HH:mm')}`;
    if (user.lastLiveRecoveryLogKey === key) return false;
    user.lastLiveRecoveryLogKey = key;
    await recordLog(user, 'reconnect', text);
    return true;
}

async function sendDayOffClockInPromptIfDue(member, user, shift, now) {
    if (!member || !user || !shift) return false;
    const sessionKey = getShiftSessionKey(shift, now);
    if (user.dayOffClockInPromptSessionKey !== sessionKey) {
        user.dayOffClockInPromptSessionKey = sessionKey;
        user.dayOffClockInPromptStartedAt = now.toISOString();
        user.dayOffClockInPromptMarks = [];
    }

    if (!Array.isArray(user.dayOffClockInPromptMarks)) user.dayOffClockInPromptMarks = [];

    const startedAt = user.dayOffClockInPromptStartedAt
        ? moment(user.dayOffClockInPromptStartedAt).tz(CONFIG.TIMEZONE)
        : now;
    const elapsedMins = Math.max(0, now.diff(startedAt, 'minutes'));
    const dueMark = elapsedMins >= 10 ? 10 : 0;
    if (![0, 10].includes(dueMark) || user.dayOffClockInPromptMarks.includes(dueMark)) return false;

    const reminderNumber = dueMark === 0 ? 1 : 2;
    await member.send(buildDayOffClockInPromptMessage(reminderNumber, dueMark)).catch(() => null);
    user.dayOffClockInPromptMarks.push(dueMark);
    appendAttendanceEvent(user, 'dayoff_clockin_prompt_sent', now, 'voice_snapshot', {
        reminderNumber,
        reminderMark: dueMark,
        result: 'dm_attempted'
    });
    return true;
}

async function notifyDayOffPresence(member, user, shift, now, action = 'LIVE ON', isStreaming = false) {
    if (!member || !user || !shift) return false;
    const key = `${getShiftSessionKey(shift, now)}:${action}`;
    appendAttendanceEvent(user, 'dayoff_presence_detected', now, 'voice_snapshot', {
        action,
        result: 'day_off_kept'
    });
    if (user.dayOffPresenceNotifiedFor === key) {
        return isStreaming ? await sendDayOffClockInPromptIfDue(member, user, shift, now) : false;
    }
    user.dayOffPresenceNotifiedFor = key;

    const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) {
        await logChan.send(buildDayOffPresenceLogLines(
            now.format('MM/DD HH:mm'),
            user.name || member.displayName || '알 수 없음',
            action
        ).join('\n')).catch(() => null);
    }

    if (isStreaming) {
        await sendDayOffClockInPromptIfDue(member, user, shift, now);
    } else {
        await member.send(buildDayOffPresenceDm()).catch(() => null);
    }
    return true;
}

async function notifyAfterFinishPresence(member, user, shift, now, action = 'LIVE ON after clock-out') {
    if (!member || !user || !shift) return false;
    const key = `${getShiftSessionKey(shift, now)}:${action}`;
    appendAttendanceEvent(user, 'after_finish_presence_detected', now, 'voice_snapshot', {
        action,
        result: 'finished_kept'
    });
    if (user.afterFinishPresenceNotifiedFor === key) return false;
    user.afterFinishPresenceNotifiedFor = key;

    await recordLog(user, 'reconnect', `퇴근 후 라이브 감지 (FINISHED 유지, 자동 출근 안 함)`);
    await member.send(buildAfterFinishPresenceDm()).catch(() => null);
    return true;
}

async function notifyFinishedReturnToVoice(member, user, shift, now, action = 'Returned to voice after clock-out') {
    if (!member || !user || !shift) return false;
    const clockOutKey = user.checkOutRaw || user.lastClockOutDetectedAt || getShiftSessionKey(shift, now);
    const key = `${clockOutKey}:${action}`;
    const bounds = getShiftBounds(shift, now);
    const isWithinShift = Boolean(bounds?.start && bounds?.end && now.isSameOrAfter(bounds.start) && now.isBefore(bounds.end));
    const wasVoiceLeaveFinish = ['dc-timeout', 'auto-out-after-shift'].includes(user.lastClockOutSource);
    appendAttendanceEvent(user, 'finished_return_to_voice_detected', now, 'voice_snapshot', {
        action,
        result: 'finished_kept',
        withinShift: isWithinShift,
        previousClockOutSource: user.lastClockOutSource || null
    });
    if (user.lastFinishedReturnPromptKey === key) return false;
    user.lastFinishedReturnPromptKey = key;

    const lines = isWithinShift && wasVoiceLeaveFinish
        ? buildFinishedReturnWithinShiftDm()
        : buildFinishedReturnDefaultDm();

    await member.send(lines).catch(() => null);
    return true;
}

async function notifyStandbyClockInRequired(member, user, shift, now, action = 'Standby voice presence') {
    if (!member || !user || !shift) return false;
    const key = `${getShiftSessionKey(shift, now)}:${action}`;
    if (user.standbyClockInPromptKey === key) return false;
    user.standbyClockInPromptKey = key;
    appendAttendanceEvent(user, 'standby_clockin_required', now, 'voice_snapshot', {
        action,
        result: 'standby_kept'
    });
    await member.send(buildStandbyClockInRequiredDm()).catch(() => null);
    await recordLog(user, 'reconnect', '대기중 음성채널 접속 감지 - 라이브 ON 후 CLOCK IN 버튼 필요');
    return true;
}

async function normalizeCurrentShiftSession(member, user, shift, now) {
    const result = attendanceService.normalizeCurrentShiftSessionCore(member, user, shift, now);
    if (!result.changed) return false;
    if (result.action === 'working-role-off') {
        await updateWorkingRole(member, false);
        return true;
    }
    if (result.action === 'working-role-on') {
        await updateWorkingRole(member, true);
        return true;
    }
    if (result.action === 'clock-in') {
        await handleClockIn(member, user, shift, now, true);
    }
    return true;
}

async function recordLog(user, actionType, customText = null, earlyOverrideTime = null, options = {}) {
    if (!user) return;
    const now = moment().tz(CONFIG.TIMEZONE);
    const eventTime = options.effectiveTime ? moment(options.effectiveTime).tz(CONFIG.TIMEZONE) : now;
    const shiftIcon = CONFIG.EXCEPTIONS.SHARED_SEAT_USER && user.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER
        ? '👑'
        : (user.shift === 'day' ? '☀️' : '🌙');
    let aIcon = '🔵';
    let defaultText = '업무 기록';

    if (actionType === 'in') {
        if (user.status === 'absent') {
            aIcon = '⚠️';
            defaultText = '초과 시간 지각 (출근)';
        } else if (user.status === 'late') {
            aIcon = '🟠';
            defaultText = '지각 출근';
        } else {
            aIcon = '🟢';
            defaultText = '정상 출근';
        }
    } else if (actionType === 'out') {
        aIcon = '🔴';
        defaultText = '퇴근';
    } else if (actionType === 'ot') {
        aIcon = '🔥';
        defaultText = '연장 시작';
    } else if (actionType === 'disconnect') {
        aIcon = '⚡';
        defaultText = `DC (${CONFIG.GRACE_PERIOD_MINS}분 접속 유예 시작)`;
    } else if (actionType === 'reconnect') {
        aIcon = '🔗';
        defaultText = 'DC 복구';
    }

    if (options.forceIcon) aIcon = options.forceIcon;

    let baseTxt = customText || defaultText;

    if (actionType === 'out' && !user.dayOff && !options.skipEarlyPenalty) {
        const clockStatus = getClockOutStatus(user, earlyOverrideTime || now);
        const earlyMins = clockStatus.earlyMins;
        if (clockStatus.isEarly) {
            if (baseTxt.includes('조기 퇴근') || baseTxt.includes('조기퇴근')) {
                baseTxt = baseTxt + ' (' + formatDuration(earlyMins) + ' 남음)';
            } else {
                baseTxt = baseTxt + ' (⚠️ 조기퇴근 ' + formatDuration(earlyMins) + ' 전)';
            }
            user.totalEarly = (user.totalEarly || 0) + 1;
            user.points = (user.points || 0) + CONFIG.POINTS.EARLY_OUT;
            if (options.reversibleEarlyPenaltyKey) {
                user.reversibleEarlyPenaltyKey = options.reversibleEarlyPenaltyKey;
                user.reversibleEarlyPenaltyAppliedAt = eventTime.toISOString();
                user.reversibleEarlyPenaltyPoints = Math.abs(CONFIG.POINTS.EARLY_OUT);
            }
        }
    }

    if (actionType === 'out' && user.checkInRaw && !baseTxt.includes('[근무:')) {
        const workedMins = Math.max(0, eventTime.diff(moment(user.checkInRaw).tz(CONFIG.TIMEZONE), 'minutes'));
        baseTxt = baseTxt + ' [근무: ' + formatDuration(workedMins) + ']';
    }

    // 라이브 및 방송 관련 자동 감지하여 카메라 아이콘 🎥 조합 추가
    const isLiveAction = options.isLive || (baseTxt && (
        baseTxt.includes('라이브') || 
        baseTxt.includes('방송') || 
        baseTxt.includes('자동 출근') || 
        baseTxt.includes('자동 퇴근')
    ));

    if (isLiveAction) {
        aIcon += '🎥';
    }

    const logChan = client.channels.cache.get(CONFIG.LOG_CHANNEL) ||
        await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) {
        const timestamp = eventTime.format('MM/DD HH:mm');
        await logChan.send(`\`[${timestamp}]\` ${shiftIcon} 👤 **${user.name}** → ${aIcon} ${baseTxt}`)
            .catch(e => console.error('[LOG SEND ERROR]', e));
    }

    if (actionType === 'off') {
        await sendRawAttendanceSheetEvent({
            member: null,
            user,
            shift: user.shift,
            status: RAW_ATTENDANCE_STATUS.DAY_OFF,
            eventTime,
            inTime: '-',
            outTime: '-',
            note: customText || '휴무'
        });
    } else if (actionType === 'reconnect' && String(baseTxt || '').includes('복구')) {
        await sendRawAttendanceSheetEvent({
            member: null,
            user,
            shift: user.shift,
            status: mapClockInStatus(user.status),
            eventTime,
            inTime: user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : '-',
            outTime: '-',
            note: baseTxt,
            forceStatus: true
        });
    } else if (actionType === 'ot' && shouldSyncOvertimeRawAttendance(baseTxt)) {
        await sendRawAttendanceSheetEvent({
            member: null,
            user,
            shift: user.shift,
            status: RAW_ATTENDANCE_STATUS.OVERTIME,
            eventTime,
            inTime: user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : eventTime.format('HH:mm'),
            outTime: '-',
            note: buildOvertimeRawAttendanceNote(baseTxt, eventTime)
        });
    }
}

function getAttendanceSheetProfile(member, user, shift) {
    const memberProfile = roleService.getWorkerRoleProfileFromMember(member);
    const nicknameProfile = roleService.getWorkerRoleProfileFromNickname(member?.displayName || user?.name);
    const profile = memberProfile || nicknameProfile || {};
    return {
        server: profile.server || null,
        shift: profile.shift || (shift ? String(shift).toUpperCase() : null)
    };
}

function getSessionWorkDate(user, session, fallbackAt) {
    const source = session?.scheduledStartAt || session?.clockInAt || user?.checkInRaw || fallbackAt;
    if (!session && !user?.checkInRaw && ['day', 'night'].includes(user?.shift)) {
        return getShiftBounds(user.shift, moment(fallbackAt).tz(CONFIG.TIMEZONE)).start.format('YYYY-MM-DD');
    }
    return moment(source).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD');
}

function mapClockInStatus(status) {
    return mapRawClockInStatus(status);
}

function mapClockOutStatus(user, outMoment, session) {
    return mapRawClockOutStatus({ user, outMoment, session, moment });
}

function shouldSyncOvertimeRawAttendance(note) {
    const text = String(note || '');
    if (text.includes('예약 대기') || text.includes('예약 등록')) return false;
    return (
        text.includes('시작') ||
        text.includes('감지') ||
        text.includes('강제') ||
        text.toLowerCase().includes('restored')
    );
}

function buildClockInRawAttendanceNote(user, result, isAuto, detectedAt) {
    const recognizedAt = moment(result.recognizedAt).tz(CONFIG.TIMEZONE);
    const detectedMoment = moment(detectedAt).tz(CONFIG.TIMEZONE);
    if (user?.status === 'absent') {
        return `무단결근 유예시간 초과 후 출근 ${recognizedAt.format('HH:mm')}`;
    }
    if (result.preShift) {
        return `사전 출근 대기 / 인정 출근 ${recognizedAt.format('HH:mm')} / 실제 감지 ${detectedMoment.format('HH:mm')}`;
    }
    return `${isAuto ? '자동 출근' : '출근'} ${recognizedAt.format('HH:mm')}`;
}

function buildClockOutRawAttendanceNote(user, outMoment, customLogText = null, options = {}, session = null) {
    const outAt = moment(outMoment).tz(CONFIG.TIMEZONE);
    if (session?.otStartedAt || session?.otType) {
        const startedAt = moment(session.otStartedAt || session.scheduledEndAt || session.clockInAt).tz(CONFIG.TIMEZONE);
        const totalMins = startedAt.isValid() ? Math.max(0, outAt.diff(startedAt, 'minutes')) : 0;
        return `오버타임 시작 ${startedAt.format('HH:mm')} / 종료 ${outAt.format('HH:mm')} / 총 ${formatDuration(totalMins)}`;
    }
    const clockStatus = getClockOutStatus(user, outAt);
    if (!user?.dayOff && !options.skipEarlyPenalty && clockStatus.isEarly) {
        return `조기퇴근 ${outAt.format('HH:mm')} (${formatDuration(clockStatus.earlyMins)} 남음)`;
    }
    return customLogText || options.clockOutSource || `퇴근 ${outAt.format('HH:mm')}`;
}

function buildOvertimeRawAttendanceNote(note, eventTime) {
    const at = moment(eventTime).tz(CONFIG.TIMEZONE).format('HH:mm');
    const text = String(note || '').trim();
    if (text.includes('오버타임 시작') || text.includes('연장 시작')) {
        return text.includes(at) ? text : `${text} ${at}`;
    }
    return `오버타임 시작 ${at}${text && text !== '-' ? ' / ' + text : ''}`;
}

async function sendRawAttendanceSheetEvent({ member, user, shift, status, eventTime, inTime = '-', outTime = '-', note = '-', session = null, forceStatus = false }) {
    const profile = getAttendanceSheetProfile(member, user, shift);
    if (!profile.server || !profile.shift) {
        console.warn('[RAW ATTENDANCE SHEET SKIP] Missing server/shift profile', {
            userId: user?.id || member?.id,
            name: user?.name || member?.displayName
        });
        return { ok: false, skipped: true, reason: 'missing-profile' };
    }

    return rawAttendanceSheetService.sendAttendanceRow({
        date: getSessionWorkDate(user, session, eventTime),
        server: profile.server,
        shift: profile.shift,
        name: user?.name || member?.displayName || member?.user?.username || 'Unknown',
        status,
        inTime,
        outTime,
        note,
        forceStatus
    });
}

async function handleClockIn(member, user, shift, now, isAuto = false) {
    const u = ensureUserData(member, shift) || user;
    const clockInRule = getRecognizedClockInMoment(shift, now);
    const result = attendanceService.applyClockInCore(u, member, shift, now, clockInRule, isAuto);
    if (!result.ok) {
        if (result.shouldLogPreShiftWait) {
            await recordLog(u, 'reconnect', `사전 대기 감지 (${result.preShiftStart.format('HH:mm')} 출근 시작 전)`);
        }
        return false;
    }

    await updateWorkingRole(member, true);
    if (isAuto) {
        u.lastLiveLogKey = getShiftSessionKey(shift, result.recognizedAt);
        const statusText = u.status === 'late' ? '지각' : (u.status === 'absent' ? '초과 시간 지각' : '정상');
        const preText = result.preShift ? `사전 라이브 대기 ${now.format('HH:mm')} / 인정 출근 ${result.recognizedAt.format('HH:mm')}` : `디스코드 자동 출근 (${statusText})`;
        await recordLog(u, 'in', preText, null, { effectiveTime: result.recognizedAt });
    } else {
        await recordLog(u, 'in', result.preShift ? `사전 출근 대기 / 인정 출근 ${result.recognizedAt.format('HH:mm')}` : null, null, { effectiveTime: result.recognizedAt });
    }
    await sendRawAttendanceSheetEvent({
        member,
        user: u,
        shift,
        status: mapClockInStatus(u.status),
        eventTime: result.recognizedAt,
        inTime: result.recognizedAt.format('HH:mm'),
        outTime: '-',
        note: buildClockInRawAttendanceNote(u, result, isAuto, now),
        session: result.session,
        forceStatus: u.status === 'absent'
    });
    return true;
}

async function handleClockOut(member, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
    const result = attendanceService.applyClockOutCore(member, user, now, customLogText, earlyOverrideTime, options);
    if (!result.ok) return;
    await updateWorkingRole(member, false);
    await recordLog(user, 'out', customLogText, result.recordLogTime, result.recordLogOptions);
    await sendRawAttendanceSheetEvent({
        member,
        user,
        shift: user.shift,
        status: mapClockOutStatus(user, result.outMoment, result.session),
        eventTime: result.outMoment,
        inTime: user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : '-',
        outTime: result.outMoment.format('HH:mm'),
        note: buildClockOutRawAttendanceNote(user, result.outMoment, customLogText, result.recordLogOptions, result.session),
        session: result.session
    });
}

async function handleClockOutWithoutMember(memberId, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
    const result = attendanceService.applyClockOutCore(memberId, user, now, customLogText, earlyOverrideTime, options);
    if (!result.ok) return false;
    await recordLog(user, 'out', customLogText, result.recordLogTime, result.recordLogOptions);
    await sendRawAttendanceSheetEvent({
        member: null,
        user,
        shift: user.shift,
        status: mapClockOutStatus(user, result.outMoment, result.session),
        eventTime: result.outMoment,
        inTime: user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : '-',
        outTime: result.outMoment.format('HH:mm'),
        note: buildClockOutRawAttendanceNote(user, result.outMoment, customLogText, result.recordLogOptions, result.session),
        session: result.session
    });
    return true;
}

function applyDayOffState(user, now, source = 'day-off', reason = 'day-off-applied') {
    return attendanceService.applyDayOffCore(user, now, source, reason).ok;
}

function applyLiveExceptionState(user, shift, now, source = 'live-exception', reason = 'live-exception-applied', options = {}) {
    return attendanceService.applyLiveExceptionCore(user, shift, now, source, reason, options);
}

function clearStaleDayOffState(user, shift, now, source = 'voice_snapshot', reason = 'stale-dayoff-cleared') {
    return attendanceService.clearStaleDayOffCore(user, shift, now, source, reason);
}

function clearDayOffReservationState(user, now, source = 'day-off-reservation', reason = 'day-off-reservation-cleared') {
    return attendanceService.clearDayOffReservationStateCore(user, now, source, reason);
}

function applyManualResumeRequiredState(user, now, source = 'button-or-command', reason = 'manual-resume-live-required', options = {}) {
    return attendanceService.applyManualResumeRequiredCore(user, now, source, reason, options);
}

function applyPendingOvertimeReservationState(user, now, source = 'button-or-command', reason = 'manual-ot-reserved', options = {}) {
    return attendanceService.applyPendingOvertimeReservationCore(user, now, source, reason, options);
}

function expireDayOffState(user, now, source = 'day-off-expiry', reason = 'day-off-expired') {
    return attendanceService.expireDayOffStateCore(user, now, source, reason);
}

function resetFinishedForPreClockIn(user, now, source = 'button-or-command', reason = 'clock-in-retry-before-live', options = {}) {
    return attendanceService.resetFinishedForPreClockInCore(user, now, source, reason, options);
}

function applyCurrentShiftLiveOnState(user, shift, now, source = 'dashboard-overtime-cleanup', reason = 'current-shift-live-on') {
    return attendanceService.applyCurrentShiftLiveOnCore(user, shift, now, source, reason);
}

function applySmartResetState(user, now, source = 'smart-reset', reason = 'smart-reset') {
    return attendanceService.applySmartResetCore(user, now, source, reason);
}

function applyOvertimeState(user, now, type = 'AUTO', source = 'overtime', reason = 'overtime-started', options = {}) {
    return attendanceService.applyOvertimeCore(user, now, type, source, reason, options);
}

function applyDisconnectedState(user, now, source = 'voice-state', options = {}) {
    return attendanceService.applyDisconnectedCore(user, now, source, options);
}

function applyLiveOnState(user, now, source = 'voice-state', reason = 'live-on-recovered') {
    return attendanceService.applyLiveOnCore(user, now, source, reason);
}

function normalizeManualAdjustmentState(user, field, value, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!user) return false;
    const enabled = String(value).toLowerCase() === 'true';
    if (field === 'day-off' && enabled) {
        return applyDayOffState(user, now, 'manual-adjust-command', 'manual-day-off-true');
    }
    if (field === 'finished' && enabled) {
        return applyFinishedState(user, now, 'manual-adjust-command', 'manual-finished-true').ok;
    }
    if (field === 'checked-in') {
        if (enabled) {
            user.dayOff = false;
            user.isFinished = false;
            user.disconnected = false;
            user.disconnectedAt = null;
            transitionRecordedStatus(user, {
                attendanceStatus: 'WORKING',
                voiceStatus: user.voiceStatus === 'LIVE_ON' ? 'LIVE_ON' : 'OFFLINE'
            }, now, 'manual-adjust-command', 'manual-checked-in-true');
            return true;
        }
        applyFinishedState(user, now, 'manual-adjust-command', 'manual-checked-in-false');
        return true;
    }
    if (field === 'disconnected') {
        if (enabled) {
            user.checkedIn = true;
            user.dayOff = false;
            user.isFinished = false;
            user.disconnected = true;
            user.disconnectedAt = user.disconnectedAt || now.toISOString();
            transitionRecordedStatus(user, {
                attendanceStatus: 'WORKING',
                voiceStatus: 'DISCONNECTED'
            }, now, 'manual-adjust-command', 'manual-disconnected-true');
            return true;
        }
        user.disconnected = false;
        user.disconnectedAt = null;
        transitionRecordedStatus(user, {
            voiceStatus: user.checkedIn ? 'OFFLINE' : (user.isFinished ? 'OFFLINE' : user.voiceStatus || 'OFFLINE')
        }, now, 'manual-adjust-command', 'manual-disconnected-false');
        return true;
    }
    return false;
}

    return {
        expireDayOffSessions,
        getMemberShiftRole,
        getRecentMaintenanceEnd,
        shouldShowPostMaintenanceFinished,
        shouldShowAsPreShiftStandby,
        ensureSessionStore,
        appendAttendanceEvent,
        transitionRecordedStatus,
        getOpenSession,
        getRelevantSessionForTime,
        getScheduledEndMoment,
        normalizeOpenSessions,
        startAttendanceSession,
        finishAttendanceSession,
        applyFinishedState,
        startSessionPeriod,
        closeOpenSessionPeriod,
        sumSessionPeriods,
        calculateSessionWorkedMinutes,
        getUserLatestSessionSummary,
        createPendingClockOut,
        recoverPendingClockOut,
        getClockOutStatus,
        setFinishedPresence,
        getOvertimeStartMoment,
        canStartOvertimeNow,
        canStartPreShiftOvertime,
        canStartPostShiftOvertime,
        startPreShiftOvertime,
        startPostShiftOvertime,
        isOvertimeEntryStillValid,
        isFinishedBeforeCurrentShift,
        isCurrentShiftRegularWorker,
        getLatestOvertimeSession,
        getRestorableOvertimeSession,
        restoreOvertimeAfterFinish,
        activatePendingManualOvertime,
        markLiveOffState,
        clearLiveOffState,
        recordLiveConfirmation,
        recordLiveRecovery,
        buildDayOffClockInPromptMessage,
        sendDayOffClockInPromptIfDue,
        notifyDayOffPresence,
        notifyAfterFinishPresence,
        notifyFinishedReturnToVoice,
        notifyStandbyClockInRequired,
        normalizeCurrentShiftSession,
        recordLog,
        getAttendanceSheetProfile,
        getSessionWorkDate,
        mapClockInStatus,
        mapClockOutStatus,
        shouldSyncOvertimeRawAttendance,
        buildClockInRawAttendanceNote,
        buildClockOutRawAttendanceNote,
        buildOvertimeRawAttendanceNote,
        sendRawAttendanceSheetEvent,
        handleClockIn,
        handleClockOut,
        handleClockOutWithoutMember,
        applyDayOffState,
        applyLiveExceptionState,
        clearStaleDayOffState,
        clearDayOffReservationState,
        applyManualResumeRequiredState,
        applyPendingOvertimeReservationState,
        expireDayOffState,
        resetFinishedForPreClockIn,
        applyCurrentShiftLiveOnState,
        applySmartResetState,
        applyOvertimeState,
        applyDisconnectedState,
        applyLiveOnState,
        normalizeManualAdjustmentState
    };
}

module.exports = { createClockWorkflow };
