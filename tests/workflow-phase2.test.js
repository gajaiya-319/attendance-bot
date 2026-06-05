'use strict';

const assert = require('assert');
const { createDashboardWorkflow } = require('../src/workflows/dashboardWorkflow');
const { createVoiceSyncWorkflow } = require('../src/workflows/voiceSyncWorkflow');
const { createMembershipWorkflow } = require('../src/workflows/membershipWorkflow');
const { createScheduledJobsWorkflow } = require('../src/workflows/scheduledJobsWorkflow');
const { createWorkflowRuntime } = require('../src/runtime/workflowRuntime');

(async () => {
    const attendanceData = {};
    const overtimeUsers = [];
    const liveExceptions = {};
    let statusMessageId = null;

    const voice = createVoiceSyncWorkflow({
        client: { guilds: { cache: { get: () => null } } },
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila' },
        moment: require('moment-timezone'),
        getAttendanceData: () => attendanceData,
        saveSystemAsync: async () => {},
        refreshGuildMembers: async () => true,
        determineShift: () => 'day',
        ensureUserData: () => null,
        getMemberShiftRole: () => 'day',
        getActiveLiveException: () => null,
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getScheduledEndMoment: () => null,
        isMaintenanceWindow: () => false,
        isWithinPreShiftWindow: () => false,
        isCurrentShiftRegularWorker: () => false,
        canStartPostShiftOvertime: () => false,
        getRestorableOvertimeSession: () => null,
        appendAttendanceEvent: () => {},
        transitionRecordedStatus: () => false,
        setFinishedPresence: () => false,
        handleClockOut: async () => {},
        applyDisconnectedState: () => {},
        recordLog: async () => {},
        getActiveApprovedDayOffReservation: () => null,
        clearStaleDayOffState: () => {},
        applyLiveExceptionState: () => {},
        handleClockIn: async () => false,
        activatePendingManualOvertime: async () => false,
        restoreOvertimeAfterFinish: async () => false,
        startPostShiftOvertime: async () => false,
        recordLiveConfirmation: async () => false,
        recordLiveRecovery: async () => false,
        markLiveOffState: () => {},
        clearLiveOffState: () => {}
    });

    assert.strictEqual(typeof voice.applyVoiceSnapshot, 'function');
    assert.strictEqual(typeof voice.syncVoiceStates, 'function');

    const dashboard = createDashboardWorkflow({
        client: {
            channels: {
                cache: { get: () => null },
                fetch: async () => null
            }
        },
        CONFIG: { TIMEZONE: 'Asia/Manila', STATUS_CHANNEL: 'status', ROLES: { DAY: 'd', NIGHT: 'n' } },
        moment: require('moment-timezone'),
        EmbedBuilder: class { setTitle() { return this; } setColor() { return this; } setDescription() { return this; } setTimestamp() { return this; } addFields() { return this; } },
        dashboardMessageService: {
            consolidateStatusMessages: async () => ({ keptId: null, deleted: 0 }),
            upsertStatusMessage: async () => ({ statusMessageId: null, created: false, updated: false, skipped: true })
        },
        dashboardStateUtils: require('../src/utils/dashboardState'),
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        setOvertimeUsers: list => { overtimeUsers.length = 0; overtimeUsers.push(...list); },
        getStatusMessageId: () => statusMessageId,
        setStatusMessageId: id => { statusMessageId = id; },
        saveSystemAsync: async () => {},
        refreshGuildMembers: async () => true,
        syncVoiceStates: voice.syncVoiceStates,
        expireDayOffSessions: () => false,
        isMaintenanceWindow: () => false,
        isWithinPreShiftWindow: () => false,
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getMemberShiftRole: () => 'day',
        getActiveApprovedDayOffReservation: () => null,
        applyApprovedDayOffReservation: async () => false,
        ensureUserData: () => null,
        determineShift: () => 'day',
        normalizeCurrentShiftSession: async () => false,
        handleClockOut: async () => {},
        transitionRecordedStatus: () => false,
        isOvertimeEntryStillValid: () => false,
        getRankingWorkerShift: () => 'day',
        getDashboardName: () => 'tester',
        applyCurrentShiftLiveOnState: () => {}
    });

    assert.strictEqual(typeof dashboard.queueDashboardRender, 'function');
    assert.strictEqual(typeof dashboard.getActiveLiveException, 'function');
    assert.strictEqual(dashboard.getLayoutVersion(), 'classic-dashboard-wide-blank-v14');

    const runtime = createWorkflowRuntime({
        client: { guilds: { cache: { get: () => null } }, channels: { cache: { get: () => null }, fetch: async () => null } },
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila', STATUS_CHANNEL: 's', ROLES: { DAY: 'd', NIGHT: 'n', WORKING: 'w' }, LOG_CHANNEL: 'l' },
        moment: require('moment-timezone'),
        fs: require('fs'),
        EmbedBuilder: class {},
        ActionRowBuilder: class {},
        ButtonBuilder: class {},
        ButtonStyle: {},
        PermissionFlagsBits: {},
        padWidth: (v, w) => String(v).padEnd(w),
        truncateWidth: v => String(v),
        formatExactWidth: v => String(v),
        renderEmbedCodeBlock: v => v,
        safeAddFields: () => {},
        refreshGuildMembers: async () => true,
        dashboardMessageService: {
            consolidateStatusMessages: async () => ({ keptId: null, deleted: 0 }),
            upsertStatusMessage: async () => ({ statusMessageId: null, created: false, updated: false, skipped: true })
        },
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        setOvertimeUsers: list => { overtimeUsers.length = 0; overtimeUsers.push(...list); },
        getAnnounceData: () => ({}),
        getLiveExceptions: () => liveExceptions,
        getDayOffReservations: () => ({}),
        getStatusMessageId: () => statusMessageId,
        setStatusMessageId: id => { statusMessageId = id; },
        getLastSavedAt: () => null,
        getLastBackupAt: () => null,
        getPanelInfo: () => ({ day: { cId: 'd', mId: null }, night: { cId: 'n', mId: null } }),
        setPanelMessageId: () => {},
        removeOvertimeUser: () => {},
        saveSystemAsync: async () => {},
        dayOffService: {},
        roleService: {},
        ensureUserData: () => null,
        applyDayOffState: () => {},
        clearDayOffReservationState: () => {},
        appendAttendanceEvent: () => {},
        updateWorkingRole: async () => {},
        applyApprovedDayOffReservation: async () => false,
        getActiveApprovedDayOffReservation: () => null,
        getDayOffLogicalDateForShift: () => '2026-01-01',
        buildShiftBoundsForBusinessDate: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getMemberShiftRole: () => 'day',
        getOperationalShift: () => 'day',
        getDashboardName: () => 'x',
        dashboardStateUtils: require('../src/utils/dashboardState'),
        collectStatusTransitionWarnings: () => [],
        isAssignedWorker: () => false,
        hasManagedAttendanceRole: () => false,
        determineShift: () => 'day',
        transitionRecordedStatus: () => false,
        normalizeCurrentShiftSession: async () => false,
        handleClockOut: async () => {},
        isOvertimeEntryStillValid: () => false,
        getRankingWorkerShift: () => 'day',
        applyCurrentShiftLiveOnState: () => {},
        expireDayOffSessions: () => false,
        isCurrentShiftRegularWorker: () => false,
        canStartPostShiftOvertime: () => false,
        getRestorableOvertimeSession: () => null,
        setFinishedPresence: () => false,
        applyDisconnectedState: () => {},
        recordLog: async () => {},
        clearStaleDayOffState: () => {},
        applyLiveExceptionState: () => {},
        handleClockIn: async () => false,
        activatePendingManualOvertime: async () => false,
        restoreOvertimeAfterFinish: async () => false,
        startPostShiftOvertime: async () => false,
        recordLiveConfirmation: async () => false,
        recordLiveRecovery: async () => false,
        markLiveOffState: () => {},
        clearLiveOffState: () => {},
        getScheduledEndMoment: () => null,
        createBackupSnapshot: async () => {},
        getRuntimeHealthSnapshot: () => ({}),
        getStartupBuildInfo: () => ({}),
        readRuntimeHealthFile: async () => ({}),
        buildCommandDefinitions: () => [],
        hiddenCommandAliases: {},
        validateCommandPayloads: () => [],
        getActiveMaintenanceWindow: () => null,
        isMaintenanceWindow: () => false,
        isWithinPreShiftWindow: () => false,
        maintenanceOverrideService: {},
        opsQueueService: { list: async () => [], retryAll: async () => ({ total: 0, succeeded: 0, failed: 0 }) },
        purchaseSheetService: {},
        retryQueuedItem: async () => ({ ok: true }),
        isOwnerId: () => false,
        renderPercentBar: () => '',
        renderReportTopRow: () => '',
        renderReportStatsLegend: () => '',
        renderReportMetricRow: () => '',
        renderReportMetricHeader: () => '',
        renderSessionMetricRow: () => '',
        formatDuration: () => '',
        formatKoreanDateTime: () => '',
        getWorkerProfileForRawSync: () => ({ shift: 'day' }),
        DAY_OFF_REQUEST_CUSTOM_IDS: {},
        reactionCleanupLocks: new Set(),
        getDayOffPanelPayload: () => ({}),
        alertState: {
            lastOperationalIssueSignature: null,
            lastOperationalIssueAlertAt: 0,
            lastOpsQueueAutoRetryAt: 0,
            lastOpsQueueStuckAlertAt: 0,
            lastOpsQueueAutoResultSignature: null,
            lastOpsQueueAutoResultAlertAt: 0
        }
    });

    assert.ok(runtime.dashboard);
    assert.ok(runtime.voice);
    assert.ok(runtime.membership);
    assert.ok(runtime.scheduled);

    console.log('workflow-phase2 tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
