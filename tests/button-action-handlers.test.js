const assert = require('assert');
const { createButtonActionHandlers } = require('../src/events/buttonActionHandlers');

function timeLabel(value) {
    return {
        diff: () => 60,
        format: () => value,
        toISOString: () => `${value}:00.000Z`
    };
}

function createInteraction() {
    const interaction = {
        guild: {
            voiceStates: {
                cache: new Map()
            }
        },
        replyPayload: null,
        reply: async payload => {
            interaction.replyPayload = payload;
        }
    };
    return interaction;
}

function createHandlers(overrides = {}) {
    const calls = [];
    const state = {
        overtimeWindow: true,
        preShiftWindow: false,
        voiceConnected: true,
        streaming: true
    };
    const handlers = createButtonActionHandlers({
        MessageFlags: { Ephemeral: 64 },
        getShiftBounds: () => ({ start: timeLabel('09:00 AM'), end: timeLabel('2026-05-30T09:00:00') }),
        handleClockOut: async (member, user, now, text = null) => {
            calls.push(`clockOut:${member.displayName}:${text || 'default'}`);
            user.checkedIn = false;
            user.disconnected = false;
        },
        handleClockIn: async (member, user, shift) => {
            calls.push(`clockIn:${member.displayName}:${shift}`);
            user.checkedIn = true;
            return true;
        },
        appendAttendanceEvent: (user, event, now, source, details) => calls.push(`event:${event}:${details?.previousClockOutSource || ''}`),
        applyLiveExceptionState: (user, shift, now, source, reason, options) => {
            calls.push(`liveException:${reason}:${options.voiceStatus}`);
            user.liveException = true;
        },
        applyDayOffState: (user, now, source, reason) => {
            calls.push(`dayOff:${source}:${reason}`);
            user.dayOff = true;
        },
        applyLiveOnState: (user, now, source, reason) => {
            calls.push(`liveOn:${reason}`);
            user.disconnected = false;
            user.checkedIn = true;
        },
        applyManualResumeRequiredState: (user, now, source, reason, options) => {
            calls.push(`manualResume:${reason}:${options.voiceStatus}`);
            user.manualResumeRequired = true;
        },
        applyPendingOvertimeReservationState: (user, now, source, reason, options) => {
            calls.push(`pendingOt:${reason}:${options.voiceConnected}`);
            user.pendingManualOT = true;
        },
        applyOvertimeState: (user, now, type, source, reason, options) => {
            calls.push(`ot:${type}:${reason}:${options.voiceStatus}`);
            user.overtime = true;
            return { added: true };
        },
        canStartOvertimeNow: () => state.overtimeWindow,
        canStartPreShiftOvertime: () => state.preShiftWindow,
        getActiveLiveException: () => state.activeLiveException || null,
        getOvertimeStartMoment: () => timeLabel('10:00 PM'),
        getVoiceSnapshot: () => ({
            isVoiceConnected: state.voiceConnected,
            isStreamingNow: state.streaming
        }),
        isOvertimeUser: id => id === 'ot-user',
        markLiveOffState: user => {
            calls.push('markLiveOff');
            user.liveOff = true;
        },
        markWorkedOnDayOff: async () => {
            calls.push('workedDayOff');
            return { messageId: 'msg1', leaveDate: '2026-05-30' };
        },
        notifyDayOffPresence: async (member, user, shift, now, reason) => calls.push(`notify:${reason}`),
        removeOvertimeUser: id => calls.push(`removeOt:${id}`),
        resetFinishedForPreClockIn: (user, now, source, reason, options) => {
            calls.push(`resetFinished:${reason}:${options.voiceStatus}`);
            user.isFinished = false;
        },
        renderDashboard: async options => calls.push(`render:${Boolean(options?.forceMemberRefresh)}`),
        saveSystem: async () => calls.push('save'),
        setLiveException: (id, exception) => {
            calls.push(`setLiveException:${id}:${exception.mode}`);
            state.activeLiveException = exception;
        },
        startPreShiftOvertime: async (member, user, shift, now, source) => calls.push(`preOt:${member.displayName}:${source}`),
        updateWorkingRole: async (member, enabled) => calls.push(`working:${member.displayName}:${enabled}`),
        recordLog: async (user, type, text = '') => calls.push(`log:${type}:${text}`),
        getCompletionMessage: type => `done:${type}`,
        ...overrides
    });
    return { handlers, calls, state };
}

