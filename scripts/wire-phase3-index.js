'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.js');
const clockPath = path.join(root, 'src/workflows/clockWorkflow.js');

let src = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');
const clockSrc = fs.readFileSync(clockPath, 'utf8');
const factoryStart = clockSrc.indexOf('function createClockWorkflow(deps) {');
const clockExports = [...clockSrc.slice(factoryStart).matchAll(/^(?:async )?function (\w+)/gm)].map(m => m[1]);
if (!clockExports.length) throw new Error('clock function exports not found');

for (const name of clockExports) {
    const line = `function ${name}(...args) { return workflowRuntime.clock.${name}(...args); }`;
    if (!src.includes(line)) {
        src = src.replace(
            'function printStartupBanner() {',
            `${line}\nfunction printStartupBanner() {`
        );
    }
}

const slimInit = `
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
    attendanceService,
    roleService,
    rawAttendanceSheetService,
    dashboardStateUtils,
    getDashboardShift,
    getShiftBounds,
    getOperationalShift,
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
    updateWorkingRole,
    dayOffService,
    ensureUserData,
    determineShift,
    getDayOffLogicalDateForShift,
    buildShiftBoundsForBusinessDate,
    getDashboardName,
    collectStatusTransitionWarnings,
    isAssignedWorker,
    hasManagedAttendanceRole,
    getActiveApprovedDayOffReservation: (...args) => workflowRuntime.dayOff.getActiveApprovedDayOffReservation?.(...args) ?? null,
    applyApprovedDayOffReservation: (...args) => workflowRuntime.dayOff.applyApprovedDayOffReservation(...args),
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
    getTimeLogicRecentMaintenanceEnd,
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
    RAW_ATTENDANCE_STATUS,
    mapRawClockInStatus,
    mapRawClockOutStatus,
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

// Fix circular dayOff refs in init - use forwarders defined at top
const slimInitFixed = slimInit
    .replace(
        "getActiveApprovedDayOffReservation: (...args) => workflowRuntime.dayOff.getActiveApprovedDayOffReservation?.(...args) ?? null,\n    applyApprovedDayOffReservation: (...args) => workflowRuntime.dayOff.applyApprovedDayOffReservation(...args),",
        ''
    );

const initStart = src.indexOf('workflowRuntime = createWorkflowRuntime({');
const initEnd = src.indexOf('\n});\n', initStart);
if (initStart < 0 || initEnd < 0) throw new Error('workflowRuntime init not found');

const beforeInit = src.slice(0, initStart);
const afterInit = src.slice(initEnd + 4);
src = `${beforeInit}${slimInitFixed.trimStart()}${afterInit}`;

fs.writeFileSync(indexPath, src, 'utf8');
console.log('wired phase3:', clockExports.length, 'clock forwarders');
