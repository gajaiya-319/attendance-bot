'use strict';

function createButtonActionHandlers({
    MessageFlags,
    getShiftBounds,
    handleClockOut,
    handleClockIn,
    appendAttendanceEvent,
    applyLiveExceptionState,
    applyDayOffState,
    applyLiveOnState,
    applyManualResumeRequiredState,
    applyPendingOvertimeReservationState,
    applyOvertimeState,
    canStartOvertimeNow,
    canStartPreShiftOvertime,
    getActiveLiveException,
    getOvertimeStartMoment,
    getVoiceSnapshot,
    isOvertimeUser,
    markLiveOffState,
    markWorkedOnDayOff,
    notifyDayOffPresence,
    removeOvertimeUser,
    resetFinishedForPreClockIn,
    renderDashboard,
    saveSystem,
    setLiveException,
    startPreShiftOvertime,
    updateWorkingRole,
    recordLog,
    getCompletionMessage = () => '처리되었습니다.'
}) {
    if (typeof getShiftBounds !== 'function') throw new TypeError('getShiftBounds must be a function');
    if (typeof handleClockOut !== 'function') throw new TypeError('handleClockOut must be a function');
    if (typeof handleClockIn !== 'function') throw new TypeError('handleClockIn must be a function');
    if (typeof appendAttendanceEvent !== 'function') throw new TypeError('appendAttendanceEvent must be a function');
    if (typeof applyLiveExceptionState !== 'function') throw new TypeError('applyLiveExceptionState must be a function');
    if (typeof applyDayOffState !== 'function') throw new TypeError('applyDayOffState must be a function');
    if (typeof applyLiveOnState !== 'function') throw new TypeError('applyLiveOnState must be a function');
    if (typeof applyManualResumeRequiredState !== 'function') throw new TypeError('applyManualResumeRequiredState must be a function');
    if (typeof applyPendingOvertimeReservationState !== 'function') throw new TypeError('applyPendingOvertimeReservationState must be a function');
    if (typeof applyOvertimeState !== 'function') throw new TypeError('applyOvertimeState must be a function');
    if (typeof canStartOvertimeNow !== 'function') throw new TypeError('canStartOvertimeNow must be a function');
    if (typeof canStartPreShiftOvertime !== 'function') throw new TypeError('canStartPreShiftOvertime must be a function');
    if (typeof getActiveLiveException !== 'function') throw new TypeError('getActiveLiveException must be a function');
    if (typeof getOvertimeStartMoment !== 'function') throw new TypeError('getOvertimeStartMoment must be a function');
    if (typeof getVoiceSnapshot !== 'function') throw new TypeError('getVoiceSnapshot must be a function');
    if (typeof isOvertimeUser !== 'function') throw new TypeError('isOvertimeUser must be a function');
    if (typeof markLiveOffState !== 'function') throw new TypeError('markLiveOffState must be a function');
    if (typeof markWorkedOnDayOff !== 'function') throw new TypeError('markWorkedOnDayOff must be a function');
    if (typeof notifyDayOffPresence !== 'function') throw new TypeError('notifyDayOffPresence must be a function');
    if (typeof removeOvertimeUser !== 'function') throw new TypeError('removeOvertimeUser must be a function');
    if (typeof resetFinishedForPreClockIn !== 'function') throw new TypeError('resetFinishedForPreClockIn must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof setLiveException !== 'function') throw new TypeError('setLiveException must be a function');
    if (typeof startPreShiftOvertime !== 'function') throw new TypeError('startPreShiftOvertime must be a function');
    if (typeof updateWorkingRole !== 'function') throw new TypeError('updateWorkingRole must be a function');
    if (typeof recordLog !== 'function') throw new TypeError('recordLog must be a function');
    if (typeof getCompletionMessage !== 'function') throw new TypeError('getCompletionMessage must be a function');

    async function reply(interaction, autoDel, content, delay) {
        return interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel(delay));
    }

    async function persistDashboard() {
        await saveSystem();
        await renderDashboard({ forceMemberRefresh: true });
    }

    async function preflightAction({ interaction, autoDel, user, type }) {
        if (type === 'in' && user.checkedIn && !user.dayOff && !user.disconnected) {
            await persistDashboard();
            return {
                handled: true,
                response: reply(interaction, autoDel, '이미 출근 상태입니다.', 2000)
            };
        }

        if (type === 'out' && !user.checkedIn && !user.disconnected) {
            return {
                handled: true,
                response: reply(interaction, autoDel, '출근 상태가 아닙니다.', 2000)
            };
        }

        return { handled: false };
    }

    async function handleOut({ member, user, now }) {
        await handleClockOut(member, user, now);
        return true;
    }

    async function handleOff({ member, user, shift, now }) {
        if (user.checkedIn || user.disconnected || isOvertimeUser(member.id)) {
            await handleClockOut(member, user, now, '휴무 버튼 전환 전 퇴근 처리');
        }
        user.dayOffExpireAt = getShiftBounds(shift, now).end.toISOString();
        applyDayOffState(user, now, 'button-or-command', 'day-off-button');
        user.offCount = (user.offCount || 0) + 1;
        removeOvertimeUser(member.id);
        await updateWorkingRole(member, false);
        await recordLog(user, 'off');
        return true;
    }

    async function handleClockInLiveGate({ interaction, autoDel, member, user, shift, now }) {
        const wasDayOff = Boolean(user.dayOff);
        const { isVoiceConnected, isStreamingNow } = getVoiceSnapshot(interaction, member);
        const activeLiveException = getActiveLiveException(member.id, now);
        const canClockInByLiveException = Boolean(isVoiceConnected && activeLiveException);

        if (wasDayOff && !isStreamingNow && !canClockInByLiveException) {
            await notifyDayOffPresence(member, user, shift, now, 'CLOCK IN attempted while Day Off', false);
            await persistDashboard();
            return {
                handled: true,
                wasDayOff,
                activeLiveException,
                canClockInByLiveException,
                response: reply(interaction, autoDel, [
                    '현재 휴무(Day Off)로 등록되어 있습니다.',
                    '',
                    '오늘 근무를 시작하려면 라이브를 켠 뒤 출근(CLOCK IN) 버튼을 다시 눌러 주세요.',
                    '라이브가 켜진 상태에서 CLOCK IN을 눌러야만 출근으로 인정됩니다.'
                ].join('\n'), 7000)
            };
        }

        const canSelfResumeLiveException = Boolean(
            isVoiceConnected &&
            !isStreamingNow &&
            !activeLiveException &&
            user.isFinished &&
            ['live-off-timeout', 'live-exception-expired'].includes(user.lastClockOutSource)
        );
        if (canSelfResumeLiveException) {
            const exceptionExpiresAt = getShiftBounds(shift, now).end;
            const previousClockOutSource = user.lastClockOutSource || null;
            const previousClockOutAt = user.checkOutRaw || null;
            setLiveException(member.id, {
                userId: member.id,
                name: member.displayName,
                shift,
                hours: null,
                approvedMinutes: Math.max(1, exceptionExpiresAt.diff(now, 'minutes')),
                mode: 'self-clock-in',
                reason: 'Unable to turn on LIVE; resumed from FINISHED by CLOCK IN',
                approvedBy: member.id,
                approvedByName: member.displayName || member.user?.username || 'Unknown',
                approvedAt: now.toISOString(),
                expiresAt: exceptionExpiresAt.toISOString(),
                status: 'active'
            });
            applyLiveExceptionState(user, shift, now, 'button-or-command', 'self-live-exception-clock-in', {
                voiceStatus: 'EXCEPTION'
            });
            user.manualResumeRequired = false;
            user.manualResumeRequiredSince = null;
            user.manualResumeRequiredReason = null;
            user.lastManualResumePromptKey = null;
            user.manualResumePromptMarks = [];
            appendAttendanceEvent(user, 'self_live_exception_clock_in', now, 'button-or-command', {
                previousClockOutSource,
                previousClockOutAt,
                exceptionExpiresAt: exceptionExpiresAt.toISOString()
            });
            await updateWorkingRole(member, true);
            await recordLog(user, 'reconnect', '라이브 불가 예외 CLOCK IN - 근무 인정');
            await persistDashboard();
            return {
                handled: true,
                wasDayOff,
                activeLiveException: null,
                canClockInByLiveException: false,
                response: reply(
                    interaction,
                    autoDel,
                    '라이브 예외로 근무가 재개되었습니다. 현황판에는 라이브 예외로 표시됩니다.',
                    7000
                )
            };
        }

        if (!isStreamingNow && !canClockInByLiveException) {
            if (user.manualResumeRequired) {
                applyManualResumeRequiredState(user, now, 'button-or-command', 'manual-resume-live-required', {
                    voiceStatus: isVoiceConnected ? 'LIVE_OFF' : 'OFFLINE'
                });
                await persistDashboard();
                return {
                    handled: true,
                    wasDayOff,
                    activeLiveException,
                    canClockInByLiveException,
                    response: reply(
                        interaction,
                        autoDel,
                        isVoiceConnected
                            ? '아직 퇴근(FINISHED) 상태입니다. 라이브를 먼저 켠 뒤 출근(CLOCK IN)을 다시 눌러 주세요. 라이브 ON 상태에서 CLOCK IN을 눌러야 출근으로 인정됩니다.'
                            : '아직 퇴근(FINISHED) 상태입니다. 음성 채널에 들어가 라이브를 켠 뒤 출근(CLOCK IN)을 다시 눌러 주세요. 그렇지 않으면 출근으로 인정되지 않습니다.',
                        7000
                    )
                };
            }
            resetFinishedForPreClockIn(user, now, 'button-or-command', 'clock-in-live-required', {
                voiceStatus: isVoiceConnected ? 'LIVE_OFF' : 'OFFLINE'
            });
            if (isVoiceConnected) markLiveOffState(user, now);
            await persistDashboard();
            return {
                handled: true,
                wasDayOff,
                activeLiveException,
                canClockInByLiveException,
                response: reply(
                    interaction,
                    autoDel,
                    isVoiceConnected
                        ? [
                            '라이브 방송을 켜 주세요.',
                            '',
                            '지금 라이브를 켤 수 없나요?',
                            '음성 채널에 남아 출근(CLOCK IN)을 누르면 라이브 예외로 재개할 수 있습니다.',
                            '그렇게 해야만 근무로 인정됩니다.',
                            '',
                            '라이브를 정말 켤 수 없을 때만 이용해 주세요.',
                            'CLOCK IN을 누르지 않으면 출근이 인정되지 않습니다.'
                        ].join('\n')
                        : '음성 채널에 들어가 라이브를 켜야 출근이 인정됩니다.',
                    isVoiceConnected ? 10000 : 3000
                )
            };
        }

        return {
            handled: false,
            wasDayOff,
            activeLiveException,
            canClockInByLiveException,
            isVoiceConnected,
            isStreamingNow
        };
    }

    async function handleClockInComplete({
        interaction,
        autoDel,
        member,
        user,
        shift,
        now,
        gate
    }) {
        const {
            wasDayOff,
            isVoiceConnected,
            isStreamingNow,
            activeLiveException,
            canClockInByLiveException
        } = gate;

        if (user.isFinished) {
            resetFinishedForPreClockIn(user, now, 'button-or-command', 'clock-in-retry-before-live', {
                voiceStatus: isVoiceConnected ? (isStreamingNow ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE'
            });
        }

        if (canStartPreShiftOvertime(user, now)) {
            await startPreShiftOvertime(member, user, shift, now, 'button-or-command');
            const workedDayOffReservation = wasDayOff
                ? await markWorkedOnDayOff(member, user, shift, now)
                : null;
            if (workedDayOffReservation) {
                appendAttendanceEvent(user, 'dayoff_clock_in_confirmed', now, 'button-or-command', {
                    reservationMessageId: workedDayOffReservation.messageId || null,
                    leaveDate: workedDayOffReservation.leaveDate || null,
                    mode: 'pre-shift-overtime'
                });
            }
            await persistDashboard();
            return {
                handled: true,
                response: reply(interaction, autoDel, [
                    '✅ 사전 OT가 시작되었습니다.',
                    '',
                    `정규 ${shift.toUpperCase()} 근무는 ${getShiftBounds(shift, now).start.format('hh:mm A')}에 시작합니다.`,
                    '그 전까지는 연장 근무(OT)로 표시됩니다.'
                ].join('\n'), 7000)
            };
        }

        if (user.disconnected) {
            applyLiveOnState(user, now, 'button-or-command', 'clock-in-dc-recovered');
            await recordLog(user, 'reconnect', 'DC 복구');
        } else {
            const clockedIn = await handleClockIn(member, user, shift, now, false);
            if (!clockedIn) {
                const bounds = getShiftBounds(shift, now);
                await persistDashboard();
                return {
                    handled: true,
                    response: reply(
                        interaction,
                        autoDel,
                        `출근이 인정되지 않았습니다. 감지된 근무조: ${shift.toUpperCase()}. 근무 시작: ${bounds.start.format('hh:mm A')}. DAY/NIGHT 역할을 확인한 뒤, 라이브 ON 상태에서 출근(CLOCK IN)을 다시 눌러 주세요.`,
                        7000
                    )
                };
            }
        }

        const workedDayOffReservation = wasDayOff
            ? await markWorkedOnDayOff(member, user, shift, now)
            : null;
        if (canClockInByLiveException) {
            applyLiveExceptionState(user, shift, now, 'button-or-command', 'clock-in-with-live-exception', {
                voiceStatus: 'EXCEPTION'
            });
            appendAttendanceEvent(user, 'clock_in_with_live_exception', now, 'button-or-command', {
                exceptionApprovedAt: activeLiveException.approvedAt || null,
                exceptionExpiresAt: activeLiveException.expiresAt || null
            });
            await recordLog(user, 'reconnect', '라이브 예외 대상 CLOCK IN - 근무 인정');
        }
        if (workedDayOffReservation) {
            appendAttendanceEvent(user, 'dayoff_clock_in_confirmed', now, 'button-or-command', {
                reservationMessageId: workedDayOffReservation.messageId || null,
                leaveDate: workedDayOffReservation.leaveDate || null
            });
        }

        return { handled: false };
    }

    async function handleOvertime({ interaction, autoDel, member, user, shift, now }) {
        if (user.dayOff) {
            await notifyDayOffPresence(member, user, shift, now, 'OVERTIME attempted while Day Off');
            await persistDashboard();
            return {
                handled: true,
                response: reply(
                    interaction,
                    autoDel,
                    '현재 휴무(Day Off)입니다. OT는 자동으로 인정되지 않습니다. 관리자 승인이 필요합니다.',
                    5000
                )
            };
        }

        const { isVoiceConnected, isStreamingNow } = getVoiceSnapshot(interaction, member);
        const overtimeStart = getOvertimeStartMoment(user, now);
        const isOvertimeWindow = canStartOvertimeNow(user, now);
        const isPreShiftOvertimeWindow = canStartPreShiftOvertime(user, now);

        if (!user.checkedIn && !isOvertimeWindow) {
            if (isPreShiftOvertimeWindow && isStreamingNow) {
                await startPreShiftOvertime(member, user, shift, now, 'button-or-command');
                await persistDashboard();
                return {
                    handled: true,
                    response: reply(interaction, autoDel, [
                        '✅ 사전 OT가 시작되었습니다.',
                        '',
                        `정규 ${shift.toUpperCase()} 근무는 ${getShiftBounds(shift, now).start.format('hh:mm A')}에 시작합니다.`,
                        '그 전까지는 연장 근무(OT)로 표시됩니다.'
                    ].join('\n'), 7000)
                };
            }

            await persistDashboard();
            return {
                handled: true,
                response: reply(interaction, autoDel, [
                    '⚠️ OT 예약이 되지 않았습니다.',
                    '',
                    isPreShiftOvertimeWindow
                        ? '정규 근무 시작 전이지만 라이브가 켜져 있지 않습니다.'
                        : '아직 출근 처리되지 않았습니다.',
                    isPreShiftOvertimeWindow
                        ? '음성 채널에 들어가 라이브를 켠 뒤 OVERTIME을 다시 눌러 주세요.'
                        : '라이브를 켠 뒤 출근(CLOCK IN) 버튼을 먼저 눌러 주세요.',
                    '',
                    `OT는 ${overtimeStart ? overtimeStart.format('hh:mm A') : '근무 종료'} 이후부터 가능합니다.`
                ].join('\n'), 7000)
            };
        }

        if (!isStreamingNow) {
            applyPendingOvertimeReservationState(user, now, 'button-or-command', 'manual-ot-reserved-live-off', {
                voiceConnected: isVoiceConnected
            });
            await recordLog(user, 'ot', 'OT 예약 대기 (라이브 ON 후 정시 이후 인정)');
            await persistDashboard();
            return {
                handled: true,
                response: reply(
                    interaction,
                    autoDel,
                    isVoiceConnected
                        ? 'OT 대기 상태입니다. 라이브를 켜면 수동 OT가 인정됩니다.'
                        : '음성 채널에 들어가 라이브를 켜야 OT가 인정됩니다.',
                    3000
                )
            };
        }

        if (!isOvertimeWindow) {
            applyPendingOvertimeReservationState(user, now, 'button-or-command', 'manual-ot-reserved-before-window', {
                voiceConnected: false
            });
            await recordLog(user, 'ot', `OT 예약 등록 (정시 이후 ${overtimeStart ? overtimeStart.format('hh:mm A') : '근무 종료'}부터 인정)`);
            await persistDashboard();
            return {
                handled: true,
                response: reply(
                    interaction,
                    autoDel,
                    `OT 예약이 저장되었습니다. ${overtimeStart ? overtimeStart.format('hh:mm A') : '근무 종료'} 이후에도 라이브를 유지하면 수동 OT로 전환됩니다.`,
                    5000
                )
            };
        }

        if (!user.checkedIn) await handleClockIn(member, user, shift, now, false);
        const result = applyOvertimeState(user, now, 'MANUAL', 'button-or-command', 'manual-ot-button-started', {
            voiceStatus: 'LIVE_ON',
            sessionSource: 'manual-ot-button'
        });
        if (result.added) {
            await recordLog(user, 'ot', '수동 연장 근무 시작');
        }
        return { handled: false };
    }

    async function completeAction({ interaction, autoDel, type }) {
        await reply(interaction, autoDel, getCompletionMessage(type), 2000);
        await persistDashboard();
    }

    async function runAction({ interaction, autoDel, member, user, shift, now, type }) {
        const preflightResult = await preflightAction({
            interaction,
            autoDel,
            user,
            type
        });
        if (preflightResult.handled) return preflightResult.response;

        if (type === 'in') {
            const clockInGate = await handleClockInLiveGate({
                interaction,
                autoDel,
                member,
                user,
                shift,
                now
            });
            if (clockInGate.handled) return clockInGate.response;

            const clockInResult = await handleClockInComplete({
                interaction,
                autoDel,
                member,
                user,
                shift,
                now,
                gate: clockInGate
            });
            if (clockInResult.handled) return clockInResult.response;
        } else if (type === 'out') {
            await handleOut({ member, user, shift, now });
        } else if (type === 'ot') {
            const overtimeResult = await handleOvertime({
                interaction,
                autoDel,
                member,
                user,
                shift,
                now
            });
            if (overtimeResult.handled) return overtimeResult.response;
        } else if (type === 'off') {
            await handleOff({ member, user, shift, now });
        }

        return completeAction({ interaction, autoDel, type });
    }

    return {
        preflightAction,
        runAction,
        out: handleOut,
        off: handleOff,
        clockInLiveGate: handleClockInLiveGate,
        clockInComplete: handleClockInComplete,
        overtime: handleOvertime,
        completeAction
    };
}

module.exports = {
    createButtonActionHandlers
};
