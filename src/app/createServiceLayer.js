'use strict';

const {
    createDashboardStateUtils,
    createAttendanceService,
    createRoleService,
    createRawAttendanceSheetService,
    createDayOffService,
    createDayOffRequestInteractionHandler,
    createAdminService,
    createPermissionUtils,
    createPayrollOperationLogService,
    createPurchaseSheetService,
    createPayrollLiveSummarySyncService,
    createPayrollArchiveService,
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
        getShiftBounds
    });

    const roleService = createRoleService({ CONFIG });

    const rawAttendanceSheetService = createRawAttendanceSheetService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
        webAppUrl: null,
        logger: console
    });

    function getWorkerProfileForRawSync(member) {
        return roleService.getWorkerRoleProfileFromMember(member) ||
            roleService.getWorkerRoleProfileFromNickname(member?.displayName || member?.user?.username);
    }

    async function syncCurrentWorkerProfile(member) {
        if (!member || member.user?.bot) return { ok: false, skipped: true, reason: 'missing-member' };
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

    async function syncCurrentWorkerProfiles(guild) {
        const members = Array.from(guild?.members?.cache?.values?.() || []);
        if (typeof rawAttendanceSheetService.syncWorkerProfiles === 'function') {
            const profiles = [];
            for (const member of members) {
                if (!member || member.user?.bot) continue;
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
            if (!member || member.user?.bot) continue;
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
        canManageAnnouncements
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
        canPostPanel: (member, user) => Boolean(
            member?.permissions?.has(PermissionFlagsBits.Administrator) ||
            user?.id === CONFIG.DAYOFF_REVIEWER_ID ||
            isOwnerId(user?.id)
        )
    });

    const payrollOperationLogService = createPayrollOperationLogService({ logger: console });

    const payrollArchiveService = createPayrollArchiveService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
        greatSpreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
        serverTabs: CONFIG.PURCHASE_SERVER_TABS,
        operationLog: payrollOperationLogService,
        logger: console
    });

    const payrollLiveSummarySyncService = createPayrollLiveSummarySyncService({
        client,
        CONFIG,
        logger: console
    });

    const purchaseSheetService = createPurchaseSheetService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
        serverTabs: CONFIG.PURCHASE_SERVER_TABS,
        sectionLabels: CONFIG.PURCHASE_SECTION_LABELS,
        sheetNameAliases: CONFIG.SHEET_NAME_ALIASES,
        operationLog: payrollOperationLogService
    });

    return {
        dashboardStateUtils,
        attendanceService,
        roleService,
        rawAttendanceSheetService,
        getWorkerProfileForRawSync,
        syncCurrentWorkerProfile,
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
        payrollOperationLogService,
        payrollArchiveService,
        payrollLiveSummarySyncService,
        purchaseSheetService
    };
}

module.exports = { createServiceLayer };
