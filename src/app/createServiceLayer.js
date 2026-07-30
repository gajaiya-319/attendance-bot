'use strict';

const {
    createDashboardStateUtils,
    createAttendanceService,
    createRoleService,
    createRawAttendanceSheetService,
    createBackgroundJobQueueService,
    createDayOffService,
    createDayOffRequestInteractionHandler,
    createAdminService,
    createPermissionUtils,
    createPayrollOperationLogService,
    createPurchaseSheetService,
    createPayrollLiveSummarySyncService,
    createPayrollArchiveService,
    createPayrollIntegrityAuditService,
    createEndAdenaReconciliationService,
    createEndAdenaFreshnessService,
    createEndAdenaSubmissionValidationService,
    createAttendanceEventLedger,
    createAttendanceAutoRepairService,
    createSelfHealingSupervisorService,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    PermissionFlagsBits
} = require('./appDependencies');
const { isExcludedUserId } = require('../utils/excludedUsers');

function createServiceLayer(ctx) {
    const {
        workflowApi,
        botState,
        CONFIG,
        client = null,
        moment,
        google,
        determineShift,
        getShiftBounds,
        getShiftSessionKey,
        isWithinPreShiftWindow,
        padWidth,
        truncateWidth
    } = ctx;

    const backgroundJobQueueService = createBackgroundJobQueueService({
        logger: console,
        onStats: stats => botState.writeRuntimeHealthFile('running', { backgroundQueue: stats })
    });

    const selfHealingSupervisorService = createSelfHealingSupervisorService({
        logger: console
    });

    const dashboardStateUtils = createDashboardStateUtils({
        CONFIG,
        moment,
        getScheduledEndMoment: (...args) => workflowApi.getScheduledEndMoment(...args),
        getRecentMaintenanceEnd: (...args) => workflowApi.getRecentMaintenanceEnd(...args),
        isWithinPreShiftWindow,
        getMemberShiftRole: (...args) => workflowApi.getMemberShiftRole(...args),
        getActiveLiveException: (...args) => workflowApi.getActiveLiveException(...args),
        getOvertimeUsers: () => botState.overtimeUsers
    });

    const attendanceService = createAttendanceService({
        CONFIG,
        moment,
        getAttendanceData: () => botState.attendanceData,
        getOvertimeUsers: () => botState.overtimeUsers,
        determineShift,
        getShiftSessionKey,
        getShiftBounds,
        appendSystemEvent: event => botState.attendanceEventLedger.append(event)
    });

    botState.attendanceEventLedger = createAttendanceEventLedger({
        state: botState,
        moment,
        timezone: CONFIG.TIMEZONE,
        maxEvents: CONFIG.ATTENDANCE_EVENT_LOG_MAX || 10000
    });

    const attendanceAutoRepairService = createAttendanceAutoRepairService({
        state: botState,
        CONFIG,
        moment,
        logger: console
    });

    const roleService = createRoleService({ CONFIG });

    const rawAttendanceSheetService = createRawAttendanceSheetService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
        webAppUrl: null,
        pendingFilePath: './logs/raw-attendance-pending.json',
        repairAuditFilePath: './logs/raw-attendance-repair.jsonl',
        logger: console
    });

    function getWorkerProfileForRawSync(member) {
        return roleService.getWorkerRoleProfileFromMember(member);
    }

    async function syncCurrentWorkerProfile(member) {
        if (!member || member.user?.bot) return { ok: false, skipped: true, reason: 'missing-member' };
        if (isExcludedUserId(CONFIG, member)) return { ok: false, skipped: true, reason: 'excluded-user' };
        const name = roleService.getWorkerNicknameBase(member.displayName || member.user?.username || 'Unknown');
        const profile = getWorkerProfileForRawSync(member);
        if (!profile) {
            return rawAttendanceSheetService.removeWorkerProfile({ name });
        }

        return rawAttendanceSheetService.sendWorkerProfile({
            name,
            server: profile.server,
            shift: profile.shift
        });
    }

    async function removeCurrentWorkerProfile(member) {
        if (!member || member.user?.bot) return { ok: false, skipped: true, reason: 'missing-member' };
        if (isExcludedUserId(CONFIG, member)) return { ok: false, skipped: true, reason: 'excluded-user' };
        const name = roleService.getWorkerNicknameBase(member.displayName || member.user?.username || 'Unknown');
        return rawAttendanceSheetService.removeWorkerProfile({ name });
    }

    async function syncCurrentWorkerProfiles(guild) {
        const members = Array.from(guild?.members?.cache?.values?.() || []);
        if (typeof rawAttendanceSheetService.syncWorkerProfiles === 'function') {
            const profiles = [];
            for (const member of members) {
                if (!member || member.user?.bot || isExcludedUserId(CONFIG, member)) continue;
                const profile = getWorkerProfileForRawSync(member);
                if (!profile) continue;
                profiles.push({
                    name: roleService.getWorkerNicknameBase(member.displayName || member.user?.username || 'Unknown'),
                    server: profile.server,
                    shift: profile.shift
                });
            }
            const result = await rawAttendanceSheetService.syncWorkerProfiles(profiles);
            const count = result?.count ?? profiles.length;
            console.log(`[RAW ATTENDANCE PROFILE SYNC] ${count} current worker profile(s) synced.`);
            return count;
        }

        let synced = 0;
        for (const member of members) {
            if (!member || member.user?.bot || isExcludedUserId(CONFIG, member)) continue;
            const profile = getWorkerProfileForRawSync(member);
            if (!profile) continue;
            const result = await syncCurrentWorkerProfile(member);
            if (result?.ok) synced += 1;
        }
        console.log(`[RAW ATTENDANCE PROFILE SYNC] ${synced} current worker profile(s) synced.`);
        return synced;
    }

    const dayOffService = createDayOffService({
        CONFIG,
        moment,
        EmbedBuilder,
        padWidth,
        truncateWidth,
        getReservations: () => botState.dayOffReservations
    });

    const adminService = createAdminService({
        getAnnounceData: () => botState.announceData,
        truncateWidth
    });

    const {
        isOwnerId,
        hasWorkerServerRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        canManageLiveException,
        canManageAnnouncements,
        canRunOperationalCommand,
        canManageDayOff,
        canReviewEndAdena
    } = createPermissionUtils({ CONFIG, PermissionFlagsBits });

    const dayOffRequestInteractions = createDayOffRequestInteractionHandler({
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        EmbedBuilder,
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle,
        MessageFlags,
        CONFIG,
        dayOffService,
        submitDayOffRequest: (...args) => workflowApi.submitDayOffRequestFromInteraction(...args),
        canPostPanel: (member, user) => canManageDayOff(member, user?.id)
    });

    const payrollOperationLogService = createPayrollOperationLogService({ logger: console });

    const payrollArchiveService = createPayrollArchiveService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
        greatSpreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
        serverTabs: CONFIG.PURCHASE_SERVER_TABS,
        serverSheetIds: CONFIG.PURCHASE_SERVER_SHEET_IDS,
        operationLog: payrollOperationLogService,
        logger: console
    });

    const payrollLiveSummarySyncService = createPayrollLiveSummarySyncService({
        client,
        CONFIG,
        logger: console
    });

    const payrollIntegrityAuditService = createPayrollIntegrityAuditService({
        payrollOperationLogService,
        auditRunner: options => require('../../scripts/audit-payroll-rawdata-vs-great').runPayrollRawAudit(options),
        client,
        CONFIG,
        logger: console
    });

    const purchaseSheetService = createPurchaseSheetService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
        serverTabs: CONFIG.PURCHASE_SERVER_TABS,
        serverSheetIds: CONFIG.PURCHASE_SERVER_SHEET_IDS,
        sectionLabels: CONFIG.PURCHASE_SECTION_LABELS,
        sheetNameAliases: CONFIG.SHEET_NAME_ALIASES,
        operationLog: payrollOperationLogService
    });

    const endAdenaReconciliationService = createEndAdenaReconciliationService({
        CONFIG,
        moment,
        client,
        getAttendanceData: () => botState.attendanceData,
        payrollOperationLogService,
        purchaseSheetService,
        refreshGuildMembers: (guild, options) => botState.refreshGuildMembers(guild, options),
        logger: console
    });

    const endAdenaSubmissionValidationService = createEndAdenaSubmissionValidationService({
        CONFIG,
        moment,
        getShiftBounds,
        getAttendanceData: () => botState.attendanceData,
        purchaseSheetService,
        payrollOperationLogService,
        logger: console
    });

    const endAdenaFreshnessService = createEndAdenaFreshnessService({
        CONFIG,
        moment,
        getShiftBounds,
        payrollOperationLogService,
        endAdenaReconciliationService,
        client,
        logger: console
    });

    return {
        dashboardStateUtils,
        attendanceService,
        roleService,
        rawAttendanceSheetService,
        getWorkerProfileForRawSync,
        syncCurrentWorkerProfile,
        removeCurrentWorkerProfile,
        syncCurrentWorkerProfiles,
        dayOffService,
        dayOffRequestInteractions,
        adminService,
        isOwnerId,
        hasWorkerServerRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        canManageLiveException,
        canManageAnnouncements,
        canRunOperationalCommand,
        canManageDayOff,
        canReviewEndAdena,
        payrollOperationLogService,
        payrollArchiveService,
        payrollLiveSummarySyncService,
        payrollIntegrityAuditService,
        purchaseSheetService,
        endAdenaSubmissionValidationService,
        endAdenaReconciliationService,
        endAdenaFreshnessService,
        attendanceAutoRepairService,
        backgroundJobQueueService,
        selfHealingSupervisorService
    };
}

module.exports = { createServiceLayer };
