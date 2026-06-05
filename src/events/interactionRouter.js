'use strict';

function createInteractionRouter({
    handleChatInputCommand,
    handleButton,
    handleModalSubmit = async () => false,
    handleError
}) {
    if (typeof handleChatInputCommand !== 'function') {
        throw new TypeError('handleChatInputCommand must be a function');
    }
    if (typeof handleButton !== 'function') {
        throw new TypeError('handleButton must be a function');
    }
    if (typeof handleModalSubmit !== 'function') {
        throw new TypeError('handleModalSubmit must be a function');
    }
    if (typeof handleError !== 'function') {
        throw new TypeError('handleError must be a function');
    }

    return async function routeInteraction(interaction) {
        try {
            if (interaction?.isChatInputCommand?.()) {
                return await handleChatInputCommand(interaction);
            }
            if (interaction?.isButton?.()) {
                return await handleButton(interaction);
            }
            if (interaction?.isModalSubmit?.()) {
                return await handleModalSubmit(interaction);
            }
            return false;
        } catch (error) {
            return await handleError(interaction, error);
        }
    };
}

module.exports = {
    createInteractionRouter
};
