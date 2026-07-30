'use strict';

const {
    buildLiveOffClockOutDm,
    buildDcTimeoutClockOutDm,
    buildDcGraceHoldDm,
    buildLiveOffGraceHoldDm,
    buildAbsentWarningDm,
    buildScheduledBroadcastTitle
} = require('../utils/attendanceDmMessages');
const { getLiveExceptionsMap } = require('../utils/liveExceptionsAccess');
const {
    incrementMonthlyAttendanceStat,
    markMonthlyOvertimeAward
} = require('../utils/monthlyAttendanceStats');

function createScheduledJobsWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        getLiveExceptions,
        getAnnounceData,
        saveSystemAsync,
        recordLog,
        handleClockOut,
        handleClockOutWithoutMember = null,
        transitionRecordedStatus,
        updateWorkingRole,
        getScheduledEndMoment,
        getShiftBounds,
        formatKoreanDateTime,
        renderDashboardCore,
        handleClockIn,
        getActiveLiveException,
        isMaintenanceWindow,
        isCurrentShiftRegularWorker,
        getOvertimeStartMoment,
        addOvertimeUser,
        determineShift,
        ensureUserData,
        getOpenSession,
        startAttendanceSession,
        requestPostShiftOvertimeConfirmation = async () => ({ handled: false, changed: false }),
        rawAttendanceSheetService = null,
        RAW_ATTENDANCE_STATUS = { ABSENT: '\uACB0\uC11D' },
        getWorkerProfileForRawSync = () => null,
        formatDuration,
        appendAdminAudit = async () => {},
        attendanceAutoRepairService = null,
        logger = console
    } = deps;
const ABSENT_WARNING_MARKS = [30, 60, 90, 120];

function getAbsentWarningMark(elapsedMins) {
    return ABSENT_WARNING_MARKS.filter(mark => elapsedMins >= mark).pop() || null;
}

function hasContinuousPostShiftLiveEvidence(user, targetEnd, now, isStreamingNow, hasLiveException = false) {
    if (!user || !targetEnd?.isValid?.()) return false;
    if (!isStreamingNow && !hasLiveException) return false;
    if (user.disconnected || user.disconnectedAt || user.liveOffStartedAt) return false;
    if (moment(now).tz(CONFIG.TIMEZONE).isBefore(targetEnd)) return false;
    if (hasLiveException) return true;
    const lastLiveOnAt = user.lastLiveOnAt ? moment(user.lastLiveOnAt).tz(CONFIG.TIMEZONE) : null;
    if (!lastLiveOnAt?.isValid?.()) return false;
    return lastLiveOnAt.isSameOrBefore(targetEnd.clone().add(1, 'minute'));
}

function normalizeAbsentWarningMarks(user) {
    if (!Array.isArray(user.absentWarningMarks)) user.absentWarningMarks = [];
    user.absentWarningMarks = user.absentWarningMarks
        .map(mark => Number(mark))
        .filter(mark => ABSENT_WARNING_MARKS.includes(mark));
    return user.absentWarningMarks;
}

function isEligibleForAbsentWarning(user, member, now) {
    if (!user || !member || member.user?.bot) return false;
    if (user.checkedIn || user.dayOff || user.disconnected || user.isFinished) return false;
    if (!['day', 'night'].includes(user.shift)) return false;
    if (getOvertimeUsers().some(ot => ot.id === user.id)) return false;
    if (getActiveLiveException(user.id, now)) return false;
    if (!isCurrentShiftRegularWorker(member, now)) return false;
    const bounds = getShiftBounds(user.shift, now);
    if (!bounds?.start || !bounds?.end) return false;
    if (now.isBefore(bounds.start) || now.isSameOrAfter(bounds.end)) return false;
    return true;
}

async function sendFinalAbsentRawAttendance(member, user, bounds, now) {
    if (!rawAttendanceSheetService || typeof rawAttendanceSheetService.sendAttendanceRow !== 'function') {
        return { ok: false, skipped: true, reason: 'raw-attendance-disabled' };
    }
    const profile = getWorkerProfileForRawSync(member) || {};
    const server = profile.server || user?.server || null;
    const shift = profile.shift || (user?.shift ? String(user.shift).toUpperCase() : null);
    if (!server || !shift) {
        logger.warn?.('[RAW ATTENDANCE ABSENT AUTO RESOLVE] Missing server/shift profile', {
            userId: user?.id || member?.id,
            name: user?.name || member?.displayName
        });
    }
    return rawAttendanceSheetService.sendAttendanceRow({
        date: bounds?.start ? bounds.start.format('YYYY-MM-DD') : now.format('YYYY-MM-DD'),
        server,
        shift,
        name: user?.name || member?.displayName || member?.user?.username || 'Unknown',
        status: RAW_ATTENDANCE_STATUS.ABSENT || '\uACB0\uC11D',
        inTime: '-',
        outTime: '-',
        note: '\uCD5C\uC885 \uACB0\uC11D - \uC815\uADDC \uADFC\uBB34 \uC885\uB8CC\uAE4C\uC9C0 \uCD9C\uADFC \uAE30\uB85D \uC5C6\uC74C',
        forceStatus: true
    });
}

