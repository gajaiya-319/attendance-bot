'use strict';

function createDayOffMutationCommands({
    MessageFlags,
    canAdmin,
    canManageDayOff,
    parseDayOffCommandDate,
    approveDayOffReservation,
    cancelDayOffReservation,
    cancelOnlyDayOffReservation,
    rejectDayOffReservation,
    renderDashboard
}) {
    if (typeof canAdmin !== 'function') throw new TypeError('canAdmin must be a function');
    if (typeof canManageDayOff !== 'function') throw new TypeError('canManageDayOff must be a function');
    if (typeof parseDayOffCommandDate !== 'function') throw new TypeError('parseDayOffCommandDate must be a function');
    if (typeof approveDayOffReservation !== 'function') throw new TypeError('approveDayOffReservation must be a function');
    if (typeof cancelDayOffReservation !== 'function') throw new TypeError('cancelDayOffReservation must be a function');
    if (typeof cancelOnlyDayOffReservation !== 'function') throw new TypeError('cancelOnlyDayOffReservation must be a function');
    if (typeof rejectDayOffReservation !== 'function') throw new TypeError('rejectDayOffReservation must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');

    function noPerms(interaction, autoDel) {
        return interaction.reply({
            content: 'No perms.',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    function invalidDate(interaction, autoDel) {
        return interaction.reply({
            content: '날짜 형식이 올바르지 않습니다. 예: 2026-05-21 또는 May 21',
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel());
    }

    async function deferIfNeeded(interaction) {
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

    function getLeaveDate(interaction) {
        const dateInput = interaction.options.getString('date') || interaction.options.getString('\ub0a0\uc9dc');
        return parseDayOffCommandDate(dateInput);
    }

    async function executeApprove(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound
    } = {}) {
        if (!canManageDayOff(interaction)) return noPerms(interaction, autoDel);
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');

        const target = getTargetMember();
        if (!target) return replyMemberNotFound();
        const leaveDate = getLeaveDate(interaction);
        if (!leaveDate) return invalidDate(interaction, autoDel);

        await deferIfNeeded(interaction);
        const approved = await approveDayOffReservation(target, leaveDate, interaction.member);
        if (!approved) {
            return reply(interaction, `${target.displayName} / ${leaveDate} 대기 중인 휴무 신청을 찾지 못했습니다.`, autoDel);
        }
        if (approved.error === 'duplicate') {
            return reply(interaction, `이미 동일한 날짜(${leaveDate})에 승인된 휴무가 존재합니다.`, autoDel);
        }
        renderDashboard();
        return reply(interaction, `${approved.name} 님의 ${leaveDate} 휴무를 승인했습니다.`, autoDel);
    }

    async function executeCancel(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound
    } = {}) {
        if (!canAdmin(interaction)) return noPerms(interaction, autoDel);
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');

        const target = getTargetMember();
        if (!target) return replyMemberNotFound();
        const leaveDate = getLeaveDate(interaction);
        if (!leaveDate) return invalidDate(interaction, autoDel);

        await deferIfNeeded(interaction);
        const cancelled = await cancelDayOffReservation(target, leaveDate, interaction.member);
        if (!cancelled) {
            return reply(interaction, `${target.displayName} / ${leaveDate} 휴무 예약을 찾지 못했습니다.`, autoDel);
        }
        renderDashboard();
        return reply(interaction, `${cancelled.name} 님의 ${leaveDate} 휴무를 취소했습니다.`, autoDel);
    }

    async function executeForceCancel(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound
    } = {}) {
        if (!canManageDayOff(interaction)) return noPerms(interaction, autoDel);
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');

        const target = getTargetMember();
        if (!target) return replyMemberNotFound();
        await deferIfNeeded(interaction);
        const cancelled = await cancelOnlyDayOffReservation(target, interaction.member);
        if (cancelled?.error === 'ambiguous') {
            const candidates = cancelled.candidates
                .slice(0, 5)
                .map(r => `${r.leaveDate} / ${r.shiftLabel || '-'}`)
                .join(', ');
            return reply(interaction, `휴무 신청이 ${cancelled.count}개입니다. 날짜가 있는 /휴무취소를 사용해주세요. 후보: ${candidates}`, autoDel, 7000);
        }
        if (!cancelled || cancelled.error === 'not-found') {
            return reply(interaction, `${target.displayName} 님의 취소 가능한 휴무 신청을 찾지 못했습니다.`, autoDel);
        }
        renderDashboard();
        return reply(interaction, `${cancelled.name} 님의 ${cancelled.leaveDate} 휴무를 강제 취소했습니다.`, autoDel);
    }

    async function executeReject(interaction, {
        autoDel = () => {},
        getTargetMember,
        replyMemberNotFound
    } = {}) {
        if (!canManageDayOff(interaction)) return noPerms(interaction, autoDel);
        if (typeof getTargetMember !== 'function') throw new TypeError('getTargetMember must be a function');
        if (typeof replyMemberNotFound !== 'function') throw new TypeError('replyMemberNotFound must be a function');

        const target = getTargetMember();
        if (!target) return replyMemberNotFound();
        const leaveDate = getLeaveDate(interaction);
        const reason = interaction.options.getString('reason') || interaction.options.getString('\uc0ac\uc720') || 'Rejected by Graet';
        if (!leaveDate) return invalidDate(interaction, autoDel);

        await deferIfNeeded(interaction);
        const rejected = await rejectDayOffReservation(target, leaveDate, interaction.member, reason);
        if (!rejected) {
            return reply(interaction, `${target.displayName} / ${leaveDate} 휴무 신청을 찾지 못했습니다.`, autoDel);
        }
        renderDashboard();
        return reply(interaction, `${rejected.name} 님의 ${leaveDate} 휴무 신청을 반려했습니다.`, autoDel);
    }

    return {
        approve: {
            aliases: ['dayoff-approve', '\ud734\ubb34\uc2b9\uc778'],
            execute: executeApprove
        },
        cancel: {
            aliases: ['dayoff-cancel', '\ud734\ubb34\ucde8\uc18c'],
            execute: executeCancel
        },
        forceCancel: {
            aliases: ['dayoff-cancel-force', '\uac15\uc81c\ud734\ubb34\ucde8\uc18c'],
            execute: executeForceCancel
        },
        reject: {
            aliases: ['dayoff-reject', '\ud734\ubb34\ubc18\ub824'],
            execute: executeReject
        }
    };
}

module.exports = {
    createDayOffMutationCommands
};
