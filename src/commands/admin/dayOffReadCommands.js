'use strict';

function createDayOffReadCommands({
    MessageFlags,
    canRun,
    buildDayOffLogEmbed,
    buildDayOffListEmbed
}) {
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');
    if (typeof buildDayOffLogEmbed !== 'function') throw new TypeError('buildDayOffLogEmbed must be a function');
    if (typeof buildDayOffListEmbed !== 'function') throw new TypeError('buildDayOffListEmbed must be a function');

    function noPerms(interaction, autoDel) {
        return interaction.reply({
            content: 'No perms.',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    async function executeLog(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const limit = interaction.options.getInteger('limit') || interaction.options.getInteger('\uac2f\uc218') || 10;
        return interaction.reply({
            embeds: [await buildDayOffLogEmbed(Math.max(1, Math.min(30, limit)))],
            flags: MessageFlags.Ephemeral
        });
    }

    async function executeList(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const status = interaction.options.getString('status') || interaction.options.getString('\uc0c1\ud0dc') || 'all';
        return interaction.reply({
            embeds: [buildDayOffListEmbed(status)],
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        log: {
            aliases: ['dayoff-log', '\ud734\ubb34\ub85c\uadf8'],
            execute: executeLog
        },
        list: {
            aliases: ['dayoff-list', '\ud734\ubb34\ubaa9\ub85d'],
            execute: executeList
        }
    };
}

module.exports = {
    createDayOffReadCommands
};
