'use strict';

const fs = require('fs');
const path = require('path');

const phase2Forwarders = [
    ['queueDashboardRender', 'dashboard', 'queueDashboardRender'],
    ['renderDashboardCore', 'dashboard', 'renderDashboardCore'],
    ['getActiveLiveException', 'dashboard', 'getActiveLiveException'],
    ['getDayNightWorkerStats', 'dashboard', 'getDayNightWorkerStats'],
    ['getDayNightWorkerOvertimeUsers', 'dashboard', 'getDayNightWorkerOvertimeUsers'],
    ['applyVoiceSnapshot', 'voice', 'applyVoiceSnapshot'],
    ['syncVoiceStates', 'voice', 'syncVoiceStates'],
    ['syncWorkingRoles', 'membership', 'syncWorkingRoles'],
    ['reconcileAttendanceMembership', 'membership', 'reconcileAttendanceMembership'],
    ['autoAssignGuestForUnassignedMembers', 'membership', 'autoAssignGuestForUnassignedMembers'],
    ['syncManualGuestNickname', 'membership', 'syncManualGuestNickname'],
    ['syncNicknameFromAssignedRoles', 'membership', 'syncNicknameFromAssignedRoles'],
    ['syncRolesFromStructuredNickname', 'membership', 'syncRolesFromStructuredNickname'],
    ['performSmartReset', 'scheduled', 'performSmartReset'],
    ['checkGracePeriods', 'scheduled', 'checkGracePeriods'],
    ['autoOvertimeCheck', 'scheduled', 'autoOvertimeCheck'],
    ['grantLiveException', 'scheduled', 'grantLiveException'],
    ['checkLiveExceptions', 'scheduled', 'checkLiveExceptions'],
    ['checkScheduledAnnouncements', 'scheduled', 'checkScheduledAnnouncements']
];

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
    dashboardMessageService,
    getDashboardShift,
    getShiftBounds,
    getAttendanceData: () => attendanceData,
    getOvertimeUsers: () => overtimeUsers,
    setOvertimeUsers: list => {
        overtimeUsers = list;
    },
    getAnnounceData: () => announceData,
    getLiveExceptions: () => liveExceptions,
    getDayOffReservations: () => dayOffReservations,
    getStatusMessageId: () => statusMessageId,
    setStatusMessageId: id => {
        statusMessageId = id;
    },
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
    applyApprovedDayOffReservation,
    getActiveApprovedDayOffReservation,
    getDayOffLogicalDateForShift,
    buildShiftBoundsForBusinessDate,
    getMemberShiftRole,
    getOperationalShift,
    getDashboardName,
    dashboardStateUtils,
    collectStatusTransitionWarnings,
    isAssignedWorker,
    hasManagedAttendanceRole,
    determineShift,
    transitionRecordedStatus,
    normalizeCurrentShiftSession,
    handleClockOut,
    isOvertimeEntryStillValid,
    getRankingWorkerShift,
    applyCurrentShiftLiveOnState,
    expireDayOffSessions,
    isCurrentShiftRegularWorker,
    canStartPostShiftOvertime,
    getRestorableOvertimeSession,
    setFinishedPresence,
    applyDisconnectedState,
    recordLog,
    clearStaleDayOffState,
    applyLiveExceptionState,
    handleClockIn,
    activatePendingManualOvertime,
    restoreOvertimeAfterFinish,
    startPostShiftOvertime,
    recordLiveConfirmation,
    recordLiveRecovery,
    markLiveOffState,
    clearLiveOffState,
    getScheduledEndMoment,
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
    getWorkerProfileForRawSync,
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

const indexPath = path.join(__dirname, '..', 'index.js');
let src = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

for (const [name, root, method] of phase2Forwarders) {
    const line = `function ${name}(...args) { return workflowRuntime.${root}.${method}(...args); }`;
    if (!src.includes(line)) {
        src = src.replace(
            'function printStartupBanner() {',
            `${line}\nfunction printStartupBanner() {`
        );
    }
}

if (!src.includes('workflowRuntime = createWorkflowRuntime')) {
    const markers = [
        '/**\n\n * [ INTERACTION HANDLER ]\n */',
        '/**\n * [ INTERACTION HANDLER ]\n */'
    ];
    let replaced = false;
    for (const marker of markers) {
        if (src.includes(marker)) {
            src = src.replace(marker, `${initBlock}\n${marker}`);
            replaced = true;
            break;
        }
    }
    if (!replaced) throw new Error('interaction handler marker not found');
} else {
    const start = src.indexOf('workflowRuntime = createWorkflowRuntime({');
    const end = src.indexOf('\n});\n', start);
    if (start < 0 || end < 0) throw new Error('workflowRuntime init block not found for update');
    src = `${src.slice(0, start)}${initBlock.trimStart()}${src.slice(end + 5)}`;
}

fs.writeFileSync(indexPath, src, 'utf8');
console.log('wired phase2 workflow runtime into index.js');
