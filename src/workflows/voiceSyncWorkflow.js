'use strict';

const {
    buildManualResumeRequiredDm,
    buildLiveOffWarningDm
} = require('../utils/attendanceDmMessages');

function createVoiceSyncWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        getAttendanceData,
        getOvertimeUsers = () => [],
        saveSystemAsync,
        refreshGuildMembers,
        determineShift,
        ensureUserData,
        getMemberShiftRole,
        getActiveLiveException,
        getShiftBounds,
        getScheduledEndMoment,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        isCurrentShiftRegularWorker,
        canStartPostShiftOvertime,
        getRestorableOvertimeSession,
        appendAttendanceEvent,
        transitionRecordedStatus,
        setFinishedPresence,
        handleClockOut,
        applyDisconnectedState,
        recordLog,
        getActiveApprovedDayOffReservation,
        clearStaleDayOffState,
        applyLiveExceptionState,
        handleClockIn,
        activatePendingManualOvertime,
        restoreOvertimeAfterFinish,
        notifyDayOffPresence = async () => false,
        notifyAfterFinishPresence = async () => false,
        notifyFinishedReturnToVoice = async () => false,
        notifyStandbyClockInRequired = async () => false,
        sendFinishedLiveOffReminder = async () => false,
        startPostShiftOvertime,
        recordLiveConfirmation,
        recordLiveRecovery,
        markLiveOffState,
        clearLiveOffState,
        isFinishedBeforeCurrentShift = () => false,
        applyLiveOnState = () => ({ changed: false }),
        updateWorkingRole = async () => {},
        canStartOvertimeNow = () => false,
        startAttendanceSession = () => {},
        formatDuration = mins => String(mins),
        logger = console
    } = deps;
