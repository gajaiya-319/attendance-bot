'use strict';

function createDiagnosticsCommand({
    MessageFlags,
    buildDiagnosticsEmbed,
    canRun
}) {
    if (typeof buildDiagnosticsEmbed !== 'function') throw new TypeError('buildDiagnosticsEmbed must be a function');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    async function execute(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({
                content: 'No perms.',
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }

        return interaction.reply({
            embeds: [buildDiagnosticsEmbed(interaction.guild)],
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        aliases: ['diagnostics', '\uc9c4\ub2e8'],
        execute
    };
}

module.exports = {
    createDiagnosticsCommand
};
