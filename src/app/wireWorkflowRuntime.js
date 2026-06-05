'use strict';

const {
    createWorkflowRuntime,
    retryQueuedItem,
    DAY_OFF_REQUEST_CUSTOM_IDS,
    buildCommandDefinitions,
    hiddenCommandAliases,
    validateCommandPayloads,
    collectStatusTransitionWarnings,
    RAW_ATTENDANCE_STATUS
} = require('./appDependencies');

function wireWorkflowRuntimeForApp(ctx) {
    const {
        wireWorkflowRuntime,
        botState,
        commands,
        dayOffReactionCleanupLocks,
        dayOffRequestInteractions,
        client,
        CONFIG,
        moment,
        fs,
        EmbedBuilder,
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        PermissionFlagsBits,
        padWidth,
        truncateWidth,
        formatExactWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        refreshGuildMembers,
        dashboardMessageService,
        attendanceService,
        roleService,
        rawAttendanceSheetService,
        dashboardStateUtils,
        getDashboardShift,
        getShiftBounds,
        getShiftSessionKey,
        getRecognizedClockInMoment,
        getOperationalShift,
        saveSystemAsync,
        updateWorkingRole,
        dayOffService,
        ensureUserData,
        determineShift,
        getDayOffLogicalDateForShift,
        buildShiftBoundsForBusinessDate,
        getDashboardName,
        renderDashboardHeader,
        renderSummaryBox,
        renderCleanGrid,
        renderStatusList,
        renderOvertimeList,
        isAssignedWorker,
        hasManagedAttendanceRole,
        createBackupSnapshot,
        getRuntimeHealthSnapshot,
        getStartupBuildInfo,
        readRuntimeHealthFile,
        getActiveMaintenanceWindow,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        getTimeLogicRecentMaintenanceEnd,
        maintenanceOverrideService,
        opsQueueService,
        purchaseSheetService,
        isOwnerId,
        renderPercentBar,
        renderReportTopRow,
        renderReportStatsLegend,
        renderReportMetricRow,
        renderReportMetricHeader,
        renderSessionMetricRow,
        formatDuration,
        formatKoreanDateTime,
        mapRawClockInStatus,
        mapRawClockOutStatus,
        getWorkerProfileForRawSync
    } = ctx;

    const workflowRuntime = createWorkflowRuntime({
        client,
        CONFIG,
        moment,
        fs,
        EmbedBuilder,
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        PermissionFlagsBits,
        padWidth,
        truncateWidth,
        formatExactWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        refreshGuildMembers,
        dashboardMessageService,
        attendanceService,
        roleService,
        rawAttendanceSheetService,
        dashboardStateUtils,
        getDashboardShift,
        getShiftBounds,
        getShiftSessionKey,
        getRecognizedClockInMoment,
        getOperationalShift,
        getAttendanceData: () => botState.attendanceData,
        getOvertimeUsers: () => botState.overtimeUsers,
        setOvertimeUsers: list => {
            botState.overtimeUsers = list;
        },
        getAnnounceData: () => botState.announceData,
        getLiveExceptions: () => botState.liveExceptions,
        getDayOffReservations: () => botState.dayOffReservations,
        getStatusMessageId: () => botState.statusMessageId,
        setStatusMessageId: id => {
            botState.statusMessageId = id;
        },
        getLastSavedAt: () => botState.lastSavedAt,
        getLastBackupAt: () => botState.lastBackupAt,
        getPanelInfo: () => botState.panelInfo,
        setPanelMessageId: (key, messageId) => {
            botState.panelInfo[key].mId = messageId;
        },
        removeOvertimeUser: id => {
            botState.overtimeUsers = botState.overtimeUsers.filter(o => o.id !== id);
        },
        saveSystemAsync,
        updateWorkingRole,
        dayOffService,
        ensureUserData,
        determineShift,
        getDayOffLogicalDateForShift,
        buildShiftBoundsForBusinessDate,
        getDashboardName,
        renderDashboardHeader,
        renderSummaryBox,
        renderCleanGrid,
        renderStatusList,
        renderOvertimeList,
        collectStatusTransitionWarnings,
        isAssignedWorker,
        hasManagedAttendanceRole,
        createBackupSnapshot,
        getRuntimeHealthSnapshot,
        getStartupBuildInfo,
        readRuntimeHealthFile,
        buildCommandDefinitions,
        hiddenCommandAliases,
        validateCommandPayloads,
        getActiveMaintenanceWindow,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        getTimeLogicRecentMaintenanceEnd: getTimeLogicRecentMaintenanceEnd,
        maintenanceOverrideService,
        opsQueueService,
        purchaseSheetService,
        retryQueuedItem,
        isOwnerId: id => isOwnerId(id),
        renderPercentBar,
        renderReportTopRow,
        renderReportStatsLegend,
        renderReportMetricRow,
        renderReportMetricHeader,
        renderSessionMetricRow,
        formatDuration,
        formatKoreanDateTime,
        RAW_ATTENDANCE_STATUS,
        mapRawClockInStatus,
        mapRawClockOutStatus,
        getWorkerProfileForRawSync,
        DAY_OFF_REQUEST_CUSTOM_IDS,
        reactionCleanupLocks: dayOffReactionCleanupLocks,
        getDayOffPanelPayload: () => dayOffRequestInteractions.buildPanelPayload(),
        alertState: {
            get lastOperationalIssueSignature() {
                return botState.lastOperationalIssueSignature;
            },
            set lastOperationalIssueSignature(value) {
                botState.lastOperationalIssueSignature = value;
            },
            get lastOperationalIssueAlertAt() {
                return botState.lastOperationalIssueAlertAt;
            },
            set lastOperationalIssueAlertAt(value) {
                botState.lastOperationalIssueAlertAt = value;
            },
            get lastOpsQueueAutoRetryAt() {
                return botState.lastOpsQueueAutoRetryAt;
            },
            set lastOpsQueueAutoRetryAt(value) {
                botState.lastOpsQueueAutoRetryAt = value;
            },
            get lastOpsQueueStuckAlertAt() {
                return botState.lastOpsQueueStuckAlertAt;
            },
            set lastOpsQueueStuckAlertAt(value) {
                botState.lastOpsQueueStuckAlertAt = value;
            },
            get lastOpsQueueAutoResultSignature() {
                return botState.lastOpsQueueAutoResultSignature;
            },
            set lastOpsQueueAutoResultSignature(value) {
                botState.lastOpsQueueAutoResultSignature = value;
            },
            get lastOpsQueueAutoResultAlertAt() {
                return botState.lastOpsQueueAutoResultAlertAt;
            },
            set lastOpsQueueAutoResultAlertAt(value) {
                botState.lastOpsQueueAutoResultAlertAt = value;
            }
        },
        logger: console
    });

    wireWorkflowRuntime(workflowRuntime);
    return workflowRuntime;
}

module.exports = { wireWorkflowRuntimeForApp };
