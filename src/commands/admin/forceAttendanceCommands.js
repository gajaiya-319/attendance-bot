'use strict';

function createForceAttendanceCommands({
    MessageFlags,
    canRun,
    determineShift,
    ensureUserData,
    getShiftBounds,
    handleClockIn,
    handleClockOut,
    applyDayOffState,
    applyOvertimeState,
    removeOvertimeUser,
    updateWorkingRole,
    recordLog,
    writeAdminActionLog,
    saveSystem,
    renderDashboard
}) {
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');
    if (typeof determineShift !== 'function') throw new TypeError('determineShift must be a function');
    if (typeof ensureUserData !== 'function') throw new TypeError('ensureUserData must be a function');
    if (typeof getShiftBounds !== 'function') throw new TypeError('getShiftBounds must be a function');
    if (typeof handleClockIn !== 'function') throw new TypeError('handleClockIn must be a function');
    if (typeof handleClockOut !== 'function') throw new TypeError('handleClockOut must be a function');
    if (typeof applyDayOffState !== 'function') throw new TypeError('applyDayOffState must be a function');
    if (typeof applyOvertimeState !== 'function') throw new TypeError('applyOvertimeState must be a function');
    if (typeof removeOvertimeUser !== 'function') throw new TypeError('removeOvertimeUser must be a function');
    if (typeof updateWorkingRole !== 'function') throw new TypeError('updateWorkingRole must be a function');
    if (typeof recordLog !== 'function') throw new TypeError('recordLog must be a function');
    if (typeof writeAdminActionLog !== 'function') throw new TypeError('writeAdminActionLog must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');

    async function acknowledge(interaction) {
        if (!interaction.deferred && !interaction.replied && typeof interaction.deferReply === 'function') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    }

    function reply(interaction, content, autoDel, delay) {
        const response = (interaction.deferred || interaction.replied) && typeof interaction.editReply === 'function'
            ? interaction.editReply({ content })
            : interaction.reply({
                content,
                flags: MessageFlags.Ephemeral
            });
        return response.then(() => autoDel(delay));
    }

    function noPerms(interaction, autoDel) {
        return reply(interaction, 'No perms.', autoDel);
    }

    function noRole(interaction, autoDel) {
        return reply(interaction, 'No role.', autoDel);
    }

    function notCheckedIn(interaction, autoDel) {
        return reply(interaction, 'Target is not checked in.', autoDel);
    }

    function requireTarget({ getTargetMember, replyMemberNotFound }) {
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');
        const target = getTargetMember();
        return target || replyMemberNotFound();
    }

    async function persistForceChange(interaction) {
        await acknowledge(interaction);
        await saveSystem();
        await renderDashboard({ forceMemberRefresh: true });
    }

    async function executeForceIn(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const target = requireTarget({ getTargetMember, replyMemberNotFound });
        if (!target?.id) return target;
        const shift = determineShift(target);
        if (!shift) return noRole(interaction, autoDel);
        const user = ensureUserData(target, shift);
        await handleClockIn(target, user, shift, now);
        await writeAdminActionLog('FORCE_IN', interaction.member, target, [`shift=${shift}`]);
        await persistForceChange(interaction);
        return reply(interaction, '✅ Forced In.', autoDel);
    }

    async function executeForceOut(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const target = requireTarget({ getTargetMember, replyMemberNotFound });
        if (!target?.id) return target;
        const user = ensureUserData(target, determineShift(target));
        if (!user.checkedIn && !user.disconnected) return notCheckedIn(interaction, autoDel);
        await handleClockOut(target, user, now, '관리자 강제 퇴근', null, { skipEarlyPenalty: true });
        await writeAdminActionLog('FORCE_OUT', interaction.member, target, ['skipEarlyPenalty=true']);
        await persistForceChange(interaction);
        return reply(interaction, '✅ Forced Out.', autoDel);
    }

    async function executeForceEarlyOut(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const target = requireTarget({ getTargetMember, replyMemberNotFound });
        if (!target?.id) return target;
        const user = ensureUserData(target, determineShift(target));
        if (!user.checkedIn && !user.disconnected) return notCheckedIn(interaction, autoDel);
        await handleClockOut(target, user, now, '관리자 조기퇴근 처리');
        await writeAdminActionLog('FORCE_EARLY_OUT', interaction.member, target);
        await persistForceChange(interaction);
        return reply(interaction, '✅ Forced Early Out.', autoDel);
    }

    async function executeForceOff(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const target = requireTarget({ getTargetMember, replyMemberNotFound });
        if (!target?.id) return target;
        const shift = determineShift(target);
        const user = ensureUserData(target, shift);
        if (shift) user.dayOffExpireAt = getShiftBounds(shift, now).end.toISOString();
        applyDayOffState(user, now, 'force-off-command', 'admin-forced-day-off');
        user.offCount = (user.offCount || 0) + 1;
        removeOvertimeUser(target.id);
        await updateWorkingRole(target, false);
        await recordLog(user, 'off', '관리자 강제 휴무');
        await writeAdminActionLog('FORCE_OFF', interaction.member, target, [shift ? `shift=${shift}` : 'shift=unknown']);
        await persistForceChange(interaction);
        return reply(interaction, '✅ Forced Off.', autoDel);
    }

    async function executeForceOvertime(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound,
        now
    } = {}) {
        if (!canRun(interaction.member)) return noPerms(interaction, autoDel);
        const target = requireTarget({ getTargetMember, replyMemberNotFound });
        if (!target?.id) return target;
        const shift = determineShift(target);
        if (!shift) return noRole(interaction, autoDel);
        const user = ensureUserData(target, shift);
        if (!user.checkedIn) await handleClockIn(target, user, shift, now);
        const result = applyOvertimeState(user, now, 'FORCED', 'force-ot-command', 'admin-forced-overtime', {
            voiceStatus: target.voice?.streaming ? 'LIVE_ON' : (target.voice?.channelId ? 'LIVE_OFF' : 'OFFLINE'),
            sessionSource: 'forced-ot'
        });
        await updateWorkingRole(target, true);
        await recordLog(user, 'ot', result.added ? '관리자 강제 연장' : '관리자 강제 연장 상태 재확인');
        await writeAdminActionLog('FORCE_OT', interaction.member, target, [`shift=${shift}`, `checkedIn=${Boolean(user.checkedIn)}`]);
        await persistForceChange(interaction);
        return reply(interaction, '✅ Forced OT.', autoDel);
    }

    return {
        forceIn: {
            aliases: ['force-in', '강제출근'],
            execute: executeForceIn
        },
        forceOut: {
            aliases: ['force-out', '강제퇴근'],
            execute: executeForceOut
        },
        forceEarlyOut: {
            aliases: ['force-early-out', '강제조기퇴근'],
            execute: executeForceEarlyOut
        },
        forceOff: {
            aliases: ['force-off', '강제휴무'],
            execute: executeForceOff
        },
        forceOvertime: {
            aliases: ['force-ot', '강제연장'],
            execute: executeForceOvertime
        }
    };
}

module.exports = {
    createForceAttendanceCommands
};
