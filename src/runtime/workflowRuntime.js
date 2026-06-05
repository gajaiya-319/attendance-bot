'use strict';

const { createClockWorkflow } = require('../workflows/clockWorkflow');
const { createNoticePanelWorkflow } = require('../workflows/noticePanelWorkflow');
const { createReportingWorkflow } = require('../workflows/reportingWorkflow');
const { createOpsMonitoringWorkflow } = require('../workflows/opsMonitoringWorkflow');
const { createAuditEmbedWorkflow } = require('../workflows/auditEmbedWorkflow');
const { createAdminAuditLog } = require('../workflows/adminAuditLog');
const { createDayOffWorkflow } = require('../workflows/dayOffWorkflow');
const { createDashboardWorkflow } = require('../workflows/dashboardWorkflow');
const { createVoiceSyncWorkflow } = require('../workflows/voiceSyncWorkflow');
const { createMembershipWorkflow } = require('../workflows/membershipWorkflow');
const { createScheduledJobsWorkflow } = require('../workflows/scheduledJobsWorkflow');

function createWorkflowRuntime(deps) {
    let syncVoiceStatesRef = async () => {};
    let getActiveLiveExceptionRef = () => null;
    let getRankingWorkerShiftRef = () => null;
    let getActiveApprovedDayOffReservationRef = () => null;
    let applyApprovedDayOffReservationRef = async () => false;

    const clock = createClockWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        attendanceService: deps.attendanceService,
        roleService: deps.roleService,
        rawAttendanceSheetService: deps.rawAttendanceSheetService,
        dashboardStateUtils: deps.dashboardStateUtils,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        setOvertimeUsers: deps.setOvertimeUsers,
        saveSystemAsync: deps.saveSystemAsync,
        updateWorkingRole: deps.updateWorkingRole,
        ensureUserData: deps.ensureUserData,
        getActiveLiveException: (...args) => getActiveLiveExceptionRef(...args),
        getOperationalShift: deps.getOperationalShift,
        getDashboardShift: deps.getDashboardShift,
        getShiftBounds: deps.getShiftBounds,
        getShiftSessionKey: deps.getShiftSessionKey,
        getRecognizedClockInMoment: deps.getRecognizedClockInMoment,
        isWithinPreShiftWindow: deps.isWithinPreShiftWindow,
        getTimeLogicRecentMaintenanceEnd: deps.getTimeLogicRecentMaintenanceEnd,
        formatDuration: deps.formatDuration,
        RAW_ATTENDANCE_STATUS: deps.RAW_ATTENDANCE_STATUS,
        mapRawClockInStatus: deps.mapRawClockInStatus,
        mapRawClockOutStatus: deps.mapRawClockOutStatus,
        logger: deps.logger
    });

    const dashboard = createDashboardWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        dashboardMessageService: deps.dashboardMessageService,
        dashboardStateUtils: deps.dashboardStateUtils,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        setOvertimeUsers: deps.setOvertimeUsers,
        getStatusMessageId: deps.getStatusMessageId,
        setStatusMessageId: deps.setStatusMessageId,
        saveSystemAsync: deps.saveSystemAsync,
        refreshGuildMembers: deps.refreshGuildMembers,
        syncVoiceStates: (...args) => syncVoiceStatesRef(...args),
        expireDayOffSessions: clock.expireDayOffSessions,
        isMaintenanceWindow: deps.isMaintenanceWindow,
        isWithinPreShiftWindow: deps.isWithinPreShiftWindow,
        getDashboardShift: deps.getDashboardShift,
        getShiftBounds: deps.getShiftBounds,
        getMemberShiftRole: clock.getMemberShiftRole,
        getActiveApprovedDayOffReservation: (...args) => getActiveApprovedDayOffReservationRef(...args),
        applyApprovedDayOffReservation: (...args) => applyApprovedDayOffReservationRef(...args),
        ensureUserData: deps.ensureUserData,
        determineShift: deps.determineShift,
        normalizeCurrentShiftSession: clock.normalizeCurrentShiftSession,
        handleClockOut: clock.handleClockOut,
        transitionRecordedStatus: clock.transitionRecordedStatus,
        isOvertimeEntryStillValid: clock.isOvertimeEntryStillValid,
        getRankingWorkerShift: (...args) => getRankingWorkerShiftRef(...args),
        getDashboardName: deps.getDashboardName,
        applyCurrentShiftLiveOnState: clock.applyCurrentShiftLiveOnState,
        applyLiveOnState: clock.applyLiveOnState,
        getLiveExceptions: deps.getLiveExceptions,
        isAssignedWorker: deps.isAssignedWorker,
        safeAddFields: deps.safeAddFields,
        renderDashboardHeader: deps.renderDashboardHeader,
        renderSummaryBox: deps.renderSummaryBox,
        renderCleanGrid: deps.renderCleanGrid,
        renderStatusList: deps.renderStatusList,
        renderOvertimeList: deps.renderOvertimeList,
        formatDuration: deps.formatDuration,
        logger: deps.logger
    });

    getActiveLiveExceptionRef = dashboard.getActiveLiveException;

    const voice = createVoiceSyncWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        saveSystemAsync: deps.saveSystemAsync,
        refreshGuildMembers: deps.refreshGuildMembers,
        determineShift: deps.determineShift,
        ensureUserData: deps.ensureUserData,
        getMemberShiftRole: clock.getMemberShiftRole,
        getActiveLiveException: dashboard.getActiveLiveException,
        formatDuration: deps.formatDuration,
        getShiftBounds: deps.getShiftBounds,
        getScheduledEndMoment: clock.getScheduledEndMoment,
        isMaintenanceWindow: deps.isMaintenanceWindow,
        isWithinPreShiftWindow: deps.isWithinPreShiftWindow,
        isCurrentShiftRegularWorker: clock.isCurrentShiftRegularWorker,
        canStartPostShiftOvertime: clock.canStartPostShiftOvertime,
        getRestorableOvertimeSession: clock.getRestorableOvertimeSession,
        appendAttendanceEvent: clock.appendAttendanceEvent,
        transitionRecordedStatus: clock.transitionRecordedStatus,
        setFinishedPresence: clock.setFinishedPresence,
        handleClockOut: clock.handleClockOut,
        applyDisconnectedState: clock.applyDisconnectedState,
        recordLog: clock.recordLog,
        getActiveApprovedDayOffReservation: (...args) => getActiveApprovedDayOffReservationRef(...args),
        clearStaleDayOffState: clock.clearStaleDayOffState,
        applyLiveExceptionState: clock.applyLiveExceptionState,
        handleClockIn: clock.handleClockIn,
        activatePendingManualOvertime: clock.activatePendingManualOvertime,
        restoreOvertimeAfterFinish: clock.restoreOvertimeAfterFinish,
        notifyDayOffPresence: clock.notifyDayOffPresence,
        notifyAfterFinishPresence: clock.notifyAfterFinishPresence,
        notifyFinishedReturnToVoice: clock.notifyFinishedReturnToVoice,
        notifyStandbyClockInRequired: clock.notifyStandbyClockInRequired,
        startPostShiftOvertime: clock.startPostShiftOvertime,
        recordLiveConfirmation: clock.recordLiveConfirmation,
        recordLiveRecovery: clock.recordLiveRecovery,
        markLiveOffState: clock.markLiveOffState,
        clearLiveOffState: clock.clearLiveOffState,
        isFinishedBeforeCurrentShift: clock.isFinishedBeforeCurrentShift,
        applyLiveOnState: clock.applyLiveOnState,
        updateWorkingRole: deps.updateWorkingRole,
        canStartOvertimeNow: clock.canStartOvertimeNow,
        startAttendanceSession: clock.startAttendanceSession,
        logger: deps.logger
    });

    syncVoiceStatesRef = voice.syncVoiceStates;

    const dayOff = createDayOffWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        dayOffService: deps.dayOffService,
        roleService: deps.roleService,
        getDayOffReservations: deps.getDayOffReservations,
        getAttendanceData: deps.getAttendanceData,
        removeOvertimeUser: deps.removeOvertimeUser,
        saveSystemAsync: deps.saveSystemAsync,
        ensureUserData: deps.ensureUserData,
        applyDayOffState: clock.applyDayOffState,
        clearDayOffReservationState: clock.clearDayOffReservationState,
        appendAttendanceEvent: clock.appendAttendanceEvent,
        updateWorkingRole: deps.updateWorkingRole,
        queueDashboardRender: dashboard.queueDashboardRender,
        getDayOffLogicalDateForShift: deps.getDayOffLogicalDateForShift,
        buildShiftBoundsForBusinessDate: deps.buildShiftBoundsForBusinessDate,
        getShiftBounds: deps.getShiftBounds,
        getDayOffPanelPayload: deps.getDayOffPanelPayload,
        DAY_OFF_REQUEST_CUSTOM_IDS: deps.DAY_OFF_REQUEST_CUSTOM_IDS,
        reactionCleanupLocks: deps.reactionCleanupLocks,
        logger: deps.logger
    });

    getActiveApprovedDayOffReservationRef = dayOff.getActiveApprovedDayOffReservation;
    applyApprovedDayOffReservationRef = dayOff.applyApprovedDayOffReservation;

    const adminAuditLog = createAdminAuditLog({
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        fs: deps.fs,
        client: deps.client,
        getAttendanceData: deps.getAttendanceData,
        appendAttendanceEvent: clock.appendAttendanceEvent,
        writeDayOffLog: text => dayOff.writeDayOffLog(text)
    });

    const membership = createMembershipWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        setOvertimeUsers: deps.setOvertimeUsers,
        saveSystemAsync: deps.saveSystemAsync,
        refreshGuildMembers: deps.refreshGuildMembers,
        updateWorkingRole: deps.updateWorkingRole,
        ensureUserData: deps.ensureUserData,
        determineShift: deps.determineShift,
        getMemberShiftRole: clock.getMemberShiftRole,
        isAssignedWorker: deps.isAssignedWorker,
        hasManagedAttendanceRole: deps.hasManagedAttendanceRole,
        roleService: deps.roleService,
        getWorkerProfileForRawSync: deps.getWorkerProfileForRawSync,
        getLiveExceptions: deps.getLiveExceptions,
        isOwnerId: deps.isOwnerId,
        writeDayOffLog: text => dayOff.writeDayOffLog(text),
        PermissionFlagsBits: deps.PermissionFlagsBits,
        logger: deps.logger
    });

    const scheduled = createScheduledJobsWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        setOvertimeUsers: deps.setOvertimeUsers,
        getLiveExceptions: deps.getLiveExceptions,
        getAnnounceData: deps.getAnnounceData,
        saveSystemAsync: deps.saveSystemAsync,
        recordLog: clock.recordLog,
        handleClockIn: clock.handleClockIn,
        handleClockOut: clock.handleClockOut,
        transitionRecordedStatus: clock.transitionRecordedStatus,
        updateWorkingRole: deps.updateWorkingRole,
        getScheduledEndMoment: clock.getScheduledEndMoment,
        getShiftBounds: deps.getShiftBounds,
        getActiveLiveException: dashboard.getActiveLiveException,
        isMaintenanceWindow: deps.isMaintenanceWindow,
        isCurrentShiftRegularWorker: clock.isCurrentShiftRegularWorker,
        getOvertimeStartMoment: clock.getOvertimeStartMoment,
        addOvertimeUser: (user, type, startedAt) => {
            const add = deps.attendanceService?.addOvertimeUser;
            return typeof add === 'function' ? add.call(deps.attendanceService, user, type, startedAt) : false;
        },
        determineShift: deps.determineShift,
        ensureUserData: deps.ensureUserData,
        getOpenSession: clock.getOpenSession,
        startAttendanceSession: clock.startAttendanceSession,
        formatDuration: deps.formatDuration,
        formatKoreanDateTime: deps.formatKoreanDateTime,
        renderDashboardCore: dashboard.renderDashboardCore,
        logger: deps.logger
    });

    const ops = createOpsMonitoringWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        padWidth: deps.padWidth,
        truncateWidth: deps.truncateWidth,
        renderEmbedCodeBlock: deps.renderEmbedCodeBlock,
        safeAddFields: deps.safeAddFields,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        getDayOffReservations: deps.getDayOffReservations,
        getDashboardName: deps.getDashboardName,
        getActiveLiveException: dashboard.getActiveLiveException,
        getMemberShiftRole: clock.getMemberShiftRole,
        getOperationalShift: deps.getOperationalShift,
        opsQueueService: deps.opsQueueService,
        purchaseSheetService: deps.purchaseSheetService,
        retryQueuedItem: deps.retryQueuedItem,
        alertState: deps.alertState,
        logger: deps.logger
    });

    const audit = createAuditEmbedWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        PermissionFlagsBits: deps.PermissionFlagsBits,
        padWidth: deps.padWidth,
        truncateWidth: deps.truncateWidth,
        renderEmbedCodeBlock: deps.renderEmbedCodeBlock,
        safeAddFields: deps.safeAddFields,
        refreshGuildMembers: deps.refreshGuildMembers,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        getAnnounceData: deps.getAnnounceData,
        getDayOffReservations: deps.getDayOffReservations,
        getStatusMessageId: deps.getStatusMessageId,
        getLastSavedAt: deps.getLastSavedAt,
        getLastBackupAt: deps.getLastBackupAt,
        dashboardStateUtils: deps.dashboardStateUtils,
        collectStatusTransitionWarnings: deps.collectStatusTransitionWarnings,
        collectDataAuditIssues: ops.collectDataAuditIssues,
        collectOperationalIssues: ops.collectOperationalIssues,
        formatOperationalIssueRows: ops.formatOperationalIssueRows,
        getDashboardName: deps.getDashboardName,
        isAssignedWorker: deps.isAssignedWorker,
        hasManagedAttendanceRole: deps.hasManagedAttendanceRole,
        ensureUserData: deps.ensureUserData,
        determineShift: deps.determineShift,
        transitionRecordedStatus: clock.transitionRecordedStatus,
        createBackupSnapshot: deps.createBackupSnapshot,
        saveSystemAsync: deps.saveSystemAsync,
        queueDashboardRender: dashboard.queueDashboardRender,
        writeAdminActionLog: adminAuditLog.writeAdminActionLog,
        readAdminAudit: adminAuditLog.readAdminAudit,
        readDayOffLog: dayOff.readDayOffLog,
        getRuntimeHealthSnapshot: deps.getRuntimeHealthSnapshot,
        getStartupBuildInfo: deps.getStartupBuildInfo,
        readRuntimeHealthFile: deps.readRuntimeHealthFile,
        buildCommandDefinitions: deps.buildCommandDefinitions,
        hiddenCommandAliases: deps.hiddenCommandAliases,
        validateCommandPayloads: deps.validateCommandPayloads,
        getOperationalShift: deps.getOperationalShift,
        getDashboardShift: deps.getDashboardShift,
        getShiftBounds: deps.getShiftBounds,
        getActiveMaintenanceWindow: deps.getActiveMaintenanceWindow,
        isMaintenanceWindow: deps.isMaintenanceWindow,
        isWithinPreShiftWindow: deps.isWithinPreShiftWindow,
        maintenanceOverrideService: deps.maintenanceOverrideService,
        guildId: deps.CONFIG.GUILD_ID,
        logger: deps.logger
    });

    const reporting = createReportingWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        padWidth: deps.padWidth,
        truncateWidth: deps.truncateWidth,
        formatExactWidth: deps.formatExactWidth,
        renderEmbedCodeBlock: deps.renderEmbedCodeBlock,
        safeAddFields: deps.safeAddFields,
        refreshGuildMembers: deps.refreshGuildMembers,
        getDashboardShift: deps.getDashboardShift,
        getShiftBounds: deps.getShiftBounds,
        getDayNightWorkerStats: dashboard.getDayNightWorkerStats,
        getDayNightWorkerOvertimeUsers: dashboard.getDayNightWorkerOvertimeUsers,
        getAttendanceData: deps.getAttendanceData,
        getOvertimeUsers: deps.getOvertimeUsers,
        renderPercentBar: deps.renderPercentBar,
        renderReportTopRow: deps.renderReportTopRow,
        renderReportStatsLegend: deps.renderReportStatsLegend,
        renderReportMetricRow: deps.renderReportMetricRow,
        renderReportMetricHeader: deps.renderReportMetricHeader,
        renderSessionMetricRow: deps.renderSessionMetricRow,
        formatDuration: deps.formatDuration,
        isOwnerId: deps.isOwnerId,
        PermissionFlagsBits: deps.PermissionFlagsBits,
        logger: deps.logger
    });

    getRankingWorkerShiftRef = reporting.getRankingWorkerShift;

    const notice = createNoticePanelWorkflow({
        client: deps.client,
        CONFIG: deps.CONFIG,
        moment: deps.moment,
        EmbedBuilder: deps.EmbedBuilder,
        ActionRowBuilder: deps.ActionRowBuilder,
        ButtonBuilder: deps.ButtonBuilder,
        ButtonStyle: deps.ButtonStyle,
        padWidth: deps.padWidth,
        getPanelInfo: deps.getPanelInfo,
        setPanelMessageId: deps.setPanelMessageId,
        saveSystemAsync: deps.saveSystemAsync,
        logger: deps.logger
    });

    return {
        clock,
        dashboard,
        voice,
        membership,
        scheduled,
        adminAuditLog,
        dayOff,
        ops,
        audit,
        reporting,
        notice
    };
}

module.exports = {
    createWorkflowRuntime
};
