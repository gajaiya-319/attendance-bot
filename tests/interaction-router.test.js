const assert = require('assert');
const { createInteractionRouter } = require('../src/events/interactionRouter');

(async () => {
    const calls = [];
    const router = createInteractionRouter({
        handleChatInputCommand: async interaction => {
            calls.push(`command:${interaction.id}`);
            return 'command-ok';
        },
        handleButton: async interaction => {
            calls.push(`button:${interaction.id}`);
            return 'button-ok';
        },
        handleModalSubmit: async interaction => {
            calls.push(`modal:${interaction.id}`);
            return 'modal-ok';
        },
        handleError: async (interaction, error) => {
            calls.push(`error:${interaction?.id}:${error.message}`);
            return 'error-ok';
        }
    });

    assert.strictEqual(await router({
        id: 'cmd1',
        isChatInputCommand: () => true,
        isButton: () => false
    }), 'command-ok');

    assert.strictEqual(await router({
        id: 'btn1',
        isChatInputCommand: () => false,
        isButton: () => true
    }), 'button-ok');

    assert.strictEqual(await router({
        id: 'none1',
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => false
    }), false);

    assert.strictEqual(await router({
        id: 'modal1',
        isChatInputCommand: () => false,
        isButton: () => false,
        isModalSubmit: () => true
    }), 'modal-ok');

    const failingRouter = createInteractionRouter({
        handleChatInputCommand: async () => {
            throw new Error('boom');
        },
        handleButton: async () => null,
        handleError: async (interaction, error) => {
            calls.push(`caught:${interaction.id}:${error.message}`);
            return 'caught';
        }
    });

    assert.strictEqual(await failingRouter({
        id: 'cmd2',
        isChatInputCommand: () => true,
        isButton: () => false
    }), 'caught');

    assert.deepStrictEqual(calls, [
        'command:cmd1',
        'button:btn1',
        'modal:modal1',
        'caught:cmd2:boom'
    ]);

    assert.throws(() => createInteractionRouter({}), /handleChatInputCommand/);

    console.log('interaction-router tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
