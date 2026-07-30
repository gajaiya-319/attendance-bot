'use strict';

const { isAutoOtConfirmCustomId } = require('../utils/overtimeActivityPolicy');

function createButtonInteractionHandler({
    createAutoDelete,
    buttonInteractionContext,
    buttonActionHandlers,
    endAdenaReviewCommand = null
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

        if (endAdenaReviewCommand?.isButton?.(interaction.customId)) {
            return endAdenaReviewCommand.handleButton(interaction);
        }

        if (
            isAutoOtConfirmCustomId(interaction.customId) &&
            typeof buttonActionHandlers.handleAutoOvertimeConfirmationButton === 'function'
        ) {
            return buttonActionHandlers.handleAutoOvertimeConfirmationButton({
                interaction,
                autoDel
            });
        }

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
