'use strict';

const deps = require('./appDependencies');

function createInteractionHandlers(ctx) {
    const {
        workflowApi,
        botState,
        saveSystemAsync,
        slash,
        services,
        determineShift,
        ensureUserData,
        updateWorkingRole,
        markMemberActivity,
        isCooldown,
        refreshGuildMembers,
        handleInteractionReplyError,
        withCommandStatusPayload,
        formatKoreanDateTime,
        JOKES,
        CONFIG,
        moment,
        MessageFlags,
        PermissionFlagsBits,
        failText
    } = ctx;

    const {
        createAutoDelete,
        patchCommandReplies,
        createCommandOptionHelpers,
        createChatInputCommandContext,
        createChatInputCommandHandler,
        createButtonInteractionContext,
        createButtonActionHandlers,
        createButtonInteractionHandler,
        createInteractionErrorHandler,
        createVoiceStateUpdateHandler,
        createGuildMemberEventHandlers
    } = deps;

    const { canManageLiveException, dayOffRequestInteractions, syncCurrentWorkerProfile } = services;

    const buttonInteractionContext = createButtonInteractionContext({
        MessageFlags,
        refreshGuildMembers,
        markMemberActivity,
        saveSystem: () => saveSystemAsync(),
        determineShift,
        ensureUserData,
        isCooldown,
        getNow: () => moment().tz(CONFIG.TIMEZONE),
        onAction: (type, member) => console.log('[BUTTON ACTION]', type, member.id, member.displayName)
    });

    const buttonActionHandlers = createButtonActionHandlers({
        MessageFlags,
        getShiftBounds: ctx.getShiftBounds,
        handleClockOut: (...args) => workflowApi.handleClockOut(...args),
        handleClockIn: (...args) => workflowApi.handleClockIn(...args),
        appendAttendanceEvent: (...args) => workflowApi.appendAttendanceEvent(...args),
        applyLiveExceptionState: (...args) => workflowApi.applyLiveExceptionState(...args),
        applyDayOffState: (...args) => workflowApi.applyDayOffState(...args),
        applyLiveOnState: (...args) => workflowApi.applyLiveOnState(...args),
        applyManualResumeRequiredState: (...args) => workflowApi.applyManualResumeRequiredState(...args),
        applyPendingOvertimeReservationState: (...args) => workflowApi.applyPendingOvertimeReservationState(...args),
        applyOvertimeState: (...args) => workflowApi.applyOvertimeState(...args),
        canStartOvertimeNow: (...args) => workflowApi.canStartOvertimeNow(...args),
        canStartPreShiftOvertime: (...args) => workflowApi.canStartPreShiftOvertime(...args),
        getActiveLiveException: (...args) => workflowApi.getActiveLiveException(...args),
        getOvertimeStartMoment: (...args) => workflowApi.getOvertimeStartMoment(...args),
        getVoiceSnapshot: (interaction, member) => {
            const voiceState = interaction.guild.voiceStates.cache.get(member.id);
            const isVoiceConnected = Boolean(member.voice?.channelId || voiceState?.channelId);
            return {
                isVoiceConnected,
                isStreamingNow: Boolean(isVoiceConnected && (member.voice?.streaming || voiceState?.streaming))
            };
        },
        isOvertimeUser: id => botState.overtimeUsers.some(o => o.id === id),
        markLiveOffState: (...args) => workflowApi.markLiveOffState(...args),
        markWorkedOnDayOff: (...args) => workflowApi.markWorkedOnDayOff(...args),
        notifyDayOffPresence: (...args) => workflowApi.notifyDayOffPresence(...args),
        removeOvertimeUser: id => {
            botState.overtimeUsers = botState.overtimeUsers.filter(o => o.id !== id);
        },
        resetFinishedForPreClockIn: (...args) => workflowApi.resetFinishedForPreClockIn(...args),
        renderDashboard: options => workflowApi.queueDashboardRender(options),
        saveSystem: () => saveSystemAsync(),
        setLiveException: (id, exception) => {
            botState.liveExceptions[id] = exception;
        },
        startPreShiftOvertime: (...args) => workflowApi.startPreShiftOvertime(...args),
        updateWorkingRole,
        recordLog: (...args) => workflowApi.recordLog(...args),
        getCompletionMessage: type => (JOKES[type?.toUpperCase()] || ['Completed.'])[0]
    });

    const buttonInteractionHandler = createButtonInteractionHandler({
        createAutoDelete,
        buttonInteractionContext,
        buttonActionHandlers
    });

    const interactionErrorHandler = createInteractionErrorHandler({
        MessageFlags,
        failText
    });

    const chatInputCommandContext = createChatInputCommandContext({
        MessageFlags,
        createAutoDelete,
        patchCommandReplies,
        createCommandOptionHelpers,
        withCommandStatusPayload,
        handleInteractionReplyError,
        markMemberActivity,
        saveSystem: () => saveSystemAsync(),
        getNow: () => moment().tz(CONFIG.TIMEZONE),
        canAdmin: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator))
    });

    const chatInputCommandHandler = createChatInputCommandHandler({
        MessageFlags,
        CONFIG,
        chatInputCommandContext,
        canManageLiveException,
        grantLiveException: (...args) => workflowApi.grantLiveException(...args),
        renderDashboard: options => workflowApi.queueDashboardRender(options),
        formatKoreanDateTime,
        ensureUserData,
        clearDayOffReservationState: (...args) => workflowApi.clearDayOffReservationState(...args),
        saveSystem: () => saveSystemAsync(),
        sendOpsReport: (...args) => workflowApi.sendOpsReport(...args),
        refreshGuildMembers,
        buildRankingEmbed: (...args) => workflowApi.buildRankingEmbed(...args),
        reconcileAttendanceMembership: (...args) => workflowApi.reconcileAttendanceMembership(...args),
        syncVoiceStates: (...args) => workflowApi.syncVoiceStates(...args),
        checkDayOffReservations: (...args) => workflowApi.checkDayOffReservations(...args),
        autoOvertimeCheck: (...args) => workflowApi.autoOvertimeCheck(...args),
        syncAutoPanels: (...args) => workflowApi.syncAutoPanels(...args),
        syncWorkingRoles: (...args) => workflowApi.syncWorkingRoles(...args),
        buildInactiveCandidatesEmbed: (...args) => workflowApi.buildInactiveCandidatesEmbed(...args),
        syncUserRecordedStatus: (...args) => workflowApi.syncUserRecordedStatus(...args),
        auditCommands: slash.auditCommands,
        opsCheckCommand: slash.opsCheckCommand,
        opsQueueCommands: slash.opsQueueCommands,
        opsSafetyCommands: slash.opsSafetyCommands,
        payrollAuditCommand: slash.payrollAuditCommand,
        maintenanceCommands: slash.maintenanceCommands,
        dayOffReadCommands: slash.dayOffReadCommands,
        dayOffMutationCommands: slash.dayOffMutationCommands,
        dayOffRequestInteractions,
        forceAttendanceCommands: slash.forceAttendanceCommands,
        diagnosticsCommand: slash.diagnosticsCommand,
        backupCommands: slash.backupCommands,
        announcementCommands: slash.announcementCommands,
        userAdminCommands: slash.userAdminCommands,
        payrollArchiveCommand: slash.payrollArchiveCommand,
        myInfoCommand: slash.myInfoCommand
    });

    const voiceStateUpdateHandler = createVoiceStateUpdateHandler({
        markMemberActivity,
        determineShift,
        ensureUserData,
        getNow: () => moment().tz(CONFIG.TIMEZONE),
        applyVoiceSnapshot: (...args) => workflowApi.applyVoiceSnapshot(...args),
        saveSystem: () => saveSystemAsync(),
        renderDashboard: () => workflowApi.queueDashboardRender()
    });

    const guildMemberEventHandlers = createGuildMemberEventHandlers({
        CONFIG,
        getAttendanceData: () => botState.attendanceData,
        getLiveExceptions: () => botState.liveExceptions,
        removeOvertimeUser: id => {
            botState.overtimeUsers = botState.overtimeUsers.filter(o => o.id !== id);
        },
        syncManualGuestNickname: (...args) => workflowApi.syncManualGuestNickname(...args),
        syncNicknameFromAssignedRoles: (...args) => workflowApi.syncNicknameFromAssignedRoles(...args),
        syncRolesFromStructuredNickname: (...args) => workflowApi.syncRolesFromStructuredNickname(...args),
        ensureUserData,
        applyFinishedState: (...args) => workflowApi.applyFinishedState(...args),
        clearMemberState: () => {},
        getNow: () => moment().tz(CONFIG.TIMEZONE),
        writeDayOffLog: (...args) => workflowApi.writeDayOffLog(...args),
        saveSystem: () => saveSystemAsync(),
        syncCurrentWorkerProfile,
        renderDashboard: options => workflowApi.queueDashboardRender(options)
    });

    return {
        buttonInteractionContext,
        buttonActionHandlers,
        buttonInteractionHandler,
        interactionErrorHandler,
        chatInputCommandContext,
        chatInputCommandHandler,
        voiceStateUpdateHandler,
        guildMemberEventHandlers
    };
}

module.exports = { createInteractionHandlers };