function runAttendanceAutoRepair(now, reason) {
    if (!attendanceAutoRepairService || typeof attendanceAutoRepairService.run !== 'function') return false;
    try {
        const result = attendanceAutoRepairService.run({ now, reason });
        return Boolean(result?.changed);
    } catch (error) {
        logger.warn?.('[ATTENDANCE AUTO REPAIR ERROR]', error?.message || error);
        return false;
    }
}

async function finalizeAbsentAfterShiftEnd(member, user, bounds, now) {
    if (!user || user.checkedIn || user.dayOff || user.isFinished) return false;
    if (!['day', 'night'].includes(user.shift)) return false;
    if (!bounds?.start || !bounds?.end || now.isBefore(bounds.end)) return false;
    if (getOvertimeUsers().some(ot => ot.id === user.id)) return false;
    if (getActiveLiveException(user.id, now)) return false;

    const sessionKey = `${user.shift}:${bounds.start.format('YYYY-MM-DD HH:mm')}`;
    if (user.finalAbsentSessionKey === sessionKey) return false;
    if (user.checkInRaw) {
        const checkedInAt = moment(user.checkInRaw).tz(CONFIG.TIMEZONE);
        if (checkedInAt.isSameOrAfter(bounds.start) && checkedInAt.isBefore(bounds.end)) return false;
    }

    user.status = 'absent';
    user.absentConvertedToLateThisShift = false;
    user.excessiveLateThisShift = false;
    user.excessiveLateCountedThisShift = false;
    if (!user.strikeReceivedThisShift) {
        user.strikes = (user.strikes || 0) + 1;
        user.points = (user.points || 0) + (CONFIG.POINTS?.ABSENT || 0);
        user.totalAbsent = (user.totalAbsent || 0) + 1;
        incrementMonthlyAttendanceStat(user, {
            moment,
            at: bounds.end,
            timezone: CONFIG.TIMEZONE,
            field: 'totalAbsent',
            pointsDelta: CONFIG.POINTS?.ABSENT || 0
        });
        user.strikeReceivedThisShift = true;
    }
    user.finalAbsentSessionKey = sessionKey;
    transitionRecordedStatus(user, {
        attendanceStatus: 'ABSENT',
        voiceStatus: 'OFFLINE'
    }, bounds.end, 'final-absent', 'shift-ended-without-clock-in');
    await sendFinalAbsentRawAttendance(member, user, bounds, now);
    await recordLog(user, 'absent', '최종 결석 - 정규 근무 종료까지 출근 기록 없음');
    await appendAdminAudit('FINAL_ABSENT_CONFIRMED', {
        targetId: user.id || member?.id,
        targetName: user.name || member?.displayName || member?.user?.username || user.id,
        shift: user.shift || null,
        shiftStart: bounds.start.toISOString(),
        shiftEnd: bounds.end.toISOString(),
        reason: 'shift-ended-without-clock-in'
    });
    return true;
}

async function checkAbsentWarnings(now = moment().tz(CONFIG.TIMEZONE)) {
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return false;
    let changed = false;

    for (const id in getAttendanceData()) {
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) continue;
        const user = getAttendanceData()[id];
        if (user?.id && user.id !== id) {
            // Keep the persisted id consistent for later audit/event records.
            user.id = id;
        } else if (!user?.id) {
            user.id = id;
        }
        const member = guild.members.cache.get(id);
        const boundsForFinal = user?.shift ? getShiftBounds(user.shift, now) : null;
        if (member && await finalizeAbsentAfterShiftEnd(member, user, boundsForFinal, now)) {
            changed = true;
            continue;
        }
        if (!isEligibleForAbsentWarning(user, member, now)) continue;

        const bounds = getShiftBounds(user.shift, now);
        const elapsedMins = Math.max(0, now.diff(bounds.start, 'minutes'));
        const mark = getAbsentWarningMark(elapsedMins);
        if (!mark) continue;

        const marks = normalizeAbsentWarningMarks(user);
        if (marks.includes(mark)) continue;

        const reminderNumber = ABSENT_WARNING_MARKS.indexOf(mark) + 1;
        let dmStatus = 'sent';
        let dmError = null;
        await member.send(buildAbsentWarningDm(reminderNumber, mark, 120)).catch(error => {
            dmStatus = 'failed';
            dmError = error?.message || String(error);
        });
        await appendAdminAudit('AUTO_DM_ABSENT_WARNING', {
            targetId: id,
            targetName: user.name || member.displayName || member.user?.username || id,
            shift: user.shift || null,
            reminderNumber,
            mark,
            elapsedMins,
            dmStatus,
            dmError,
            reason: 'no-clock-in-after-shift-start'
        });
        marks.push(mark);
        user.lastAbsentWarningAt = now.toISOString();

        if (mark >= 120) {
            user.absentCandidateThisShift = true;
            user.absentCandidateSince = user.absentCandidateSince || now.toISOString();
            transitionRecordedStatus(user, {
                attendanceStatus: 'PRE_SHIFT',
                voiceStatus: 'OFFLINE'
            }, now, 'absent-warning', 'no-clock-in-after-120-minutes-candidate');
        }

        changed = true;
    }

    return changed;
}

