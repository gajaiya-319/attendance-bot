'use strict';

function createOpsCheckCommand({
    MessageFlags,
    buildOpsCheckEmbed,
    canRun
}) {
    if (typeof buildOpsCheckEmbed !== 'function') throw new TypeError('buildOpsCheckEmbed must be a function');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    async function execute(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({
                content: 'No perms.',
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;

        return interaction.editReply({
            embeds: [await buildOpsCheckEmbed(interaction.guild)]
        });
    }

    return {
        aliases: ['ops-check', '\uc6b4\uc601\uc810\uac80'],
        execute
    };
}

module.exports = {
    createOpsCheckCommand
};
