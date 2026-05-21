const assert = require('assert');
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const moment = require('moment-timezone');
const { createDataStore } = require('../src/services/dataStore');

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-store-'));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

function createConfig(dir) {
    return {
        TIMEZONE: 'Asia/Manila',
        DAY_CHAN: 'day-channel',
        NIGHT_CHAN: 'night-channel',
        FILES: {
            DATA: path.join(dir, 'attendanceData.json'),
            BACKUP: path.join(dir, 'attendanceData.json.bak'),
            BACKUP_DIR: path.join(dir, 'backups'),
            MAX_BACKUPS: 2
        }
    };
}

(async () => {
    await withTempDir(async dir => {
        const store = createDataStore({ config: createConfig(dir), fsSync, fs, moment });
        await store.saveSystemAsync({
            attendanceData: { user1: { id: 'user1', checkedIn: true } },
            overtimeUsers: [{ id: 'user1', type: 'MANUAL' }],
            statusMessageId: 'status-message',
            panelInfo: { day: { cId: 'day-channel', mId: 'day-message' }, night: { cId: 'night-channel', mId: null } },
            announceData: { 1: 'announce-message' },
            dayOffReservations: { reservation1: { status: 'pending' } },
            liveExceptions: { user1: { status: 'active' } }
        });

        assert.strictEqual(fsSync.existsSync(path.join(dir, 'attendanceData.json')), true, 'data file is written');
        assert.strictEqual(fsSync.existsSync(path.join(dir, 'attendanceData.json.bak')), true, 'backup file is written');

        const reloaded = createDataStore({ config: createConfig(dir), fsSync, fs, moment });
        reloaded.loadSystem();
        assert.strictEqual(reloaded.db.attendanceData.user1.checkedIn, true, 'attendanceData reloads');
        assert.strictEqual(reloaded.db.overtimeUsers[0].type, 'MANUAL', 'overtimeUsers reloads');
        assert.strictEqual(reloaded.db.panelInfo.day.mId, 'day-message', 'panelInfo reloads');
    });

    await withTempDir(async dir => {
        const store = createDataStore({ config: createConfig(dir), fsSync, fs, moment });
        await store.createBackupSnapshot('manual', {
            attendanceData: { before: { id: 'before' } },
            overtimeUsers: [],
            statusMessageId: null,
            panelInfo: undefined,
            announceData: undefined,
            dayOffReservations: {},
            liveExceptions: {}
        });

        const backups = await store.listBackupSnapshots();
        assert.strictEqual(backups.length, 1, 'backup snapshot is listed');

        store.assignState({ attendanceData: { after: { id: 'after' } } });
        const restoredName = await store.restoreBackupSnapshot(backups[0], store.getState());
        assert.strictEqual(restoredName, backups[0], 'restore returns file name');
        assert.strictEqual(Boolean(store.db.attendanceData.before), true, 'backup restore applies state');
        assert.strictEqual(Boolean(store.db.attendanceData.after), false, 'backup restore replaces old state');
    });

    console.log('data-store tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
