'use strict';

const {
    buildDayOffClockInPromptMessage,
    buildDayOffPresenceDm,
    buildDayOffPresenceLogLines,
    buildAfterFinishPresenceDm,
    buildFinishedReturnWithinShiftDm,
    buildFinishedReturnDefaultDm,
    buildStandbyClockInRequiredDm,
    buildExcessiveLateDm
} = require('../utils/attendanceDmMessages');
const {
    buildAttendanceDecisionLog,
    normalizeBrokenKorean
} = require('../utils/attendanceLogFormatter');
const { incrementMonthlyAttendanceStat } = require('../utils/monthlyAttendanceStats');
const {
    buildAutoOtConfirmDmPayload,
    classifyOvertimeActivityRisk,
    createAutoOtConfirmToken,
    getMemberActivityNames,
    parseAutoOtConfirmCustomId
} = require('../utils/overtimeActivityPolicy');

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
        ActionRowBuilder = null,
        ButtonBuilder = null,
        ButtonStyle = null,
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

function canStartPostShiftOvertime(user, now = moment().tz(CONFIG.TIMEZONE), options = {}) {
    return attendanceService.canStartPostShiftOvertime(user, now, options);
}

function getPostShiftOvertimeStartMoment(user, now = moment().tz(CONFIG.TIMEZONE), options = {}) {
    return attendanceService.getPostShiftOvertimeStartMoment(user, now, options);
}

function shouldCollapsePresenceLog(user, actionType, eventTime) {
    if (!['disconnect', 'reconnect'].includes(actionType)) return false;
    const windowMins = Math.max(1, Number(CONFIG.PRESENCE_LOG_COLLAPSE_MINS || 5));
    const last = user.lastPresenceDecisionLog || null;
    if (last?.at) {
        const lastAt = moment(last.at).tz(CONFIG.TIMEZONE);
        if (last.actionType === actionType && eventTime.diff(lastAt, 'minutes') < windowMins) {
            user.collapsedPresenceDecisionLogCount = (user.collapsedPresenceDecisionLogCount || 0) + 1;
            user.lastPresenceDecisionLogSuppressedAt = eventTime.toISOString();
            return true;
        }
    }
    user.lastPresenceDecisionLog = {
        at: eventTime.toISOString(),
        actionType
    };
    return false;
}

function appendCollapsedPresenceSummary(user, text) {
    const count = Number(user.collapsedPresenceDecisionLogCount || 0);
    if (count <= 0) return text;
    user.collapsedPresenceDecisionLogCount = 0;
    return `${text} [짧은 동일상태 반복 ${count}건 묶음]`;
}

async function startPreShiftOvertime(member, user, shift, now, source = 'button-or-command') {
    const result = attendanceService.applyPreShiftOvertimeCore(member, user, shift, now, source);
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    await recordLog(user, 'ot', `사전 OT 시작 (정규 출근 ${result.shiftStart.format('hh:mm A')} 전)`);
    return true;
}

async function startPostShiftOvertime(member, user, now, source = 'voice_snapshot', options = {}) {
    const overtimeStart = getPostShiftOvertimeStartMoment(user, now, options) || now;
    const scheduledEnd = getOvertimeStartMoment(user, now);
    const detachedLateReturn = Boolean(
        options.allowLateReturn &&
        scheduledEnd &&
        moment(overtimeStart).tz(CONFIG.TIMEZONE).diff(moment(scheduledEnd).tz(CONFIG.TIMEZONE), 'minutes') > 0
    );
    const result = applyOvertimeState(user, now, 'AUTO', source, 'post-shift-live-auto-ot-started', {
        startedAt: overtimeStart,
        voiceStatus: 'LIVE_ON',
        sessionSource: 'post-shift-auto-ot',
        sourceSession: detachedLateReturn ? undefined : (options.sourceSession || getOpenSession(user)),
        otEvidence: options.otEvidence || null,
        resetClockInForOvertime: detachedLateReturn,
        sessionScheduledStartAt: detachedLateReturn ? overtimeStart : undefined,
        sessionScheduledEndAt: detachedLateReturn ? overtimeStart : undefined,
        monthlyAt: detachedLateReturn ? overtimeStart : undefined,
        sessionKey: detachedLateReturn
            ? `post-shift-return:${user.shift || 'unknown'}:${moment(overtimeStart).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm')}`
            : undefined
    });
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    if (result.added) {
        await recordLog(user, 'ot', `교대 후 라이브 유지 자동 OT 감지 (${formatDuration(Math.max(0, now.diff(overtimeStart, 'minutes')))})`);
    }
    return true;
}

