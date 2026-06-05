'use strict';

function createButtonInteractionHandler({
    createAutoDelete,
    buttonInteractionContext,
    buttonActionHandlers
}) {
    if (typeof createAutoDelete !== 'function') throw new TypeError('createAutoDelete must be a function');
    if (!buttonInteractionContext || typeof buttonInteractionContext.prepare !== 'function') {
        throw new TypeError('buttonInteractionContext.prepare must be a function');
    }
    if (!buttonActionHandlers || typeof buttonActionHandlers.runAction !== 'function') {
        throw new TypeError('buttonActionHandlers.runAction must be a function');
    }

    return async function handleButtonInteraction(interaction) {
        const autoDel = createAutoDelete(interaction);
        if (!interaction.isButton()) return undefined;

        const buttonContext = await buttonInteractionContext.prepare(interaction, { autoDel });
        if (buttonContext.handled) return buttonContext.response;

        const {
            member,
            shift,
            user,
            now,
            type
        } = buttonContext;

        return buttonActionHandlers.runAction({
            interaction,
            autoDel,
            member,
            user,
            shift,
            now,
            type
        });
    };
}

module.exports = {
    createButtonInteractionHandler
};
