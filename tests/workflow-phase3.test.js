'use strict';

const assert = require('assert');
const { createClockWorkflow } = require('../src/workflows/clockWorkflow');
const { createWorkflowRuntime } = require('../src/runtime/workflowRuntime');

(async () => {
    const attendanceData = {};
    const overtimeUsers = [];

    const clock = createClockWorkflow({
        client: { guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }, channels: { cache: { get: () => null }, fetch: async () => null } },
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila', ROLES: { DAY: 'd', NIGHT: 'n' }, CLOCK_OUT_GRACE_MINS: 15 },
        moment: require('moment-timezone'),
        attendanceService: {
            getScheduledEndMoment: () => null,
            transitionRecordedStatus: () => false,
            applyFinishedStateCore: () => ({ ok: true }),
            applyDayOffCore: () => ({ ok: true })
        },
        roleService: {},
        rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
        dashboardStateUtils: require('../src/utils/dashboardState'),
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        setOvertimeUsers: list => { overtimeUsers.length = 0; overtimeUsers.push(...list); },
        saveSystemAsync: async () => {},
        updateWorkingRole: async () => {},
        getActiveLiveException: () => null,
        getOperationalShift: () => 'day',
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        isWithinPreShiftWindow: () => false,
        getTimeLogicRecentMaintenanceEnd: () => null,
        formatDuration: mins => `${mins}m`,
        RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
        mapRawClockInStatus: () => 'IN',
        mapRawClockOutStatus: () => 'OUT'
    });

    assert.strictEqual(typeof clock.handleClockIn, 'function');
    assert.strictEqual(typeof clock.getMemberShiftRole, 'function');
    assert.strictEqual(typeof clock.expireDayOffSessions, 'function');

    const { createAttendanceService } = require('../src/services/attendanceService');
    const attendanceService = createAttendanceService({
        CONFIG: { TIMEZONE: 'Asia/Manila' },
        moment: require('moment-timezone'),
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        determineShift: () => 'day',
        getShiftSessionKey: () => 'key',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() })
    });

    const runtime = createWorkflowRuntime({
        client: clockDepsClient(),
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila', STATUS_CHANNEL: 's', ROLES: { DAY: 'd', NIGHT: 'n', WORKING: 'w' }, LOG_CHANNEL: 'l', CLOCK_OUT_GRACE_MINS: 15 },
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
        attendanceService,
        roleService: {},
        rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }), sendWorkerProfile: async () => ({ ok: true }), removeWorkerProfile: async () => ({ ok: true }) },
        dashboardStateUtils: require('../src/utils/dashboardState'),
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getOperationalShift: () => 'day',
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        setOvertimeUsers: list => { overtimeUsers.length = 0; overtimeUsers.push(...list); },
        getAnnounceData: () => ({}),
        getLiveExceptions: () => ({}),
        getDayOffReservations: () => ({}),
        getStatusMessageId: () => null,
        setStatusMessageId: () => {},
        getLastSavedAt: () => null,
        getLastBackupAt: () => null,
        getPanelInfo: () => ({ day: { cId: 'd', mId: null }, night: { cId: 'n', mId: null } }),
        setPanelMessageId: () => {},
        removeOvertimeUser: () => {},
        saveSystemAsync: async () => {},
        updateWorkingRole: async () => {},
        dayOffService: {},
        ensureUserData: () => null,
        determineShift: () => 'day',
        getDayOffLogicalDateForShift: () => '2026-01-01',
        buildShiftBoundsForBusinessDate: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getDashboardName: () => 'x',
        collectStatusTransitionWarnings: () => [],
        isAssignedWorker: () => false,
        hasManagedAttendanceRole: () => false,
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
        getTimeLogicRecentMaintenanceEnd: () => null,
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
        formatDuration: mins => `${mins}m`,
        formatKoreanDateTime: () => '',
        RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
        mapRawClockInStatus: () => 'IN',
        mapRawClockOutStatus: () => 'OUT',
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

    assert.ok(runtime.clock);
    assert.ok(runtime.voice);
    assert.strictEqual(typeof runtime.clock.handleClockIn, 'function');
    assert.strictEqual(typeof runtime.voice.syncVoiceStates, 'function');

    console.log('workflow-phase3 tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});

function clockDepsClient() {
    return {
        guilds: { cache: { get: () => ({ members: { cache: new Map() }, voiceStates: { cache: new Map() } }) } },
        channels: { cache: { get: () => null }, fetch: async () => null }
    };
}
