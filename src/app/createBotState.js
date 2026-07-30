'use strict';

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

    /**
     * [ STATE & MUTEX ]
     *
     */
    let attendanceData = {};
    let overtimeUsers = [];
    let statusMessageId = null;
    let panelInfo = { day: { cId: CONFIG.DAY_CHAN, mId: null }, night: { cId: CONFIG.NIGHT_CHAN, mId: null } };
    let announceData = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
    let dayOffReservations = {};
    let liveExceptions = {};
    let attendanceEventLog = [];
    
    let lastSavedAt = null;
    let lastBackupAt = null;
    let lastCommandRegisterAt = null;
    let lastCommandRegisterCount = 0;
    let lastCommandRegisterError = null;
    let lastOperationalIssueSignature = null;
    let lastOperationalIssueAlertAt = 0;
    let lastOpsQueueAutoRetryAt = 0;
    let lastOpsQueueStuckAlertAt = 0;
    let lastOpsQueueAutoResultSignature = null;
    let lastOpsQueueAutoResultAlertAt = 0;
    let lastRawAttendanceSelfRepairAt = 0;
    let lastRawAttendanceSelfRepairSignature = null;
    let lastRawAttendanceSelfRepairAlertAt = 0;

    let systemStateBridge;
    let persistenceRuntime;
    let startupRuntime;

    systemStateBridge = createSystemStateBridge({
        dataStore,
        getLiveState: () => ({
            attendanceData,
            overtimeUsers,
            statusMessageId,
            panelInfo,
            announceData,
            dayOffReservations,
            liveExceptions,
            attendanceEventLog
        }),
        setLiveState: next => {
            attendanceData = next.attendanceData;
            overtimeUsers = next.overtimeUsers;
            statusMessageId = next.statusMessageId;
            panelInfo = next.panelInfo;
            announceData = next.announceData;
            dayOffReservations = next.dayOffReservations;
            liveExceptions = next.liveExceptions;
            attendanceEventLog = Array.isArray(next.attendanceEventLog) ? next.attendanceEventLog : [];
        },
        onMetaSynced: meta => {
            lastSavedAt = meta.lastSavedAt;
            lastBackupAt = meta.lastBackupAt;
        }
    });
    
    persistenceRuntime = createPersistenceRuntime({
        dataStore,
        maintenanceOverrideService,
        collectSystemState: () => systemStateBridge.collectSystemState(),
        applySystemState: state => systemStateBridge.applySystemState(state),
        syncDataStoreMeta: () => systemStateBridge.syncDataStoreMeta()
    });
    
    startupRuntime = createStartupRuntime({
        CONFIG,
        moment,
        crypto,
        fsSync,
        runtimeHealthService,
        projectRoot,
        getCommandRegisterHealth: () => ({
            lastCommandRegisterAt,
            lastCommandRegisterCount,
            lastCommandRegisterError
        }),
        getMemberFetchHealth: () => persistenceRuntime.getMemberFetchHealth()
    });

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
        get attendanceEventLog() { return attendanceEventLog; },
        set attendanceEventLog(v) { attendanceEventLog = Array.isArray(v) ? v : []; },
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
        get lastRawAttendanceSelfRepairAt() { return lastRawAttendanceSelfRepairAt; },
        set lastRawAttendanceSelfRepairAt(v) { lastRawAttendanceSelfRepairAt = v; },
        get lastRawAttendanceSelfRepairSignature() { return lastRawAttendanceSelfRepairSignature; },
        set lastRawAttendanceSelfRepairSignature(v) { lastRawAttendanceSelfRepairSignature = v; },
        get lastRawAttendanceSelfRepairAlertAt() { return lastRawAttendanceSelfRepairAlertAt; },
        set lastRawAttendanceSelfRepairAlertAt(v) { lastRawAttendanceSelfRepairAlertAt = v; },
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
