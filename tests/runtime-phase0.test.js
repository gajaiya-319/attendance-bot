'use strict';

const assert = require('assert');
const path = require('path');
const fsSync = require('fs');
const moment = require('moment-timezone');
const { createSystemStateBridge } = require('../src/runtime/systemStateBridge');
const { createPersistenceRuntime } = require('../src/runtime/persistenceRuntime');
const { createStartupRuntime } = require('../src/runtime/startupRuntime');
const { createDataStore } = require('../src/services/dataStore');

function createLiveState() {
    const state = {
        attendanceData: { u1: { id: 'u1', checkedIn: true } },
        overtimeUsers: [{ id: 'u1' }],
        statusMessageId: 'status-1',
        panelInfo: { day: { cId: 'day', mId: null }, night: { cId: 'night', mId: null } },
        announceData: { 1: null },
        dayOffReservations: {},
        liveExceptions: {}
    };
    return {
        getLiveState: () => state,
        setLiveState: next => {
            state.attendanceData = next.attendanceData;
            state.overtimeUsers = next.overtimeUsers;
            state.statusMessageId = next.statusMessageId;
            state.panelInfo = next.panelInfo;
            state.announceData = next.announceData;
            state.dayOffReservations = next.dayOffReservations;
            state.liveExceptions = next.liveExceptions;
        },
        state
    };
}

(async () => {
    const { getLiveState, setLiveState, state } = createLiveState();
    const dataStore = createDataStore({
        config: {
            TIMEZONE: 'Asia/Manila',
            DAY_CHAN: 'day',
            NIGHT_CHAN: 'night',
            FILES: {
                DATA: path.join(__dirname, 'tmp-runtime-phase0-data.json'),
                BACKUP: path.join(__dirname, 'tmp-runtime-phase0-data.bak'),
                BACKUP_DIR: path.join(__dirname, 'tmp-runtime-phase0-backups'),
                MAX_BACKUPS: 2
            }
        },
        fsSync,
        moment
    });

    let syncedMeta = null;
    const bridge = createSystemStateBridge({
        dataStore,
        getLiveState,
        setLiveState,
        onMetaSynced: meta => {
            syncedMeta = meta;
        }
    });

    const collected = bridge.collectSystemState();
    assert.strictEqual(collected.attendanceData.u1.id, 'u1');

    bridge.applySystemState({
        attendanceData: { u2: { id: 'u2' } },
        overtimeUsers: [],
        statusMessageId: null,
        dayOffReservations: {},
        liveExceptions: {}
    });
    assert.strictEqual(state.attendanceData.u2.id, 'u2');
    assert.ok(state.panelInfo.day.cId, 'panelInfo preserved when omitted');

    await dataStore.saveSystemAsync(bridge.collectSystemState());
    bridge.syncDataStoreMeta();
    assert.ok(syncedMeta?.lastSavedAt);

    const maintenanceOverrideService = {
        load: async () => {}
    };
    const persistence = createPersistenceRuntime({
        dataStore,
        maintenanceOverrideService,
        collectSystemState: bridge.collectSystemState,
        applySystemState: bridge.applySystemState,
        syncDataStoreMeta: bridge.syncDataStoreMeta
    });

    await persistence.saveSystemAsync();
    assert.ok(fsSync.existsSync(path.join(__dirname, 'tmp-runtime-phase0-data.json')));

    const startup = createStartupRuntime({
        CONFIG: {
            VERSION: 'test',
            RELEASE_NOTE: 'phase0',
            TIMEZONE: 'Asia/Manila'
        },
        moment,
        crypto: require('crypto'),
        fsSync,
        runtimeHealthService: {
            write: async () => ({ ok: true }),
            read: async () => ({ ok: true })
        },
        getCommandRegisterHealth: () => ({
            lastCommandRegisterAt: 'ok',
            lastCommandRegisterCount: 3,
            lastCommandRegisterError: null
        }),
        getMemberFetchHealth: () => persistence.getMemberFetchHealth(),
        projectRoot: path.join(__dirname, '..')
    });

    const health = startup.getRuntimeHealthSnapshot();
    assert.strictEqual(health.commandRegister.count, 3);
    assert.ok(health.memberFetch);

    const buildInfo = startup.getStartupBuildInfo();
    assert.ok(buildInfo.fileCount > 0);
    assert.match(buildInfo.hash, /^[a-f0-9]{8}$/);

    try {
        fsSync.unlinkSync(path.join(__dirname, 'tmp-runtime-phase0-data.json'));
    } catch (_) {}
    try {
        fsSync.unlinkSync(path.join(__dirname, 'tmp-runtime-phase0-data.bak'));
    } catch (_) {}

    console.log('runtime-phase0 tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
