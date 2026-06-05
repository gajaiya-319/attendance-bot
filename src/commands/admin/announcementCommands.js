'use strict';

function createAnnouncementCommands({
    MessageFlags,
    canRun,
    getAnnounceData,
    saveSystem,
    formatAnnouncementList
}) {
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');
    if (typeof getAnnounceData !== 'function') throw new TypeError('getAnnounceData must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof formatAnnouncementList !== 'function') throw new TypeError('formatAnnouncementList must be a function');

    function noPerms(interaction, autoDel) {
        return interaction.reply({
            content: 'No perms.',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    function requireOptionHelpers(options, names) {
        for (const name of names) {
            if (typeof options[name] !== 'function') throw new TypeError(`${name} must be a function`);
        }
    }

    async function executeSet(interaction, {
        autoDel = () => {},
        getSlot,
        getAnnounceTime,
        getAnnounceContent,
        getAnnounceRole,
        getAnnounceRoles
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        requireOptionHelpers({ getSlot, getAnnounceTime, getAnnounceContent }, [
            'getSlot',
            'getAnnounceTime',
            'getAnnounceContent'
        ]);

        const slot = getSlot();
        const time = getAnnounceTime();
        const content = getAnnounceContent();
        const roles = typeof getAnnounceRoles === 'function'
            ? getAnnounceRoles()
            : (typeof getAnnounceRole === 'function' ? [getAnnounceRole()].filter(Boolean) : []);
        const roleIds = [...new Set(roles.map(role => role?.id).filter(Boolean))].slice(0, 2);

        if (slot < 1 || slot > 6 || !/^\d{2}:\d{2}$/.test(time)) {
            return interaction.reply({
                content: 'Invalid slot or time. Use slot 1-6 and HH:mm.',
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }

        getAnnounceData()[slot] = {
            active: true,
            time,
            content,
            roleId: roleIds[0] || null,
            roleIds,
            lastSentDate: null
        };

        await saveSystem();
        const targetText = roleIds.length
            ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
            : '@everyone';

        return interaction.reply({
            content: `Announcement slot ${slot} saved for ${time}. Targets: ${targetText}`,
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    async function executeCancel(interaction, { autoDel = () => {}, getSlot } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        requireOptionHelpers({ getSlot }, ['getSlot']);

        const slot = getSlot();
        if (slot < 1 || slot > 6) {
            return interaction.reply({
                content: 'Invalid slot. Use 1-6.',
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }

        if (getAnnounceData()[slot]) getAnnounceData()[slot].active = false;
        await saveSystem();
        return interaction.reply({
            content: `Announcement slot ${slot} disabled.`,
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    async function executeList(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        return interaction.reply({
            content: `\`\`\`\n${formatAnnouncementList()}\n\`\`\``,
            flags: MessageFlags.Ephemeral
        });
    }

    return {
        set: {
            aliases: ['set-announce', '\uacf5\uc9c0\uc124\uc815'],
            execute: executeSet
        },
        cancel: {
            aliases: ['cancel-announce', '\uacf5\uc9c0\ucde8\uc18c'],
            execute: executeCancel
        },
        list: {
            aliases: ['list-announce', '\uacf5\uc9c0\ubaa9\ub85d'],
            execute: executeList
        }
    };
}

module.exports = {
    createAnnouncementCommands
};
