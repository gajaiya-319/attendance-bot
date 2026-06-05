const assert = require('assert');
const {
    isUnknownInteractionError,
    createInteractionReplyErrorHandler,
    registerDiscordErrorGuards
} = require('../src/utils/discordErrorGuards');

(() => {
    assert.strictEqual(isUnknownInteractionError({ code: 10062 }), true);
    assert.strictEqual(isUnknownInteractionError({ rawError: { code: 10062 } }), true);
    assert.strictEqual(isUnknownInteractionError({ code: 500 }), false);

    const logs = [];
    const replyHandler = createInteractionReplyErrorHandler({
        logger: {
            warn: message => logs.push(`warn:${message}`)
        }
    });
    assert.strictEqual(replyHandler({ code: 10062 }, 'reply'), null);
    assert.strictEqual(logs[0].includes('reply'), true);
    assert.throws(() => replyHandler(new Error('boom')), /boom/);

    const clientHandlers = {};
    const processHandlers = {};
    const guardLogs = [];
    registerDiscordErrorGuards({
        client: {
            on: (event, handler) => {
                clientHandlers[event] = handler;
            }
        },
        processRef: {
            on: (event, handler) => {
                processHandlers[event] = handler;
            }
        },
        logger: {
            warn: message => guardLogs.push(`warn:${message}`),
            error: (message, error) => guardLogs.push(`error:${message}:${error.message}`)
        }
    });

    clientHandlers.error({ code: 10062 });
    clientHandlers.error(new Error('client'));
    processHandlers.unhandledRejection({ rawError: { code: 10062 } });
    processHandlers.unhandledRejection(new Error('promise'));

    assert.deepStrictEqual(guardLogs, [
        'warn:[INTERACTION WARN] Unknown interaction ignored. The command reply window already expired.',
        'error:[CLIENT ERROR]:client',
        'warn:[INTERACTION WARN] Unknown interaction ignored. The command reply window already expired.',
        'error:[UNHANDLED REJECTION]:promise'
    ]);

    assert.throws(() => registerDiscordErrorGuards({ client: {}, processRef: { on: () => {} } }), /client\.on/);

    console.log('discord-error-guards tests passed');
})();
