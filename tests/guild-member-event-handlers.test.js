const assert = require('assert');
const { createGuildMemberEventHandlers } = require('../src/events/guildMemberEventHandlers');

function member({ id = 'u1', name = 'Robin - Valacas Day Time', roles = [] } = {}) {
    const calls = [];
    const cache = {
        has: role => roles.includes(role)
    };
    return {
        id,
        displayName: name,
        user: { bot: false },
        roles: {
            cache,
            add: async role => calls.push(`add:${role}`),
            remove: async role => calls.push(`remove:${role}`)
        },
        calls
    };
}

function createHandlers(overrides = {}) {
    const calls = [];
    const attendanceData = overrides.attendanceData || {};
    const liveExceptions = overrides.liveExceptions || {};
    let nowMs = overrides.nowMs || Date.parse('2026-05-31T00:00:00.000Z');
    const getNowValue = () => ({
        toISOString: () => new Date(nowMs).toISOString(),
        valueOf: () => nowMs
    });
    const handlers = createGuildMemberEventHandlers({
        CONFIG: {
            NICKNAME_ROLE_SYNC: overrides.nicknameSync ?? true,
            EXCEPTIONS: {
                SHARED_SEAT_USER: overrides.sharedSeatUser || null
            },
            ROLES: {
                HEINE: 'heine',
                PAAGRIO: 'paagrio',
                DAY: 'day',
                NIGHT: 'night'
            }
        },
        getAttendanceData: () => attendanceData,
        getLiveExceptions: () => liveExceptions,
        removeOvertimeUser: id => calls.push(`removeOt:${id}`),
        syncManualGuestNickname: async () => {
            calls.push('manualGuest');
            return Boolean(overrides.manualGuestHandled);
        },
        syncNicknameFromAssignedRoles: async () => {
            calls.push('assignedNickname');
            return Boolean(overrides.assignedNicknameHandled);
        },
        syncRolesFromStructuredNickname: async newMember => {
            calls.push(`structured:${newMember.displayName}`);
            return Boolean(overrides.structuredHandled);
        },
        ensureUserData: (newMember, shift) => {
            calls.push(`ensure:${newMember.id}:${shift}`);
            const user = attendanceData[newMember.id] || {};
            attendanceData[newMember.id] = user;
            return user;
        },
        applyFinishedState: (user, receivedNow, source, reason) => {
            calls.push(`finished:${source}:${reason}:${receivedNow.toISOString()}`);
            user.isFinished = true;
        },
        clearMemberState: id => calls.push(`clear:${id}`),
        getNow: getNowValue,
        writeDayOffLog: async text => calls.push(`log:${text.split('\n')[0]}`),
        saveSystem: async () => calls.push('save'),
        syncCurrentWorkerProfile: async newMember => calls.push(`profile:${newMember.id}`),
        removeCurrentWorkerProfile: async member => calls.push(`removeProfile:${member.id}`),
        isAssignedWorker: member => {
            const hasServer = member?.roles?.cache?.has('heine') || member?.roles?.cache?.has('paagrio');
            const hasShift = member?.roles?.cache?.has('day') || member?.roles?.cache?.has('night');
            return Boolean(hasServer && hasShift);
        },
        renderDashboard: options => calls.push(`render:${Boolean(options?.forceMemberRefresh)}`),
        logger: {
            error: (label, error) => calls.push(`error:${label}:${error.message}`)
        }
    });
    return {
        handlers,
        calls,
        attendanceData,
        liveExceptions,
        advanceNow: ms => { nowMs += ms; }
    };
}

