const assert = require('assert');
const { createChatInputCommandContext } = require('../src/events/chatInputCommandContext');

(async () => {
    const calls = [];
    const autoDel = () => calls.push('autoDel');
    const now = { tag: 'now' };
    const target = { id: 'target' };
    const interaction = {
        commandName: 'refresh',
        member: { admin: true },
        isChatInputCommand: () => true,
        replyPayload: null,
        reply: async payload => {
            interaction.replyPayload = payload;
        },
        options: {
            getMember: name => (name === 'target' ? target : null),
            getInteger: () => null,
            getString: () => null,
            getRole: () => null
        }
    };

    const prepare = createChatInputCommandContext({
        MessageFlags: { Ephemeral: 64 },
        createAutoDelete: received => {
            calls.push(received === interaction ? 'createAutoDelete:interaction' : 'createAutoDelete:other');
            return autoDel;
        },
        patchCommandReplies: received => calls.push(received === interaction ? 'patch:interaction' : 'patch:other'),
        createCommandOptionHelpers: received => {
            calls.push(received === interaction ? 'helpers:interaction' : 'helpers:other');
            return {
                n: command => received.commandName === command,
                getTargetMember: () => received.options.getMember('target'),
                getSlot: () => 1,
                getAnnounceTime: () => '09:00',
                getAnnounceContent: () => 'hello',
                getAnnounceRole: () => null,
                getAnnounceRoles: () => []
            };
        },
        withCommandStatusPayload: payload => payload,
        handleInteractionReplyError: () => {},
        markMemberActivity: (member, source) => {
            calls.push(`activity:${member.admin}:${source}`);
            return true;
        },
        saveSystem: async () => calls.push('save'),
        getNow: () => now,
        canAdmin: member => Boolean(member.admin)
    });

    const context = await prepare(interaction);
    assert.strictEqual(context.handled, false);
    assert.strictEqual(context.autoDel, autoDel);
    assert.strictEqual(context.isAdmin, true);
    assert.strictEqual(context.now, now);
    assert.strictEqual(context.n('refresh'), true);
    assert.strictEqual(context.getTargetMember(), target);
    await context.replyMemberNotFound();
    assert.strictEqual(interaction.replyPayload.content, '대상을 찾을 수 없습니다.');
    assert.strictEqual(interaction.replyPayload.flags, 64);
    assert.deepStrictEqual(calls, [
        'createAutoDelete:interaction',
        'patch:interaction',
        'activity:true:command',
        'save',
        'helpers:interaction',
        'autoDel'
    ]);

    const skipped = await prepare({
        isChatInputCommand: () => false
    });
    assert.strictEqual(skipped.handled, true);
    assert.strictEqual(skipped.response, undefined);

    assert.throws(() => createChatInputCommandContext({}), /MessageFlags/);

    console.log('chat-input-command-context tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
