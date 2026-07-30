'use strict';

const { initPayrollCronSchedulers } = require('../scheduler/payrollCron');
const { notifyPayrollOwners } = require('../utils/payrollOwnerNotify');

function registerDiscordHandlers(ctx) {
    let payrollCronStop = () => {};
    let rawAttendanceRetryStop = () => {};
    let backgroundQueueMonitorStop = () => {};
    const {
        Events,
        PermissionFlagsBits,
        MessageFlags,
        CONFIG,
        moment,
        getShiftBounds,
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
        endAdenaSubmissionValidationService,
        endAdenaReconciliationService,
        endAdenaFreshnessService,
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
        rawAttendanceSheetService,
        backgroundJobQueueService,
        payrollLiveSummarySyncService,
        payrollIntegrityAuditService,
        payrollArchiveService,
        payrollOperationLogService,
        botState
    } = ctx;

    if (typeof backgroundJobQueueService?.startEventLoopLagMonitor === 'function') {
        backgroundQueueMonitorStop = backgroundJobQueueService.startEventLoopLagMonitor();
    }

    if (typeof rawAttendanceSheetService?.startPendingAttendanceRetryLoop === 'function') {
        rawAttendanceRetryStop = rawAttendanceSheetService.startPendingAttendanceRetryLoop({
            intervalMs: Number(process.env.RAW_ATTENDANCE_RETRY_INTERVAL_MS || 300000),
            runImmediately: false,
            onNeedsReview: async items => {
                const preview = items.slice(0, 10).map(item => {
                    const row = item.row || {};
                    return `- ${row.date || '-'} ${row.server || '-'} ${row.shift || '-'} ${row.name || '-'} (${item.attempts}회, ${item.failureClass || 'unknown'})`;
                }).join('\n');
                const notification = await notifyPayrollOwners({
                    client,
                    CONFIG,
                    logger: console,
                    content: [
                        `⚠️ 출석 시트 기록 장기 실패 (${items.length}건)`,
                        `자동 재시도 ${items[0]?.attempts || 0}회 이상 실패했습니다.`,
                        preview,
                        items.length > 10 ? `외 ${items.length - 10}건` : '',
                        '자동 재시도는 5분마다 계속됩니다.'
                    ].filter(Boolean).join('\n')
                });
                if (!notification.sent && !notification.fallbackSent) {
                    throw new Error('출석 시트 장기 실패 알림을 받을 관리자를 찾지 못했습니다.');
                }
            }
        });
    }

    if (payrollArchiveService) {
        const payrollCron = initPayrollCronSchedulers({
            cron,
            CONFIG,
            client,
            payrollArchiveService,
            payrollOperationLogService,
            payrollLiveSummarySyncService,
            payrollIntegrityAuditService,
            backgroundJobQueueService,
            logger: console
        });
        if (payrollCron && typeof payrollCron.stop === 'function') {
            payrollCronStop = payrollCron.stop;
        }
    }

    const schedulePayrollLiveSync = payrollLiveSummarySyncService
        ? () => payrollLiveSummarySyncService.scheduleSync()
        : null;

    function scheduleLateEndAdenaReconciliation(event) {
        if (typeof endAdenaReconciliationService?.reconcileLateApproval !== 'function') return null;
        const actionAt = moment(event?.audit?.actionAt);
        const shiftEndAt = moment(event?.audit?.shiftEndAt);
        if (!actionAt.isValid() || !shiftEndAt.isValid() || actionAt.isBefore(shiftEndAt.clone().add(60, 'minutes'))) {
            return { accepted: false, skipped: true, reason: 'regular-reconciliation-pending' };
        }
        const task = () => endAdenaReconciliationService.reconcileLateApproval(event, {
            guild: client.guilds.cache.get(CONFIG.GUILD_ID)
        });
        if (typeof backgroundJobQueueService?.enqueue === 'function') {
            return backgroundJobQueueService.enqueue({
                key: `end-adena-late-${event.shift}-${event.messageId}-${event.action}`,
                task,
                priority: 99,
                timeoutMs: 180_000
            });
        }
        return task();
    }

    const dayOffMessageEventHandlers = createDayOffMessageEventHandlers({
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
        getShiftBounds,
        purchaseSheetService,
        submissionValidationService: endAdenaSubmissionValidationService,
        opsQueueService,
        onGreatTabChanged: schedulePayrollLiveSync,
        onApprovalRecorded: scheduleLateEndAdenaReconciliation
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
        getNow: () => moment().tz(CONFIG.TIMEZONE),
        getShiftBounds,
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
        reconcileRecentDayOffMessages: (...args) => workflowApi.reconcileRecentDayOffMessages(...args),
        autoAssignGuestForUnassignedMembers: (...args) => workflowApi.autoAssignGuestForUnassignedMembers(...args),
        syncWorkingRoles: (...args) => workflowApi.syncWorkingRoles(...args),
        syncCurrentWorkerProfiles,
        backgroundJobQueueService,
        syncLiveThreeDayPayrollSummary: payrollLiveSummarySyncService
            ? () => payrollLiveSummarySyncService.sync()
            : null,
        syncPayrollReactionStatuses,
        sendDailyCloseReport: (...args) => workflowApi.sendDailyCloseReport(...args),
        createScheduledBackupIfDue,
        syncAutoPanels: (...args) => workflowApi.syncAutoPanels(...args),
        processOpsQueueAutoRetry: (...args) => workflowApi.processOpsQueueAutoRetry(...args),
        checkOperationalIssues: (...args) => workflowApi.checkOperationalIssues(...args),
        runAutoAuditRepair: (...args) => workflowApi.runAutoAuditRepair(...args),
        expireDayOffSessions: (...args) => workflowApi.expireDayOffSessions(...args),
        cleanupOldDayOffReservations,
        saveSystem: () => saveSystemAsync(),
        renderDashboard: () => workflowApi.queueDashboardRender(),
        performSmartReset: (...args) => workflowApi.performSmartReset(...args),
        reportEndAdenaCloseReadiness: typeof endAdenaReconciliationService?.reportCloseReadiness === 'function'
            ? options => endAdenaReconciliationService.reportCloseReadiness({
                ...options,
                guild: client.guilds.cache.get(CONFIG.GUILD_ID)
            })
            : null,
        resetEndAdenaSummary: typeof purchaseSheetService?.resetAdenaSummary === 'function'
            ? (shift, due = {}) => purchaseSheetService.resetAdenaSummary({
                shift,
                bounds: due.bounds || null,
                scheduledAt: due.resetAt || null
            })
            : null,
        remindPendingEndAdenaApprovals: typeof endAdenaReconciliationService?.remindPendingApprovals === 'function'
            ? options => endAdenaReconciliationService.remindPendingApprovals({
                ...options,
                guild: client.guilds.cache.get(CONFIG.GUILD_ID)
            })
            : null,
        reconcileEndAdenaSummary: typeof endAdenaReconciliationService?.run === 'function'
            ? options => endAdenaReconciliationService.run({
                ...options,
                guild: client.guilds.cache.get(CONFIG.GUILD_ID)
            })
            : null,
        resolveEndAdenaSettlementWindow: typeof endAdenaReconciliationService?.getSettlementWindow === 'function'
            ? options => endAdenaReconciliationService.getSettlementWindow(options)
            : null,
        recoverLateEndAdenaApprovals: typeof endAdenaReconciliationService?.recoverLateApprovals === 'function'
            ? () => endAdenaReconciliationService.recoverLateApprovals({
                guild: client.guilds.cache.get(CONFIG.GUILD_ID)
            })
            : null,
        auditEndAdenaFreshness: typeof endAdenaFreshnessService?.audit === 'function'
            ? () => endAdenaFreshnessService.audit({
                guild: client.guilds.cache.get(CONFIG.GUILD_ID)
            })
            : null,
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
        payrollCronStop: () => {
            payrollCronStop();
            rawAttendanceRetryStop();
            backgroundQueueMonitorStop();
        }
    };
}

module.exports = { registerDiscordHandlers };