async function performSmartReset(targetShift) {
    const now = moment().tz(CONFIG.TIMEZONE);
    for (const id in getAttendanceData()) {
        const u = getAttendanceData()[id];
        if (u.shift === targetShift) {
            u.strikeReceivedThisShift = false;
            u.isFinished = false;
            if (u.checkedIn && u.checkInRaw) {
                const hrs = now.diff(moment(u.checkInRaw), 'hours');
                const limit = getOvertimeUsers().some(ot => ot.id === id) ? CONFIG.PURGE_MANUAL_OT : CONFIG.PURGE_NORMAL;
                if (hrs >= limit) {
                    u.checkedIn = false;
                    setOvertimeUsers(getOvertimeUsers().filter(ot => ot.id !== id));
                    await recordLog(u, 'out', '자동 퇴근');
                } else {
                    continue;
                }
            }
            u.dayOff = false;
            u.dayOffExpireAt = null;
            u.status = null;
            u.absentConvertedToLateThisShift = false;
            u.excessiveLateThisShift = false;
            u.excessiveLateCountedThisShift = false;
            u.absentCandidateThisShift = false;
            u.absentCandidateSince = null;
            u.absentWarningMarks = [];
            u.lastAbsentWarningAt = null;
            transitionRecordedStatus(u, {
                attendanceStatus: 'PRE_SHIFT',
                voiceStatus: 'OFFLINE'
            }, now, 'smart-reset', `reset-${targetShift}`);
        }
    }
    await saveSystemAsync();
    await renderDashboardCore();
}

