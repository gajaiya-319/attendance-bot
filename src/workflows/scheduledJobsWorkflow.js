'use strict';

const {
    buildLiveOffClockOutDm,
    buildDcTimeoutClockOutDm,
    buildScheduledBroadcastTitle
} = require('../utils/attendanceDmMessages');
const { getLiveExceptionsMap } = require('../utils/liveExceptionsAccess');

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
        formatDuration,
        logger = console
    } = deps;
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
    let changed = false;
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
            const liveOffTimeoutText = `라이브 OFF 유예 초과 자동 퇴근 (인정 퇴근 ${effectiveOut.format('hh:mm A')} / 처리 ${now.format('hh:mm A')})`;
            if (m) {
                await handleClockOut(m, u, now, liveOffTimeoutText, effectiveOut,
                    { effectiveTime: effectiveOut, detectedAt: now, forceIcon: '🔴', clockOutSource: 'live-off-timeout' }
                );
            } else {
                console.warn(`[GRACE WARN] live-off timeout: member ${id} not in cache, applying state only.`);
                u.checkedIn = false;
                u.disconnected = false;
                u.pendingClockOut = null;
                u.liveOffStartedAt = null;
                u.isFinished = true;
                await recordLog(u, 'out', liveOffTimeoutText, effectiveOut, { effectiveTime: effectiveOut, forceIcon: '🔴' });
            }
            if (m?.send) {
                if (!Array.isArray(u.liveOffWarningMarks)) u.liveOffWarningMarks = [];
                if (!u.liveOffWarningMarks.includes(CONFIG.LIVE_OFF_CLOCK_OUT_MINS)) {
                    u.liveOffWarningMarks.push(CONFIG.LIVE_OFF_CLOCK_OUT_MINS);
                }
                await m.send(buildLiveOffClockOutDm(CONFIG.LIVE_OFF_CLOCK_OUT_MINS)).catch(() => null);
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
            const earlyMins = scheduledEnd ? scheduledEnd.diff(effectiveDcOut, 'minutes') : 0;
            const customMsg = earlyMins > CONFIG.CLOCK_OUT_GRACE_MINS ? 'DC 유예 시간 초과 (조기 퇴근)' : 'DC 유예 시간 초과 (정상 퇴근)';
            if (m) {
                await handleClockOut(m, u, now, customMsg, effectiveDcOut, {
                    effectiveTime: effectiveDcOut,
                    detectedAt: now,
                    forceIcon: '🔴',
                    clockOutSource: 'dc-timeout'
                });
            } else {
                console.warn(`[GRACE WARN] dc-timeout: member ${id} not in cache, applying state only.`);
                u.checkedIn = false;
                u.disconnected = false;
                u.pendingClockOut = null;
                u.disconnectedAt = null;
                u.isFinished = true;
                await recordLog(u, 'out', customMsg, effectiveDcOut, { effectiveTime: effectiveDcOut, forceIcon: '🔴' });
            }
            if (m?.send) {
                await m.send(buildDcTimeoutClockOutDm(
                    CONFIG.GRACE_PERIOD_MINS,
                    CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS
                )).catch(() => null);
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
        if ((!u.checkedIn && !u.pendingManualOT) || u.dayOff || getOvertimeUsers().some(ot => ot.id === id)) continue;
        if (!['day', 'night'].includes(u.shift)) continue;

        const member = guild?.members.cache.get(id);
        if (isCurrentShiftRegularWorker(member, now)) {
            if (u.checkedIn && u.attendanceStatus === 'OVERTIME') {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'WORKING',
                    voiceStatus: member?.voice?.streaming || guild?.voiceStates.cache.get(id)?.streaming ? 'LIVE_ON' : (member?.voice?.channelId || guild?.voiceStates.cache.get(id)?.channelId ? 'LIVE_OFF' : 'OFFLINE')
                }, now, 'auto-overtime-check', 'current-shift-regular-worker');
                changed = true;
            }
            continue;
        }

        const targetEnd = getOvertimeStartMoment(u, now);
        if (!targetEnd) continue;

        if (u.pendingManualOT && now.isSameOrAfter(targetEnd)) {
            const voiceState = guild?.voiceStates.cache.get(id);
            const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
            if (isStreamingNow && addOvertimeUser(u, 'MANUAL', targetEnd)) {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'OVERTIME',
                    voiceStatus: 'LIVE_ON'
                }, targetEnd, 'auto-overtime-check', 'reserved-manual-ot-started');
                u.pendingManualOT = false;
                u.totalOT = (u.totalOT || 0) + 1;
                u.points = (u.points || 0) + CONFIG.POINTS.OT;
                await recordLog(u, 'ot', '예약된 수동 연장 근무 시작');
                changed = true;
            }
            continue;
        }

        if (now.isSameOrAfter(targetEnd.clone().add(CONFIG.AUTO_OT_AFTER_MINS, 'minutes'))) {
            const voiceState = guild?.voiceStates.cache.get(id);
            const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
            const hasLiveException = Boolean(getActiveLiveException(id, now));
            if ((isStreamingNow || hasLiveException) && addOvertimeUser(u, 'AUTO', targetEnd)) {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'OVERTIME',
                    voiceStatus: isStreamingNow ? 'LIVE_ON' : 'EXCEPTION'
                }, targetEnd, 'auto-overtime-check', 'auto-ot-started');
                u.totalOT = (u.totalOT || 0) + 1;
                u.points = (u.points || 0) + CONFIG.POINTS.OT;
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
        return { ok: false, message: '현재 근무 종료 시간을 계산할 수 없습니다. 시간을 직접 입력해주세요.' };
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
        `\`[${now.format('MM/DD HH:mm')}]\` 👑 관리자 라이브 예외 승인`,
        `👥 대상: **${targetMember.displayName}**`,
        `⏰ 인정 범위: ${hours ? `${hours}시간` : '현재 근무 종료 시각까지'}`,
        `⏳ 만료 시간: ${formatKoreanDateTime(expiresAt)}`,
        `📝 사유: ${reason}`,
        `👑 승인자: ${liveExceptions[targetMember.id].approvedByName}`
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
                `\`[${now.format('MM/DD HH:mm')}]\` ⏰ 라이브 예외 만료`,
                `👥 대상: **${exception.name || userId}**`,
                `⏱️ 처리 기준: ${exception.expireReason === 'scheduled-shift-end' ? '예정 퇴근 시간' : '예외 만료 시간'}`,
                `🕐 예정 퇴근: ${scheduledEnd ? formatKoreanDateTime(scheduledEnd) : '계산 불가'}`,
                `⏳ 예외 만료: ${formatKoreanDateTime(exception.expiresAt)}`,
                '라이브 방송이 없으면 이제 출근 인정되지 않습니다.'
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
        checkGracePeriods,
        autoOvertimeCheck,
        grantLiveException,
        checkLiveExceptions,
        checkScheduledAnnouncements
    };
}

module.exports = { createScheduledJobsWorkflow };
