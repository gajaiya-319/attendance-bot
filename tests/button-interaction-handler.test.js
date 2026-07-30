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

    const dmCalls = [];
    const dmButtonHandler = createButtonInteractionHandler({
        createAutoDelete: receivedInteraction => {
            dmCalls.push(receivedInteraction.customId);
            return autoDelete;
        },
        buttonInteractionContext: {
            prepare: async () => {
                throw new Error('DM OT confirmation should not require guild button context');
            }
        },
        buttonActionHandlers: {
            runAction: async () => {
                throw new Error('regular action should not run for OT confirmation');
            },
            handleAutoOvertimeConfirmationButton: async payload => {
                dmCalls.push(payload.autoDel === autoDelete ? 'autoDel' : 'noAutoDel');
                dmCalls.push(payload.interaction.customId);
                return 'ot-confirmed';
            }
        }
    });
    assert.strictEqual(
        await dmButtonHandler({ isButton: () => true, customId: 'auto_ot_confirm:start:u1:tok1' }),
        'ot-confirmed'
    );
    assert.deepStrictEqual(dmCalls, [
        'auto_ot_confirm:start:u1:tok1',
        'autoDel',
        'auto_ot_confirm:start:u1:tok1'
    ]);

    const reviewCalls = [];
    const reviewButtonHandler = createButtonInteractionHandler({
        createAutoDelete: () => autoDelete,
        buttonInteractionContext: {
            prepare: async () => { throw new Error('review button must bypass attendance context'); }
        },
        buttonActionHandlers: {
            runAction: async () => { throw new Error('review button must bypass attendance actions'); }
        },
        endAdenaReviewCommand: {
            isButton: customId => customId.startsWith('end-adena-review:'),
            handleButton: async received => {
                reviewCalls.push(received.customId);
                return 'reviewed';
            }
        }
    });
    assert.strictEqual(await reviewButtonHandler({
        isButton: () => true,
        customId: 'end-adena-review:refresh:DAY:1:2'
    }), 'reviewed');
    assert.deepStrictEqual(reviewCalls, ['end-adena-review:refresh:DAY:1:2']);

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