async function checkGracePeriods() {
    const now = moment().tz(CONFIG.TIMEZONE);
    let changed = runAttendanceAutoRepair(now, 'check-grace-periods');
    if (await checkAbsentWarnings(now)) changed = true;
    for (const id in getAttendanceData()) {
        const u = getAttendanceData()[id];
        if (!u.checkedIn && u.preShiftLiveAt && u.shift) {
            const member = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(id);
            if (member?.voice?.streaming) {
                if (await handleClockIn(member, u, u.shift, now, true)) changed = true;
            }
        }
        if (
            u.checkedIn &&
            !u.disconnected &&
            !u.dayOff &&
            (u.pendingClockOut?.source === 'live_off' || u.liveOffStartedAt) &&
            now.isSameOrAfter(moment(u.pendingClockOut?.expiresAt || moment(u.liveOffStartedAt).tz(CONFIG.TIMEZONE).add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes'))) &&
            !getActiveLiveException(id, now)
        ) {
            const m = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(id);
            const effectiveOut = moment(u.pendingClockOut?.at || u.liveOffStartedAt).tz(CONFIG.TIMEZONE);
            const scheduledEnd = getScheduledEndMoment(u, effectiveOut);
            if (scheduledEnd && now.isBefore(scheduledEnd)) {
                if (!u.pendingClockOut || u.pendingClockOut.source !== 'live_off') {
                    u.pendingClockOut = {
                        source: 'live_off',
                        at: effectiveOut.toISOString(),
                        expiresAt: effectiveOut.clone().add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes').toISOString(),
                        detectedAt: null,
                        recoveredAt: null,
                        reason: 'live off grace started'
                    };
                }
                u.pendingClockOut.finalizeAfterShiftEnd = true;
                u.pendingClockOut.shiftEndAt = scheduledEnd.toISOString();
                if (!u.pendingClockOut.timeoutNotifiedAt) {
                    u.pendingClockOut.timeoutNotifiedAt = now.toISOString();
                    u.pendingClockOut.timeoutDetectedAt = now.toISOString();
                    await recordLog(u, 'disconnect', 'LIVE OFF 유예 시간 초과 - 정규 퇴근 시각까지 확정 보류', now, {
                        presenceStartedAt: effectiveOut.toISOString()
                    });
                    if (m?.send) {
                        let dmStatus = 'sent';
                        let dmError = null;
                        await m.send(buildLiveOffGraceHoldDm(
                            CONFIG.LIVE_OFF_CLOCK_OUT_MINS,
                            scheduledEnd.format('HH:mm')
                        )).catch(error => {
                            dmStatus = 'failed';
                            dmError = error?.message || String(error);
                        });
                        await appendAdminAudit('AUTO_DM_LIVE_OFF_TIMEOUT_HOLD', {
                            targetId: id,
                            targetName: u.name || m.displayName || m.user?.username || id,
                            shift: u.shift || null,
                            mark: CONFIG.LIVE_OFF_CLOCK_OUT_MINS,
                            dmStatus,
                            dmError,
                            reason: 'live-off-timeout-held',
                            shiftEndAt: scheduledEnd.toISOString()
                        });
                    }
                }
                transitionRecordedStatus(u, {
                    attendanceStatus: u.checkedIn ? 'WORKING' : undefined,
                    voiceStatus: 'LIVE_OFF'
                }, now, 'live-off-timeout-hold', 'live-off-timeout-held-until-shift-end');
                changed = true;
                continue;
            }
            const liveOffTimeoutText = `라이브 OFF 유예 초과 자동 퇴근 (인정 퇴근 ${effectiveOut.format('hh:mm A')} / 처리 ${now.format('hh:mm A')})`;
            if (m) {
                await handleClockOut(m, u, now, liveOffTimeoutText, effectiveOut,
                    { effectiveTime: effectiveOut, detectedAt: now, forceIcon: '🔵', clockOutSource: 'live-off-timeout' }
                );
            } else {
                console.warn(`[GRACE WARN] live-off timeout: member ${id} not in cache, applying clock-out without member.`);
                if (typeof handleClockOutWithoutMember === 'function') {
                    await handleClockOutWithoutMember(id, u, now, liveOffTimeoutText, effectiveOut, {
                        effectiveTime: effectiveOut,
                        detectedAt: now,
                        forceIcon: '🔵',
                        clockOutSource: 'live-off-timeout'
                    });
                } else {
                    u.checkedIn = false;
                    u.disconnected = false;
                    u.pendingClockOut = null;
                    u.liveOffStartedAt = null;
                    u.isFinished = true;
                    await recordLog(u, 'out', liveOffTimeoutText, effectiveOut, { effectiveTime: effectiveOut, forceIcon: '🔵' });
                }
            }
            if (m?.send) {
                if (!Array.isArray(u.liveOffWarningMarks)) u.liveOffWarningMarks = [];
                if (!u.liveOffWarningMarks.includes(CONFIG.LIVE_OFF_CLOCK_OUT_MINS)) {
                    u.liveOffWarningMarks.push(CONFIG.LIVE_OFF_CLOCK_OUT_MINS);
                }
                let dmStatus = 'sent';
                let dmError = null;
                await m.send(buildLiveOffClockOutDm(CONFIG.LIVE_OFF_CLOCK_OUT_MINS)).catch(error => {
                    dmStatus = 'failed';
                    dmError = error?.message || String(error);
                });
                await appendAdminAudit('AUTO_DM_LIVE_OFF_CLOCK_OUT', {
                    targetId: id,
                    targetName: u.name || m.displayName || m.user?.username || id,
                    shift: u.shift || null,
                    mark: CONFIG.LIVE_OFF_CLOCK_OUT_MINS,
                    dmStatus,
                    dmError,
                    reason: 'live-off-timeout'
                });
            }
            changed = true;
            continue;
        }
        if (
            u.disconnected &&
            (u.pendingClockOut?.source === 'voice_leave' || u.disconnectedAt) &&
            now.isSameOrAfter(moment(u.pendingClockOut?.expiresAt || moment(u.disconnectedAt).tz(CONFIG.TIMEZONE).add(CONFIG.GRACE_PERIOD_MINS, 'minutes')))
        ) {
            const m = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(id);
            const effectiveDcOut = moment(u.pendingClockOut?.at || u.disconnectedAt).tz(CONFIG.TIMEZONE);
            const scheduledEnd = getScheduledEndMoment(u, effectiveDcOut);
            if (scheduledEnd && now.isBefore(scheduledEnd)) {
                if (!u.pendingClockOut || u.pendingClockOut.source !== 'voice_leave') {
                    u.pendingClockOut = {
                        source: 'voice_leave',
                        at: effectiveDcOut.toISOString(),
                        expiresAt: effectiveDcOut.clone().add(CONFIG.GRACE_PERIOD_MINS, 'minutes').toISOString(),
                        detectedAt: null,
                        recoveredAt: null,
                        reason: 'voice leave grace started'
                    };
                }
                u.pendingClockOut.finalizeAfterShiftEnd = true;
                u.pendingClockOut.shiftEndAt = scheduledEnd.toISOString();
                if (!u.pendingClockOut.timeoutNotifiedAt) {
                    u.pendingClockOut.timeoutNotifiedAt = now.toISOString();
                    u.pendingClockOut.timeoutDetectedAt = now.toISOString();
                    await recordLog(u, 'disconnect', 'DC 유예 시간 초과 - 정규 퇴근 시각까지 판정 보류', now, {
                        presenceStartedAt: effectiveDcOut.toISOString()
                    });
                    if (m?.send) {
                        let dmStatus = 'sent';
                        let dmError = null;
                        await m.send(buildDcGraceHoldDm(
                            CONFIG.GRACE_PERIOD_MINS,
                            scheduledEnd.format('HH:mm')
                        )).catch(error => {
                            dmStatus = 'failed';
                            dmError = error?.message || String(error);
                        });
                        await appendAdminAudit('AUTO_DM_DC_TIMEOUT_HOLD', {
                            targetId: id,
                            targetName: u.name || m.displayName || m.user?.username || id,
                            shift: u.shift || null,
                            mark: CONFIG.GRACE_PERIOD_MINS,
                            dmStatus,
                            dmError,
                            reason: 'voice-disconnect-timeout-held',
                            shiftEndAt: scheduledEnd.toISOString()
                        });
                    }
                }
                transitionRecordedStatus(u, {
                    attendanceStatus: u.checkedIn ? 'WORKING' : undefined,
                    voiceStatus: 'DISCONNECTED'
                }, now, 'dc-timeout-hold', 'dc-timeout-held-until-shift-end');
                changed = true;
                continue;
            }
            const earlyMins = scheduledEnd ? scheduledEnd.diff(effectiveDcOut, 'minutes') : 0;
            const customMsg = earlyMins > CONFIG.CLOCK_OUT_GRACE_MINS
                ? 'DC 유예 시간 초과 - 정규 종료 시각에 조기퇴근 확정'
                : 'DC 유예 시간 초과 - 정규 종료 시각에 정상퇴근 확정';
            if (m) {
                await handleClockOut(m, u, now, customMsg, effectiveDcOut, {
                    effectiveTime: effectiveDcOut,
                    detectedAt: now,
                    forceIcon: '🔵',
                    clockOutSource: 'dc-timeout'
                });
            } else {
                console.warn(`[GRACE WARN] dc-timeout: member ${id} not in cache, applying clock-out without member.`);
                if (typeof handleClockOutWithoutMember === 'function') {
                    await handleClockOutWithoutMember(id, u, now, customMsg, effectiveDcOut, {
                        effectiveTime: effectiveDcOut,
                        detectedAt: now,
                        forceIcon: '🔵',
                        clockOutSource: 'dc-timeout'
                    });
                } else {
                    u.checkedIn = false;
                    u.disconnected = false;
                    u.pendingClockOut = null;
                    u.disconnectedAt = null;
                    u.isFinished = true;
                    await recordLog(u, 'out', customMsg, effectiveDcOut, { effectiveTime: effectiveDcOut, forceIcon: '🔵' });
                }
            }
            if (m?.send) {
                let dmStatus = 'sent';
                let dmError = null;
                await m.send(buildDcTimeoutClockOutDm(
                    CONFIG.GRACE_PERIOD_MINS,
                    CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS
                )).catch(error => {
                    dmStatus = 'failed';
                    dmError = error?.message || String(error);
                });
                await appendAdminAudit('AUTO_DM_DC_TIMEOUT_CLOCK_OUT', {
                    targetId: id,
                    targetName: u.name || m.displayName || m.user?.username || id,
                    shift: u.shift || null,
                    mark: CONFIG.GRACE_PERIOD_MINS,
                    dmStatus,
                    dmError,
                    reason: 'voice-disconnect-timeout'
                });
            }
            changed = true;
        }
    }
    if (changed) {
        await saveSystemAsync();
        await renderDashboardCore({ forceMemberRefresh: true });
    }
}

async function autoOvertimeCheck() {
    const now = moment().tz(CONFIG.TIMEZONE);
    if (isMaintenanceWindow(now)) return;
    let changed = false;
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);

    function hasStaleAutoOvertimeRepairForTargetEnd(user, targetEnd) {
        if (!user || !targetEnd || !Array.isArray(user.sessions)) return false;
        return user.sessions.some(session => {
            if (session?.clockOutSource !== 'auto-repair-stale-overtime') return false;
            const raw = session.otStartedAt || session.scheduledEndAt || session.clockOutAt;
            if (!raw) return false;
            const repairedAt = moment(raw).tz(CONFIG.TIMEZONE);
            return repairedAt.isValid() && repairedAt.isSame(targetEnd, 'minute');
        });
    }

    const preOtBefore = getOvertimeUsers().length;
    const preOtToRemove = [];
    for (const ot of getOvertimeUsers()) {
        if (ot.type !== 'PRE_OT') continue;
        const u = getAttendanceData()[ot.id];
        const member = guild?.members.cache.get(ot.id);
        if (!u || !member || u.dayOff || u.isFinished) {
            preOtToRemove.push(ot.id);
            continue;
        }
        const bounds = getShiftBounds(u.shift, now);
        if (!bounds?.start || now.isBefore(bounds.start)) continue;

        transitionRecordedStatus(u, {
            attendanceStatus: 'WORKING',
            voiceStatus: member.voice?.streaming || guild?.voiceStates.cache.get(ot.id)?.streaming
                ? 'LIVE_ON'
                : (member.voice?.channelId || guild?.voiceStates.cache.get(ot.id)?.channelId ? 'LIVE_OFF' : 'OFFLINE')
        }, bounds.start, 'auto-overtime-check', 'pre-shift-ot-ended-regular-shift-started');
        u.pendingManualOT = false;
        u.isFinished = false;
        u.checkedIn = true;
        await recordLog(u, 'in', '정시 근무 시작 (사전 OT 종료)', null, { effectiveTime: bounds.start });
        preOtToRemove.push(ot.id);
        changed = true;
    }
    if (preOtToRemove.length > 0) {
        setOvertimeUsers(getOvertimeUsers().filter(ot => !preOtToRemove.includes(ot.id)));
    }
    if (getOvertimeUsers().length !== preOtBefore) changed = true;

    for (const id in getAttendanceData()) {
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) continue;
        const u = getAttendanceData()[id];
        if (!['day', 'night'].includes(u.shift)) continue;

        const member = guild?.members.cache.get(id);
        const voiceState = guild?.voiceStates.cache.get(id);
        const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
        const hasLiveException = Boolean(getActiveLiveException(id, now));
        const targetEnd = getOvertimeStartMoment(u, now);
        const postShiftContinuousWindowMins = Math.max(0, Number(CONFIG.POST_SHIFT_CONTINUOUS_OT_WINDOW_MINS || 30));
        const maxAutoOtMins = Math.max(60, Number(CONFIG.MAX_AUTO_OT_MINS || 0) || CONFIG.PURGE_MANUAL_OT * 60);
        const targetEndElapsedMins = targetEnd ? now.diff(targetEnd, 'minutes') : null;
        const isContinuousPostShiftOtWindow = targetEndElapsedMins != null &&
            targetEndElapsedMins >= CONFIG.AUTO_OT_AFTER_MINS &&
            targetEndElapsedMins <= postShiftContinuousWindowMins;
        const hasContinuousPostShiftLive = hasContinuousPostShiftLiveEvidence(
            u,
            targetEnd,
            now,
            isStreamingNow,
            hasLiveException
        );
        const canAutoStartPostResetOt = Boolean(
            !u.checkedIn &&
            !u.pendingManualOT &&
            !u.dayOff &&
            member &&
            targetEnd &&
            isContinuousPostShiftOtWindow &&
            hasContinuousPostShiftLive &&
            (isStreamingNow || hasLiveException) &&
            !isCurrentShiftRegularWorker(member, now) &&
            !hasStaleAutoOvertimeRepairForTargetEnd(u, targetEnd)
        );

        if (u.dayOff || getOvertimeUsers().some(ot => ot.id === id)) continue;
        if ((!u.checkedIn && !u.pendingManualOT) && !canAutoStartPostResetOt) continue;
        if (isCurrentShiftRegularWorker(member, now)) {
            if (u.checkedIn && u.attendanceStatus === 'OVERTIME') {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'WORKING',
                    voiceStatus: isStreamingNow ? 'LIVE_ON' : (member?.voice?.channelId || voiceState?.channelId ? 'LIVE_OFF' : 'OFFLINE')
                }, now, 'auto-overtime-check', 'current-shift-regular-worker');
                changed = true;
            }
            continue;
        }

        if (!targetEnd) continue;

        if (canAutoStartPostResetOt) {
            const confirmResult = await requestPostShiftOvertimeConfirmation(member, u, now, 'auto-overtime-check', {
                scheduledEnd: targetEnd
            });
            if (confirmResult.changed) changed = true;
            continue;
        }

        if (u.pendingManualOT && now.isSameOrAfter(targetEnd)) {
            if (isStreamingNow && addOvertimeUser(u, 'MANUAL', targetEnd)) {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'OVERTIME',
                    voiceStatus: 'LIVE_ON'
                }, targetEnd, 'auto-overtime-check', 'reserved-manual-ot-started');
                u.pendingManualOT = false;
                if (markMonthlyOvertimeAward(u, {
                    moment,
                    at: targetEnd,
                    timezone: CONFIG.TIMEZONE,
                    sourceKey: `manual:${targetEnd.toISOString()}`
                })) {
                    u.totalOT = (u.totalOT || 0) + 1;
                    u.points = (u.points || 0) + CONFIG.POINTS.OT;
                    incrementMonthlyAttendanceStat(u, {
                        moment,
                        at: targetEnd,
                        timezone: CONFIG.TIMEZONE,
                        field: 'totalOT',
                        pointsDelta: CONFIG.POINTS.OT
                    });
                }
                await recordLog(u, 'ot', '예약된 수동 연장 근무 시작');
                changed = true;
            }
            continue;
        }

        if (
            now.isSameOrAfter(targetEnd.clone().add(CONFIG.AUTO_OT_AFTER_MINS, 'minutes')) &&
            targetEndElapsedMins <= maxAutoOtMins &&
            !hasStaleAutoOvertimeRepairForTargetEnd(u, targetEnd)
        ) {
            const canRequestCheckedInAutoOt = Boolean(
                u.checkedIn &&
                (isStreamingNow || hasLiveException) &&
                hasContinuousPostShiftLive
            );
            if (canRequestCheckedInAutoOt) {
                const confirmResult = await requestPostShiftOvertimeConfirmation(member, u, now, 'auto-overtime-check', {
                    scheduledEnd: targetEnd
                });
                if (confirmResult.changed) changed = true;
                continue;
            }
            if (false) {
                await recordLog(u, 'ot', `자동 OT 감지 (정시 이후 ${formatDuration(now.diff(targetEnd, 'minutes'))} 라이브 유지)`);
                changed = true;
            }
        }
    }
    if (changed) {
        await saveSystemAsync();
        await renderDashboardCore({ forceMemberRefresh: true });
    }
}

