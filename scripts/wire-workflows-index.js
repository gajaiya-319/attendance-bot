'use strict';

const fs = require('fs');
const path = require('path');

const workflowForwarders = [
    ['buildDiagnosticsEmbed', 'audit', 'buildDiagnosticsEmbed'],
    ['buildOpsCheckEmbed', 'audit', 'buildOpsCheckEmbed'],
    ['buildPermissionCheckEmbed', 'audit', 'buildPermissionCheckEmbed'],
    ['buildDataAuditEmbed', 'audit', 'buildDataAuditEmbed'],
    ['buildStatusAuditEmbed', 'audit', 'buildStatusAuditEmbed'],
    ['buildStatusTraceEmbed', 'audit', 'buildStatusTraceEmbed'],
    ['buildTimeAuditEmbed', 'audit', 'buildTimeAuditEmbed'],
    ['buildDayOffLogEmbed', 'audit', 'buildDayOffLogEmbed'],
    ['syncUserRecordedStatus', 'audit', 'syncUserRecordedStatus'],
    ['sendOpsReport', 'reporting', 'sendOpsReport'],
    ['sendDeepReport', 'reporting', 'sendDeepReport'],
    ['buildRankingEmbed', 'reporting', 'buildRankingEmbed'],
    ['buildInactiveCandidatesEmbed', 'reporting', 'buildInactiveCandidatesEmbed'],
    ['syncAutoPanels', 'notice', 'syncAutoPanels'],
    ['checkOperationalIssues', 'ops', 'checkOperationalIssues'],
    ['processOpsQueueAutoRetry', 'ops', 'processOpsQueueAutoRetry'],
    ['submitDayOffRequestFromInteraction', 'dayOff', 'submitDayOffRequestFromInteraction'],
    ['processDayOffMessage', 'dayOff', 'processDayOffMessage'],
    ['approveDayOffMessage', 'dayOff', 'approveDayOffMessage'],
    ['cancelDayOffRequest', 'dayOff', 'cancelDayOffRequest'],
    ['cancelDayOffApproval', 'dayOff', 'cancelDayOffApproval'],
    ['checkDayOffReservations', 'dayOff', 'checkDayOffReservations'],
    ['approveDayOffReservationByCommand', 'dayOff', 'approveDayOffReservationByCommand'],
    ['cancelDayOffReservationByCommand', 'dayOff', 'cancelDayOffReservationByCommand'],
    ['cancelOnlyDayOffReservationByCommand', 'dayOff', 'cancelOnlyDayOffReservationByCommand'],
    ['rejectDayOffReservationByCommand', 'dayOff', 'rejectDayOffReservationByCommand'],
    ['writeDayOffLog', 'dayOff', 'writeDayOffLog'],
    ['writeAdminActionLog', 'adminAuditLog', 'writeAdminActionLog'],
    ['applyApprovedDayOffReservation', 'dayOff', 'applyApprovedDayOffReservation'],
    ['sendFinishedLiveOffReminder', 'dayOff', 'sendFinishedLiveOffReminder'],
    ['markWorkedOnDayOff', 'dayOff', 'markWorkedOnDayOff']
];

const indexPath = path.join(__dirname, '..', 'index.js');
let src = fs.readFileSync(indexPath, 'utf8');

if (!src.includes('createWorkflowRuntime')) {
    src = src.replace(
        "const { createStartupRuntime } = require('./src/runtime/startupRuntime');\n",
        "const { createStartupRuntime } = require('./src/runtime/startupRuntime');\nconst { createWorkflowRuntime } = require('./src/runtime/workflowRuntime');\nconst { DAY_OFF_REQUEST_CUSTOM_IDS } = require('./src/events/dayOffRequestInteractionHandler');\n"
    );
}

if (!src.includes('let workflowRuntime;')) {
    const fnDefs = workflowForwarders
        .map(([name, root, method]) => `function ${name}(...args) { return workflowRuntime.${root}.${method}(...args); }`)
        .join('\n');

    src = src.replace(
        'function printStartupBanner() {',
        `let workflowRuntime;\n\n${fnDefs}\n\nfunction printStartupBanner() {`
    );
}

const initBlock = `
const DAYOFF_APPROVAL_EMOJI = '✅';
const dayOffReactionCleanupLocks = new Set();

workflowRuntime = createWorkflowRuntime({
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
    getDashboardShift,
    getShiftBounds,
    getDayNightWorkerStats,
    getDayNightWorkerOvertimeUsers,
    getAttendanceData: () => attendanceData,
    getOvertimeUsers: () => overtimeUsers,
    getAnnounceData: () => announceData,
    getDayOffReservations: () => dayOffReservations,
    getStatusMessageId: () => statusMessageId,
    getLastSavedAt: () => lastSavedAt,
    getLastBackupAt: () => lastBackupAt,
    getPanelInfo: () => panelInfo,
    setPanelMessageId: (key, messageId) => {
        panelInfo[key].mId = messageId;
    },
    removeOvertimeUser: id => {
        overtimeUsers = overtimeUsers.filter(o => o.id !== id);
    },
    saveSystemAsync,
    dayOffService,
    roleService,
    ensureUserData,
    applyDayOffState,
    clearDayOffReservationState,
    appendAttendanceEvent,
    updateWorkingRole,
    queueDashboardRender,
    getDayOffLogicalDateForShift,
    buildShiftBoundsForBusinessDate,
    getActiveLiveException,
    getMemberShiftRole,
    getOperationalShift,
    getDashboardName,
    dashboardStateUtils,
    collectStatusTransitionWarnings,
    isAssignedWorker,
    hasManagedAttendanceRole,
    determineShift,
    transitionRecordedStatus,
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
    maintenanceOverrideService,
    opsQueueService,
    purchaseSheetService,
    retryQueuedItem: require('./src/commands/admin/opsQueueCommands').retryQueuedItem,
    isOwnerId: id => isOwnerId(id),
    renderPercentBar,
    renderReportTopRow,
    renderReportStatsLegend,
    renderReportMetricRow,
    renderReportMetricHeader,
    renderSessionMetricRow,
    formatDuration,
    formatKoreanDateTime,
    DAY_OFF_REQUEST_CUSTOM_IDS,
    reactionCleanupLocks: dayOffReactionCleanupLocks,
    getDayOffPanelPayload: () => dayOffRequestInteractions.buildPanelPayload(),
    alertState: {
        lastOperationalIssueSignature,
        lastOperationalIssueAlertAt,
        lastOpsQueueAutoRetryAt,
        lastOpsQueueStuckAlertAt,
        lastOpsQueueAutoResultSignature,
        lastOpsQueueAutoResultAlertAt
    },
    logger: console
});

`;

if (!src.includes('workflowRuntime = createWorkflowRuntime')) {
    src = src.replace(
        '/**\n * [ INTERACTION HANDLER ]\n */',
        `${initBlock}\n/**\n * [ INTERACTION HANDLER ]\n */`
    );
}

fs.writeFileSync(indexPath, src, 'utf8');
console.log('wired workflow runtime into index.js');