async function applyVoiceSnapshot(member, user, shift, snapshot, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!member || !user || !shift) return false;
    let changed = false;
    const source = snapshot.source || 'voice_snapshot';
    const wasConnected = Boolean(snapshot.wasConnected);
    const isConnected = Boolean(snapshot.isConnected);
    const wasStreaming = Boolean(snapshot.wasStreaming);
    const isStreaming = Boolean(snapshot.isStreaming);
    const joinedVoice = !wasConnected && isConnected;
    const leftVoice = wasConnected && !isConnected;
    const becameLive = !wasStreaming && isStreaming;
    const stoppedStreaming = wasStreaming && !isStreaming;
    const maintenance = isMaintenanceWindow(now);

    if (maintenance && !isWithinPreShiftWindow(shift, now)) {
        if (joinedVoice) appendAttendanceEvent(user, 'voice_join_maintenance', now, source, { live: isStreaming });
        if (becameLive) appendAttendanceEvent(user, 'live_on_maintenance', now, source);
        return false;
    }

    const bounds = getShiftBounds(shift, now);
    const hasRestorableOvertime = Boolean(isStreaming && !user.checkedIn && getRestorableOvertimeSession(user, shift, now));
    const canStartPostShiftOt = Boolean(
        isStreaming &&
        !isCurrentShiftRegularWorker(member, now) &&
        canStartPostShiftOvertime(user, now)
    );
    
    // ✨ [핵심 수정] 출근한 사람(checkedIn)이거나 이미 퇴근 대기 중인 사람(isFinished)은 
    // 근무 시간이 지나도 채널 상태 감지를 무시하지 않도록 강제 예외 처리합니다.
    if (!user.checkedIn && !user.isFinished && !user.pendingManualOT && !hasRestorableOvertime && !canStartPostShiftOt && !now.isBetween(bounds.start, bounds.end, null, '[]') && !isWithinPreShiftWindow(shift, now)) {
        return false;
    }

    if (user.isFinished && !user.checkedIn) {
        if (!isConnected) {
            return setFinishedPresence(user, 'left_voice', now, source);
        }
        if (setFinishedPresence(user, 'in_voice', now, source)) changed = true;
    }

    const activeLiveException = getActiveLiveException(member.id, now);

    if (!isConnected) {
        if (user.voiceJoinedAt || user.liveOffStartedAt || user.liveOffWarnedFor) {
            user.voiceJoinedAt = null;
            user.liveOffStartedAt = null;
            user.liveOffWarnedFor = null;
            changed = true;
        }
        if (activeLiveException && !user.checkedIn && !user.isFinished) {
            applyLiveExceptionState(user, shift, now, source, 'live-exception-disconnected', {
                voiceStatus: 'DISCONNECTED',
                disconnected: false
            });
            changed = true;
        }
        if (transitionRecordedStatus(user, {
            voiceStatus: (user.checkedIn || activeLiveException) ? 'DISCONNECTED' : 'OFFLINE'
        }, now, source, (user.checkedIn || activeLiveException) ? 'voice-disconnected' : 'voice-offline')) changed = true;
        
        if ((user.checkedIn || activeLiveException) && !user.disconnected) {
            // ✨ 정규 퇴근 시간 이후에 채널을 나가면 즉시 퇴근 처리 (유예 없음)
            const shiftEnd = getScheduledEndMoment(user, now); 
            if (shiftEnd && now.isSameOrAfter(shiftEnd)) {
                await handleClockOut(member, user, now, '정규 퇴근 시간 이후 채널 이탈 (즉시 자동 퇴근)', now, { clockOutSource: 'auto-out-after-shift' });
                changed = true;
                return true;
            }

            applyDisconnectedState(user, now, source, {
                graceMins: CONFIG.GRACE_PERIOD_MINS,
                pendingReason: '음성채널 이탈 유예 시작',
                reason: 'voice-disconnected'
            });
            await recordLog(user, 'disconnect', source === 'heartbeat' ? 'DC (음성채널 이탈 감지)' : null);
            changed = true;
        }
        return changed;
    }

    if (user.dayOff) {
        const activeDayOffReservation = getActiveApprovedDayOffReservation(member.id, shift, now);
        if (isStreaming && isCurrentShiftRegularWorker(member, now) && !activeDayOffReservation) {
            clearStaleDayOffState(user, shift, now, source, 'current-regular-live-on-without-approved-reservation');
            await recordLog(user, 'reconnect', '현재 근무자 LIVE ON 감지 - 예약 없는 DAY OFF 상태 자동 해제');
            changed = true;
        } else {
        if (transitionRecordedStatus(user, {
            attendanceStatus: 'DAY_OFF',
            voiceStatus: isStreaming ? 'LIVE_ON' : 'LIVE_OFF'
        }, now, source, 'day-off-presence')) changed = true;
        if (isConnected) {
            const action = isStreaming ? 'LIVE ON while Day Off' : 'Voice channel presence while Day Off';
            return await notifyDayOffPresence(member, user, shift, now, action, isStreaming);
        }
        return false;
        }
    }

    if (activeLiveException) {
        const result = applyLiveExceptionState(user, shift, now, source, 'live-exception-voice-connected', {
            voiceStatus: 'EXCEPTION'
        });
        await updateWorkingRole(member, true);
        if (!result.wasCheckedIn || joinedVoice) {
            await recordLog(user, 'reconnect', '라이브 예외 근무 인정 - 음성채널 접속 확인');
        }
        return true;
    }

    if (canStartPostShiftOt && await startPostShiftOvertime(member, user, now, source)) {
        return true;
    }

    if (
        isStreaming &&
        isConnected &&
        isCurrentShiftRegularWorker(member, now) &&
        !user.checkedIn &&
        (user.isFinished || user.attendanceStatus === 'FINISHED') &&
        !getOvertimeUsers().some(ot => ot.id === member.id)
    ) {
        const scheduledEnd = getScheduledEndMoment(user, now);
        if (scheduledEnd && now.isBefore(scheduledEnd)) {
            user.isFinished = false;
            user.finishedPresence = null;
            user.finalLeftAt = null;
            user.manualResumeRequired = false;
            user.manualResumeRequiredSince = null;
            user.manualResumeRequiredReason = null;
            if (await handleClockIn(member, user, shift, now, true)) changed = true;
            if (await activatePendingManualOvertime(user, now)) changed = true;
            return true;
        }
    }

    if (isStreaming && isFinishedBeforeCurrentShift(user, shift, now)) {
        user.isFinished = false;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        if (await handleClockIn(member, user, shift, now, true)) changed = true;
        if (await activatePendingManualOvertime(user, now)) changed = true;
        return true;
    }

    const canResumeAsApprovedOt = Boolean(
        user.pendingManualOT &&
        canStartOvertimeNow(user, now)
    );
    const lastClockOutEvent = Array.isArray(user.attendanceEvents)
        ? user.attendanceEvents.slice().reverse().find(event => event?.type === 'clock_out_confirmed')
        : null;
    const lastClockOutSource = user.lastClockOutSource || lastClockOutEvent?.source || null;
    const lastClockOutAt = user.checkOutRaw || lastClockOutEvent?.at || null;
    const lastAutoTimeoutClockOutAt = lastClockOutAt ? moment(lastClockOutAt).tz(CONFIG.TIMEZONE) : null;
    const autoTimeoutResumeMins = lastAutoTimeoutClockOutAt
        ? now.diff(lastAutoTimeoutClockOutAt, 'minutes')
        : null;
    const isAutoTimeoutClockOut = ['dc-timeout', 'live-off-timeout'].includes(lastClockOutSource);
    const scheduledEnd = getScheduledEndMoment(user, now);
    const isBeforeScheduledEnd = Boolean(scheduledEnd && now.isBefore(scheduledEnd));
    const canAutoResumeCurrentRegularWorker = isCurrentShiftRegularWorker(member, now);
    const canResumeFromAutoTimeout = Boolean(
        isStreaming &&
        user.isFinished &&
        !user.checkedIn &&
        isAutoTimeoutClockOut &&
        isBeforeScheduledEnd &&
        autoTimeoutResumeMins !== null &&
        (canAutoResumeCurrentRegularWorker || autoTimeoutResumeMins <= CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS) &&
        (!user.manualResumeRequired || canAutoResumeCurrentRegularWorker) &&
        !getOvertimeUsers().some(ot => ot.id === member.id)
    );
    if (canResumeFromAutoTimeout) {
        const resumePenaltyKey = `${lastClockOutSource}:${lastAutoTimeoutClockOutAt.toISOString()}`;
        if (user.reversibleEarlyPenaltyKey === resumePenaltyKey) {
            user.totalEarly = Math.max(0, (user.totalEarly || 0) - 1);
            user.points = (user.points || 0) + (user.reversibleEarlyPenaltyPoints || Math.abs(CONFIG.POINTS.EARLY_OUT));
            user.reversibleEarlyPenaltyKey = null;
            user.reversibleEarlyPenaltyAppliedAt = null;
            user.reversibleEarlyPenaltyPoints = null;
            appendAttendanceEvent(user, 'early_penalty_reversed', now, source, {
                reason: 'auto-timeout-resumed-live-on',
                currentRegularWorker: canAutoResumeCurrentRegularWorker,
                clockOutSource: lastClockOutSource,
                clockOutAt: lastClockOutAt
            });
        }
        user.checkedIn = true;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = now.toISOString();
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, now, source, canAutoResumeCurrentRegularWorker ? 'current-regular-resumed-live-on' : 'auto-timeout-resumed-live-on');
        startAttendanceSession(user, shift, now, canAutoResumeCurrentRegularWorker ? 'current-regular-resume' : 'auto-timeout-resume');
        await updateWorkingRole(member, true);
        await recordLog(user, 'reconnect', canAutoResumeCurrentRegularWorker
            ? '현재 근무자 DC/LIVE OFF 종료 후 라이브 복구 (근무 재개)'
            : '자동 조기퇴근 후 라이브 복구 (근무 재개)');
        return true;
    }
    const shouldPromptManualResume = Boolean(
        isStreaming &&
        user.isFinished &&
        !user.checkedIn &&
        isAutoTimeoutClockOut &&
        isBeforeScheduledEnd &&
        autoTimeoutResumeMins !== null &&
        autoTimeoutResumeMins > CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS &&
        !canAutoResumeCurrentRegularWorker &&
        !getOvertimeUsers().some(ot => ot.id === member.id)
    );
    if (shouldPromptManualResume) {
        const promptKey = `${lastClockOutSource}:${lastClockOutAt}:manual-resume-required`;
        user.manualResumeRequired = true;
        user.manualResumeRequiredReason = lastClockOutSource;
        if (user.lastManualResumePromptKey !== promptKey) {
            user.lastManualResumePromptKey = promptKey;
            user.manualResumeRequiredSince = now.toISOString();
            user.manualResumePromptMarks = [];
        }
        const promptStartedAt = user.manualResumeRequiredSince
            ? moment(user.manualResumeRequiredSince).tz(CONFIG.TIMEZONE)
            : now.clone();
        const promptElapsedMins = Math.max(0, now.diff(promptStartedAt, 'minutes'));
        const reminderMark = Math.floor(promptElapsedMins / 10) * 10;
        const allowedReminderMarks = [0, 10, 20];
        if (allowedReminderMarks.includes(reminderMark) && !user.manualResumePromptMarks.includes(reminderMark)) {
            user.manualResumePromptMarks.push(reminderMark);
            const reminderNumber = allowedReminderMarks.indexOf(reminderMark) + 1;
            appendAttendanceEvent(user, 'manual_resume_required', now, source, {
                clockOutSource: lastClockOutSource,
                clockOutAt: lastClockOutAt,
                minutesSinceClockOut: autoTimeoutResumeMins,
                reminderNumber,
                reminderMark
            });
            await member.send(buildManualResumeRequiredDm(reminderNumber)).catch(() => null);
            await recordLog(user, 'reconnect', `자동 조기퇴근 후 60분 초과 복귀 감지 (CLOCK IN 버튼 필요, 안내 ${reminderNumber}/3)`);
        }
        return true;
    }
    if (isStreaming && !user.checkedIn && await restoreOvertimeAfterFinish(member, user, shift, now, source)) {
        return true;
    }
    if (user.isFinished && !user.checkedIn) {
        if (!isConnected) {
            if (setFinishedPresence(user, 'left_voice', now, source)) changed = true;
            if (transitionRecordedStatus(user, {
                attendanceStatus: 'FINISHED',
                voiceStatus: 'OFFLINE'
            }, now, source, 'finished-presence-offline')) changed = true;
            return changed;
        }

        if (setFinishedPresence(user, 'in_voice', now, source)) changed = true;
        if (transitionRecordedStatus(user, {
            attendanceStatus: 'FINISHED',
            voiceStatus: isStreaming ? 'LIVE_ON' : 'LIVE_OFF'
        }, now, source, 'finished-presence-kept')) changed = true;
        if (joinedVoice) {
            const notified = await notifyFinishedReturnToVoice(member, user, shift, now, 'Returned to voice after clock-out');
            if (notified) changed = true;
        }
        if (!isStreaming && isConnected) {
            const notified = await notifyStandbyClockInRequired(member, user, shift, now, 'Finished user in voice without live');
            if (notified) changed = true;
            const finishedReminderSent = await sendFinishedLiveOffReminder(member, user, now, source);
            if (finishedReminderSent) changed = true;
        }
        if (isStreaming) {
            const notified = await notifyAfterFinishPresence(member, user, shift, now, 'LIVE ON after clock-out');
            return changed || notified;
        }
        appendAttendanceEvent(user, joinedVoice ? 'voice_join_after_finish' : 'voice_live_off_after_finish', now, source, {
            result: 'finished_kept'
        });
        return true;
    }
    if (isStreaming && user.isFinished && !user.checkedIn && !canResumeAsApprovedOt && !getOvertimeUsers().some(ot => ot.id === member.id)) {
        return await notifyAfterFinishPresence(member, user, shift, now, 'LIVE ON after clock-out');
    }

    if (!isStreaming) {
        appendAttendanceEvent(user, joinedVoice ? 'voice_join' : 'voice_live_off_snapshot', now, source, { live: false });
        if (user.disconnected) {
            applyLiveOnState(user, now, source, `${source}_voice_rejoined_live_off`);
            markLiveOffState(user, now);
            await recordLog(user, 'reconnect', 'DC 복구 - 음성채널 재접속, 라이브 OFF 상태');
            await recordLog(user, 'disconnect', '라이브 OFF 시작 - 음성채널 접속 상태');
            return true;
        }
        if (
            user.checkedIn &&
            !user.isFinished &&
            !getActiveLiveException(member.id, now) &&
            user.status !== 'exception' &&
            user.voiceStatus !== 'EXCEPTION'
        ) {
            // ✨ 정규 퇴근 시간 이후에 방송을 끄면 즉시 퇴근 처리 (유예 없음)
            const shiftEnd = getScheduledEndMoment(user, now); 
            if (shiftEnd && now.isSameOrAfter(shiftEnd)) {
                await handleClockOut(member, user, now, '정규 퇴근 시간 이후 방송 종료 - 자동 퇴근', now, { clockOutSource: 'auto-out-after-shift-live-off' });
                changed = true;
                return true;
            }

            const started = markLiveOffState(user, now);
            const liveOffAt = user.liveOffStartedAt || user.voiceJoinedAt;
            const liveOffMins = liveOffAt ? now.diff(moment(liveOffAt).tz(CONFIG.TIMEZONE), 'minutes') : 0;
            const pendingLiveOffClockOutAt = user.pendingClockOut?.source === 'live_off' && user.pendingClockOut.expiresAt
                ? moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE)
                : (liveOffAt ? moment(liveOffAt).tz(CONFIG.TIMEZONE).add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes') : null);
            const isLiveOffClockOutDue = Boolean(pendingLiveOffClockOutAt && now.isSameOrAfter(pendingLiveOffClockOutAt));
            if (started) {
                await recordLog(user, 'disconnect', stoppedStreaming ? '라이브 OFF 시작 - 방송 종료' : '라이브 OFF 시작 - 음성채널 접속 상태');
                changed = true;
            }
            const warningMark = Math.floor(liveOffMins / CONFIG.LIVE_OFF_DM_INTERVAL_MINS) * CONFIG.LIVE_OFF_DM_INTERVAL_MINS;
            const liveOffReminderMarks = [10, 20];
            if (
                !isLiveOffClockOutDue &&
                liveOffReminderMarks.includes(warningMark) &&
                !user.liveOffWarningMarks.includes(warningMark)
            ) {
                const reminderNumber = liveOffReminderMarks.indexOf(warningMark) + 1;
                await member.send(buildLiveOffWarningDm(
                    reminderNumber,
                    warningMark,
                    CONFIG.LIVE_OFF_CLOCK_OUT_MINS
                )).catch(() => null);
                user.liveOffWarningMarks.push(warningMark);
                user.liveOffWarnedFor = `${shift}:${liveOffAt ? moment(liveOffAt).format('YYYY-MM-DD HH:mm') : now.format('YYYY-MM-DD HH:mm')}:${warningMark}`;
                changed = true;
            }
        } else if (!user.checkedIn && isWithinPreShiftWindow(shift, now)) {
            if (!user.voiceJoinedAt) {
                user.voiceJoinedAt = now.toISOString();
                changed = true;
            }
        } else if (!user.checkedIn && !user.isFinished && isConnected && now.isSameOrAfter(bounds.start)) {
            const notified = await notifyStandbyClockInRequired(member, user, shift, now, 'Standby voice without live');
            if (notified) changed = true;
        }
        return changed;
    }

    user.isFinished = false;
    const liveOffStartedAt = (user.liveOffStartedAt || user.voiceJoinedAt)
        ? moment(user.liveOffStartedAt || user.voiceJoinedAt).tz(CONFIG.TIMEZONE)
        : null;
    const liveOffDurationText = liveOffStartedAt
        ? ` [라이브 OFF 지속: ${formatDuration(Math.max(0, now.diff(liveOffStartedAt, 'minutes')))}]`
        : '';

    const wasDisconnectedBeforeLiveOn = Boolean(user.disconnected);
    if (applyLiveOnState(user, now, source, 'live-on-recovered').changed) changed = true;

    if (wasDisconnectedBeforeLiveOn) {
        applyLiveOnState(user, now, source, `${source}_live_recovered_from_dc`);
        if (!user.checkedIn) await handleClockIn(member, user, shift, now, true);
        transitionRecordedStatus(user, {
            voiceStatus: 'LIVE_ON'
        }, now, source, 'dc-recovered-live-on');
        await recordLog(user, 'reconnect', 'DC 복구 - 라이브 ON 상태로 복귀');
        await recordLog(user, 'reconnect', '라이브 ON 복구 - DC 이후 방송 재개' + liveOffDurationText);
        if (await activatePendingManualOvertime(user, now)) changed = true;
        return true;
    }

    if (!user.checkedIn) {
        if (user.isFinished) {
            return changed; 
        }

        if (await handleClockIn(member, user, shift, now, true)) changed = true;
        if (await activatePendingManualOvertime(user, now)) changed = true;
        return true;
    }

    if (transitionRecordedStatus(user, {
        voiceStatus: 'LIVE_ON'
    }, now, source, 'live-on-confirmed')) changed = true;

    if (becameLive || liveOffStartedAt) {
        const text = liveOffStartedAt
            ? '라이브 ON 복구 - 방송 재개' + liveOffDurationText
            : '라이브 ON 확인 - 출근 상태 유지';
        if (liveOffStartedAt) {
            if (await recordLiveRecovery(member, user, shift, now, liveOffStartedAt, text)) changed = true;
        } else if (await recordLiveConfirmation(member, user, shift, now, text)) {
            changed = true;
        }
    } else if (source === 'heartbeat' && await recordLiveConfirmation(member, user, shift, now)) {
        changed = true;
    }

    if (await activatePendingManualOvertime(user, now)) changed = true;
    return changed;
}