async function grantLiveException(targetMember, hours = null, reason, approverMember) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const shift = determineShift(targetMember);
    if (!shift) return { ok: false, message: '대상에게 DAY/NIGHT 역할이 없습니다.' };

    const u = ensureUserData(targetMember, shift);
    if (!u) return { ok: false, message: '대상 데이터를 생성할 수 없습니다.' };

    const shouldStartNewSession = Boolean(u.isFinished || !u.checkedIn || !getOpenSession(u));
    const shiftEnd = getShiftBounds(shift, now).end;
    const expiresAt = hours ? now.clone().add(hours, 'hours') : shiftEnd.clone();
    if (!expiresAt || expiresAt.isSameOrBefore(now)) {
        return { ok: false, message: '현재 근무 종료 시간을 계산할 수 없습니다. 시간을 직접 입력해 주세요.' };
    }
    const approvedMinutes = Math.max(1, expiresAt.diff(now, 'minutes'));
    const liveExceptions = getLiveExceptionsMap(getLiveExceptions, logger);
    liveExceptions[targetMember.id] = {
        userId: targetMember.id,
        name: targetMember.displayName,
        shift,
        hours: hours || null,
        approvedMinutes,
        mode: hours ? 'manual-hours' : 'shift-end',
        reason,
        approvedBy: approverMember.id,
        approvedByName: approverMember.displayName || approverMember.user?.username || 'Unknown',
        approvedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'active'
    };

    setOvertimeUsers(getOvertimeUsers().filter(o => o.id !== targetMember.id));
    u.checkedIn = true;
    u.dayOff = false;
    u.disconnected = false;
    u.disconnectedAt = null;
    u.isFinished = false;
    u.shift = shift;
    u.status = 'exception';
    transitionRecordedStatus(u, {
        attendanceStatus: 'WORKING',
        voiceStatus: 'EXCEPTION'
    }, now, 'live-exception-command', 'admin-approved-live-exception');
    if (shouldStartNewSession) {
        u.checkInTime = now.format('hh:mm A');
        u.checkInRaw = now.toISOString();
        u.checkOutTime = null;
        u.checkOutRaw = null;
        u.lastClockOutSource = null;
        u.finishedPresence = null;
        u.finalLeftAt = null;
        u.finishedLiveOffReminderMarks = [];
        startAttendanceSession(u, shift, now, 'live-exception-command');
    } else {
        u.checkInTime = u.checkInTime || now.format('hh:mm A');
        u.checkInRaw = u.checkInRaw || now.toISOString();
    }
    u.voiceJoinedAt = null;
    u.liveOffStartedAt = null;
    u.lastLiveOnAt = now.toISOString();
    u.liveOffWarnedFor = null;
    await updateWorkingRole(targetMember, true);
    await saveSystemAsync();

    const logText = [
        `\`[${now.format('MM/DD HH:mm')}]\` 관리자 라이브 예외 승인`,
        `대상: **${targetMember.displayName}**`,
        `인정 범위: ${hours ? `${hours}시간` : '현재 근무 종료 시간까지'}`,
        `만료 시간: ${formatKoreanDateTime(expiresAt)}`,
        `사유: ${reason}`,
        `승인자: ${liveExceptions[targetMember.id].approvedByName}`
    ].join('\n');
    const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) await logChan.send(logText).catch(() => null);

    return { ok: true, expiresAt };
}