function isMemberStreaming(member) {
    const voiceState = member?.guild?.voiceStates?.cache?.get?.(member.id);
    return Boolean(member?.voice?.streaming || voiceState?.streaming);
}

function getAutoOtConfirmExpireAt(at) {
    const mins = Number(CONFIG.AUTO_OT_CONFIRM_EXPIRE_MINS || 0);
    if (!Number.isFinite(mins) || mins <= 0) return null;
    return moment(at).tz(CONFIG.TIMEZONE).clone().add(mins, 'minutes');
}

function getAutoOtConfirmReminderMins() {
    const mins = Number(CONFIG.AUTO_OT_CONFIRM_REMINDER_MINS || 5);
    return Number.isFinite(mins) && mins > 0 ? mins : 5;
}

function getPendingAutoOtConfirm(user, now = moment().tz(CONFIG.TIMEZONE)) {
    const pending = user?.pendingAutoOTConfirm;
    if (!pending || pending.status !== 'pending') return null;
    const expiresAt = pending.expiresAt ? moment(pending.expiresAt).tz(CONFIG.TIMEZONE) : null;
    if (pending.expiresAt && (!expiresAt?.isValid?.() || moment(now).tz(CONFIG.TIMEZONE).isAfter(expiresAt))) return null;
    return pending;
}

function shouldSendAutoOtConfirmReminder(pending, now) {
    const at = moment(now).tz(CONFIG.TIMEZONE);
    const lastDmAt = pending?.lastDmAt || pending?.requestedAt;
    if (!lastDmAt) return true;
    const last = moment(lastDmAt).tz(CONFIG.TIMEZONE);
    if (!last?.isValid?.()) return true;
    return at.diff(last, 'minutes') >= getAutoOtConfirmReminderMins();
}

function isUnknownActivityContinuousLiveFallbackEnabled() {
    const value = CONFIG.AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK;
    if (typeof value === 'boolean') return value;
    return String(value ?? 'true').toLowerCase() !== 'false';
}

function canUseUnknownActivityContinuousLiveFallback(user, now, activityRisk) {
    if (activityRisk?.reason !== 'activity-not-visible') return false;
    if (!isUnknownActivityContinuousLiveFallbackEnabled()) return false;
    if (typeof attendanceService.canStartPostShiftOvertime !== 'function') return false;
    return canStartPostShiftOvertime(user, now, {
        allowLateReturn: false,
        requireContinuousLive: true
    });
}

function canUseUnknownActivityLateReturnFallback(user, now, activityRisk) {
    if (activityRisk?.reason !== 'activity-not-visible') return false;
    if (typeof attendanceService.canStartPostShiftOvertime !== 'function') return false;
    return canStartPostShiftOvertime(user, now, {
        allowLateReturn: true,
        requireContinuousLive: false
    });
}

async function sendAutoOtConfirmationDm(member, user, pending, now, { reminder = false, source = 'auto-overtime-check' } = {}) {
    const at = moment(now).tz(CONFIG.TIMEZONE);
    const expiresAt = pending.expiresAt ? moment(pending.expiresAt).tz(CONFIG.TIMEZONE) : null;
    const validExpiresAt = expiresAt?.isValid?.() ? expiresAt : null;
    const payload = buildAutoOtConfirmDmPayload({
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        userId: user.id || member.id,
        token: pending.token,
        expiresAt: validExpiresAt,
        reminder,
        reminderCount: Number(pending.dmSentCount || 0) + 1,
        activityStatus: pending.activityStatus || null,
        activityNames: pending.activityNames || [],
        activityName: pending.activityName || null,
        activityFallback: pending.activityFallback || null
    });

    try {
        const message = await member.send(payload);
        pending.messageId = message?.id || null;
        pending.channelId = message?.channelId || null;
        pending.lastDmAt = at.toISOString();
        pending.dmSentCount = Number(pending.dmSentCount || 0) + 1;
        pending.lastDmError = null;
        pending.error = null;
        if (reminder) {
            appendAttendanceEvent(user, 'auto_ot_confirmation_reminder_sent', at, source, {
                dmSentCount: pending.dmSentCount,
                scheduledEndAt: pending.scheduledEndAt || null
            });
        }
        return { ok: true, changed: true };
    } catch (error) {
        pending.lastDmAt = at.toISOString();
        pending.dmFailureCount = Number(pending.dmFailureCount || 0) + 1;
        pending.lastDmError = error?.message || String(error);
        pending.error = pending.lastDmError;
        appendAttendanceEvent(user, 'auto_ot_confirmation_dm_failed', at, source, {
            error: pending.lastDmError,
            dmFailureCount: pending.dmFailureCount
        });
        logger.warn?.('[AUTO OT CONFIRM DM WARN]', {
            userId: user.id || member.id,
            error: pending.lastDmError
        });
        return { ok: false, changed: true, error: pending.lastDmError };
    }
}

