'use strict';

function createUserAdminCommands({
    MessageFlags,
    canAdmin,
    canManageRoles,
    isOwner,
    ownerOnlyReply,
    failText,
    pendingText,
    okText,
    determineShift,
    ensureUserData,
    applyManualAdjustment,
    normalizeManualAdjustmentState,
    createBackupSnapshot,
    deleteUserData,
    removeOvertimeUser,
    resetAllState,
    updateWorkingRole,
    applyFinishedState,
    syncWorkingRoles,
    writeAdminActionLog,
    saveSystem,
    renderDashboard,
    roleIds
}) {
    if (typeof canAdmin !== 'function') throw new TypeError('canAdmin must be a function');
    if (typeof canManageRoles !== 'function') throw new TypeError('canManageRoles must be a function');
    if (typeof isOwner !== 'function') throw new TypeError('isOwner must be a function');
    if (typeof ownerOnlyReply !== 'function') throw new TypeError('ownerOnlyReply must be a function');
    if (typeof determineShift !== 'function') throw new TypeError('determineShift must be a function');
    if (typeof ensureUserData !== 'function') throw new TypeError('ensureUserData must be a function');
    if (typeof applyManualAdjustment !== 'function') throw new TypeError('applyManualAdjustment must be a function');
    if (typeof normalizeManualAdjustmentState !== 'function') throw new TypeError('normalizeManualAdjustmentState must be a function');
    if (typeof createBackupSnapshot !== 'function') throw new TypeError('createBackupSnapshot must be a function');
    if (typeof deleteUserData !== 'function') throw new TypeError('deleteUserData must be a function');
    if (typeof removeOvertimeUser !== 'function') throw new TypeError('removeOvertimeUser must be a function');
    if (typeof resetAllState !== 'function') throw new TypeError('resetAllState must be a function');
    if (typeof updateWorkingRole !== 'function') throw new TypeError('updateWorkingRole must be a function');
    if (typeof applyFinishedState !== 'function') throw new TypeError('applyFinishedState must be a function');
    if (typeof syncWorkingRoles !== 'function') throw new TypeError('syncWorkingRoles must be a function');
    if (typeof writeAdminActionLog !== 'function') throw new TypeError('writeAdminActionLog must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');
    if (!Array.isArray(roleIds)) throw new TypeError('roleIds must be an array');

    function reply(interaction, content, autoDel) {
        return interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    function noPerms(interaction, autoDel, formatter = text => text) {
        return reply(interaction, formatter('No perms.'), autoDel);
    }

    function requireTarget({ getTargetMember, replyMemberNotFound }) {
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');
        const target = getTargetMember();
        if (!target) return { missing: true, response: replyMemberNotFound() };
        return { target };
    }

    async function executeManualAdjust(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canAdmin(interaction.member)) return noPerms(interaction, autoDel);
        if (!isOwner(interaction.user.id)) return ownerOnlyReply(interaction);
        const lookup = requireTarget({ getTargetMember, replyMemberNotFound });
        if (lookup.missing) return lookup.response;
        const target = lookup.target;
        const field = interaction.options.getString('field') || interaction.options.getString('항목');
        const value = interaction.options.getString('value') || interaction.options.getString('값');
        const user = ensureUserData(target, determineShift(target));
        if (!applyManualAdjustment(user, field, value)) {
            return reply(interaction, 'Invalid field/value.', autoDel);
        }
        normalizeManualAdjustmentState(user, field, value, now);
        await writeAdminActionLog('MANUAL_ADJUST', interaction.member, target, [`field=${field}`, `value=${value}`]);
        await saveSystem();
        await renderDashboard();
        return reply(interaction, `Updated ${user.name}: ${field} = ${value}`, autoDel);
    }

    async function executeFire(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound
    } = {}) {
        if (!canAdmin(interaction.member)) return noPerms(interaction, autoDel);
        if (!isOwner(interaction.user.id)) return ownerOnlyReply(interaction);
        const lookup = requireTarget({ getTargetMember, replyMemberNotFound });
        if (lookup.missing) return lookup.response;
        const target = lookup.target;
        await createBackupSnapshot('before-fire');
        deleteUserData(target.id);
        removeOvertimeUser(target.id);
        await updateWorkingRole(target, false);
        await target.kick('Attendance bot fire command').catch(e => console.error('[KICK ERROR]', e));
        await writeAdminActionLog('FIRE_KICK', interaction.member, target, ['backup=before-fire']);
        await saveSystem();
        await renderDashboard();
        return reply(interaction, 'Fired/Kicked.', autoDel);
    }

    async function executeClearRoles(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canManageRoles(interaction.member)) return noPerms(interaction, autoDel);
        const lookup = requireTarget({ getTargetMember, replyMemberNotFound });
        if (lookup.missing) return lookup.response;
        const target = lookup.target;
        for (const roleId of roleIds) {
            if (target.roles.cache.has(roleId)) {
                await target.roles.remove(roleId).catch(e => console.error('[ROLE CLEAR ERROR]', e));
            }
        }
        const user = ensureUserData(target);
        user.shift = null;
        applyFinishedState(user, now, 'clear-roles-command', 'roles-cleared');
        await writeAdminActionLog('CLEAR_ROLES', interaction.member, target, [`roles=${roleIds.join(',')}`]);
        await saveSystem();
        await renderDashboard();
        return reply(interaction, 'Roles cleared.', autoDel);
    }

    async function executeResetUser(interaction, {
        autoDel = () => {},
        getTargetMember,
        now: unusedNow
    } = {}) {
        if (!canAdmin(interaction.member)) return noPerms(interaction, autoDel, failText);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;
        await interaction.editReply({ content: pendingText('개인 리셋 처리 중입니다. 백업을 만들고 데이터를 정리하고 있습니다.') }).catch(() => null);
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        const target = getTargetMember();
        if (!target) return interaction.editReply({ content: failText('Member not found.') }).then(() => autoDel());
        await createBackupSnapshot('before-user-reset');
        deleteUserData(target.id);
        removeOvertimeUser(target.id);
        ensureUserData(target);
        await updateWorkingRole(target, false);
        await writeAdminActionLog('RESET_USER', interaction.member, target, ['backup=before-user-reset']);
        await saveSystem();
        await renderDashboard({ forceMemberRefresh: true });
        return interaction.editReply({ content: okText(`개인 리셋 완료: ${target.displayName}`) }).then(() => autoDel());
    }

    async function executeResetAll(interaction, {
        autoDel = () => {}
    } = {}) {
        if (!canAdmin(interaction.member)) return noPerms(interaction, autoDel, failText);
        if (!isOwner(interaction.user.id)) return ownerOnlyReply(interaction);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;
        await interaction.editReply({ content: pendingText('전체 리셋 처리 중입니다. 백업을 만들고 전체 출석 데이터를 정리하고 있습니다.') }).catch(() => null);
        await createBackupSnapshot('before-full-reset');
        resetAllState();
        await syncWorkingRoles();
        await writeAdminActionLog('RESET_ALL', interaction.member, null, ['backup=before-full-reset']);
        await saveSystem();
        await renderDashboard({ forceMemberRefresh: true });
        return interaction.editReply({ content: okText('전체 리셋 완료. 출석 데이터와 OT 상태를 초기화했습니다.') }).then(() => autoDel());
    }

    return {
        manualAdjust: {
            aliases: ['manual-adjust', '수동수정'],
            execute: executeManualAdjust
        },
        fire: {
            aliases: ['fire', '해고'],
            execute: executeFire
        },
        clearRoles: {
            aliases: ['clear-roles', '역할삭제'],
            execute: executeClearRoles
        },
        resetUser: {
            aliases: ['reset-user', '리셋', '개인리셋'],
            execute: executeResetUser
        },
        resetAll: {
            aliases: ['reset-all', '전체리셋'],
            execute: executeResetAll
        }
    };
}

module.exports = {
    createUserAdminCommands
};
