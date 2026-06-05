'use strict';

function isUnknownInteractionError(error) {
    return error?.code === 10062 || error?.rawError?.code === 10062;
}

function createInteractionReplyErrorHandler({
    logger = console,
    isUnknownInteraction = isUnknownInteractionError
} = {}) {
    return function handleInteractionReplyError(error, context = 'reply') {
        if (isUnknownInteraction(error)) {
            logger.warn?.(`[INTERACTION WARN] Expired interaction ignored during ${context}.`);
            return null;
        }
        throw error;
    };
}

function registerDiscordErrorGuards({
    client,
    processRef = process,
    logger = console,
    isUnknownInteraction = isUnknownInteractionError
}) {
    if (!client || typeof client.on !== 'function') throw new TypeError('client.on must be a function');
    if (!processRef || typeof processRef.on !== 'function') throw new TypeError('processRef.on must be a function');

    client.on('error', error => {
        if (isUnknownInteraction(error)) {
            logger.warn?.('[INTERACTION WARN] Unknown interaction ignored. The command reply window already expired.');
            return;
        }
        logger.error?.('[CLIENT ERROR]', error);
    });

    processRef.on('unhandledRejection', error => {
        if (isUnknownInteraction(error)) {
            logger.warn?.('[INTERACTION WARN] Unknown interaction ignored. The command reply window already expired.');
            return;
        }
        logger.error?.('[UNHANDLED REJECTION]', error);
    });
}

module.exports = {
    isUnknownInteractionError,
    createInteractionReplyErrorHandler,
    registerDiscordErrorGuards
};
