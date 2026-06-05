'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function cleanExtractBody(body) {
    return body
        .replace(/^\uFEFF/, '')
        .replace(/^\/\*\*[\s\S]*?\*\/\s*/m, '')
        .replace(/^\s*\*\/\s*$/gm, '')
        .replace(/^\/\/.*\n/gm, '');
}

function wrapWorkflow(name, factory, extractFile, header, footer, transformBody) {
    let body = cleanExtractBody(fs.readFileSync(path.join(root, extractFile), 'utf8').replace(/\r\n/g, '\n'));
    if (typeof transformBody === 'function') body = transformBody(body);
    const content = [
        "'use strict';",
        '',
        `function ${factory}(deps) {`,
        header,
        body,
        footer,
        '}',
        '',
        `module.exports = { ${factory} };`,
        ''
    ].join('\n');
    fs.writeFileSync(path.join(root, 'src/workflows', name), content, 'utf8');
}

wrapWorkflow(
    'reportingWorkflow.js',
    'createReportingWorkflow',
    'src/workflows/_extract-report.txt',
    `    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
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
        getAttendanceData,
        getOvertimeUsers,
        renderPercentBar,
        renderReportTopRow,
        renderReportStatsLegend,
        renderReportMetricRow,
        renderReportMetricHeader,
        renderSessionMetricRow,
        formatDuration,
        isOwnerId,
        PermissionFlagsBits,
        logger = console
    } = deps;`,
    `    return {
        sendDeepReport,
        sendOpsReport,
        getRankingWorkerShift,
        buildRankingEmbed,
        buildInactiveCandidatesEmbed
    };`,
    body => body
        .replace(/\battendanceData\b/g, 'getAttendanceData()')
        .replace(/\bovertimeUsers\b/g, 'getOvertimeUsers()')
);

wrapWorkflow(
    'opsMonitoringWorkflow.js',
    'createOpsMonitoringWorkflow',
    'src/workflows/_extract-ops.txt',
    `    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        padWidth,
        truncateWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        getAttendanceData,
        getOvertimeUsers,
        getDayOffReservations,
        getDashboardName,
        getActiveLiveException,
        getMemberShiftRole,
        getOperationalShift,
        opsQueueService,
        purchaseSheetService,
        retryQueuedItem,
        alertState,
        logger = console
    } = deps;
    const {
        lastOperationalIssueSignature,
        lastOperationalIssueAlertAt,
        lastOpsQueueAutoRetryAt,
        lastOpsQueueStuckAlertAt,
        lastOpsQueueAutoResultSignature,
        lastOpsQueueAutoResultAlertAt
    } = alertState;`,
    `    return {
        collectDataAuditIssues,
        makeOperationalIssue,
        collectDashboardGroupDuplicateIssues,
        collectOperationalIssues,
        formatOperationalIssueRows,
        fetchOpsAlertChannel,
        buildOpsQueueResultSignature,
        sendOpsQueueAutoResultAlert,
        notifyOperationalIssues,
        sendOpsQueueStuckAlert,
        processOpsQueueAutoRetry,
        checkOperationalIssues
    };`,
    body => body
        .replace(/\battendanceData\b/g, 'getAttendanceData()')
        .replace(/\bovertimeUsers\b/g, 'getOvertimeUsers()')
        .replace(/\bdayOffReservations\b/g, 'getDayOffReservations()')
);

