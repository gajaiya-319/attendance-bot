'use strict';

function createAuditCommands({
    MessageFlags,
    canRun,
    buildPermissionCheckEmbed,
    buildDataAuditEmbed,
    buildStatusAuditEmbed,
    buildStatusTraceEmbed,
    buildTimeAuditEmbed
}) {
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');
    if (typeof buildPermissionCheckEmbed !== 'function') throw new TypeError('buildPermissionCheckEmbed must be a function');
    if (typeof buildDataAuditEmbed !== 'function') throw new TypeError('buildDataAuditEmbed must be a function');
    if (typeof buildStatusAuditEmbed !== 'function') throw new TypeError('buildStatusAuditEmbed must be a function');
    if (typeof buildStatusTraceEmbed !== 'function') throw new TypeError('buildStatusTraceEmbed must be a function');
    if (typeof buildTimeAuditEmbed !== 'function') throw new TypeError('buildTimeAuditEmbed must be a function');

    function noPerms(interaction, autoDel) {
        return interaction.reply({
            content: 'No perms.',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    async function executePermissionCheck(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;
        return interaction.editReply({ embeds: [await buildPermissionCheckEmbed(interaction.guild)] });
    }

    async function executeDataAudit(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        return interaction.reply({
            embeds: [buildDataAuditEmbed()],
            flags: MessageFlags.Ephemeral
        });
    }

    async function executeStatusAudit(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        return interaction.reply({
            embeds: [await buildStatusAuditEmbed(interaction.guild)],
            flags: MessageFlags.Ephemeral
        });
    }

    async function executeStatusTrace(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');
        const target = getTargetMember();
        if (!target) return replyMemberNotFound();
        return interaction.reply({
            embeds: [buildStatusTraceEmbed(target)],
            flags: MessageFlags.Ephemeral
        });
    }

    async function executeTimeAudit(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        return interaction.reply({
            embeds: [buildTimeAuditEmbed()],
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        permissionCheck: {
            aliases: ['permission-check', '\uad8c\ud55c\uc9c4\ub2e8'],
            execute: executePermissionCheck
        },
        dataAudit: {
            aliases: ['data-audit', '\ub370\uc774\ud130\uac80\uc0ac'],
            execute: executeDataAudit
        },
        statusAudit: {
            aliases: ['status-audit', '\uc0c1\ud0dc\uac80\uc0ac'],
            execute: executeStatusAudit
        },
        statusTrace: {
            aliases: ['status-trace', '\uc0c1\ud0dc\ucd94\uc801'],
            execute: executeStatusTrace
        },
        timeAudit: {
            aliases: ['time-audit', '\uc2dc\uac04\uac80\uc0ac'],
            execute: executeTimeAudit
        }
    };
}

module.exports = {
    createAuditCommands
};
