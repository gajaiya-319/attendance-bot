'use strict';

function createChatInputCommandContext({
    MessageFlags,
    createAutoDelete,
    patchCommandReplies,
    createCommandOptionHelpers,
    withCommandStatusPayload,
    handleInteractionReplyError,
    markMemberActivity,
    saveSystem,
    getNow,
    canAdmin
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (typeof createAutoDelete !== 'function') throw new TypeError('createAutoDelete must be a function');
    if (typeof patchCommandReplies !== 'function') throw new TypeError('patchCommandReplies must be a function');
    if (typeof createCommandOptionHelpers !== 'function') throw new TypeError('createCommandOptionHelpers must be a function');
    if (typeof withCommandStatusPayload !== 'function') throw new TypeError('withCommandStatusPayload must be a function');
    if (typeof handleInteractionReplyError !== 'function') throw new TypeError('handleInteractionReplyError must be a function');
    if (typeof markMemberActivity !== 'function') throw new TypeError('markMemberActivity must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof getNow !== 'function') throw new TypeError('getNow must be a function');
    if (typeof canAdmin !== 'function') throw new TypeError('canAdmin must be a function');

    return async function prepareChatInputCommand(interaction) {
        const autoDel = createAutoDelete(interaction);
        if (!interaction.isChatInputCommand()) {
            return { handled: true, response: undefined, autoDel };
        }

        patchCommandReplies(interaction, {
            withCommandStatusPayload,
            handleInteractionReplyError
        });

        if (interaction.member && markMemberActivity(interaction.member, 'command')) {
            await saveSystem();
        }

        const helpers = createCommandOptionHelpers(interaction);
        const replyMemberNotFound = () => interaction.reply({
            content: '대상을 찾을 수 없습니다.',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());

        return {
            handled: false,
            autoDel,
            isAdmin: canAdmin(interaction.member),
            now: getNow(),
            replyMemberNotFound,
            ...helpers
        };
    };
}

module.exports = {
    createChatInputCommandContext
};
