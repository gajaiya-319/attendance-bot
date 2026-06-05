'use strict';

function createButtonInteractionContext({
    MessageFlags,
    refreshGuildMembers,
    markMemberActivity,
    saveSystem,
    determineShift,
    ensureUserData,
    isCooldown,
    getNow,
    onAction = () => {}
}) {
    if (typeof refreshGuildMembers !== 'function') throw new TypeError('refreshGuildMembers must be a function');
    if (typeof markMemberActivity !== 'function') throw new TypeError('markMemberActivity must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof determineShift !== 'function') throw new TypeError('determineShift must be a function');
    if (typeof ensureUserData !== 'function') throw new TypeError('ensureUserData must be a function');
    if (typeof isCooldown !== 'function') throw new TypeError('isCooldown must be a function');
    if (typeof getNow !== 'function') throw new TypeError('getNow must be a function');
    if (typeof onAction !== 'function') throw new TypeError('onAction must be a function');

    async function reply(interaction, content, autoDel, delay) {
        return interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel(delay));
    }

    async function prepare(interaction, { autoDel = () => {} } = {}) {
        await refreshGuildMembers(interaction.guild, { force: true, minIntervalMs: 0 });
        const member = await interaction.guild.members
            .fetch({ user: interaction.user.id, force: true })
            .catch(() => interaction.member);

        if (markMemberActivity(member, 'button')) await saveSystem();

        const shift = determineShift(member);
        if (!shift) {
            return {
                handled: true,
                response: reply(interaction, 'No role.', autoDel)
            };
        }

        const user = ensureUserData(member, shift);
        if (isCooldown(user)) {
            return {
                handled: true,
                response: reply(interaction, 'Cooldown (3s).', autoDel, 2000)
            };
        }

        const now = getNow();
        const type = interaction.customId;
        user.manualPanelTouchedAt = now.toISOString();
        user.shift = shift;
        onAction(type, member, user, shift, now);

        return {
            handled: false,
            member,
            shift,
            user,
            now,
            type
        };
    }

    return {
        prepare
    };
}

module.exports = {
    createButtonInteractionContext
};
