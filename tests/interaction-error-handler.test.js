const assert = require('assert');
const { createInteractionErrorHandler } = require('../src/events/interactionErrorHandler');

(async () => {
    const logs = [];
    const handler = createInteractionErrorHandler({
        MessageFlags: { Ephemeral: 64 },
        failText: text => `FAIL:${text}`,
        logger: {
            error: (...args) => logs.push(args)
        }
    });

    const replyInteraction = {
        replyPayload: null,
        reply: async payload => {
            replyInteraction.replyPayload = payload;
        }
    };
    await handler(replyInteraction, new Error('boom'));
    assert.strictEqual(replyInteraction.replyPayload.flags, 64);
    assert.strictEqual(replyInteraction.replyPayload.content.startsWith('FAIL:'), true);
    assert.strictEqual(logs[0][0], '[INTERACTION ERROR]');
    assert.strictEqual(logs[0][1].message, 'boom');

    const editInteraction = {
        deferred: true,
        editPayload: null,
        editReply: async payload => {
            editInteraction.editPayload = payload;
        },
        reply: async () => {
            throw new Error('reply should not be called after defer');
        }
    };
    await handler(editInteraction, new Error('deferred'));
    assert.deepStrictEqual(editInteraction.editPayload.embeds, []);
    assert.deepStrictEqual(editInteraction.editPayload.components, []);
    assert.strictEqual(editInteraction.editPayload.content.startsWith('FAIL:'), true);

    const swallowedInteraction = {
        reply: async () => {
            throw new Error('discord interaction already expired');
        }
    };
    await handler(swallowedInteraction, new Error('outer'));

    assert.throws(() => createInteractionErrorHandler({}), /MessageFlags/);
    assert.throws(() => createInteractionErrorHandler({ MessageFlags: {} }), /failText/);

    console.log('interaction-error-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