wrapWorkflow(
    'auditEmbedWorkflow.js',
    'createAuditEmbedWorkflow',
    'src/workflows/_extract-audit.txt',
    `    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        PermissionFlagsBits,
        padWidth,
        truncateWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        refreshGuildMembers,
        getAttendanceData,
        getOvertimeUsers,
        getAnnounceData,
        getDayOffReservations,
        getStatusMessageId,
        getLastSavedAt,
        getLastBackupAt,
        dashboardStateUtils,
        collectStatusTransitionWarnings,
        collectDataAuditIssues,
        collectOperationalIssues,
        formatOperationalIssueRows,
        getDashboardName,
        isAssignedWorker,
        hasManagedAttendanceRole,
        ensureUserData,
        determineShift,
        transitionRecordedStatus,
        createBackupSnapshot,
        saveSystemAsync,
        queueDashboardRender,
        writeAdminActionLog,
        readAdminAudit,
        readDayOffLog,
        getRuntimeHealthSnapshot,
        getStartupBuildInfo,
        readRuntimeHealthFile,
        buildCommandDefinitions,
        hiddenCommandAliases,
        validateCommandPayloads,
        getOperationalShift,
        getDashboardShift,
        getShiftBounds,
        getActiveMaintenanceWindow,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        maintenanceOverrideService,
        guildId: GUILD_ID,
        logger = console
    } = deps;`,
    `    return {
        buildDiagnosticsEmbed,
        buildDataAuditEmbed,
        deriveAttendanceStatusForAudit,
        deriveVoiceStatusForAudit,
        buildStatusAuditEmbed,
        collectStatusAuditMismatches,
        formatShiftBoundsForOps,
        formatMaintenanceOverrideRows,
        buildOpsCheckEmbed,
        buildStatusTraceEmbed,
        syncUserRecordedStatus,
        buildTimeAuditEmbed,
        buildPermissionCheckEmbed,
        buildDayOffLogEmbed
    };`,
    body => body
        .replace(/\battendanceData\b/g, 'getAttendanceData()')
        .replace(/\bovertimeUsers\b/g, 'getOvertimeUsers()')
        .replace(/\bannounceData\b/g, 'getAnnounceData()')
        .replace(/\bdayOffReservations\b/g, 'getDayOffReservations()')
        .replace(/\blastSavedAt\b/g, 'getLastSavedAt()')
        .replace(/\blastBackupAt\b/g, 'getLastBackupAt()')
        .replace(/\bstatusMessageId\b/g, 'getStatusMessageId()')
        .replace(/client\.guilds\.cache\.get\(CONFIG\.GUILD_ID\)/g, 'client.guilds.cache.get(GUILD_ID)')
);

wrapWorkflow(
    'dayOffWorkflow.js',
    'createDayOffWorkflow',
    'src/workflows/_extract-dayoff.txt',
    `    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        dayOffService,
        roleService,
        getDayOffReservations,
        getAttendanceData,
        removeOvertimeUser,
        saveSystemAsync,
        ensureUserData,
        applyDayOffState,
        clearDayOffReservationState,
        appendAttendanceEvent,
        updateWorkingRole,
        queueDashboardRender,
        getDayOffLogicalDateForShift,
        buildShiftBoundsForBusinessDate,
        getShiftBounds,
        getDayOffPanelPayload,
        DAY_OFF_REQUEST_CUSTOM_IDS,
        reactionCleanupLocks,
        logger = console
    } = deps;`,
    `    return {
        sendTemporaryDayOffReply,
        isReactionBlockedError,
        setDayOffStatusEmoji,
        sendDayOffStatusFallback,
        writeDayOffLog,
        appendDayOffAudit,
        readDayOffLog,
        notifyDayOffReviewer,
        dayOffReservationToParsed,
        getDayOffReservationUserId,
        fetchDayOffReservationUser,
        saveDayOffReservation,
        isDayOffRequestPanelMessage,
        repostDayOffRequestPanel,
        submitDayOffRequestFromInteraction,
        processDayOffMessage,
        approveDayOffMessage,
        cancelDayOffApproval,
        cancelDayOffRequest,
        markWorkedOnDayOff,
        getActiveApprovedDayOffReservation,
        buildLiveOffGuidanceDm,
        sendFinishedLiveOffReminder,
        cancelDayOffReservationByCommand,
        cancelOnlyDayOffReservationByCommand,
        rejectDayOffReservationByCommand,
        approveDayOffReservationByCommand,
        checkDayOffReservations,
        applyApprovedDayOffReservation
    };`,
    body => {
        let next = body
            .replace(/^const DAYOFF_STATUS_EMOJIS = [\s\S]*?^const dayOffReactionCleanupLocks = new Set\(\);\s*/m, '')
            .replace(/^async function writeAdminActionLog[\s\S]*?^async function appendDayOffAudit/m, 'async function appendDayOffAudit')
            .replace(/\bdayOffReactionCleanupLocks\b/g, 'reactionCleanupLocks')
            .replace(/\bdayOffReservations\b/g, 'getDayOffReservations()')
            .replace(/\battendanceData\b/g, 'getAttendanceData()')
            .replace(/overtimeUsers = overtimeUsers\.filter\(o => o\.id !== ([^)]+)\)/g, 'removeOvertimeUser($1)')
            .replace(/dayOffRequestInteractions\.buildPanelPayload\(\)/g, 'getDayOffPanelPayload()');
        return next;
    }
);

console.log('built reporting, ops, audit, dayoff workflows');