(async () => {
    const now = {
        tag: 'now',
        toISOString: () => '2026-05-30T08:00:00.000Z'
    };

    const { handlers: outHandlers, calls: outCalls } = createHandlers();
    const outMember = { id: 'u1', displayName: 'Robin' };
    const outUser = { checkedIn: true };
    await outHandlers.out({ member: outMember, user: outUser, now });
    assert.strictEqual(outUser.checkedIn, false);
    assert.deepStrictEqual(outCalls, ['clockOut:Robin:default']);

    const { handlers: alreadyInHandlers, calls: alreadyInCalls } = createHandlers();
    const alreadyInInteraction = createInteraction();
    let alreadyInDelay = null;
    const alreadyIn = await alreadyInHandlers.preflightAction({
        interaction: alreadyInInteraction,
        autoDel: delay => {
            alreadyInDelay = delay;
        },
        user: { checkedIn: true, dayOff: false, disconnected: false },
        type: 'in'
    });
    assert.strictEqual(alreadyIn.handled, true);
    await alreadyIn.response;
    assert.strictEqual(alreadyInInteraction.replyPayload.content, '이미 출근 상태입니다.');
    assert.strictEqual(alreadyInDelay, 2000);
    assert.deepStrictEqual(alreadyInCalls, ['save', 'render:true']);

    const { handlers: notCheckedInHandlers, calls: notCheckedInCalls } = createHandlers();
    const notCheckedInInteraction = createInteraction();
    let notCheckedInDelay = null;
    const notCheckedIn = await notCheckedInHandlers.preflightAction({
        interaction: notCheckedInInteraction,
        autoDel: delay => {
            notCheckedInDelay = delay;
        },
        user: { checkedIn: false, disconnected: false },
        type: 'out'
    });
    assert.strictEqual(notCheckedIn.handled, true);
    await notCheckedIn.response;
    assert.strictEqual(notCheckedInInteraction.replyPayload.content, '출근 상태가 아닙니다.');
    assert.strictEqual(notCheckedInDelay, 2000);
    assert.deepStrictEqual(notCheckedInCalls, []);

    const { handlers: runOutHandlers, calls: runOutCalls } = createHandlers();
    const runOutInteraction = createInteraction();
    let runOutDelay = null;
    const runOutUser = { checkedIn: true, disconnected: false };
    await runOutHandlers.runAction({
        interaction: runOutInteraction,
        autoDel: delay => {
            runOutDelay = delay;
        },
        member: { id: 'u1', displayName: 'Robin' },
        user: runOutUser,
        shift: 'night',
        now,
        type: 'out'
    });
    assert.strictEqual(runOutUser.checkedIn, false);
    assert.strictEqual(runOutInteraction.replyPayload.content, 'done:out');
    assert.strictEqual(runOutDelay, 2000);
    assert.deepStrictEqual(runOutCalls, [
        'clockOut:Robin:default',
        'save',
        'render:true'
    ]);

    const { handlers: offHandlers, calls: offCalls } = createHandlers();
    const offMember = { id: 'ot-user', displayName: 'Daba' };
    const offUser = { checkedIn: false, disconnected: false, offCount: 2 };
    await offHandlers.off({ member: offMember, user: offUser, shift: 'night', now });
    assert.strictEqual(offUser.dayOffExpireAt, '2026-05-30T09:00:00:00.000Z');
    assert.strictEqual(offUser.dayOff, true);
    assert.strictEqual(offUser.offCount, 3);
    assert.deepStrictEqual(offCalls, [
        'clockOut:Daba:휴무 버튼 전환 전 퇴근 처리',
        'dayOff:button-or-command:day-off-button',
        'removeOt:ot-user',
        'working:Daba:false',
        'log:off:'
    ]);

    const { handlers: gateDayOffHandlers, calls: gateDayOffCalls, state: gateDayOffState } = createHandlers();
    gateDayOffState.streaming = false;
    const gateDayOffInteraction = createInteraction();
    let gateDayOffDelay = null;
    const gateDayOff = await gateDayOffHandlers.clockInLiveGate({
        interaction: gateDayOffInteraction,
        autoDel: delay => {
            gateDayOffDelay = delay;
        },
        member: { id: 'u2', displayName: 'Cee' },
        user: { dayOff: true },
        shift: 'day',
        now
    });
    assert.strictEqual(gateDayOff.handled, true);
    await gateDayOff.response;
    assert.strictEqual(gateDayOffDelay, 7000);
    assert.strictEqual(gateDayOffInteraction.replyPayload.content.includes('휴무'), true);
    assert.deepStrictEqual(gateDayOffCalls, [
        'notify:CLOCK IN attempted while Day Off',
        'save',
        'render:true'
    ]);

    const { handlers: selfExceptionHandlers, calls: selfExceptionCalls, state: selfExceptionState } = createHandlers();
    selfExceptionState.streaming = false;
    const selfExceptionInteraction = createInteraction();
    const selfExceptionUser = {
        isFinished: true,
        lastClockOutSource: 'live-off-timeout',
        checkOutRaw: '2026-05-30T01:00:00.000Z',
        manualResumeRequired: true
    };
    const selfException = await selfExceptionHandlers.clockInLiveGate({
        interaction: selfExceptionInteraction,
        autoDel: () => {},
        member: { id: 'u3', displayName: 'Tonstar' },
        user: selfExceptionUser,
        shift: 'night',
        now
    });
    assert.strictEqual(selfException.handled, true);
    await selfException.response;
    assert.strictEqual(selfExceptionUser.manualResumeRequired, false);
    assert.strictEqual(selfExceptionInteraction.replyPayload.content, '라이브 예외로 근무가 재개되었습니다. 현황판에는 라이브 예외로 표시됩니다.');
    assert.deepStrictEqual(selfExceptionCalls, [
        'setLiveException:u3:self-clock-in',
        'liveException:self-live-exception-clock-in:EXCEPTION',
        'event:self_live_exception_clock_in:live-off-timeout',
        'working:Tonstar:true',
        'log:reconnect:라이브 불가 예외 CLOCK IN - 근무 인정',
        'save',
        'render:true'
    ]);

    const { handlers: liveRequiredHandlers, calls: liveRequiredCalls, state: liveRequiredState } = createHandlers();
    liveRequiredState.streaming = false;
    const liveRequiredInteraction = createInteraction();
    const liveRequired = await liveRequiredHandlers.clockInLiveGate({
        interaction: liveRequiredInteraction,
        autoDel: () => {},
        member: { id: 'u4', displayName: 'Zurin' },
        user: { isFinished: true },
        shift: 'day',
        now
    });
    assert.strictEqual(liveRequired.handled, true);
    await liveRequired.response;
    assert.strictEqual(liveRequiredInteraction.replyPayload.content.includes('라이브'), true);
    assert.deepStrictEqual(liveRequiredCalls, [
        'resetFinished:clock-in-live-required:LIVE_OFF',
        'markLiveOff',
        'save',
        'render:true'
    ]);

    const { handlers: passGateHandlers, state: passGateState } = createHandlers();
    passGateState.streaming = true;
    const passGate = await passGateHandlers.clockInLiveGate({
        interaction: createInteraction(),
        autoDel: () => {},
        member: { id: 'u5', displayName: 'Gab' },
        user: {},
        shift: 'night',
        now
    });
    assert.strictEqual(passGate.handled, false);
    assert.strictEqual(passGate.canClockInByLiveException, false);

    const { handlers: preShiftClockInHandlers, calls: preShiftClockInCalls, state: preShiftClockInState } = createHandlers();
    preShiftClockInState.preShiftWindow = true;
    const preShiftClockInInteraction = createInteraction();
    const preShiftClockIn = await preShiftClockInHandlers.clockInComplete({
        interaction: preShiftClockInInteraction,
        autoDel: () => {},
        member: { id: 'u6', displayName: 'Brave' },
        user: {},
        shift: 'night',
        now,
        gate: { wasDayOff: true, isVoiceConnected: true, isStreamingNow: true }
    });
    assert.strictEqual(preShiftClockIn.handled, true);
    await preShiftClockIn.response;
    assert.strictEqual(preShiftClockInInteraction.replyPayload.content.includes('사전 OT'), true);
    assert.deepStrictEqual(preShiftClockInCalls, [
        'preOt:Brave:button-or-command',
        'workedDayOff',
        'event:dayoff_clock_in_confirmed:',
        'save',
        'render:true'
    ]);

    const { handlers: dcClockInHandlers, calls: dcClockInCalls } = createHandlers();
    const dcClockIn = await dcClockInHandlers.clockInComplete({
        interaction: createInteraction(),
        autoDel: () => {},
        member: { id: 'u7', displayName: 'Ding' },
        user: { disconnected: true },
        shift: 'day',
        now,
        gate: { wasDayOff: false, isVoiceConnected: true, isStreamingNow: true }
    });
    assert.strictEqual(dcClockIn.handled, false);
    assert.deepStrictEqual(dcClockInCalls, [
        'liveOn:clock-in-dc-recovered',
        'log:reconnect:DC 복구'
    ]);

    const { handlers: failedClockInHandlers, calls: failedClockInCalls } = createHandlers({
        handleClockIn: async () => {
            failedClockInCalls.push('clockIn:false');
            return false;
        }
    });
    const failedClockInInteraction = createInteraction();
    const failedClockIn = await failedClockInHandlers.clockInComplete({
        interaction: failedClockInInteraction,
        autoDel: () => {},
        member: { id: 'u8', displayName: 'Lance' },
        user: {},
        shift: 'night',
        now,
        gate: { wasDayOff: false, isVoiceConnected: true, isStreamingNow: true }
    });
    assert.strictEqual(failedClockIn.handled, true);
    await failedClockIn.response;
    assert.strictEqual(failedClockInInteraction.replyPayload.content.includes('출근이 인정되지 않았습니다'), true);
    assert.deepStrictEqual(failedClockInCalls, [
        'clockIn:false',
        'save',
        'render:true'
    ]);

    const { handlers: liveExceptionClockInHandlers, calls: liveExceptionClockInCalls } = createHandlers();
    const liveExceptionClockIn = await liveExceptionClockInHandlers.clockInComplete({
        interaction: createInteraction(),
        autoDel: () => {},
        member: { id: 'u9', displayName: 'Chuwi' },
        user: {},
        shift: 'night',
        now,
        gate: {
            wasDayOff: true,
            isVoiceConnected: true,
            isStreamingNow: false,
            canClockInByLiveException: true,
            activeLiveException: { approvedAt: 'approved', expiresAt: 'expires' }
        }
    });
    assert.strictEqual(liveExceptionClockIn.handled, false);
    assert.deepStrictEqual(liveExceptionClockInCalls, [
        'clockIn:Chuwi:night',
        'workedDayOff',
        'liveException:clock-in-with-live-exception:EXCEPTION',
        'event:clock_in_with_live_exception:',
        'log:reconnect:라이브 예외 대상 CLOCK IN - 근무 인정',
        'event:dayoff_clock_in_confirmed:'
    ]);

    const { handlers: dayOffOtHandlers, calls: dayOffOtCalls } = createHandlers();
    const dayOffInteraction = createInteraction();
    let dayOffDelay = null;
    const dayOffOt = await dayOffOtHandlers.overtime({
        interaction: dayOffInteraction,
        autoDel: delay => {
            dayOffDelay = delay;
        },
        member: { id: 'u2', displayName: 'Cee' },
        user: { dayOff: true },
        shift: 'day',
        now
    });
    assert.strictEqual(dayOffOt.handled, true);
    await dayOffOt.response;
    assert.strictEqual(dayOffDelay, 5000);
    assert.strictEqual(dayOffInteraction.replyPayload.content, '현재 휴무(Day Off)입니다. OT는 자동으로 인정되지 않습니다. 관리자 승인이 필요합니다.');
    assert.deepStrictEqual(dayOffOtCalls, [
        'notify:OVERTIME attempted while Day Off',
        'save',
        'render:true'
    ]);

    const { handlers: standbyHandlers, calls: standbyCalls, state: standbyState } = createHandlers();
    standbyState.streaming = false;
    const standbyInteraction = createInteraction();
    let standbyDelay = null;
    const standby = await standbyHandlers.overtime({
        interaction: standbyInteraction,
        autoDel: delay => {
            standbyDelay = delay;
        },
        member: { id: 'u3', displayName: 'Tonstar' },
        user: { checkedIn: true },
        shift: 'night',
        now
    });
    assert.strictEqual(standby.handled, true);
    await standby.response;
    assert.strictEqual(standbyDelay, 3000);
    assert.strictEqual(standbyInteraction.replyPayload.content, 'OT 대기 상태입니다. 라이브를 켜면 수동 OT가 인정됩니다.');
    assert.deepStrictEqual(standbyCalls, [
        'pendingOt:manual-ot-reserved-live-off:true',
        'log:ot:OT 예약 대기 (라이브 ON 후 정시 이후 인정)',
        'save',
        'render:true'
    ]);

    const { handlers: reserveHandlers, calls: reserveCalls, state: reserveState } = createHandlers();
    reserveState.overtimeWindow = false;
    const reserveInteraction = createInteraction();
    const reserve = await reserveHandlers.overtime({
        interaction: reserveInteraction,
        autoDel: () => {},
        member: { id: 'u4', displayName: 'Zurin' },
        user: { checkedIn: true },
        shift: 'day',
        now
    });
    assert.strictEqual(reserve.handled, true);
    await reserve.response;
    assert.strictEqual(reserveInteraction.replyPayload.content.includes('OT 예약이 저장되었습니다'), true);
    assert.deepStrictEqual(reserveCalls, [
        'pendingOt:manual-ot-reserved-before-window:false',
        'log:ot:OT 예약 등록 (정시 이후 10:00 PM부터 인정)',
        'save',
        'render:true'
    ]);

    const { handlers: successHandlers, calls: successCalls } = createHandlers();
    const success = await successHandlers.overtime({
        interaction: createInteraction(),
        autoDel: () => {},
        member: { id: 'u5', displayName: 'Gab' },
        user: { checkedIn: false },
        shift: 'night',
        now
    });
    assert.strictEqual(success.handled, false);
    assert.deepStrictEqual(successCalls, [
        'clockIn:Gab:night',
        'ot:MANUAL:manual-ot-button-started:LIVE_ON',
        'log:ot:수동 연장 근무 시작'
    ]);

    const { handlers: preShiftHandlers, calls: preShiftCalls, state: preShiftState } = createHandlers();
    preShiftState.overtimeWindow = false;
    preShiftState.preShiftWindow = true;
    const preShiftInteraction = createInteraction();
    const preShift = await preShiftHandlers.overtime({
        interaction: preShiftInteraction,
        autoDel: () => {},
        member: { id: 'u6', displayName: 'Brave' },
        user: { checkedIn: false },
        shift: 'night',
        now
    });
    assert.strictEqual(preShift.handled, true);
    await preShift.response;
    assert.strictEqual(preShiftInteraction.replyPayload.content.includes('사전 OT'), true);
    assert.deepStrictEqual(preShiftCalls, [
        'preOt:Brave:button-or-command',
        'save',
        'render:true'
    ]);

    const { handlers: completeHandlers, calls: completeCalls } = createHandlers();
    const completeInteraction = createInteraction();
    let completeDelay = null;
    await completeHandlers.completeAction({
        interaction: completeInteraction,
        autoDel: delay => {
            completeDelay = delay;
        },
        type: 'in'
    });
    assert.strictEqual(completeInteraction.replyPayload.content, 'done:in');
    assert.strictEqual(completeDelay, 2000);
    assert.deepStrictEqual(completeCalls, ['save', 'render:true']);

    console.log('button-action-handlers tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
