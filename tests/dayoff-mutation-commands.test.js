const assert = require('assert');
const { createDayOffMutationCommands } = require('../src/commands/admin/dayOffMutationCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { admin: true },
        user: { id: 'admin' },
        options: {
            getString: name => name === 'date' ? '2026-05-21' : null
        },
        deferred: false,
        replyPayload: null,
        reply: async payload => {
            interaction.replied = true;
            interaction.replyPayload = payload;
        },
        deferReply: async payload => {
            interaction.deferred = true;
            interaction.deferPayload = payload;
        },
        editReply: async payload => {
            interaction.replyPayload = payload;
        },
        ...overrides
    };
    return interaction;
}

function createCommands(overrides = {}) {
    const calls = [];
    const commands = createDayOffMutationCommands({
        MessageFlags: { Ephemeral: 64 },
        canAdmin: interaction => Boolean(interaction.member?.admin),
        canManageDayOff: interaction => Boolean(interaction.member?.manager),
        parseDayOffCommandDate: value => value === 'bad-date' ? null : value,
        approveDayOffReservation: async (target, leaveDate) => {
            calls.push(`approve:${target.displayName}:${leaveDate}`);
            return { name: target.displayName };
        },
        cancelDayOffReservation: async (target, leaveDate) => {
            calls.push(`cancel:${target.displayName}:${leaveDate}`);
            return { name: target.displayName };
        },
        cancelOnlyDayOffReservation: async target => {
            calls.push(`forceCancel:${target.displayName}`);
            return { name: target.displayName, leaveDate: '2026-05-22' };
        },
        rejectDayOffReservation: async (target, leaveDate, moderator, reason) => {
            calls.push(`reject:${target.displayName}:${leaveDate}:${reason}`);
            return { name: target.displayName };
        },
        renderDashboard: () => {
            calls.push('render');
        },
        ...overrides
    });
    return { commands, calls };
}

const target = { displayName: 'Daba' };
const context = {
    autoDel: () => {},
    getTargetMember: () => target,
    replyMemberNotFound: () => Promise.resolve('not-found')
};

(async () => {
    let deleted = false;
    const { commands: noPermCommands } = createCommands();
    const noPermInteraction = createInteraction({ member: { admin: false, manager: false } });
    await noPermCommands.approve.execute(noPermInteraction, {
        ...context,
        autoDel: () => {
            deleted = true;
        }
    });
    assert.strictEqual(noPermInteraction.deferred, false);
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const { commands: approveCommands, calls: approveCalls } = createCommands();
    const approveInteraction = createInteraction({ member: { manager: true } });
    await approveCommands.approve.execute(approveInteraction, context);
    assert.strictEqual(approveInteraction.deferred, true);
    assert.strictEqual(approveInteraction.replyPayload.content, 'Daba 님의 2026-05-21 휴무를 승인했습니다.');
    assert.deepStrictEqual(approveCalls, ['approve:Daba:2026-05-21', 'render']);

    const { commands: duplicateCommands } = createCommands({
        approveDayOffReservation: async () => ({ error: 'duplicate' })
    });
    const duplicateInteraction = createInteraction({ member: { manager: true } });
    await duplicateCommands.approve.execute(duplicateInteraction, context);
    assert.strictEqual(duplicateInteraction.deferred, true);
    assert.strictEqual(duplicateInteraction.replyPayload.content, '이미 동일한 날짜(2026-05-21)에 승인된 휴무가 존재합니다.');

    const { commands: cancelCommands, calls: cancelCalls } = createCommands();
    const cancelInteraction = createInteraction({ member: { admin: true } });
    await cancelCommands.cancel.execute(cancelInteraction, context);
    assert.strictEqual(cancelInteraction.deferred, true);
    assert.strictEqual(cancelInteraction.replyPayload.content, 'Daba 님의 2026-05-21 휴무를 취소했습니다.');
    assert.deepStrictEqual(cancelCalls, ['cancel:Daba:2026-05-21', 'render']);

    const { commands: forceCancelCommands } = createCommands({
        cancelOnlyDayOffReservation: async () => ({
            error: 'ambiguous',
            count: 2,
            candidates: [
                { leaveDate: '2026-05-21', shiftLabel: 'Night' },
                { leaveDate: '2026-05-22', shiftLabel: '' }
            ]
        })
    });
    let forceDelay = null;
    const forceCancelInteraction = createInteraction({ member: { manager: true } });
    await forceCancelCommands.forceCancel.execute(forceCancelInteraction, {
        ...context,
        autoDel: delay => {
            forceDelay = delay;
        }
    });
    assert.strictEqual(forceCancelInteraction.deferred, true);
    assert.strictEqual(forceCancelInteraction.replyPayload.content, '휴무 신청이 2개입니다. 날짜가 있는 /휴무취소를 사용해주세요. 후보: 2026-05-21 / Night, 2026-05-22 / -');
    assert.strictEqual(forceDelay, 7000);

    const { commands: rejectCommands, calls: rejectCalls } = createCommands();
    const rejectInteraction = createInteraction({
        member: { manager: true },
        options: {
            getString: name => {
                if (name === 'date') return '2026-05-21';
                if (name === 'reason') return 'Schedule conflict';
                return null;
            }
        }
    });
    await rejectCommands.reject.execute(rejectInteraction, context);
    assert.strictEqual(rejectInteraction.deferred, true);
    assert.strictEqual(rejectInteraction.replyPayload.content, 'Daba 님의 2026-05-21 휴무 신청을 반려했습니다.');
    assert.deepStrictEqual(rejectCalls, ['reject:Daba:2026-05-21:Schedule conflict', 'render']);

    const { commands: invalidDateCommands } = createCommands();
    const invalidDateInteraction = createInteraction({
        member: { manager: true },
        options: {
            getString: name => name === 'date' ? 'bad-date' : null
        }
    });
    await invalidDateCommands.approve.execute(invalidDateInteraction, context);
    assert.strictEqual(invalidDateInteraction.deferred, false);
    assert.strictEqual(invalidDateInteraction.replyPayload.content, '날짜 형식이 올바르지 않습니다. 예: 2026-05-21 또는 May 21');

    assert.strictEqual(approveCommands.approve.aliases.includes('dayoff-approve'), true);
    assert.strictEqual(approveCommands.reject.aliases.includes('\ud734\ubb34\ubc18\ub824'), true);

    console.log('dayoff-mutation-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
