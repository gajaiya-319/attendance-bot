const assert = require('assert');
const { createChatInputCommandHandler } = require('../src/events/chatInputCommandHandler');

function createInteraction(commandName, options = {}) {
    const interaction = {
        commandName,
        member: { id: 'admin' },
        guild: { id: 'guild' },
        deferred: false,
        replied: false,
        replyPayload: null,
        editPayload: null,
        deferPayload: null,
        options: {
            getString: name => options.strings?.[name] || null,
            getInteger: name => options.integers?.[name] || null
        },
        reply: async payload => {
            interaction.replied = true;
            interaction.replyPayload = payload;
        },
        editReply: async payload => {
            interaction.editPayload = payload;
        },
        deferReply: async payload => {
            interaction.deferred = true;
            interaction.deferPayload = payload;
        }
    };
    return interaction;
}

function createHandler(overrides = {}) {
    const calls = [];
    const target = {
        id: 'target',
        displayName: 'Robin',
        roles: {
            add: async role => calls.push(`role:add:${role}`),
            remove: async role => calls.push(`role:remove:${role}`)
        }
    };
    const context = interaction => ({
        handled: false,
        autoDel: () => calls.push('autoDel'),
        isAdmin: true,
        now: { tag: 'now' },
        n: command => interaction.commandName === command,
        getTargetMember: () => target,
        getSlot: () => 1,
        getAnnounceTime: () => '09:00',
        getAnnounceContent: () => 'hello',
        getAnnounceRole: () => null,
        getAnnounceRoles: () => [],
        replyMemberNotFound: async () => calls.push('member:not-found')
    });
    const handler = createChatInputCommandHandler({
        MessageFlags: { Ephemeral: 64 },
        CONFIG: {
            INACTIVE_CANDIDATE_DAYS: 14,
            ROLES: {
                HEINE: 'heine',
                PAAGRIO: 'paagrio',
                DAY: 'day',
                NIGHT: 'night'
            }
        },
        chatInputCommandContext: context,
        canManageLiveException: () => true,
        grantLiveException: async () => ({ ok: true, expiresAt: '2026-05-30T10:00:00.000Z' }),
        renderDashboard: async options => calls.push(`render:${Boolean(options?.forceMemberRefresh)}`),
        formatKoreanDateTime: value => `formatted:${value}`,
        ensureUserData: () => {
            calls.push('ensureUser');
            return {};
        },
        clearDayOffReservationState: (user, now, source, reason) => calls.push(`clearDayOff:${now.tag}:${source}:${reason}`),
        saveSystem: async () => calls.push('save'),
        sendOpsReport: async type => calls.push(`report:${type}`),
        refreshGuildMembers: async (guild, options) => calls.push(`refresh:${guild.id}:${Boolean(options?.force)}`),
        buildRankingEmbed: ({ shift }) => ({ shift }),
        reconcileAttendanceMembership: async () => calls.push('reconcile'),
        syncVoiceStates: async () => calls.push('voice'),
        checkDayOffReservations: async () => calls.push('dayoff'),
        autoOvertimeCheck: async () => calls.push('ot'),
        syncAutoPanels: async () => calls.push('panels'),
        syncWorkingRoles: async () => ({ added: 1, removed: 2 }),
        buildInactiveCandidatesEmbed: async () => ({ inactive: true }),
        syncUserRecordedStatus: async () => ({ ok: true, changed: false, user: {}, before: {}, next: {}, backupPath: 'backup.json' }),
        auditCommands: {
            permissionCheck: { aliases: [], execute: async () => {} },
            dataAudit: { aliases: [], execute: async () => {} },
            statusAudit: { aliases: [], execute: async () => {} },
            statusTrace: { aliases: [], execute: async () => {} },
            timeAudit: { aliases: [], execute: async () => {} }
        },
        opsCheckCommand: { aliases: [], execute: async () => {} },
        dayOffReadCommands: {
            log: { aliases: [], execute: async () => {} },
            list: { aliases: [], execute: async () => {} }
        },
        dayOffMutationCommands: {
            approve: { aliases: [], execute: async () => {} },
            cancel: { aliases: [], execute: async () => {} },
            forceCancel: { aliases: [], execute: async () => {} },
            reject: { aliases: [], execute: async () => {} }
        },
        forceAttendanceCommands: {
            forceIn: { aliases: [], execute: async () => {} },
            forceOut: { aliases: [], execute: async () => {} },
            forceEarlyOut: { aliases: [], execute: async () => {} },
            forceOff: { aliases: [], execute: async () => {} },
            forceOvertime: { aliases: [], execute: async () => {} }
        },
        diagnosticsCommand: { aliases: [], execute: async () => {} },
        backupCommands: {
            create: { aliases: [], execute: async () => {} },
            list: { aliases: [], execute: async () => {} },
            restore: { aliases: [], execute: async () => {} }
        },
        announcementCommands: {
            set: { aliases: [], execute: async () => {} },
            cancel: { aliases: [], execute: async () => {} },
            list: { aliases: [], execute: async () => {} }
        },
        userAdminCommands: {
            manualAdjust: { aliases: [], execute: async () => {} },
            fire: { aliases: [], execute: async () => {} },
            clearRoles: { aliases: [], execute: async () => {} },
            resetUser: { aliases: [], execute: async () => {} },
            resetAll: { aliases: [], execute: async () => {} }
        },
        payrollArchiveCommand: {
            aliases: ['급여기록', 'payroll-record'],
            execute: async () => {
                calls.push('payrollSave');
                return 'payroll-record-result';
            }
        },
        myInfoCommand: {
            aliases: ['my-info'],
            execute: async () => {
                calls.push('myInfo');
                return 'my-info-result';
            }
        },
        ...overrides
    });
    return { handler, calls, target };
}

