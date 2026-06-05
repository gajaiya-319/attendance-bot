'use strict';

function createInteractionErrorHandler({
    MessageFlags,
    failText,
    logger = console
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (typeof failText !== 'function') throw new TypeError('failText must be a function');

    return async function handleInteractionError(interaction, error) {
        logger.error?.('[INTERACTION ERROR]', error);
        const content = failText('명령어를 처리하는 중 오류가 발생했습니다. 콘솔 로그를 확인해주세요.');

        if (interaction?.deferred || interaction?.replied) {
            await interaction.editReply({ content, embeds: [], components: [] }).catch(() => null);
            return;
        }

        await interaction?.reply?.({
            content,
            flags: MessageFlags.Ephemeral
        }).catch(() => null);
    };
}

module.exports = {
    createInteractionErrorHandler
};