async function syncVoiceStates() {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (!guild) return;
        await refreshGuildMembers(guild);
        const now = moment().tz(CONFIG.TIMEZONE);
        let changed = false;
        const activeVoiceIds = new Set(guild.voiceStates.cache.map(voiceState => voiceState.id));

        for (const voiceState of guild.voiceStates.cache.values()) {
            const member = voiceState.member || guild.members.cache.get(voiceState.id);
            if (!member || member.user?.bot) continue;
            const shift = determineShift(member);
            if (!shift) continue;
            const u = ensureUserData(member, shift);
            if (!u) continue;
            if (await applyVoiceSnapshot(member, u, shift, {
                source: 'heartbeat',
                wasConnected: Boolean(
                    voiceState.channelId ||
                    u.voiceStatus === 'LIVE_ON' ||
                    u.voiceStatus === 'LIVE_OFF' ||
                    u.checkedIn ||
                    u.disconnected
                ),
                isConnected: Boolean(voiceState.channelId),
                wasStreaming: u.voiceStatus === 'LIVE_ON',
                isStreaming: Boolean(voiceState.streaming)
            }, now)) changed = true;
        }

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;
            const u = getAttendanceData()[member.id];
            if (!u) continue;
            if (getActiveLiveException(member.id, now) && activeVoiceIds.has(member.id)) continue;
            if (!activeVoiceIds.has(member.id)) {
                const shift = u.shift || getMemberShiftRole(member);
                if (!shift) continue;
                if (await applyVoiceSnapshot(member, u, shift, {
                    source: 'heartbeat',
                    wasConnected: Boolean(member.voice?.channelId || u.checkedIn || u.disconnected || u.voiceJoinedAt || u.liveOffStartedAt),
                    isConnected: false,
                    wasStreaming: Boolean(member.voice?.streaming),
                    isStreaming: false
                }, now)) changed = true;
            }
        }
        if (changed) await saveSystemAsync();
    } catch (e) {
        console.error('[VOICE SYNC ERROR]', e);
    }
}
    return {
        applyVoiceSnapshot,
        syncVoiceStates
    };
}

module.exports = { createVoiceSyncWorkflow };
