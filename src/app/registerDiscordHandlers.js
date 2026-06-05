'use strict';

const { initPayrollCronSchedulers } = require('../scheduler/payrollCron');

function registerDiscordHandlers(ctx) {
    let payrollCronStop = () => {};
    const {
        Events,
        PermissionFlagsBits,
        MessageFlags,
        CONFIG,
        moment,
        client,
        cron,
        REST,
        Routes,
        token,
        workflowApi,
        dayOffService,
        DAYOFF_APPROVAL_EMOJI,
        dayOffReactionCleanupLocks,
        markMemberActivity,
        saveSystemAsync,
        purchaseSheetService,
        opsQueueService,
        voiceStateUpdateHandler,
        guildMemberEventHandlers,
        chatInputCommandHandler,
        dayOffRequestInteractions,
        buttonInteractionHandler,
        interactionErrorHandler,
        createDayOffMessageEventHandlers,
        createPurchaseReactionHandler,
        createDeathPenaltyReactionHandler,
        createEndAdenaReactionHandler,
        createInteractionRouter,
        createClientReadyHandler,
        buildCommandDefinitions,
        hiddenCommandAliases,
        validateCommandPayloads,
        formatDiscordRestError,
        writeRuntimeHealthFile,
        refreshGuildMembers,
        cleanupOldDayOffReservations,
        printStartupBanner,
        loadSystem,
        createScheduledBackupIfDue,
        syncCurrentWorkerProfiles,
        payrollLiveSummarySyncService,
        payrollArchiveService,
        payrollOperationLogService,
        botState
    } = ctx;

    if (payrollArchiveService) {
        const payrollCron = initPayrollCronSchedulers({
            cron,
            CONFIG,
            client,
            payrollArchiveService,
            payrollOperationLogService,
            payrollLiveSummarySyncService,
            logger: console
        });
        if (payrollCron && typeof payrollCron.stop === 'function') {
            payrollCronStop = payrollCron.stop;
        }
    }

    const schedulePayrollLiveSync = payrollLiveSummarySyncService
        ? () => payrollLiveSummarySyncService.scheduleSync()
        : null;

    const dayOffMessageEventHandlers = createDayOffMessageEventHandlers({
        MessagePermissionFlags: PermissionFlagsBits,
        reviewerId: CONFIG.DAYOFF_REVIEWER_ID,
        approvalEmoji: DAYOFF_APPROVAL_EMOJI,
        cancelEmoji: '❌',
        dayOffService,
        cleanupLocks: dayOffReactionCleanupLocks,
        markMemberActivity,
        saveSystem: () => saveSystemAsync(),
        processDayOffMessage: (...args) => workflowApi.processDayOffMessage(...args),
        approveDayOffMessage: (...args) => workflowApi.approveDayOffMessage(...args),
        cancelDayOffRequest: (...args) => workflowApi.cancelDayOffRequest(...args),
        cancelDayOffApproval: (...args) => workflowApi.cancelDayOffApproval(...args)
    });

    const purchaseReactionHandler = createPurchaseReactionHandler({
        MessagePermissionFlags: PermissionFlagsBits,
        CONFIG,
        moment,
        purchaseSheetService,
        opsQueueService,
        onGreatTabChanged: schedulePayrollLiveSync
    });

    const deathPenaltyReactionHandler = createDeathPenaltyReactionHandler({
        MessagePermissionFlags: PermissionFlagsBits,
        CONFIG,
        moment,
        purchaseSheetService,
        opsQueueService,
        onGreatTabChanged: schedulePayrollLiveSync
    });

    const endAdenaReactionHandler = createEndAdenaReactionHandler({
        MessagePermissionFlags: PermissionFlagsBits,
        CONFIG,
        moment,
        purchaseSheetService,
        opsQueueService,
        onGreatTabChanged: schedulePayrollLiveSync
    });

    function withTimeout(promise, ms, fallback = null) {
        return Promise.race([
            promise,
            new Promise(resolve => setTimeout(() => resolve(fallback), ms))
        ]);
    }

    async function fetchChannelByIdOrName(id, name) {
        if (id) {
            const channel = await withTimeout(client.channels?.fetch?.(id).catch(() => null), 4000, null);
            if (channel?.messages?.fetch) return channel;
        }
        if (!name) return null;
        const guild = client.guilds?.cache?.get?.(CONFIG.GUILD_ID);
        return guild?.channels?.cache?.find?.(channel => channel.name === name && channel.messages?.fetch) || null;
    }

    async function syncChannelMessages(channel, handler, pendingMessageIds, limit = 25) {
        if (!channel?.messages?.fetch || typeof handler?.syncMessageStatus !== 'function') return 0;
        const messages = await withTimeout(channel.messages.fetch({ limit }).catch(error => {
            console.warn('[PAYROLL STATUS SYNC FETCH WARN]', {
                channelId: channel.id,
                message: error?.message || error
            });
            return null;
        }), 5000, null);
        if (!messages?.values) return 0;
        const results = await Promise.all([...messages.values()].map(message => withTimeout(
                handler.syncMessageStatus(message, { pendingMessageIds }),
                3000,
                false
        )));
        return results.filter(Boolean).length;
    }

    async function syncPayrollReactionStatuses() {
        console.log('[PAYROLL STATUS SYNC START]');
        const pending = typeof opsQueueService?.list === 'function'
            ? await opsQueueService.list().catch(() => [])
            : [];
        const pendingMessageIds = new Set((pending || []).map(item => item.messageId).filter(Boolean));
        let synced = 0;

        const purchaseChannel = await fetchChannelByIdOrName(CONFIG.PURCHASE_CHANNEL_ID, CONFIG.PURCHASE_CHANNEL_NAME);
        synced += await syncChannelMessages(purchaseChannel, purchaseReactionHandler, pendingMessageIds);

        for (const channelId of Object.values(CONFIG.DEATH_PENALTY_CHANNEL_IDS || {})) {
            const channel = await fetchChannelByIdOrName(channelId, null);
            synced += await syncChannelMessages(channel, deathPenaltyReactionHandler, pendingMessageIds);
        }

        for (const channelId of Object.values(CONFIG.END_ADENA_CHANNEL_IDS || {})) {
            const channel = await fetchChannelByIdOrName(channelId, null);
            synced += await syncChannelMessages(channel, endAdenaReactionHandler, pendingMessageIds);
        }

        console.log('[PAYROLL STATUS SYNC]', { synced, pending: pending.length });
        return { synced, pending: pending.length };
    }

    client.on(Events.VoiceStateUpdate, voiceStateUpdateHandler);
    client.on(Events.GuildMemberUpdate, guildMemberEventHandlers.update);
    client.on(Events.GuildMemberRemove, guildMemberEventHandlers.remove);
    client.on(Events.MessageCreate, dayOffMessageEventHandlers.create);
    client.on(Events.MessageCreate, purchaseReactionHandler.messageCreate);
    client.on(Events.MessageCreate, deathPenaltyReactionHandler.messageCreate);
    client.on(Events.MessageCreate, endAdenaReactionHandler.messageCreate);
    client.on(Events.MessageUpdate, dayOffMessageEventHandlers.update);
    client.on(Events.MessageUpdate, endAdenaReactionHandler.messageUpdate);
    client.on(Events.MessageReactionAdd, dayOffMessageEventHandlers.reactionAdd);
    client.on(Events.MessageReactionAdd, purchaseReactionHandler.reactionAdd);
    client.on(Events.MessageReactionAdd, deathPenaltyReactionHandler.reactionAdd);
    client.on(Events.MessageReactionAdd, endAdenaReactionHandler.reactionAdd);
    client.on(Events.MessageReactionRemove, dayOffMessageEventHandlers.reactionRemove);

    const interactionRouter = createInteractionRouter({
        handleChatInputCommand: chatInputCommandHandler,
        handleButton: async interaction => {
            const handled = await dayOffRequestInteractions.handleButton(interaction);
            if (handled !== false) return handled;
            return buttonInteractionHandler(interaction);
        },
        handleModalSubmit: interaction => dayOffRequestInteractions.handleModalSubmit(interaction),
        handleError: interactionErrorHandler
    });

    client.on(Events.InteractionCreate, interactionRouter);

    const clientReadyHandler = createClientReadyHandler({
        CONFIG,
        REST,
        Routes,
        client,
        cron,
        token,
        buildCommandDefinitions,
        hiddenCommandAliases,
        validateCommandPayloads,
        formatDiscordRestError,
        writeRuntimeHealthFile,
        refreshGuildMembers,
        syncVoiceStates: (...args) => workflowApi.syncVoiceStates(...args),
        reconcileAttendanceMembership: (...args) => workflowApi.reconcileAttendanceMembership(...args),
        checkGracePeriods: (...args) => workflowApi.checkGracePeriods(...args),
        autoOvertimeCheck: (...args) => workflowApi.autoOvertimeCheck(...args),
        checkLiveExceptions: (...args) => workflowApi.checkLiveExceptions(...args),
        checkScheduledAnnouncements: (...args) => workflowApi.checkScheduledAnnouncements(...args),
        checkDayOffReservations: (...args) => workflowApi.checkDayOffReservations(...args),
        autoAssignGuestForUnassignedMembers: (...args) => workflowApi.autoAssignGuestForUnassignedMembers(...args),
        syncWorkingRoles: (...args) => workflowApi.syncWorkingRoles(...args),
        syncCurrentWorkerProfiles,
        syncLiveThreeDayPayrollSummary: payrollLiveSummarySyncService
            ? () => payrollLiveSummarySyncService.sync()
            : null,
        syncPayrollReactionStatuses,
        createScheduledBackupIfDue,
        syncAutoPanels: (...args) => workflowApi.syncAutoPanels(...args),
        processOpsQueueAutoRetry: (...args) => workflowApi.processOpsQueueAutoRetry(...args),
        checkOperationalIssues: (...args) => workflowApi.checkOperationalIssues(...args),
        expireDayOffSessions: (...args) => workflowApi.expireDayOffSessions(...args),
        cleanupOldDayOffReservations,
        saveSystem: () => saveSystemAsync(),
        renderDashboard: () => workflowApi.queueDashboardRender(),
        performSmartReset: (...args) => workflowApi.performSmartReset(...args),
        printStartupBanner,
        getNowLabel: () => moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
        setCommandRegisterOk: ({ at, count }) => {
            botState.lastCommandRegisterAt = at;
            botState.lastCommandRegisterCount = count;
            botState.lastCommandRegisterError = null;
        },
        setCommandRegisterError: error => {
            botState.lastCommandRegisterError = error;
        },
        loadSystem
    });

    client.once(Events.ClientReady, clientReadyHandler);

    return {
        dayOffMessageEventHandlers,
        purchaseReactionHandler,
        deathPenaltyReactionHandler,
        endAdenaReactionHandler,
        interactionRouter,
        clientReadyHandler,
        payrollCronStop
    };
}

module.exports = { registerDiscordHandlers };