async function checkLiveExceptions() {
    const now = moment().tz(CONFIG.TIMEZONE);
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    let changed = false;

    const liveExceptions = getLiveExceptionsMap(getLiveExceptions, logger);
    for (const [userId, exception] of Object.entries(liveExceptions)) {
        if (!exception || exception.status !== 'active') continue;

        const member = guild?.members.cache.get(userId) || null;
        const u = getAttendanceData()[userId];
        const exceptionExpiresAt = moment(exception.expiresAt).tz(CONFIG.TIMEZONE);
        const approvedAt = exception.approvedAt ? moment(exception.approvedAt).tz(CONFIG.TIMEZONE) : null;
        const rawScheduledEnd = u
            ? (getScheduledEndMoment(u, now) || (exception.shift ? getShiftBounds(exception.shift, now).end : null))
            : (exception.shift ? getShiftBounds(exception.shift, now).end : null);
        const fallbackShiftEnd = exception.shift ? getShiftBounds(exception.shift, now).end : null;
        const scheduledEnd = rawScheduledEnd && approvedAt && rawScheduledEnd.isSameOrBefore(approvedAt)
            ? fallbackShiftEnd
            : rawScheduledEnd;
        const effectiveEnd = scheduledEnd && scheduledEnd.isBefore(exceptionExpiresAt)
            ? scheduledEnd
            : exceptionExpiresAt;
        if (now.isBefore(effectiveEnd)) continue;

        exception.status = 'expired';
        exception.expiredAt = now.toISOString();
        exception.expireReason = scheduledEnd && scheduledEnd.isSameOrBefore(exceptionExpiresAt) && now.isSameOrAfter(scheduledEnd)
            ? 'scheduled-shift-end'
            : 'exception-time-ended';

        if (u?.status === 'exception') {
            if (member && (u.checkedIn || u.disconnected)) {
                const outText = exception.expireReason === 'scheduled-shift-end'
                    ? '예정 퇴근 시간 도달 - 라이브 예외 자동 퇴근'
                    : '라이브 예외 시간 만료 - 자동 퇴근';
                await handleClockOut(member, u, now, outText, now, {
                    skipEarlyPenalty: true,
                    clockOutSource: 'live-exception-expired'
                });
            } else {
                u.checkedIn = false;
                u.disconnected = false;
                u.disconnectedAt = null;
                u.isFinished = true;
                u.status = null;
                u.checkOutTime = now.format('hh:mm A');
                u.checkOutRaw = now.toISOString();
                transitionRecordedStatus(u, {
                    attendanceStatus: 'FINISHED',
                    voiceStatus: 'OFFLINE'
                }, now, 'live-exception-expired', 'live-exception-expired-auto-finish');
                if (member) await updateWorkingRole(member, false);
            }
        }

        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
        if (logChan) {
            await logChan.send([
                `\`[${now.format('MM/DD HH:mm')}]\` 라이브 예외 만료`,
                `대상: **${exception.name || userId}**`,
                `처리 기준: ${exception.expireReason === 'scheduled-shift-end' ? '예정 퇴근 시간' : '예외 만료 시간'}`,
                `예정 퇴근: ${scheduledEnd ? formatKoreanDateTime(scheduledEnd) : '계산 불가'}`,
                `예외 만료: ${formatKoreanDateTime(exception.expiresAt)}`,
                '라이브 방송이 없으면 이제 출근으로 인정되지 않습니다.'
            ].join('\n')).catch(() => null);
        }
        changed = true;
    }

    if (changed) {
        await saveSystemAsync();
        await renderDashboardCore({ forceMemberRefresh: true });
    }
}