(async () => {
    const { handlers: updateHandlers, calls: updateCalls, attendanceData } = createHandlers();
    const oldMember = member({ name: 'Robin' });
    const newMember = member({ name: 'Robin - Valacas Day Time' });
    await updateHandlers.update(oldMember, newMember);
    assert.deepStrictEqual(newMember.calls, [
        'add:heine',
        'remove:paagrio',
        'add:day',
        'remove:night'
    ]);
    assert.strictEqual(attendanceData.u1.shift, 'day');
    assert.deepStrictEqual(updateCalls, [
        'manualGuest',
        'assignedNickname',
        'structured:Robin - Valacas Day Time',
        'ensure:u1:day',
        'save',
        'log:✅ 역할 자동 동기화 완료',
        'render:false'
    ]);

    const activeData = { u2: { checkedIn: true } };
    const { handlers: activeHandlers, calls: activeCalls, advanceNow: advanceActiveNow } = createHandlers({ attendanceData: activeData });
    await activeHandlers.update(member({ id: 'u2', name: 'Old' }), member({ id: 'u2', name: 'New - Night Time' }));
    assert.deepStrictEqual(activeCalls, [
        'manualGuest',
        'log:🟡 역할 자동 동기화 보류'
    ]);

    await activeHandlers.update(member({ id: 'u2', name: 'Old' }), member({ id: 'u2', name: 'New - Night Time' }));
    assert.deepStrictEqual(activeCalls, [
        'manualGuest',
        'log:🟡 역할 자동 동기화 보류',
        'manualGuest'
    ]);

    advanceActiveNow(60 * 60 * 1000);
    await activeHandlers.update(member({ id: 'u2', name: 'Old' }), member({ id: 'u2', name: 'New - Night Time' }));
    assert.deepStrictEqual(activeCalls, [
        'manualGuest',
        'log:🟡 역할 자동 동기화 보류',
        'manualGuest',
        'manualGuest',
        'log:🟡 역할 자동 동기화 보류'
    ]);

    const { handlers: roleOnlyHandlers, calls: roleOnlyCalls } = createHandlers();
    await roleOnlyHandlers.update(
        member({ id: 'u4', name: 'Zeki', roles: ['paagrio', 'day'] }),
        member({ id: 'u4', name: 'Zeki', roles: ['heine', 'day'] })
    );
    assert.deepStrictEqual(roleOnlyCalls, [
        'manualGuest',
        'assignedNickname',
        'profile:u4',
        'render:true'
    ]);

    const activeRoleData = { u5: { checkedIn: true } };
    const { handlers: activeRoleHandlers, calls: activeRoleCalls } = createHandlers({ attendanceData: activeRoleData });
    await activeRoleHandlers.update(
        member({ id: 'u5', name: 'Kram', roles: ['paagrio', 'day'] }),
        member({ id: 'u5', name: 'Kram', roles: ['heine', 'day'] })
    );
    assert.deepStrictEqual(activeRoleCalls, [
        'manualGuest',
        'log:🟡 역할 자동 동기화 보류',
        'profile:u5',
        'render:true'
    ]);

    const removedRoleData = { u6: { checkedIn: true, shift: 'day', liveOffWarnedFor: 'x' } };
    const removedRoleExceptions = { u6: { status: 'active' } };
    const { handlers: removedRoleHandlers, calls: removedRoleCalls } = createHandlers({
        attendanceData: removedRoleData,
        liveExceptions: removedRoleExceptions
    });
    await removedRoleHandlers.update(
        member({ id: 'u6', name: 'Leaving Role', roles: ['heine', 'day'] }),
        member({ id: 'u6', name: 'Leaving Role', roles: [] })
    );
    assert.strictEqual(removedRoleData.u6.isFinished, true);
    assert.strictEqual(removedRoleData.u6.shift, null);
    assert.strictEqual(removedRoleData.u6.liveOffWarnedFor, null);
    assert.strictEqual(removedRoleExceptions.u6.status, 'cancelled');
    assert.strictEqual(removedRoleExceptions.u6.cancelReason, 'worker-role-removed');
    assert.deepStrictEqual(removedRoleCalls, [
        'manualGuest',
        'finished:role-remove:worker-role-removed:2026-05-31T00:00:00.000Z',
        'removeOt:u6',
        'removeProfile:u6',
        'log:🧹 근무자 역할 제거 감지',
        'save',
        'render:true'
    ]);

    const liveExceptions = {
        u3: { status: 'active' }
    };
    const removeData = { u3: { checkedIn: true, shift: 'night', liveOffWarnedFor: 'x' } };
    const { handlers: removeHandlers, calls: removeCalls } = createHandlers({
        attendanceData: removeData,
        liveExceptions
    });
    await removeHandlers.remove(member({ id: 'u3', name: 'Leaving' }));
    assert.strictEqual(removeData.u3.isFinished, true);
    assert.strictEqual(removeData.u3.shift, null);
    assert.strictEqual(removeData.u3.liveOffWarnedFor, null);
    assert.strictEqual(liveExceptions.u3.status, 'cancelled');
    assert.strictEqual(liveExceptions.u3.cancelledAt, '2026-05-31T00:00:00.000Z');
    assert.strictEqual(liveExceptions.u3.cancelReason, 'member-left-guild');
    assert.deepStrictEqual(removeCalls, [
        'finished:member-remove:member-left-guild:2026-05-31T00:00:00.000Z',
        'removeOt:u3',
        'removeProfile:u3',
        'clear:u3',
        'save',
        'render:true'
    ]);

    const { handlers: botHandlers, calls: botCalls } = createHandlers();
    await botHandlers.remove({ id: 'bot', user: { bot: true } });
    assert.deepStrictEqual(botCalls, []);

    assert.throws(() => createGuildMemberEventHandlers({}), /CONFIG/);

    console.log('guild-member-event-handlers tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