function blockAutoOvertimeForActivity(member, user, now, source, scheduledEnd, risk) {
    if (!user || !risk?.shouldBlock) return { handled: false, changed: false };
    const at = moment(now).tz(CONFIG.TIMEZONE);
    const blockedKey = [
        scheduledEnd?.toISOString?.() || 'unknown',
        risk.reason || risk.status || 'activity-blocked',
        risk.activityName || risk.matched || 'unknown'
    ].join(':');
    const previous = user.pendingAutoOTConfirm;
    const alreadyBlocked = previous?.status === 'blocked' && previous.blockedKey === blockedKey;
    user.pendingAutoOTConfirm = {
        status: 'blocked',
        reason: risk.reason || 'activity-blocked',
        activityStatus: risk.status || null,
        blockedKey,
        activityName: risk.activityName || null,
        matched: risk.matched || null,
        source,
        shift: user.shift || null,
        scheduledEndAt: scheduledEnd?.toISOString?.() || null,
        blockedAt: at.toISOString(),
        activityNames: risk.activityNames || getMemberActivityNames(member)
    };
    if (!alreadyBlocked) {
        appendAttendanceEvent(user, 'auto_ot_blocked_activity_risk', at, source, {
            reason: user.pendingAutoOTConfirm.reason,
            activityStatus: user.pendingAutoOTConfirm.activityStatus,
            activityName: user.pendingAutoOTConfirm.activityName,
            matched: user.pendingAutoOTConfirm.matched,
            scheduledEndAt: scheduledEnd?.toISOString?.() || null,
            activityNames: user.pendingAutoOTConfirm.activityNames
        });
    }
    return { handled: true, changed: !alreadyBlocked, risk };
}

function getAutoOtActivityBlockMessage(risk) {
    if (risk?.reason === 'denied-activity') {
        return `OT was not started because game activity was detected: ${risk.activityName}.`;
    }
    if (risk?.reason === 'activity-not-allowlisted') {
        const names = (risk.activityNames || []).join(', ') || 'unknown';
        return `OT was not started because the visible activity is not on the approved work list: ${names}.`;
    }
    if (risk?.reason === 'activity-not-visible') {
        return 'OT was not started because Discord activity was not visible, so work-related OT could not be verified automatically.';
    }
    return 'OT was not started because activity evidence could not be verified.';
}

