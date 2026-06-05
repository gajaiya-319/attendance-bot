'use strict';

const deps = require('./appDependencies');

function createSlashCommands(ctx) {
    const {
        workflowApi,
        botState,
        saveSystemAsync,
        createBackupSnapshot,
        listBackupSnapshots,
        restoreBackupSnapshot,
        ownerOnlyReply,
        failText,
        pendingText,
        okText,
        determineShift,
        ensureUserData,
        safeAddFields,
        updateWorkingRole,
        google,
        opsQueueService,
        maintenanceOverrideService,
        services,
        CONFIG,
        MessageFlags,
        PermissionFlagsBits,
        EmbedBuilder
    } = ctx;

    const {
        createMyInfoCommand,
        createDiagnosticsCommand,
        createOpsCheckCommand,
        createPayrollArchiveCommand,
        createBackupCommands,
        createAuditCommands,
        createAnnouncementCommands,
        createDayOffReadCommands,
        createDayOffMutationCommands,
        createForceAttendanceCommands,
        createUserAdminCommands,
        createOpsQueueCommands,
        createOpsSafetyCommands,
        createPayrollAuditCommand,
        createMaintenanceCommands
    } = deps;

    const {
        adminService,
        dayOffService,
        isOwnerId,
        canManageAnnouncements,
        payrollOperationLogService,
        purchaseSheetService
    } = services;

    const myInfoCommand = createMyInfoCommand({
        EmbedBuilder,
        MessageFlags,
        safeAddFields,
        getAttendanceData: () => botState.attendanceData
    });

    const diagnosticsCommand = createDiagnosticsCommand({
        MessageFlags,
        buildDiagnosticsEmbed: (...args) => workflowApi.buildDiagnosticsEmbed(...args),
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator))
    });

    const opsCheckCommand = createOpsCheckCommand({
        MessageFlags,
        buildOpsCheckEmbed: (...args) => workflowApi.buildOpsCheckEmbed(...args),
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator))
    });

    const payrollArchiveService = services.payrollArchiveService;

    const payrollArchiveCommand = createPayrollArchiveCommand({
        MessageFlags,
        payrollArchiveService,
        payrollOperationLogService: services.payrollOperationLogService,
        isOwner: id => isOwnerId(id)
    });

    const backupCommands = createBackupCommands({
        MessageFlags,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)),
        isOwner: id => isOwnerId(id),
        ownerOnlyReply,
        saveSystem: saveSystemAsync,
        createBackupSnapshot,
        listBackupSnapshots,
        restoreBackupSnapshot,
        renderDashboard: options => workflowApi.queueDashboardRender(options)
    });

    const auditCommands = createAuditCommands({
        MessageFlags,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)),
        buildPermissionCheckEmbed: (...args) => workflowApi.buildPermissionCheckEmbed(...args),
        buildDataAuditEmbed: (...args) => workflowApi.buildDataAuditEmbed(...args),
        buildStatusAuditEmbed: (...args) => workflowApi.buildStatusAuditEmbed(...args),
        buildStatusTraceEmbed: (...args) => workflowApi.buildStatusTraceEmbed(...args),
        buildTimeAuditEmbed: (...args) => workflowApi.buildTimeAuditEmbed(...args)
    });

    const announcementCommands = createAnnouncementCommands({
        MessageFlags,
        canRun: member => canManageAnnouncements(member),
        getAnnounceData: () => botState.announceData,
        saveSystem: saveSystemAsync,
        formatAnnouncementList: () => adminService.formatAnnouncementList()
    });

    const dayOffReadCommands = createDayOffReadCommands({
        MessageFlags,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)),
        buildDayOffLogEmbed: (...args) => workflowApi.buildDayOffLogEmbed(...args),
        buildDayOffListEmbed: status => dayOffService.buildDayOffListEmbed(status)
    });

    const dayOffMutationCommands = createDayOffMutationCommands({
        MessageFlags,
        canAdmin: interaction => Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)),
        canManageDayOff: interaction => Boolean(
            interaction.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
            interaction.user?.id === CONFIG.DAYOFF_REVIEWER_ID ||
            isOwnerId(interaction.user?.id)
        ),
        parseDayOffCommandDate: value => dayOffService.parseDayOffCommandDate(value),
        approveDayOffReservation: (target, leaveDate, moderator) => workflowApi.approveDayOffReservationByCommand(target, leaveDate, moderator),
        cancelDayOffReservation: (target, leaveDate, moderator) => workflowApi.cancelDayOffReservationByCommand(target, leaveDate, moderator),
        cancelOnlyDayOffReservation: (target, moderator) => workflowApi.cancelOnlyDayOffReservationByCommand(target, moderator),
        rejectDayOffReservation: (target, leaveDate, moderator, reason) => workflowApi.rejectDayOffReservationByCommand(target, leaveDate, moderator, reason),
        renderDashboard: () => workflowApi.queueDashboardRender()
    });

    const forceAttendanceCommands = createForceAttendanceCommands({
        MessageFlags,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)),
        determineShift,
        ensureUserData,
        getShiftBounds: ctx.getShiftBounds,
        handleClockIn: (...args) => workflowApi.handleClockIn(...args),
        handleClockOut: (...args) => workflowApi.handleClockOut(...args),
        applyDayOffState: (...args) => workflowApi.applyDayOffState(...args),
        applyOvertimeState: (...args) => workflowApi.applyOvertimeState(...args),
        removeOvertimeUser: id => {
            botState.overtimeUsers = botState.overtimeUsers.filter(o => o.id !== id);
        },
        updateWorkingRole,
        recordLog: (...args) => workflowApi.recordLog(...args),
        writeAdminActionLog: (...args) => workflowApi.writeAdminActionLog(...args),
        saveSystem: () => saveSystemAsync(),
        renderDashboard: options => workflowApi.queueDashboardRender(options)
    });

    const userAdminCommands = createUserAdminCommands({
        MessageFlags,
        canAdmin: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator)),
        canManageRoles: member => canManageAnnouncements(member),
        isOwner: id => isOwnerId(id),
        ownerOnlyReply,
        failText,
        pendingText,
        okText,
        determineShift,
        ensureUserData,
        applyManualAdjustment: (user, field, value) => adminService.applyManualAdjustment(user, field, value),
        normalizeManualAdjustmentState: (...args) => workflowApi.normalizeManualAdjustmentState(...args),
        createBackupSnapshot,
        deleteUserData: id => {
            delete botState.attendanceData[id];
        },
        removeOvertimeUser: id => {
            botState.overtimeUsers = botState.overtimeUsers.filter(o => o.id !== id);
        },
        resetAllState: () => {
            botState.attendanceData = {};
            botState.overtimeUsers = [];
            botState.liveExceptions = {};
        },
        updateWorkingRole,
        applyFinishedState: (...args) => workflowApi.applyFinishedState(...args),
        syncWorkingRoles: (...args) => workflowApi.syncWorkingRoles(...args),
        writeAdminActionLog: (...args) => workflowApi.writeAdminActionLog(...args),
        saveSystem: () => saveSystemAsync(),
        renderDashboard: options => workflowApi.queueDashboardRender(options),
        roleIds: [CONFIG.ROLES.DAY, CONFIG.ROLES.NIGHT, CONFIG.ROLES.HEINE, CONFIG.ROLES.PAAGRIO, CONFIG.ROLES.WORKING].filter(Boolean)
    });

    const opsQueueCommands = createOpsQueueCommands({
        MessageFlags,
        CONFIG,
        opsQueueService,
        purchaseSheetService,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || isOwnerId(member?.id || member?.user?.id))
    });

    const opsSafetyCommands = createOpsSafetyCommands({
        MessageFlags,
        CONFIG,
        moment: ctx.moment,
        readRows: () => services.rawAttendanceSheetService.readRows?.(),
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || isOwnerId(member?.id || member?.user?.id))
    });

    const payrollAuditCommand = createPayrollAuditCommand({
        MessageFlags,
        opsQueueService,
        payrollOperationLogService,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || isOwnerId(member?.id || member?.user?.id))
    });

    const maintenanceCommands = createMaintenanceCommands({
        MessageFlags,
        maintenanceOverrideService,
        canRun: member => Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || isOwnerId(member?.id || member?.user?.id)),
        renderDashboard: options => workflowApi.queueDashboardRender(options),
        syncVoiceStates: (...args) => workflowApi.syncVoiceStates(...args)
    });

    return {
        myInfoCommand,
        diagnosticsCommand,
        opsCheckCommand,
        payrollArchiveService,
        payrollArchiveCommand,
        backupCommands,
        auditCommands,
        announcementCommands,
        dayOffReadCommands,
        dayOffMutationCommands,
        forceAttendanceCommands,
        userAdminCommands,
        opsQueueCommands,
        opsSafetyCommands,
        payrollAuditCommand,
        maintenanceCommands
    };
}

module.exports = { createSlashCommands };
