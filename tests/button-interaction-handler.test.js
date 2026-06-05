const assert = require('assert');
const { createButtonInteractionHandler } = require('../src/events/buttonInteractionHandler');

(async () => {
    const calls = [];
    const interaction = {
        isButton: () => true
    };
    const autoDelete = () => {};
    const now = { tag: 'now' };
    const member = { id: 'u1', displayName: 'Robin' };
    const user = { checkedIn: true };

    const handler = createButtonInteractionHandler({
        createAutoDelete: receivedInteraction => {
            calls.push(receivedInteraction === interaction ? 'autoDel:interaction' : 'autoDel:other');
            return autoDelete;
        },
        buttonInteractionContext: {
            prepare: async (receivedInteraction, options) => {
                calls.push(receivedInteraction === interaction ? 'prepare:interaction' : 'prepare:other');
                calls.push(options.autoDel === autoDelete ? 'prepare:autoDel' : 'prepare:noAutoDel');
                return {
                    handled: false,
                    member,
                    shift: 'night',
                    user,
                    now,
                    type: 'out'
                };
            }
        },
        buttonActionHandlers: {
            runAction: async payload => {
                calls.push(payload.interaction === interaction ? 'run:interaction' : 'run:other');
                calls.push(payload.autoDel === autoDelete ? 'run:autoDel' : 'run:noAutoDel');
                calls.push(`${payload.member.displayName}:${payload.shift}:${payload.type}:${payload.now.tag}`);
                return 'done';
            }
        }
    });

    const result = await handler(interaction);
    assert.strictEqual(result, 'done');
    assert.deepStrictEqual(calls, [
        'autoDel:interaction',
        'prepare:interaction',
        'prepare:autoDel',
        'run:interaction',
        'run:autoDel',
        'Robin:night:out:now'
    ]);

    const handledHandler = createButtonInteractionHandler({
        createAutoDelete: () => autoDelete,
        buttonInteractionContext: {
            prepare: async () => ({
                handled: true,
                response: 'context-response'
            })
        },
        buttonActionHandlers: {
            runAction: async () => {
                throw new Error('runAction should not be called when context handled the button');
            }
        }
    });
    assert.strictEqual(await handledHandler(interaction), 'context-response');

    const nonButtonHandler = createButtonInteractionHandler({
        createAutoDelete: () => autoDelete,
        buttonInteractionContext: {
            prepare: async () => {
                throw new Error('prepare should not be called for non-button interactions');
            }
        },
        buttonActionHandlers: {
            runAction: async () => {}
        }
    });
    assert.strictEqual(await nonButtonHandler({ isButton: () => false }), undefined);

    console.log('button-interaction-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