async function requestPostShiftOvertimeConfirmation(member, user, now, source = 'auto-overtime-check', options = {}) {
    if (!member || !user) return { handled: false, changed: false, reason: 'missing-input' };
    const at = moment(now).tz(CONFIG.TIMEZONE);
    const allowLateReturn = Boolean(options.allowLateReturn);
    const requireContinuousLive = options.requireContinuousLive !== false && !allowLateReturn;
    const scheduledEnd = options.scheduledEnd
        ? moment(options.scheduledEnd).tz(CONFIG.TIMEZONE)
        : getOvertimeStartMoment(user, at);
    const scheduledEndAt = scheduledEnd?.isValid?.() ? scheduledEnd.toISOString() : null;
    if (
        user.pendingAutoOTConfirm?.status === 'canceled' &&
        user.pendingAutoOTConfirm.scheduledEndAt === scheduledEndAt
    ) {
        return { handled: true, changed: false, pending: false, reason: 'auto-ot-canceled' };
    }
    const activityRisk = classifyOvertimeActivityRisk(member, CONFIG);
    const shouldBlockBeforeDm = activityRisk.shouldBlock &&
        !(activityRisk.reason === 'activity-not-visible' && activityRisk.policy === 'hold');
    if (shouldBlockBeforeDm) {
        return blockAutoOvertimeForActivity(member, user, at, source, scheduledEnd, activityRisk);
    }

    const existing = getPendingAutoOtConfirm(user, at);
    if (existing) {
        if (!shouldSendAutoOtConfirmReminder(existing, at)) {
            return { handled: true, changed: false, pending: true };
        }
        const sent = await sendAutoOtConfirmationDm(member, user, existing, at, {
            reminder: true,
            source
        });
        return {
            handled: true,
            changed: sent.changed,
            pending: true,
            reminder: true,
            dmOk: sent.ok
        };
    }

    const token = createAutoOtConfirmToken(at);
    const expiresAt = getAutoOtConfirmExpireAt(at);
    const activityFallback = allowLateReturn && canUseUnknownActivityLateReturnFallback(user, at, activityRisk)
        ? 'late-return-live'
        : (canUseUnknownActivityContinuousLiveFallback(user, at, activityRisk) ? 'continuous-live' : null);
    user.pendingAutoOTConfirm = {
        status: 'pending',
        token,
        requestedAt: at.toISOString(),
        expiresAt: expiresAt?.toISOString?.() || null,
        source,
        shift: user.shift || null,
        scheduledEndAt,
        allowLateReturn,
        requireContinuousLive,
        lastLiveOnAt: user.lastLiveOnAt || null,
        activityNames: activityRisk.activityNames || getMemberActivityNames(member),
        activityStatus: activityRisk.status || null,
        activityFallback
    };
    appendAttendanceEvent(user, 'auto_ot_confirmation_requested', at, source, {
        scheduledEndAt: user.pendingAutoOTConfirm.scheduledEndAt,
        expiresAt: user.pendingAutoOTConfirm.expiresAt,
        activityStatus: user.pendingAutoOTConfirm.activityStatus,
        activityNames: user.pendingAutoOTConfirm.activityNames,
        activityFallback: user.pendingAutoOTConfirm.activityFallback,
        allowLateReturn: user.pendingAutoOTConfirm.allowLateReturn,
        requireContinuousLive: user.pendingAutoOTConfirm.requireContinuousLive
    });

    const sent = await sendAutoOtConfirmationDm(member, user, user.pendingAutoOTConfirm, at, { source });
    if (sent.ok) await recordLog(user, 'ot', 'Auto OT candidate detected - waiting for DM confirmation');

    return { handled: true, changed: true, pending: true, dmOk: sent.ok };
}

