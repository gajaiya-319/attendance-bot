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
        const backupPath = await store.createBackupSnapshot('../manual restore', {
            attendanceData: { before: { id: 'before' } },
            overtimeUsers: [],
            statusMessageId: null,
            panelInfo: undefined,
            announceData: undefined,
            dayOffReservations: {},
            liveExceptions: {}
        });
        assert.strictEqual(path.basename(backupPath).includes('..'), false, 'backup reason is sanitized in file name');

        const backups = await store.listBackupSnapshots();
        assert.strictEqual(backups.length, 1, 'backup snapshot is listed');
        assert.strictEqual(store.isSafeBackupFileName(backups[0]), true, 'listed backup name is safe');
        assert.strictEqual(store.isSafeBackupFileName('attendanceData-202605250519-before-restore-ot-user1.json'), true, 'legacy repair backup name is safe');
        assert.strictEqual(store.isSafeBackupFileName('../attendanceData-2026-01-01-00-00-00-manual.json'), false, 'path traversal backup name is rejected');

        store.assignState({ attendanceData: { after: { id: 'after' } } });
        const restoredName = await store.restoreBackupSnapshot(backups[0], store.getState());
        assert.strictEqual(restoredName, backups[0], 'restore returns file name');
        assert.strictEqual(Boolean(store.db.attendanceData.before), true, 'backup restore applies state');
        assert.strictEqual(Boolean(store.db.attendanceData.after), false, 'backup restore replaces old state');
    });

    await withTempDir(async dir => {
        const store = createDataStore({ config: createConfig(dir), fsSync, fs, moment });
        await fs.mkdir(path.join(dir, 'backups'), { recursive: true });
        const invalidName = 'attendanceData-2026-05-21-22-00-00-invalid.json';
        await fs.writeFile(path.join(dir, 'backups', invalidName), JSON.stringify({
            attendanceData: [],
            overtimeUsers: {}
        }));

        store.assignState({ attendanceData: { safe: { id: 'safe' } }, overtimeUsers: [] });
        const restored = await store.restoreBackupSnapshot(invalidName, store.getState());
        assert.strictEqual(restored, false, 'invalid backup payload is rejected');
        assert.strictEqual(Boolean(store.db.attendanceData.safe), true, 'invalid restore keeps current state');
    });

    await withTempDir(async dir => {
        const store = createDataStore({ config: createConfig(dir), fsSync, fs, moment });
        await fs.mkdir(path.join(dir, 'backups'), { recursive: true });
        await fs.writeFile(path.join(dir, 'backups', 'attendanceData-2026-05-21-22-00-00-good.json'), JSON.stringify({
            attendanceData: { userA: { id: 'other-id' } },
            overtimeUsers: []
        }));

        const restored = await store.restoreBackupSnapshot('attendanceData-2026-05-21-22-00-00-good.json', store.getState());
        assert.strictEqual(restored, false, 'id-mismatched backup payload is rejected');
    });

    await withTempDir(async dir => {
        let releaseFirstWrite;
        let firstWriteBlocked = false;
        const delayedFs = {
            ...fs,
            async writeFile(filePath, payload) {
                if (!firstWriteBlocked && filePath.endsWith('attendanceData.json.tmp')) {
                    firstWriteBlocked = true;
                    await new Promise(resolve => {
                        releaseFirstWrite = resolve;
                    });
                }
                return fs.writeFile(filePath, payload);
            }
        };
        const store = createDataStore({ config: createConfig(dir), fsSync, fs: delayedFs, moment });
        const firstSave = store.saveSystemAsync({
            attendanceData: { user1: { id: 'user1', checkedIn: true } },
            overtimeUsers: []
        });

        while (!firstWriteBlocked) {
            await new Promise(resolve => setTimeout(resolve, 1));
        }

        let secondResolved = false;
        const secondSave = store.saveSystemAsync({
            attendanceData: { user1: { id: 'user1', checkedIn: false }, user2: { id: 'user2', checkedIn: true } },
            overtimeUsers: []
        }).then(() => {
            secondResolved = true;
        });

        await new Promise(resolve => setTimeout(resolve, 10));
        assert.strictEqual(secondResolved, false, 'queued save waits for active save to drain');
        releaseFirstWrite();
        await firstSave;
        await secondSave;

        const saved = JSON.parse(await fs.readFile(path.join(dir, 'attendanceData.json'), 'utf8'));
        assert.strictEqual(saved.attendanceData.user1.checkedIn, false, 'queued save writes latest user1 state');
        assert.strictEqual(saved.attendanceData.user2.checkedIn, true, 'queued save writes added user2 state');
    });

    console.log('data-store tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
