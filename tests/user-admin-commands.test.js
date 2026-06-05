const assert = require('assert');
const { createUserAdminCommands } = require('../src/commands/admin/userAdminCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { admin: true, manager: true },
        user: { id: 'owner' },
        deferred: false,
        replied: false,
        replyPayload: null,
        editPayloads: [],
        options: {
            getString: name => {
                if (name === 'field') return 'points';
                if (name === 'value') return '10';
                return null;
            }
        },
        reply: async payload => {
            interaction.replyPayload = payload;
            interaction.replied = true;
        },
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.editPayloads.push(payload);
        },
        ...overrides
    };
    return interaction;
}

function createCommands(overrides = {}) {
    const calls = [];
    const users = new Map();
    const commands = createUserAdminCommands({
        MessageFlags: { Ephemeral: 64 },
        canAdmin: member => Boolean(member?.admin),
        canManageRoles: member => Boolean(member?.manager),
        isOwner: id => id === 'owner',
        ownerOnlyReply: async interaction => {
            interaction.replyPayload = { content: 'Owner only.' };
            calls.push('ownerOnly');
        },
        failText: text => `FAIL:${text}`,
        pendingText: text => `PENDING:${text}`,
        okText: text => `OK:${text}`,
        determineShift: target => target.shift || 'night',
        ensureUserData: (target, shift) => {
            if (!users.has(target.id)) users.set(target.id, { id: target.id, name: target.displayName, shift });
            return users.get(target.id);
        },
        applyManualAdjustment: (user, field, value) => {
            calls.push(`adjust:${field}:${value}`);
            user[field] = value;
            return value !== 'bad';
        },
        normalizeManualAdjustmentState: (user, field, value) => calls.push(`normalize:${field}:${value}`),
        createBackupSnapshot: async reason => calls.push(`backup:${reason}`),
        deleteUserData: id => calls.push(`delete:${id}`),
        removeOvertimeUser: id => calls.push(`removeOt:${id}`),
        resetAllState: () => calls.push('resetAllState'),
        updateWorkingRole: async (target, enabled) => calls.push(`working:${target.displayName}:${enabled}`),
        applyFinishedState: (user, now, source, reason) => {
            calls.push(`finished:${source}:${reason}`);
            user.isFinished = true;
        },
        syncWorkingRoles: async () => calls.push('syncWorking'),
        writeAdminActionLog: async (action, actor, target, details = []) => calls.push(`admin:${action}:${target?.displayName || 'none'}:${details.join('|')}`),
        saveSystem: async () => calls.push('save'),
        renderDashboard: async options => calls.push(`render:${Boolean(options?.forceMemberRefresh)}`),
        roleIds: ['day', 'night', 'working'],
        ...overrides
    });
    return { commands, calls, users };
}

const target = {
    id: 'u1',
    displayName: 'Robin',
    shift: 'night',
    roles: {
        cache: new Map([['day', true], ['working', true]]),
        remove: async id => {
            target.roles.cache.delete(id);
        }
    },
    kick: async reason => {
        target.kicked = reason;
    }
};

const context = {
    now: { tag: 'now' },
    autoDel: () => {},
    getTargetMember: () => target,
    replyMemberNotFound: () => Promise.resolve('not-found')
};