async function handleAutoOvertimeConfirmation(interaction, now = moment().tz(CONFIG.TIMEZONE)) {
    const parsed = parseAutoOtConfirmCustomId(interaction?.customId);
    if (!parsed) return { handled: false, changed: false, message: null };

    const at = moment(now).tz(CONFIG.TIMEZONE);
    const userId = parsed.userId;
    if (interaction?.user?.id && interaction.user.id !== userId) {
        return {
            handled: true,
            changed: false,
            message: 'This OT confirmation is not for your account.'
        };
    }

    const user = getAttendanceData()[userId];
    const pending = user?.pendingAutoOTConfirm;
    if (!user || !pending || pending.token !== parsed.token || pending.status !== 'pending') {
        return {
            handled: true,
            changed: false,
            message: 'This OT confirmation is no longer active.'
        };
    }

    const expiresAt = pending.expiresAt ? moment(pending.expiresAt).tz(CONFIG.TIMEZONE) : null;
    if (pending.expiresAt && (!expiresAt?.isValid?.() || at.isAfter(expiresAt))) {
        pending.status = 'expired';
        pending.expiredAt = at.toISOString();
        appendAttendanceEvent(user, 'auto_ot_confirmation_expired', at, 'auto-ot-confirm-button', {
            requestedAt: pending.requestedAt || null
        });
        return {
            handled: true,
            changed: true,
            message: 'This OT confirmation has expired. OT was not started.'
        };
    }

    if (parsed.action === 'cancel') {
        pending.status = 'canceled';
        pending.canceledAt = at.toISOString();
        appendAttendanceEvent(user, 'auto_ot_confirmation_canceled', at, 'auto-ot-confirm-button', {
            requestedAt: pending.requestedAt || null
        });
        await recordLog(user, 'ot', '자동 OT 확인 취소 - FINISHED 유지');
        return {
            handled: true,
            changed: true,
            message: 'OT canceled. You will stay finished.'
        };
    }

    const guild = interaction?.guild || client?.guilds?.cache?.get?.(CONFIG.GUILD_ID);
    const member = interaction?.member?.id === userId
        ? interaction.member
        : await guild?.members?.fetch?.({ user: userId, force: true }).catch(() => null);
    if (!member) {
        return {
            handled: true,
            changed: false,
            message: 'Could not verify your server member state. OT was not started.'
        };
    }

    const activityRisk = classifyOvertimeActivityRisk(member, CONFIG);
    if (activityRisk.shouldBlock) {
        const allowByContinuousLiveFallback = canUseUnknownActivityContinuousLiveFallback(user, at, activityRisk);
        const allowByLateReturnFallback = pending.allowLateReturn &&
            canUseUnknownActivityLateReturnFallback(user, at, activityRisk);
        if (allowByContinuousLiveFallback || allowByLateReturnFallback) {
            pending.activityStatus = activityRisk.status || null;
            pending.activityNames = activityRisk.activityNames || getMemberActivityNames(member);
            pending.activityFallback = allowByLateReturnFallback ? 'late-return-live' : 'continuous-live';
        } else {
            blockAutoOvertimeForActivity(member, user, at, 'auto-ot-confirm-button', pending.scheduledEndAt ? moment(pending.scheduledEndAt).tz(CONFIG.TIMEZONE) : null, activityRisk);
            await recordLog(user, 'ot', activityRisk.reason === 'denied-activity'
                ? `Auto OT blocked - denied activity detected (${activityRisk.activityName})`
                : `Auto OT blocked - activity evidence not verified (${activityRisk.reason})`);
            return {
                handled: true,
                changed: true,
                message: getAutoOtActivityBlockMessage(activityRisk)
            };
        }
    }
    if (!isMemberStreaming(member)) {
        pending.status = 'no-live';
        pending.closedAt = at.toISOString();
        appendAttendanceEvent(user, 'auto_ot_confirmation_no_live', at, 'auto-ot-confirm-button');
        return {
            handled: true,
            changed: true,
            message: 'LIVE is not on now, so OT was not started.'
        };
    }

    const startOptions = {
        allowLateReturn: Boolean(pending.allowLateReturn),
        requireContinuousLive: pending.allowLateReturn ? false : pending.requireContinuousLive !== false
    };
    const otEvidence = {
        liveOnAtConfirmation: true,
        confirmedAt: at.toISOString(),
        activityStatus: activityRisk.status || pending.activityStatus || null,
        activityName: activityRisk.activityName || pending.activityName || null,
        activityNames: activityRisk.activityNames || pending.activityNames || [],
        activityFallback: pending.activityFallback || null,
        allowLateReturn: startOptions.allowLateReturn,
        requireContinuousLive: startOptions.requireContinuousLive,
        scheduledEndAt: pending.scheduledEndAt || null
    };
    const canStart = user.checkedIn
        ? canStartOvertimeNow(user, at)
        : canStartPostShiftOvertime(user, at, startOptions);
    if (!canStart) {
        pending.status = 'not-eligible';
        pending.closedAt = at.toISOString();
        appendAttendanceEvent(user, 'auto_ot_confirmation_not_eligible', at, 'auto-ot-confirm-button', {
            checkedIn: Boolean(user.checkedIn),
            scheduledEndAt: pending.scheduledEndAt || null,
            allowLateReturn: startOptions.allowLateReturn,
            requireContinuousLive: startOptions.requireContinuousLive
        });
        return {
            handled: true,
            changed: true,
            message: 'OT could not be verified now, so it was not started.'
        };
    }

    const started = await startPostShiftOvertime(member, user, at, 'auto-ot-confirm-button', {
        ...startOptions,
        otEvidence
    });
    if (!started) {
        return {
            handled: true,
            changed: false,
            message: 'OT could not be started.'
        };
    }

    appendAttendanceEvent(user, 'auto_ot_confirmation_accepted', at, 'auto-ot-confirm-button', {
        requestedAt: pending.requestedAt || null,
        scheduledEndAt: pending.scheduledEndAt || null,
        liveOnAtConfirmation: otEvidence.liveOnAtConfirmation,
        activityStatus: otEvidence.activityStatus,
        activityName: otEvidence.activityName,
        activityNames: otEvidence.activityNames,
        activityFallback: otEvidence.activityFallback,
        allowLateReturn: otEvidence.allowLateReturn,
        requireContinuousLive: otEvidence.requireContinuousLive
    });
    return {
        handled: true,
        changed: true,
        message: 'OT started. Thank you.'
    };
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

async function resumeAutoTimeoutShift(member, user, shift, now, source = 'voice_snapshot') {
    const result = attendanceService.applyAutoTimeoutResumeCore(user, shift, now, source);
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    const isDc = result.timeoutSource === 'dc-timeout';
    const start = result.period?.startedAt
        ? moment(result.period.startedAt).tz(CONFIG.TIMEZONE).format('HH:mm')
        : result.timeoutAt.format('HH:mm');
    const end = moment(now).tz(CONFIG.TIMEZONE).format('HH:mm');
    const durationText = formatDuration(result.periodMinutes || Math.max(0, moment(now).tz(CONFIG.TIMEZONE).diff(result.timeoutAt, 'minutes')));
    const text = isDc
        ? `DC 복구 - 유예시간 초과 후 복귀, 근무 계속 인정 (DC 이탈 ${start} / DC 복구 ${end} / DC 지속 ${durationText})`
        : `라이브 ON 복귀 - 유예시간 초과 후 복귀, 근무 계속 인정 (라이브 종료 ${start} / 라이브 복귀 ${end} / LIVE OFF 지속 ${durationText})`;
    await recordLog(user, 'reconnect', text, null, {
        presenceStartedAt: result.period?.startedAt || result.timeoutAt.toISOString()
    });
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
    await recordLog(user, 'reconnect', text, null, { presenceStartedAt: started.toISOString() });
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
    const presenceStartedAt = user.liveOffStartedAt || user.voiceJoinedAt || user.disconnectedAt || null;
    await recordLog(user, 'reconnect', '대기중 음성채널 접속 감지 - 라이브 ON 후 CLOCK IN 버튼 필요', null, {
        presenceStartedAt
    });
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
    if (shouldCollapsePresenceLog(user, actionType, eventTime)) return;
    baseTxt = appendCollapsedPresenceSummary(user, baseTxt);

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
            user.earlyOut = true;
            user.points = (user.points || 0) + CONFIG.POINTS.EARLY_OUT;
            incrementMonthlyAttendanceStat(user, {
                moment,
                at: eventTime,
                timezone: CONFIG.TIMEZONE,
                field: 'totalEarly',
                pointsDelta: CONFIG.POINTS.EARLY_OUT
            });
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

    baseTxt = normalizeBrokenKorean(baseTxt);

    const openSession = getOpenSession(user);
    const sessionSummary = openSession ? calculateSessionWorkedMinutes(openSession, eventTime) : null;
    const eventDetails = { ...options };
    if (actionType === 'in' && user.shift) {
        const bounds = getShiftBounds(user.shift, eventTime);
        const lateMinutes = bounds?.start ? Math.max(0, eventTime.diff(bounds.start, 'minutes')) : 0;
        eventDetails.lateMinutes = lateMinutes;
        eventDetails.clockInStatus = user.excessiveLateThisShift
            ? 'excessiveLate'
            : (user.status === 'late' || lateMinutes > 5 ? 'late' : 'ontime');
    }
    if (actionType === 'ot') {
        eventDetails.otStartedAt = eventDetails.otStartedAt || openSession?.otStartedAt || eventTime.toISOString();
    }
    const readableLogText = buildAttendanceDecisionLog({
        CONFIG,
        moment,
        formatDuration,
        user,
        actionType,
        eventTime,
        baseText: baseTxt,
        sessionSummary,
        eventDetails
    });

    const logChan = client.channels.cache.get(CONFIG.LOG_CHANNEL) ||
        await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) {
        await logChan.send(readableLogText)
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
    } else if (actionType === 'reconnect' && /(복구|복귀|recovered|resume)/i.test(String(baseTxt || ''))) {
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

function isFinalAbsentAttendance(user) {
    return user?.status === 'absent' || user?.attendanceStatus === 'ABSENT';
}

function buildFinalAbsentReturnNote(label, at) {
    return `\uCD5C\uC885 \uBB34\uB2E8\uACB0\uADFC \uD6C4 ${label} ${moment(at).tz(CONFIG.TIMEZONE).format('HH:mm')}`;
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
        if (result.preShiftVoiceGrace) {
            const voiceAt = result.preShiftVoiceAt
                ? moment(result.preShiftVoiceAt).tz(CONFIG.TIMEZONE).format('HH:mm')
                : '-';
            const modeText = result.preShiftVoiceMode === 'maintenance' ? '점검 음성 대기' : '사전 음성 대기';
            return `${modeText} ${voiceAt} / 인정 출근 ${recognizedAt.format('HH:mm')} / 실제 LIVE ON ${detectedMoment.format('HH:mm')}`;
        }
        const detectedPreShift = result.preShiftDetectedAt
            ? moment(result.preShiftDetectedAt).tz(CONFIG.TIMEZONE).format('HH:mm')
            : detectedMoment.format('HH:mm');
        const graceText = result.preShiftReconnectGrace ? ' / 출근 후 LIVE 복귀 유예 인정' : '';
        return `사전 LIVE 감지 ${detectedPreShift} / 인정 출근 ${recognizedAt.format('HH:mm')} / 실제 감지 ${detectedMoment.format('HH:mm')}${graceText}`;
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
    return normalizeBrokenKorean(customLogText || options.clockOutSource || `퇴근 ${outAt.format('HH:mm')}`);
}

function buildOvertimeRawAttendanceNote(note, eventTime) {
    const at = moment(eventTime).tz(CONFIG.TIMEZONE).format('HH:mm');
    const text = normalizeBrokenKorean(String(note || '').trim());
    if (text.includes('오버타임 시작') || text.includes('연장 시작')) {
        return text.includes(at) ? text : `${text} ${at}`;
    }
    return `오버타임 시작 ${at}${text && text !== '-' ? ' / ' + text : ''}`;
}

async function sendRawAttendanceSheetEvent({ member, user, shift, status, eventTime, inTime = '-', outTime = '-', note = '-', session = null, forceStatus = false }) {
    const profile = getAttendanceSheetProfile(member, user, shift);
    if (!profile.server || !profile.shift) {
        console.warn('[RAW ATTENDANCE SHEET AUTO RESOLVE] Missing server/shift profile', {
            userId: user?.id || member?.id,
            name: user?.name || member?.displayName
        });
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

async function sendExcessiveLateAuditLog(user, result, shift) {
    const logChan = client.channels.cache.get(CONFIG.LOG_CHANNEL) ||
        await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (!logChan) return;
    const shiftText = shift === 'night' ? '\uC57C\uAC04' : '\uC8FC\uAC04';
    const name = user?.name || 'Unknown';
    const inTime = result?.recognizedAt ? result.recognizedAt.format('HH:mm') : '-';
    const title = result?.convertedAbsentToLate
        ? '\uACB0\uC11D \uD655\uC815 \uD6C4 \uCD9C\uADFC - \uC9C0\uAC01\uC73C\uB85C \uC804\uD658'
        : '2\uC2DC\uAC04 \uC774\uC0C1 \uC9C0\uAC01 \uCD9C\uADFC';
    await logChan.send([
        `\`[${moment().tz(CONFIG.TIMEZONE).format('MM/DD HH:mm')}]\` \u26A0\uFE0F **2H+ \uC9C0\uAC01 \uAC10\uC0AC \uB85C\uADF8**`,
        `\uC774\uB984: **${name}** | \uC870: ${shiftText}`,
        `\uCC98\uB9AC: ${title}`,
        `\uC2DC\uAC04: \uCD9C\uADFC ${inTime}`,
        `\uC9D1\uACC4: \uC77C\uBC18 \uC9C0\uAC01 + 2\uC2DC\uAC04\uC774\uC0C1\uC9C0\uAC01`
    ].join('\n')).catch(e => console.error('[2H LATE AUDIT LOG ERROR]', e));
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
    if (result.excessiveLate) {
        await member.send(buildExcessiveLateDm()).catch(error => {
            console.warn('[2H LATE DM WARN]', { userId: member.id, message: error?.message });
        });
        await sendExcessiveLateAuditLog(u, result, shift);
    }
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
        note: result.convertedAbsentToLate
            ? '2\uC2DC\uAC04 \uC774\uC0C1 \uC9C0\uAC01 - \uACB0\uC11D \uCDE8\uC18C, \uC9C0\uAC01 \uCC98\uB9AC'
            : result.excessiveLate
                ? `2\uC2DC\uAC04 \uC774\uC0C1 \uC9C0\uAC01 \uCD9C\uADFC ${result.recognizedAt.format('HH:mm')}`
            : buildClockInRawAttendanceNote(u, result, isAuto, now),
        session: result.session,
        forceStatus: Boolean(result.convertedAbsentToLate)
    });
    return true;
}

async function handleClockOut(member, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
    const finalAbsentShift = isFinalAbsentAttendance(user) && !user?.absentConvertedToLateThisShift;
    const result = attendanceService.applyClockOutCore(member, user, now, customLogText, earlyOverrideTime, options);
    if (!result.ok) return;
    await updateWorkingRole(member, false);
    const recordLogOptions = { ...result.recordLogOptions };
    if (result.session?.otStartedAt || result.session?.otType) {
        recordLogOptions.otStartedAt = result.session.otStartedAt || result.session.scheduledEndAt;
    }
    await recordLog(user, 'out', customLogText, result.recordLogTime, recordLogOptions);
    await sendRawAttendanceSheetEvent({
        member,
        user,
        shift: user.shift,
        status: finalAbsentShift ? RAW_ATTENDANCE_STATUS.ABSENT : mapClockOutStatus(user, result.outMoment, result.session),
        eventTime: result.outMoment,
        inTime: finalAbsentShift ? '-' : (user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : '-'),
        outTime: finalAbsentShift ? '-' : result.outMoment.format('HH:mm'),
        note: finalAbsentShift
            ? buildFinalAbsentReturnNote('\uD1F4\uADFC', result.outMoment)
            : buildClockOutRawAttendanceNote(user, result.outMoment, customLogText, result.recordLogOptions, result.session),
        session: result.session,
        forceStatus: finalAbsentShift
    });
}

async function handleClockOutWithoutMember(memberId, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
    const finalAbsentShift = isFinalAbsentAttendance(user) && !user?.absentConvertedToLateThisShift;
    const result = attendanceService.applyClockOutCore(memberId, user, now, customLogText, earlyOverrideTime, options);
    if (!result.ok) return false;
    const recordLogOptions = { ...result.recordLogOptions };
    if (result.session?.otStartedAt || result.session?.otType) {
        recordLogOptions.otStartedAt = result.session.otStartedAt || result.session.scheduledEndAt;
    }
    await recordLog(user, 'out', customLogText, result.recordLogTime, recordLogOptions);
    await sendRawAttendanceSheetEvent({
        member: null,
        user,
        shift: user.shift,
        status: finalAbsentShift ? RAW_ATTENDANCE_STATUS.ABSENT : mapClockOutStatus(user, result.outMoment, result.session),
        eventTime: result.outMoment,
        inTime: finalAbsentShift ? '-' : (user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : '-'),
        outTime: finalAbsentShift ? '-' : result.outMoment.format('HH:mm'),
        note: finalAbsentShift
            ? buildFinalAbsentReturnNote('\uD1F4\uADFC', result.outMoment)
            : buildClockOutRawAttendanceNote(user, result.outMoment, customLogText, result.recordLogOptions, result.session),
        session: result.session,
        forceStatus: finalAbsentShift
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
        getPostShiftOvertimeStartMoment,
        canStartOvertimeNow,
        canStartPreShiftOvertime,
        canStartPostShiftOvertime,
        startPreShiftOvertime,
        startPostShiftOvertime,
        requestPostShiftOvertimeConfirmation,
        handleAutoOvertimeConfirmation,
        isOvertimeEntryStillValid,
        isFinishedBeforeCurrentShift,
        isCurrentShiftRegularWorker,
        getLatestOvertimeSession,
        getRestorableOvertimeSession,
        restoreOvertimeAfterFinish,
        resumeAutoTimeoutShift,
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
