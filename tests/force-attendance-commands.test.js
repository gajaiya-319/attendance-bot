const assert = require('assert');
const { createForceAttendanceCommands } = require('../src/commands/admin/forceAttendanceCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { admin: true },
        replyPayload: null,
        deferred: false,
        replied: false,
        reply: async payload => {
            interaction.replyPayload = payload;
            interaction.replied = true;
        },
        deferReply: async payload => {
            interaction.deferPayload = payload;
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.replyPayload = payload;
            interaction.replied = true;
        },
        ...overrides
    };
    return interaction;
}

function createCommands(overrides = {}) {
    const calls = [];
    const users = new Map();
    const commands = createForceAttendanceCommands({
        MessageFlags: { Ephemeral: 64 },
        canRun: member => Boolean(member?.admin),
        determineShift: target => target.shift || 'night',
        ensureUserData: (target, shift) => {
            if (!users.has(target.id)) users.set(target.id, { id: target.id, name: target.displayName, shift });
            return users.get(target.id);
        },
        getShiftBounds: () => ({ end: { toISOString: () => '2026-05-30T09:00:00.000Z' } }),
        handleClockIn: async (target, user, shift) => {
            calls.push(`clockIn:${target.displayName}:${shift}`);
            user.checkedIn = true;
        },
        handleClockOut: async (target, user, now, text, earlyOverrideTime, options) => {
            calls.push(`clockOut:${target.displayName}:${text}:${Boolean(options?.skipEarlyPenalty)}`);
            user.checkedIn = false;
            user.isFinished = true;
        },
        applyDayOffState: user => {
            calls.push(`dayOff:${user.name}`);
            user.dayOff = true;
        },
        applyOvertimeState: (user, now, type, source, reason, options) => {
            calls.push(`ot:${user.name}:${options.voiceStatus}`);
            user.overtime = true;
            return { added: true };
        },
        removeOvertimeUser: id => calls.push(`removeOt:${id}`),
        updateWorkingRole: async (target, enabled) => calls.push(`working:${target.displayName}:${enabled}`),
        recordLog: async (user, type, text) => calls.push(`log:${type}:${text}`),
        writeAdminActionLog: async (action, actor, target, details = []) => calls.push(`admin:${action}:${target?.displayName || 'none'}:${details.join('|')}`),
        saveSystem: async () => calls.push('save'),
        renderDashboard: async options => calls.push(`render:${Boolean(options?.forceMemberRefresh)}`),
        ...overrides
    });
    return { commands, calls, users };
}

const now = { tag: 'now' };
const target = { id: 'u1', displayName: 'Tonstar', shift: 'night', voice: { channelId: 'voice', streaming: true } };
const context = {
    now,
    autoDel: () => {},
    getTargetMember: () => target,
    replyMemberNotFound: () => Promise.resolve('not-found')
};

(async () => {
    let deleted = false;
    const { commands: noPermCommands } = createCommands();
    const noPermInteraction = createInteraction({ member: { admin: false } });
    await noPermCommands.forceIn.execute(noPermInteraction, {
        ...context,
        autoDel: () => {
            deleted = true;
        }
    });
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const { commands: forceInCommands, calls: forceInCalls } = createCommands();
    const forceInInteraction = createInteraction();
    await forceInCommands.forceIn.execute(forceInInteraction, context);
    assert.strictEqual(forceInInteraction.replyPayload.content, '✅ Forced In.');
    assert.strictEqual(forceInInteraction.deferred, true);
    assert.deepStrictEqual(forceInCalls, [
        'clockIn:Tonstar:night',
        'admin:FORCE_IN:Tonstar:shift=night',
        'save',
        'render:true'
    ]);

    const { commands: noRoleCommands } = createCommands({ determineShift: () => null });
    const noRoleInteraction = createInteraction();
    await noRoleCommands.forceIn.execute(noRoleInteraction, context);
    assert.strictEqual(noRoleInteraction.replyPayload.content, 'No role.');

    const { commands: forceOutCommands, calls: forceOutCalls, users: forceOutUsers } = createCommands();
    forceOutUsers.set(target.id, { id: target.id, name: target.displayName, checkedIn: true });
    const forceOutInteraction = createInteraction();
    await forceOutCommands.forceOut.execute(forceOutInteraction, context);
    assert.strictEqual(forceOutInteraction.replyPayload.content, '✅ Forced Out.');
    assert.strictEqual(forceOutInteraction.deferred, true);
    assert.deepStrictEqual(forceOutCalls, [
        'clockOut:Tonstar:관리자 강제 퇴근:true',
        'admin:FORCE_OUT:Tonstar:skipEarlyPenalty=true',
        'save',
        'render:true'
    ]);

    const { commands: earlyOutCommands, calls: earlyOutCalls, users: earlyOutUsers } = createCommands();
    earlyOutUsers.set(target.id, { id: target.id, name: target.displayName, disconnected: true });
    const earlyOutInteraction = createInteraction();
    await earlyOutCommands.forceEarlyOut.execute(earlyOutInteraction, context);
    assert.strictEqual(earlyOutInteraction.replyPayload.content, '✅ Forced Early Out.');
    assert.strictEqual(earlyOutInteraction.deferred, true);
    assert.deepStrictEqual(earlyOutCalls, [
        'clockOut:Tonstar:관리자 조기퇴근 처리:false',
        'admin:FORCE_EARLY_OUT:Tonstar:',
        'save',
        'render:true'
    ]);

    const { commands: notInCommands } = createCommands();
    const notInInteraction = createInteraction();
    await notInCommands.forceOut.execute(notInInteraction, context);
    assert.strictEqual(notInInteraction.replyPayload.content, 'Target is not checked in.');

    const { commands: offCommands, calls: offCalls, users: offUsers } = createCommands();
    const offInteraction = createInteraction();
    await offCommands.forceOff.execute(offInteraction, context);
    assert.strictEqual(offInteraction.replyPayload.content, '✅ Forced Off.');
    assert.strictEqual(offInteraction.deferred, true);
    assert.strictEqual(offUsers.get(target.id).dayOffExpireAt, '2026-05-30T09:00:00.000Z');
    assert.strictEqual(offUsers.get(target.id).offCount, 1);
    assert.deepStrictEqual(offCalls, [
        'dayOff:Tonstar',
        'removeOt:u1',
        'working:Tonstar:false',
        'log:off:관리자 강제 휴무',
        'admin:FORCE_OFF:Tonstar:shift=night',
        'save',
        'render:true'
    ]);

    const { commands: otCommands, calls: otCalls } = createCommands();
    const otInteraction = createInteraction();
    await otCommands.forceOvertime.execute(otInteraction, context);
    assert.strictEqual(otInteraction.replyPayload.content, '✅ Forced OT.');
    assert.strictEqual(otInteraction.deferred, true);
    assert.deepStrictEqual(otCalls, [
        'clockIn:Tonstar:night',
        'ot:Tonstar:LIVE_ON',
        'working:Tonstar:true',
        'log:ot:관리자 강제 연장',
        'admin:FORCE_OT:Tonstar:shift=night|checkedIn=true',
        'save',
        'render:true'
    ]);

    assert.strictEqual(otCommands.forceIn.aliases.includes('force-in'), true);
    assert.strictEqual(otCommands.forceOvertime.aliases.includes('강제연장'), true);

    console.log('force-attendance-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