(async () => {
    const { handler: myInfoHandler, calls: myInfoCalls } = createHandler();
    assert.strictEqual(await myInfoHandler(createInteraction('my-info')), 'my-info-result');
    assert.deepStrictEqual(myInfoCalls, ['myInfo']);

    const { handler: assignHandler, calls: assignCalls } = createHandler();
    const assignInteraction = createInteraction('assign-roles', {
        strings: {
            server: 'HEINE',
            shift: 'DAY'
        }
    });
    await assignHandler(assignInteraction);
    assert.strictEqual(assignInteraction.replyPayload.content, 'Assigned HEINE / DAY to Robin.');
    assert.strictEqual(assignInteraction.replyPayload.flags, 64);
    assert.deepStrictEqual(assignCalls, [
        'role:add:heine',
        'role:remove:paagrio',
        'role:add:day',
        'role:remove:night',
        'ensureUser',
        'clearDayOff:now:assign-roles-command:role-assignment-cleared-dayoff',
        'save',
        'render:false',
        'autoDel'
    ]);

    const { handler: refreshHandler, calls: refreshCalls } = createHandler();
    const refreshInteraction = createInteraction('refresh');
    await refreshHandler(refreshInteraction);
    assert.strictEqual(refreshInteraction.editPayload.content, '✅ UI Refreshed.');
    assert.deepStrictEqual(refreshCalls, [
        'refresh:guild:true',
        'reconcile',
        'voice',
        'dayoff',
        'ot',
        'panels',
        'render:true',
        'autoDel'
    ]);

    const { handler: noneHandler } = createHandler();
    assert.strictEqual(await noneHandler(createInteraction('unknown')), false);

    const { handler: payrollHandler, calls: payrollCalls } = createHandler();
    assert.strictEqual(await payrollHandler(createInteraction('급여기록')), 'payroll-record-result');
    assert.deepStrictEqual(payrollCalls, ['payrollSave']);

    assert.throws(() => createChatInputCommandHandler({}), /MessageFlags/);

    console.log('chat-input-command-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