async function checkScheduledAnnouncements() {
    try {
        const now = moment().tz(CONFIG.TIMEZONE);
        const currentTime = now.format('HH:mm');
        const today = now.format('YYYY-MM-DD');
        for (let i = 1; i <= 6; i++) {
            const d = getAnnounceData()[i];
            if (d && d.active && d.time === currentTime && d.lastSentDate !== today) {
                const chan = await client.channels.fetch(CONFIG.ANNOUNCE_CHANNEL).catch(() => null);
                if (chan) {
                    const embed = new EmbedBuilder()
                        .setTitle(buildScheduledBroadcastTitle(i))
                        .setDescription(d.content)
                        .setColor('#5865F2')
                        .setTimestamp();
                    const roleIds = Array.isArray(d.roleIds)
                        ? d.roleIds.filter(Boolean)
                        : (d.roleId ? [d.roleId] : []);
                    const mentionText = roleIds.length
                        ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
                        : '@everyone';
                    await chan.send({ content: mentionText, embeds: [embed] })
                        .catch(e => console.error('[ANNOUNCE SEND ERROR]', e));
                    d.lastSentDate = today;
                    await saveSystemAsync();
                }
            }
        }
    } catch (e) {
        console.error('[ANNOUNCE ERROR]', e);
    }
}
    return {
        performSmartReset,
        checkAbsentWarnings,
        checkGracePeriods,
        autoOvertimeCheck,
        grantLiveException,
        checkLiveExceptions,
        checkScheduledAnnouncements
    };
}

module.exports = { createScheduledJobsWorkflow };