(async () => {
    let deleted = false;
    const { commands: noPermCommands } = createCommands();
    const noPermInteraction = createInteraction({ member: { admin: false } });
    await noPermCommands.manualAdjust.execute(noPermInteraction, {
        ...context,
        autoDel: () => {
            deleted = true;
        }
    });
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const { commands: manualCommands, calls: manualCalls } = createCommands();
    const manualInteraction = createInteraction();
    await manualCommands.manualAdjust.execute(manualInteraction, context);
    assert.strictEqual(manualInteraction.replyPayload.content, 'Updated Robin: points = 10');
    assert.deepStrictEqual(manualCalls, [
        'adjust:points:10',
        'normalize:points:10',
        'admin:MANUAL_ADJUST:Robin:field=points|value=10',
        'save',
        'render:false'
    ]);

    const { commands: invalidCommands } = createCommands();
    const invalidInteraction = createInteraction({
        options: {
            getString: name => {
                if (name === 'field') return 'points';
                if (name === 'value') return 'bad';
                return null;
            }
        }
    });
    await invalidCommands.manualAdjust.execute(invalidInteraction, context);
    assert.strictEqual(invalidInteraction.replyPayload.content, 'Invalid field/value.');

    const { commands: fireCommands, calls: fireCalls } = createCommands();
    const fireInteraction = createInteraction();
    await fireCommands.fire.execute(fireInteraction, context);
    assert.strictEqual(fireInteraction.replyPayload.content, 'Fired/Kicked.');
    assert.strictEqual(target.kicked, 'Attendance bot fire command');
    assert.deepStrictEqual(fireCalls, [
        'backup:before-fire',
        'delete:u1',
        'removeOt:u1',
        'working:Robin:false',
        'admin:FIRE_KICK:Robin:backup=before-fire',
        'save',
        'render:false'
    ]);

    const { commands: clearCommands, calls: clearCalls, users: clearUsers } = createCommands();
    target.roles.cache = new Map([['day', true], ['working', true]]);
    const clearInteraction = createInteraction();
    await clearCommands.clearRoles.execute(clearInteraction, context);
    assert.strictEqual(clearInteraction.replyPayload.content, 'Roles cleared.');
    assert.strictEqual(target.roles.cache.has('day'), false);
    assert.strictEqual(clearUsers.get(target.id).shift, null);
    assert.deepStrictEqual(clearCalls, [
        'finished:clear-roles-command:roles-cleared',
        'admin:CLEAR_ROLES:Robin:roles=day,night,working',
        'save',
        'render:false'
    ]);

    const { commands: resetUserCommands, calls: resetUserCalls } = createCommands();
    const resetUserInteraction = createInteraction();
    await resetUserCommands.resetUser.execute(resetUserInteraction, context);
    assert.deepStrictEqual(resetUserInteraction.editPayloads, [
        { content: 'PENDING:개인 리셋 처리 중입니다. 백업을 만들고 데이터를 정리하고 있습니다.' },
        { content: 'OK:개인 리셋 완료: Robin' }
    ]);
    assert.deepStrictEqual(resetUserCalls, [
        'backup:before-user-reset',
        'delete:u1',
        'removeOt:u1',
        'working:Robin:false',
        'admin:RESET_USER:Robin:backup=before-user-reset',
        'save',
        'render:true'
    ]);

    const { commands: resetAllCommands, calls: resetAllCalls } = createCommands();
    const resetAllInteraction = createInteraction();
    await resetAllCommands.resetAll.execute(resetAllInteraction, context);
    assert.deepStrictEqual(resetAllInteraction.editPayloads, [
        { content: 'PENDING:전체 리셋 처리 중입니다. 백업을 만들고 전체 출석 데이터를 정리하고 있습니다.' },
        { content: 'OK:전체 리셋 완료. 출석 데이터와 OT 상태를 초기화했습니다.' }
    ]);
    assert.deepStrictEqual(resetAllCalls, [
        'backup:before-full-reset',
        'resetAllState',
        'syncWorking',
        'admin:RESET_ALL:none:backup=before-full-reset',
        'save',
        'render:true'
    ]);

    const { commands: ownerCommands, calls: ownerCalls } = createCommands();
    const ownerInteraction = createInteraction({ user: { id: 'not-owner' } });
    await ownerCommands.resetAll.execute(ownerInteraction, context);
    assert.strictEqual(ownerInteraction.replyPayload.content, 'Owner only.');
    assert.deepStrictEqual(ownerCalls, ['ownerOnly']);

    assert.strictEqual(resetAllCommands.manualAdjust.aliases.includes('manual-adjust'), true);
    assert.strictEqual(resetAllCommands.resetUser.aliases.includes('개인리셋'), true);

    console.log('user-admin-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
