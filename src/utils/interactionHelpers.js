function createAutoDelete(interaction) {
    return (ms = 3000) => setTimeout(() => interaction.deleteReply().catch(() => {}), ms);
}

function patchCommandReplies(interaction, { withCommandStatusPayload, handleInteractionReplyError }) {
    const rawReply = interaction.reply.bind(interaction);
    const rawEditReply = interaction.editReply.bind(interaction);
    const rawDeferReply = interaction.deferReply.bind(interaction);

    interaction.reply = (payload) => rawReply(withCommandStatusPayload(payload))
        .catch(e => handleInteractionReplyError(e, 'reply'));
    interaction.editReply = (payload) => rawEditReply(withCommandStatusPayload(payload))
        .catch(e => handleInteractionReplyError(e, 'editReply'));
    interaction.deferReply = (payload) => rawDeferReply(payload)
        .catch(e => handleInteractionReplyError(e, 'deferReply'));
}

function createCommandOptionHelpers(interaction) {
    return {
        n: (cmd) => interaction.commandName === cmd,
        getTargetMember: () => interaction.options.getMember('target') || interaction.options.getMember('대상'),
        getSlot: () => interaction.options.getInteger('slot') || interaction.options.getInteger('번호'),
        getAnnounceTime: () => interaction.options.getString('time') || interaction.options.getString('시간'),
        getAnnounceContent: () => interaction.options.getString('content') || interaction.options.getString('내용'),
        getAnnounceRole: () => interaction.options.getRole('target') ||
            interaction.options.getRole('대상') ||
            interaction.options.getRole('role') ||
            interaction.options.getRole('역할'),
        getAnnounceRoles: () => [
            interaction.options.getRole('target') ||
                interaction.options.getRole('대상') ||
                interaction.options.getRole('role') ||
                interaction.options.getRole('역할'),
            interaction.options.getRole('target2') ||
                interaction.options.getRole('대상2') ||
                interaction.options.getRole('role2') ||
                interaction.options.getRole('역할2')
        ].filter(Boolean)
    };
}

module.exports = {
    createAutoDelete,
    patchCommandReplies,
    createCommandOptionHelpers
};
