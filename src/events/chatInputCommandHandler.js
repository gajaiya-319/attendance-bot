'use strict';

function createChatInputCommandHandler({
    MessageFlags,
    CONFIG,
    chatInputCommandContext,
    canManageLiveException,
    grantLiveException,
    renderDashboard,
    formatKoreanDateTime,
    ensureUserData,
    clearDayOffReservationState,
    saveSystem,
    sendOpsReport,
    refreshGuildMembers,
    buildRankingEmbed,
    reconcileAttendanceMembership,
    syncVoiceStates,
    checkDayOffReservations,
    autoOvertimeCheck,
    syncAutoPanels,
    syncWorkingRoles,
    buildInactiveCandidatesEmbed,
    syncUserRecordedStatus,
    auditCommands,
    opsCheckCommand,
    opsQueueCommands,
    opsSafetyCommands,
    payrollAuditCommand,
    maintenanceCommands,
    dayOffReadCommands,
    dayOffMutationCommands,
    dayOffRequestInteractions,
    forceAttendanceCommands,
    diagnosticsCommand,
    backupCommands,
    announcementCommands,
    userAdminCommands,
    payrollArchiveCommand,
    myInfoCommand,
    logger = console
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (typeof chatInputCommandContext !== 'function') throw new TypeError('chatInputCommandContext must be a function');

    return async function handleChatInputInteraction(interaction) {
        const commandContext = await chatInputCommandContext(interaction);
        if (commandContext.handled) return commandContext.response;
        const {
            autoDel,
            isAdmin,
            now,
            n,
            getTargetMember,
            getSlot,
            getAnnounceTime,
            getAnnounceContent,
            getAnnounceRole,
            getAnnounceRoles,
            replyMemberNotFound
        } = commandContext;

        if (n('live-exception') || n('라이브예외')) {
            if (!canManageLiveException(interaction.member)) {
                return interaction.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            const target = getTargetMember();
            const hours = interaction.options.getInteger('hours') || interaction.options.getInteger('시간');
            const reason = interaction.options.getString('reason') || interaction.options.getString('사유');
            if (!target) return interaction.editReply({ content: 'Member not found.' }).then(() => autoDel());
            if (hours && (hours < 1 || hours > 12)) {
                return interaction.editReply({ content: '시간은 1~12시간 사이로 입력해주세요.' }).then(() => autoDel());
            }
            const result = await grantLiveException(target, hours, reason, interaction.member);
            if (!result.ok) return interaction.editReply({ content: result.message }).then(() => autoDel());
            await renderDashboard({ forceMemberRefresh: true });
            return interaction.editReply({
                content: `✅ 라이브 예외가 승인되었습니다. 대상: ${target.displayName}, 만료: ${formatKoreanDateTime(result.expiresAt)}`
            }).then(() => autoDel());
        }

        if (n('assign-roles') || n('역할')) {
            if (!isAdmin) return interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            const target = getTargetMember();
            if (!target) return replyMemberNotFound();
            const server = interaction.options.getString('server') || interaction.options.getString('서버');
            const shift = interaction.options.getString('shift') || interaction.options.getString('시프트');
            const serverRole = server === 'HEINE' ? CONFIG.ROLES.HEINE : CONFIG.ROLES.PAAGRIO;
            const otherServerRole = server === 'HEINE' ? CONFIG.ROLES.PAAGRIO : CONFIG.ROLES.HEINE;
            const shiftRole = shift === 'DAY' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
            const otherShiftRole = shift === 'DAY' ? CONFIG.ROLES.NIGHT : CONFIG.ROLES.DAY;

            await target.roles.add(serverRole).catch(error => logger.error?.('[ROLE ASSIGN ERROR]', error));
            await target.roles.remove(otherServerRole).catch(() => null);
            await target.roles.add(shiftRole).catch(error => logger.error?.('[SHIFT ASSIGN ERROR]', error));
            await target.roles.remove(otherShiftRole).catch(() => null);

            const user = ensureUserData(target, shift === 'DAY' ? 'day' : 'night');
            clearDayOffReservationState(user, now, 'assign-roles-command', 'role-assignment-cleared-dayoff');
            await saveSystem();
            renderDashboard();
            return interaction.reply({
                content: `Assigned ${server} / ${shift} to ${target.displayName}.`,
                flags: MessageFlags.Ephemeral
            }).then(() => autoDel());
        }

        if (n('report-regular') || n('일반보고')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            await sendOpsReport('Regular');
            return interaction.editReply({ content: 'Sent.' }).then(() => autoDel());
        }
        if (n('report-analysis') || n('정밀보고')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            await sendOpsReport('Analysis');
            return interaction.editReply({ content: 'Sent.' }).then(() => autoDel());
        }
        if (n('combined-ranking') || n('통합랭킹')) {
            const shift = interaction.options.getString('구분') || interaction.options.getString('shift') || 'all';
            await refreshGuildMembers(interaction.guild, { force: false });
            return interaction.reply({ embeds: [buildRankingEmbed({ guild: interaction.guild, shift })] });
        }
        if (n('refresh') || n('현황판갱신')) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            await interaction.editReply({ content: '✅ Refresh started. Updating attendance panels and dashboard...' }).catch(() => null);
            await refreshGuildMembers(interaction.guild, { force: true });
            await reconcileAttendanceMembership(interaction.guild);
            await syncVoiceStates();
            await checkDayOffReservations();
            await autoOvertimeCheck();
            await syncAutoPanels();
            await renderDashboard({ forceMemberRefresh: true });
            return interaction.editReply({ content: '✅ UI Refreshed.' }).then(() => autoDel());
        }
        if (n('sync-working') || n('워킹동기화')) {
            if (!isAdmin) return interaction.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            const result = await syncWorkingRoles();
            return interaction.editReply({ content: `WORKING sync complete. added=${result.added}, removed=${result.removed}` }).then(() => autoDel());
        }
        if (auditCommands.permissionCheck.aliases.some(n)) {
            return auditCommands.permissionCheck.execute(interaction, { autoDel });
        }
        if (auditCommands.dataAudit.aliases.some(n)) {
            return auditCommands.dataAudit.execute(interaction, { autoDel });
        }
        if (n('inactive-candidates') || n('비활동검사')) {
            if (!isAdmin) return interaction.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            const days = interaction.options.getInteger('days') || interaction.options.getInteger('일수') || CONFIG.INACTIVE_CANDIDATE_DAYS;
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            return interaction.editReply({ embeds: [await buildInactiveCandidatesEmbed(interaction.guild, days)] });
        }
        if (opsCheckCommand.aliases.some(n)) {
            return opsCheckCommand.execute(interaction, { autoDel });
        }
        if (opsQueueCommands?.pending?.aliases?.some(n)) {
            return opsQueueCommands.pending.execute(interaction, { autoDel });
        }
        if (opsQueueCommands?.retry?.aliases?.some(n)) {
            return opsQueueCommands.retry.execute(interaction, { autoDel });
        }
        if (opsSafetyCommands?.todayAudit?.aliases?.some(n)) {
            return opsSafetyCommands.todayAudit.execute(interaction, { autoDel });
        }
        if (payrollAuditCommand?.aliases?.some(n)) {
            return payrollAuditCommand.execute(interaction, { autoDel });
        }
        if (maintenanceCommands?.root?.aliases?.some(n)) {
            return maintenanceCommands.root.execute(interaction, { autoDel });
        }
        if (auditCommands.statusAudit.aliases.some(n)) {
            return auditCommands.statusAudit.execute(interaction, { autoDel });
        }
        if (auditCommands.statusTrace.aliases.some(n)) {
            return auditCommands.statusTrace.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound });
        }
        if (n('status-sync') || n('상태동기화')) {
            if (!isAdmin) return interaction.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
            if (!interaction.deferred && !interaction.replied) return;
            const target = getTargetMember();
            if (!target) return interaction.editReply({ content: '대상을 찾을 수 없습니다.' }).then(() => autoDel());
            const result = await syncUserRecordedStatus(target, interaction.member);
            if (!result.ok) {
                return interaction.editReply({ content: '백업 생성 실패로 상태 동기화를 중단했습니다. 데이터는 변경하지 않았습니다.' }).then(() => autoDel());
            }
            return interaction.editReply({
                content: [
                    result.changed ? '✅ 상태 동기화 완료.' : '✅ 이미 동기화되어 있습니다.',
                    `대상: ${result.user.name || target.displayName}`,
                    `Attendance: ${result.before.attendanceStatus} -> ${result.next.attendanceStatus}`,
                    `Voice: ${result.before.voiceStatus} -> ${result.next.voiceStatus}`,
                    `Backup: ${result.backupPath}`
                ].join('\n')
            }).then(() => autoDel());
        }
        if (auditCommands.timeAudit.aliases.some(n)) {
            return auditCommands.timeAudit.execute(interaction, { autoDel });
        }
        if (dayOffReadCommands.log.aliases.some(n)) {
            return dayOffReadCommands.log.execute(interaction, { autoDel });
        }
        if (dayOffReadCommands.list.aliases.some(n)) {
            return dayOffReadCommands.list.execute(interaction, { autoDel });
        }
        if (dayOffMutationCommands.approve.aliases.some(n)) {
            return dayOffMutationCommands.approve.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound });
        }
        if (dayOffMutationCommands.cancel.aliases.some(n)) {
            return dayOffMutationCommands.cancel.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound });
        }
        if (dayOffMutationCommands.forceCancel.aliases.some(n)) {
            return dayOffMutationCommands.forceCancel.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound });
        }
        if (dayOffMutationCommands.reject.aliases.some(n)) {
            return dayOffMutationCommands.reject.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound });
        }
        if (dayOffRequestInteractions?.aliases?.some(n)) {
            return dayOffRequestInteractions.executePanelCommand(interaction, { autoDel });
        }
        if (forceAttendanceCommands.forceIn.aliases.some(n)) {
            return forceAttendanceCommands.forceIn.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (forceAttendanceCommands.forceOut.aliases.some(n)) {
            return forceAttendanceCommands.forceOut.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (forceAttendanceCommands.forceEarlyOut.aliases.some(n)) {
            return forceAttendanceCommands.forceEarlyOut.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (forceAttendanceCommands.forceOff.aliases.some(n)) {
            return forceAttendanceCommands.forceOff.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (forceAttendanceCommands.forceOvertime.aliases.some(n)) {
            return forceAttendanceCommands.forceOvertime.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (diagnosticsCommand.aliases.some(n)) {
            return diagnosticsCommand.execute(interaction, { autoDel });
        }
        if (backupCommands.create.aliases.some(n)) {
            return backupCommands.create.execute(interaction, { autoDel });
        }
        if (backupCommands.list.aliases.some(n)) {
            return backupCommands.list.execute(interaction, { autoDel });
        }
        if (backupCommands.restore.aliases.some(n)) {
            return backupCommands.restore.execute(interaction, { autoDel });
        }
        if (announcementCommands.set.aliases.some(n)) {
            return announcementCommands.set.execute(interaction, {
                autoDel,
                getSlot,
                getAnnounceTime,
                getAnnounceContent,
                getAnnounceRole,
                getAnnounceRoles
            });
        }
        if (announcementCommands.cancel.aliases.some(n)) {
            return announcementCommands.cancel.execute(interaction, { autoDel, getSlot });
        }
        if (announcementCommands.list.aliases.some(n)) {
            return announcementCommands.list.execute(interaction, { autoDel });
        }
        if (userAdminCommands.manualAdjust.aliases.some(n)) {
            return userAdminCommands.manualAdjust.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (userAdminCommands.fire.aliases.some(n)) {
            return userAdminCommands.fire.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound });
        }
        if (userAdminCommands.clearRoles.aliases.some(n)) {
            return userAdminCommands.clearRoles.execute(interaction, { autoDel, getTargetMember, replyMemberNotFound, now });
        }
        if (userAdminCommands.resetUser.aliases.some(n)) {
            return userAdminCommands.resetUser.execute(interaction, { autoDel, getTargetMember, now });
        }
        if (userAdminCommands.resetAll.aliases.some(n)) {
            return userAdminCommands.resetAll.execute(interaction, { autoDel });
        }
        if (payrollArchiveCommand?.aliases?.some(n)) {
            return payrollArchiveCommand.execute(interaction, { autoDel });
        }
        if (myInfoCommand.aliases.some(n)) {
            return myInfoCommand.execute(interaction);
        }

        return false;
    };
}

module.exports = {
    createChatInputCommandHandler
};
