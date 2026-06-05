'use strict';

const deps = require('./appDependencies');
const { createWorkflowApi } = require('./workflowApi');
const { createBotState } = require('./createBotState');
const { createReportContext } = require('./createReportContext');
const { createServiceLayer } = require('./createServiceLayer');
const { createCoreHelpers } = require('./createCoreHelpers');
const { createCommandRegistry } = require('./createCommandRegistry');
const { finalizeBotApp } = require('./finalizeBotApp');

const {
    fs,
    moment,
    cron,
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    MessageFlags,
    PermissionFlagsBits,
    Partials,
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS,
    createMaintenanceOverrideService,
    createDashboardMessageService,
    createRuntimeHealthService,
    createOpsQueueService,
    createInteractionReplyErrorHandler,
    registerDiscordErrorGuards,
    formatDuration,
    withCommandStatusPayload,
    failText,
    pendingText,
    okText,
    mapRawClockInStatus,
    mapRawClockOutStatus,
    buildCommandDefinitions,
    hiddenCommandAliases,
    validateCommandPayloads,
    formatDiscordRestError,
    createDayOffMessageEventHandlers,
    createPurchaseReactionHandler,
    createDeathPenaltyReactionHandler,
    createEndAdenaReactionHandler,
    createInteractionRouter,
    createClientReadyHandler,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = deps;

function bindRef(slot) {
    return (...args) => slot.fn(...args);
}

function createAttendanceBotApp(options = {}) {
    const token = Object.prototype.hasOwnProperty.call(options, 'token')
        ? options.token
        : process.env.TOKEN;
    if (!token) {
        throw new Error('Missing TOKEN in .env');
    }

    const maintenanceOverrideService = createMaintenanceOverrideService({
        fs,
        filePath: CONFIG.FILES.MAINTENANCE_OVERRIDES,
        moment,
        timezone: CONFIG.TIMEZONE
    });

    const {
        buildShiftBoundsForBusinessDate,
        getOperationalShift,
        getActiveMaintenanceWindow,
        getRecentMaintenanceEnd: getTimeLogicRecentMaintenanceEnd,
        isMaintenanceWindow,
        getDayOffLogicalDateForShift,
        getShiftBounds,
        getShiftSessionKey,
        getRecognizedClockInMoment,
        isWithinPreShiftWindow,
        getDashboardShift
    } = require('../../time-logic')({
        CONFIG,
        SHIFT_SCHEDULE,
        MAINTENANCE_WINDOWS,
        getMaintenanceOverrides: () => maintenanceOverrideService.getAll(),
        moment
    });

    const { api: workflowApi, wire: wireWorkflowRuntime, getRuntime: getWorkflowRuntime } = createWorkflowApi();

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction]
    });

    const dashboardMessageService = createDashboardMessageService({ client });
    const handleInteractionReplyError = createInteractionReplyErrorHandler();
    registerDiscordErrorGuards({ client });

    const mainKeepAliveTimer = setInterval(() => {}, 60 * 60 * 1000);

    if (!global.__attendanceBotProcessHooks) {
        global.__attendanceBotProcessHooks = true;
        process.on('beforeExit', code => {
            console.warn(`[PROCESS WARN] beforeExit fired with code=${code}. Keeping attendance bot alive.`);
        });
        process.on('exit', code => {
            console.warn(`[PROCESS EXIT] code=${code}`);
            clearInterval(mainKeepAliveTimer);
        });
    }

    const runtimeHealthService = createRuntimeHealthService({
        fs,
        moment,
        timezone: CONFIG.TIMEZONE
    });
    const opsQueueService = createOpsQueueService({
        filePath: CONFIG.FILES.OPS_PENDING,
        logger: console
    });

    const botState = createBotState({
        CONFIG,
        maintenanceOverrideService,
        runtimeHealthService,
        crypto: deps.crypto,
        fsSync: deps.fsSync,
        moment,
        projectRoot: deps.path.join(__dirname, '..', '..')
    });

    const {
        saveSystemAsync,
        createBackupSnapshot,
        createScheduledBackupIfDue,
        loadSystem,
        refreshGuildMembers,
        writeRuntimeHealthFile
    } = botState;

    const report = createReportContext({
        workflowApi,
        botState,
        CONFIG,
        moment,
        getShiftBounds
    });

    const JOKES = {
        IN: ['출근 처리되었습니다. 오늘도 화이팅!'],
        OUT: ['퇴근 처리되었습니다. 수고하셨습니다!'],
        OT: ['연장 근무(OT) 처리되었습니다. 무리하지 마세요!'],
        OFF: ['휴무 처리되었습니다. 푹 쉬세요!']
    };

    const layoutVersion = 'classic-dashboard-wide-blank-v14';
    const instanceTag = `pid:${process.pid}`;
    const DAYOFF_APPROVAL_EMOJI = '✅';
    const dayOffReactionCleanupLocks = new Set();

    const helperRefs = {
        determineShift: { fn: () => null },
        ensureUserData: { fn: () => null },
        safeAddFields: { fn: () => null },
        ownerOnlyReply: { fn: async () => {} },
        updateWorkingRole: { fn: async () => {} },
        markMemberActivity: { fn: () => false },
        isCooldown: { fn: () => false }
    };

    const services = createServiceLayer({
        workflowApi,
        botState,
        CONFIG,
        client,
        moment,
        google: deps.google,
        determineShift: bindRef(helperRefs.determineShift),
        getShiftBounds,
        getShiftSessionKey,
        isWithinPreShiftWindow,
        padWidth: deps.padWidth,
        truncateWidth: deps.truncateWidth
    });

    const commands = createCommandRegistry({
        workflowApi,
        botState,
        services,
        saveSystemAsync,
        createBackupSnapshot,
        listBackupSnapshots: botState.listBackupSnapshots,
        restoreBackupSnapshot: botState.restoreBackupSnapshot,
        ownerOnlyReply: bindRef(helperRefs.ownerOnlyReply),
        failText,
        pendingText,
        okText,
        determineShift: bindRef(helperRefs.determineShift),
        ensureUserData: (...args) => helperRefs.ensureUserData.fn(...args),
        safeAddFields: bindRef(helperRefs.safeAddFields),
        updateWorkingRole: bindRef(helperRefs.updateWorkingRole),
        markMemberActivity: bindRef(helperRefs.markMemberActivity),
        isCooldown: bindRef(helperRefs.isCooldown),
        refreshGuildMembers,
        getShiftBounds,
        handleInteractionReplyError,
        withCommandStatusPayload,
        formatKoreanDateTime: report.formatKoreanDateTime,
        JOKES,
        isWithinPreShiftWindow,
        getShiftSessionKey,
        google: deps.google,
        opsQueueService,
        maintenanceOverrideService,
        padWidth: deps.padWidth,
        truncateWidth: deps.truncateWidth,
        CONFIG,
        moment,
        EmbedBuilder,
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle,
        MessageFlags,
        PermissionFlagsBits
    });

    const coreHelpers = createCoreHelpers({
        CONFIG,
        moment,
        getOperationalShift,
        attendanceService: services.attendanceService,
        workflowApi,
        failText,
        MessageFlags,
        startupRuntime: botState.startupRuntime,
        botState,
        normalizeEmbedField: report.normalizeEmbedField,
        renderEmbedFieldValue: report.renderEmbedFieldValue,
        layoutVersion,
        instanceTag
    });

    Object.assign(helperRefs.determineShift, { fn: coreHelpers.determineShift });
    Object.assign(helperRefs.ensureUserData, { fn: coreHelpers.ensureUserData });
    Object.assign(helperRefs.safeAddFields, { fn: coreHelpers.safeAddFields });
    Object.assign(helperRefs.ownerOnlyReply, { fn: coreHelpers.ownerOnlyReply });
    Object.assign(helperRefs.updateWorkingRole, { fn: coreHelpers.updateWorkingRole });
    Object.assign(helperRefs.markMemberActivity, { fn: coreHelpers.markMemberActivity });
    Object.assign(helperRefs.isCooldown, { fn: coreHelpers.isCooldown });

    const appContext = { ...services, ...commands };

    const { payrollCronStop = () => {} } = finalizeBotApp({
        wireCtx: {
            wireWorkflowRuntime,
            botState,
            commands: appContext,
            dayOffReactionCleanupLocks,
            dayOffRequestInteractions: services.dayOffRequestInteractions,
            client,
            CONFIG,
            moment,
            fs,
            EmbedBuilder,
            ActionRowBuilder,
            ButtonBuilder,
            ButtonStyle,
            PermissionFlagsBits,
            padWidth: deps.padWidth,
            truncateWidth: deps.truncateWidth,
            formatExactWidth: deps.formatExactWidth,
            renderEmbedCodeBlock: report.renderEmbedCodeBlock,
            safeAddFields: coreHelpers.safeAddFields,
            refreshGuildMembers,
            dashboardMessageService,
            attendanceService: services.attendanceService,
            roleService: services.roleService,
            rawAttendanceSheetService: services.rawAttendanceSheetService,
            dashboardStateUtils: services.dashboardStateUtils,
            getDashboardShift,
            getShiftBounds,
            getShiftSessionKey,
            getRecognizedClockInMoment,
            getOperationalShift,
            saveSystemAsync,
            updateWorkingRole: coreHelpers.updateWorkingRole,
            dayOffService: services.dayOffService,
            ensureUserData: coreHelpers.ensureUserData,
            determineShift: coreHelpers.determineShift,
            getDayOffLogicalDateForShift,
            buildShiftBoundsForBusinessDate,
            getDashboardName: report.getDashboardName,
            renderDashboardHeader: report.renderDashboardHeader,
            renderSummaryBox: report.renderSummaryBox,
            renderCleanGrid: report.renderCleanGrid,
            renderStatusList: report.renderStatusList,
            renderOvertimeList: report.renderOvertimeList,
            isAssignedWorker: services.isAssignedWorker,
            hasManagedAttendanceRole: services.hasManagedAttendanceRole,
            createBackupSnapshot,
            getRuntimeHealthSnapshot: botState.getRuntimeHealthSnapshot,
            getStartupBuildInfo: botState.getStartupBuildInfo,
            readRuntimeHealthFile: botState.readRuntimeHealthFile,
            getActiveMaintenanceWindow,
            isMaintenanceWindow,
            isWithinPreShiftWindow,
            getTimeLogicRecentMaintenanceEnd,
            maintenanceOverrideService,
            opsQueueService,
            purchaseSheetService: services.purchaseSheetService,
            isOwnerId: services.isOwnerId,
            renderPercentBar: report.renderPercentBar,
            renderReportTopRow: report.renderReportTopRow,
            renderReportStatsLegend: report.renderReportStatsLegend,
            renderReportMetricRow: report.renderReportMetricRow,
            renderReportMetricHeader: report.renderReportMetricHeader,
            renderSessionMetricRow: report.renderSessionMetricRow,
            formatDuration,
            formatKoreanDateTime: report.formatKoreanDateTime,
            mapRawClockInStatus,
            mapRawClockOutStatus,
            getWorkerProfileForRawSync: services.getWorkerProfileForRawSync
        },
        discordCtx: {
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
            dayOffService: services.dayOffService,
            DAYOFF_APPROVAL_EMOJI,
            dayOffReactionCleanupLocks,
            markMemberActivity: coreHelpers.markMemberActivity,
            saveSystemAsync,
            purchaseSheetService: services.purchaseSheetService,
            opsQueueService,
            voiceStateUpdateHandler: commands.voiceStateUpdateHandler,
            guildMemberEventHandlers: commands.guildMemberEventHandlers,
            chatInputCommandHandler: commands.chatInputCommandHandler,
            dayOffRequestInteractions: services.dayOffRequestInteractions,
            buttonInteractionHandler: commands.buttonInteractionHandler,
            interactionErrorHandler: commands.interactionErrorHandler,
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
            cleanupOldDayOffReservations: coreHelpers.cleanupOldDayOffReservations,
            printStartupBanner: coreHelpers.printStartupBanner,
            loadSystem,
            createScheduledBackupIfDue,
            syncCurrentWorkerProfiles: services.syncCurrentWorkerProfiles,
            payrollLiveSummarySyncService: services.payrollLiveSummarySyncService,
            payrollArchiveService: services.payrollArchiveService,
            payrollOperationLogService: services.payrollOperationLogService,
            botState
        }
    });

    function login() {
        return client.login(token);
    }

    async function shutdown() {
        clearInterval(mainKeepAliveTimer);
        payrollCronStop();
        if (client?.destroy) {
            await client.destroy();
        }
    }

    return {
        client,
        login,
        shutdown,
        getWorkflowRuntime,
        workflowApi,
        saveSystemAsync,
        loadSystem,
        printStartupBanner: coreHelpers.printStartupBanner
    };
}

module.exports = {
    createAttendanceBotApp
};
