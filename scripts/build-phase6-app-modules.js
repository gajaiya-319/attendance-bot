'use strict';

const fs = require('fs');
const path = require('path');

function indent(text, spaces) {
    const pad = ' '.repeat(spaces);
    return text.replace(/^/gm, pad);
}

function stateRefs(text) {
    return text
        .replace(/\(\) => attendanceData\b/g, '() => botState.attendanceData')
        .replace(/\battendanceData\[/g, 'botState.attendanceData[')
        .replace(/\battendanceData =/g, 'botState.attendanceData =')
        .replace(/\bdelete attendanceData/g, 'delete botState.attendanceData')
        .replace(/\bovertimeUsers =/g, 'botState.overtimeUsers =')
        .replace(/\bovertimeUsers\.some/g, 'botState.overtimeUsers.some')
        .replace(/\bovertimeUsers\.filter/g, 'botState.overtimeUsers.filter')
        .replace(/\bliveExceptions\[/g, 'botState.liveExceptions[')
        .replace(/\bliveExceptions =/g, 'botState.liveExceptions =')
        .replace(/\(\) => announceData\b/g, '() => botState.announceData')
        .replace(/\bgetReservations: \(\) => dayOffReservations\b/g, 'getReservations: () => botState.dayOffReservations');
}

const root = path.join(__dirname, '..');
const appPath = path.join(root, 'src/app/createAttendanceBotApp.js');
let body = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');

const fnStart = body.indexOf('function createAttendanceBotApp');
const bodyStart = body.indexOf('{', fnStart) + 1;
const loginIdx = body.indexOf('    function login() {');
body = body.slice(bodyStart, loginIdx);

const stateMarker = '/**\n * [ STATE & MUTEX ]';
const coreMarker = '/**\n * [ CORE HELPERS ]';
const dashMarker = '/**\n * [ DASHBOARD RENDERER ]';

const cmdStart = body.indexOf('const myInfoCommand = createMyInfoCommand');
const stateIdx = body.indexOf(stateMarker);
const coreIdx = body.indexOf(coreMarker);
const dashIdx = body.indexOf(dashMarker);
const dashUtilsIdx = body.indexOf('const dashboardStateUtils = createDashboardStateUtils');
const wireEnd = body.indexOf('wireWorkflowRuntime(workflowRuntime);') + 'wireWorkflowRuntime(workflowRuntime);'.length;

const commandsEarly = stateRefs(body.slice(cmdStart, stateIdx).trimEnd());
const stateOnly = body.slice(stateIdx, dashUtilsIdx).trimEnd();
const servicesBlock = stateRefs(body.slice(dashUtilsIdx, coreIdx).trimEnd());
const coreBlock = body.slice(body.indexOf('function cleanupOldDayOffReservations'), dashIdx).trimEnd()
    + '\n\n' + body.slice(coreIdx + coreMarker.length, body.indexOf('const DASHBOARD_LAYOUT_VERSION')).trimEnd();
const wireBlock = body.slice(body.indexOf('workflowRuntime = createWorkflowRuntime({'), wireEnd);
const wireInner = stateRefs(wireBlock
    .replace(/^workflowRuntime = createWorkflowRuntime\(\{\n/, '')
    .replace(/\n\}\);\nwireWorkflowRuntime\(workflowRuntime\);$/, ''));

const botStatePath = path.join(root, 'src/app/createBotState.js');
fs.writeFileSync(botStatePath, `'use strict';

const {
    createSystemStateBridge,
    createPersistenceRuntime,
    createStartupRuntime,
    dataStore
} = require('./appDependencies');

function createBotState(ctx) {
    const {
        CONFIG,
        maintenanceOverrideService,
        runtimeHealthService,
        crypto,
        fsSync,
        moment,
        projectRoot
    } = ctx;

${indent(stateOnly, 4)}

    async function saveSystemAsync() {
        return persistenceRuntime.saveSystemAsync();
    }
    async function createBackupSnapshot(reason = 'manual') {
        return persistenceRuntime.createBackupSnapshot(reason);
    }
    async function createScheduledBackupIfDue() {
        return persistenceRuntime.createScheduledBackupIfDue();
    }
    async function listBackupSnapshots() {
        return persistenceRuntime.listBackupSnapshots();
    }
    async function restoreBackupSnapshot(fileName = null) {
        return persistenceRuntime.restoreBackupSnapshot(fileName);
    }
    async function loadSystem() {
        return persistenceRuntime.loadSystem();
    }
    async function refreshGuildMembers(guild, options) {
        return persistenceRuntime.refreshGuildMembers(guild, options);
    }
    function getRuntimeHealthSnapshot(now) {
        return startupRuntime.getRuntimeHealthSnapshot(now);
    }
    async function writeRuntimeHealthFile(stage, extra = {}) {
        return startupRuntime.writeRuntimeHealthFile(stage, extra);
    }
    async function readRuntimeHealthFile(expectedCommandCount = 0) {
        return startupRuntime.readRuntimeHealthFile(expectedCommandCount);
    }
    function getStartupBuildInfo() {
        return startupRuntime.getStartupBuildInfo();
    }

    return {
        get attendanceData() { return attendanceData; },
        set attendanceData(v) { attendanceData = v; },
        get overtimeUsers() { return overtimeUsers; },
        set overtimeUsers(v) { overtimeUsers = v; },
        get statusMessageId() { return statusMessageId; },
        set statusMessageId(v) { statusMessageId = v; },
        get panelInfo() { return panelInfo; },
        get announceData() { return announceData; },
        get dayOffReservations() { return dayOffReservations; },
        get liveExceptions() { return liveExceptions; },
        set liveExceptions(v) { liveExceptions = v; },
        get lastSavedAt() { return lastSavedAt; },
        get lastBackupAt() { return lastBackupAt; },
        get lastCommandRegisterAt() { return lastCommandRegisterAt; },
        set lastCommandRegisterAt(v) { lastCommandRegisterAt = v; },
        get lastCommandRegisterCount() { return lastCommandRegisterCount; },
        set lastCommandRegisterCount(v) { lastCommandRegisterCount = v; },
        get lastCommandRegisterError() { return lastCommandRegisterError; },
        set lastCommandRegisterError(v) { lastCommandRegisterError = v; },
        get lastOperationalIssueSignature() { return lastOperationalIssueSignature; },
        set lastOperationalIssueSignature(v) { lastOperationalIssueSignature = v; },
        get lastOperationalIssueAlertAt() { return lastOperationalIssueAlertAt; },
        set lastOperationalIssueAlertAt(v) { lastOperationalIssueAlertAt = v; },
        get lastOpsQueueAutoRetryAt() { return lastOpsQueueAutoRetryAt; },
        set lastOpsQueueAutoRetryAt(v) { lastOpsQueueAutoRetryAt = v; },
        get lastOpsQueueStuckAlertAt() { return lastOpsQueueStuckAlertAt; },
        set lastOpsQueueStuckAlertAt(v) { lastOpsQueueStuckAlertAt = v; },
        get lastOpsQueueAutoResultSignature() { return lastOpsQueueAutoResultSignature; },
        set lastOpsQueueAutoResultSignature(v) { lastOpsQueueAutoResultSignature = v; },
        get lastOpsQueueAutoResultAlertAt() { return lastOpsQueueAutoResultAlertAt; },
        set lastOpsQueueAutoResultAlertAt(v) { lastOpsQueueAutoResultAlertAt = v; },
        systemStateBridge,
        persistenceRuntime,
        startupRuntime,
        saveSystemAsync,
        createBackupSnapshot,
        createScheduledBackupIfDue,
        listBackupSnapshots,
        restoreBackupSnapshot,
        loadSystem,
        refreshGuildMembers,
        getRuntimeHealthSnapshot,
        writeRuntimeHealthFile,
        readRuntimeHealthFile,
        getStartupBuildInfo
    };
}

module.exports = { createBotState };
`, 'utf8');

// Fix duplicate bridge in stateOnly - stateOnly already has systemStateBridge = ...
// Re-read stateOnly and remove duplicate from botState file if present

const corePath = path.join(root, 'src/app/createCoreHelpers.js');
const coreFixed = coreBlock
    .replace(/DASHBOARD_INSTANCE_TAG/g, 'instanceTag')
    .replace(/DASHBOARD_LAYOUT_VERSION/g, 'layoutVersion')
    .replace(/dayOffReservations/g, 'getDayOffReservations()');

fs.writeFileSync(corePath, `'use strict';

function createCoreHelpers(ctx) {
    const {
        CONFIG,
        moment,
        getOperationalShift,
        attendanceService,
        workflowApi,
        failText,
        MessageFlags,
        startupRuntime,
        getDayOffReservations,
        normalizeEmbedField,
        renderEmbedFieldValue,
        layoutVersion,
        instanceTag,
        botState
    } = ctx;

    function cleanupOldDayOffReservations(now = moment().tz(CONFIG.TIMEZONE)) {
        const cutoff = now.clone().subtract(14, 'days');
        let changed = false;
        for (const messageId of Object.keys(botState.dayOffReservations)) {
            const reservation = botState.dayOffReservations[messageId];
            if (!reservation?.leaveDate) continue;
            if (!moment(reservation.leaveDate, 'YYYY-MM-DD').isBefore(cutoff, 'day')) continue;
            delete botState.dayOffReservations[messageId];
            changed = true;
        }
        return changed;
    }

${indent(coreFixed.replace(/^function cleanupOldDayOffReservations[\s\S]*?^}\n\n/m, '').replace(/\battendanceData\[/g, 'botState.attendanceData['), 4)}

    return {
        cleanupOldDayOffReservations,
        printStartupBanner,
        safeAddFields,
        safeEmbedDescription,
        determineShift,
        ensureUserData,
        isCooldown,
        markMemberActivity,
        ownerOnlyReply,
        addOvertimeUser,
        updateWorkingRole
    };
}

module.exports = { createCoreHelpers };
`, 'utf8');

const cmdPath = path.join(root, 'src/app/createCommandRegistry.js');
fs.writeFileSync(cmdPath, `'use strict';

const deps = require('./appDependencies');

function createCommandRegistry(ctx) {
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
        updateWorkingRole,
        markMemberActivity,
        isCooldown,
        refreshGuildMembers,
        getShiftBounds,
        handleInteractionReplyError,
        withCommandStatusPayload,
        formatKoreanDateTime,
        JOKES,
        isWithinPreShiftWindow,
        getShiftSessionKey,
        google,
        opsQueueService,
        maintenanceOverrideService,
        rawAttendanceSheetService,
        roleService,
        padWidth,
        truncateWidth,
        createDashboardStateUtils,
        createAttendanceService,
        createRoleService,
        createDayOffService,
        createAdminService,
        createPermissionUtils,
        createPayrollOperationLogService,
        createPurchaseSheetService,
        CONFIG,
        moment,
        EmbedBuilder,
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle,
        MessageFlags,
        PermissionFlagsBits
    } = ctx;

    const {
        createMyInfoCommand,
        createDiagnosticsCommand,
        createOpsCheckCommand,
        createPayrollArchiveService,
        createPayrollArchiveCommand,
        createBackupCommands,
        createAuditCommands,
        createAnnouncementCommands,
        createDayOffReadCommands,
        createDayOffMutationCommands,
        createForceAttendanceCommands,
        createUserAdminCommands,
        createAutoDelete,
        patchCommandReplies,
        createCommandOptionHelpers,
        createChatInputCommandContext,
        createChatInputCommandHandler,
        createButtonInteractionContext,
        createButtonActionHandlers,
        createButtonInteractionHandler,
        createInteractionErrorHandler,
        createDayOffRequestInteractionHandler,
        createOpsQueueCommands,
        createOpsSafetyCommands,
        createPayrollAuditCommand,
        createMaintenanceCommands,
        createVoiceStateUpdateHandler,
        createGuildMemberEventHandlers
    } = deps;

${indent(commandsEarly, 4)}

${indent(servicesBlock, 4)}

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
        buttonInteractionContext,
        buttonActionHandlers,
        buttonInteractionHandler,
        interactionErrorHandler,
        chatInputCommandContext,
        chatInputCommandHandler,
        opsQueueCommands,
        opsSafetyCommands,
        payrollAuditCommand,
        maintenanceCommands,
        dayOffRequestInteractions,
        adminService,
        dayOffService,
        payrollOperationLogService,
        purchaseSheetService,
        voiceStateUpdateHandler,
        guildMemberEventHandlers,
        dashboardStateUtils,
        attendanceService,
        roleService,
        isOwnerId,
        hasWorkerServerRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        canManageLiveException,
        canManageAnnouncements,
        getWorkerProfileForRawSync,
        syncCurrentWorkerProfile,
        syncCurrentWorkerProfiles
    };
}

module.exports = { createCommandRegistry };
`, 'utf8');

const wirePath = path.join(root, 'src/app/wireWorkflowRuntime.js');
fs.writeFileSync(wirePath, `'use strict';

const { createWorkflowRuntime, retryQueuedItem, DAY_OFF_REQUEST_CUSTOM_IDS } = require('./appDependencies');

function wireWorkflowRuntimeForApp(ctx) {
    const { wireWorkflowRuntime, botState, commands, dayOffReactionCleanupLocks, dayOffRequestInteractions } = ctx;

    const workflowRuntime = createWorkflowRuntime({
${indent(wireInner, 8)}
    });
    wireWorkflowRuntime(workflowRuntime);
    return workflowRuntime;
}

module.exports = { wireWorkflowRuntimeForApp };
`, 'utf8');

console.log('phase6 modules generated');
