'use strict';

function createBackupCommands({
    MessageFlags,
    canRun,
    isOwner,
    ownerOnlyReply,
    saveSystem,
    createBackupSnapshot,
    listBackupSnapshots,
    restoreBackupSnapshot,
    renderDashboard
}) {
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');
    if (typeof isOwner !== 'function') throw new TypeError('isOwner must be a function');
    if (typeof ownerOnlyReply !== 'function') throw new TypeError('ownerOnlyReply must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof createBackupSnapshot !== 'function') throw new TypeError('createBackupSnapshot must be a function');
    if (typeof listBackupSnapshots !== 'function') throw new TypeError('listBackupSnapshots must be a function');
    if (typeof restoreBackupSnapshot !== 'function') throw new TypeError('restoreBackupSnapshot must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');

    function noPerms(interaction, autoDel) {
        return interaction.reply({
            content: 'No perms.',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    async function executeCreate(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        await saveSystem();
        const backupPath = await createBackupSnapshot('manual');
        return interaction.reply({
            content: backupPath ? `Backup created: ${backupPath}` : 'Backup failed. Check console logs.',
            flags: MessageFlags.Ephemeral
        });
    }

    async function executeList(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const backups = await listBackupSnapshots();
        const content = backups.length ? backups.slice(0, 10).join('\n') : 'No backups found.';
        return interaction.reply({
            content: `\`\`\`\n${content}\n\`\`\``,
            flags: MessageFlags.Ephemeral
        });
    }

    async function executeRestore(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        if (!isOwner(interaction.user.id)) return ownerOnlyReply(interaction);
        const fileName = interaction.options.getString('file') || interaction.options.getString('\ud30c\uc77c');
        const restored = await restoreBackupSnapshot(fileName);
        if (!restored) {
            return interaction.reply({
                content: 'Restore failed. Use /backup-list first.',
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }
        await renderDashboard();
        return interaction.reply({
            content: `Restored backup: ${restored}`,
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        create: {
            aliases: ['backup-create', '\ubc31\uc5c5\uc0dd\uc131'],
            execute: executeCreate
        },
        list: {
            aliases: ['backup-list', '\ubc31\uc5c5\ubaa9\ub85d'],
            execute: executeList
        },
        restore: {
            aliases: ['backup-restore', '\ubc31\uc5c5\ubcf5\uad6c'],
            execute: executeRestore
        }
    };
}

module.exports = {
    createBackupCommands
};
