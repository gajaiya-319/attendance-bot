'use strict';

const fsSyncDefault = require('fs');
const fsDefault = require('fs').promises;
const momentDefault = require('moment-timezone');
const { CONFIG } = require('../config/constants');

function createInitialState(config = CONFIG) {
    return {
        attendanceData: {},
        overtimeUsers: [],
        statusMessageId: null,
        panelInfo: { day: { cId: config.DAY_CHAN, mId: null }, night: { cId: config.NIGHT_CHAN, mId: null } },
        announceData: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
        dayOffReservations: {},
        liveExceptions: {}
    };
}

function normalizeState(input = {}, previous = createInitialState()) {
    return {
        attendanceData: input.attendanceData || {},
        overtimeUsers: input.overtimeUsers || [],
        statusMessageId: input.statusMessageId || null,
        panelInfo: input.panelInfo || previous.panelInfo,
        announceData: input.announceData || previous.announceData,
        dayOffReservations: input.dayOffReservations || {},
        liveExceptions: input.liveExceptions || {}
    };
}

function createDataStore({
    config = CONFIG,
    fsSync = fsSyncDefault,
    fs = fsDefault,
    moment = momentDefault
} = {}) {
    const db = createInitialState(config);
    const meta = {
        isSaving: false,
        pendingSave: false,
        lastSavedAt: null,
        lastBackupAt: null
    };

    function assignState(next = {}) {
        const normalized = normalizeState(next, db);
        db.attendanceData = normalized.attendanceData;
        db.overtimeUsers = normalized.overtimeUsers;
        db.statusMessageId = normalized.statusMessageId;
        db.panelInfo = normalized.panelInfo;
        db.announceData = normalized.announceData;
        db.dayOffReservations = normalized.dayOffReservations;
        db.liveExceptions = normalized.liveExceptions;
        return db;
    }

    function getState() {
        return {
            attendanceData: db.attendanceData,
            overtimeUsers: db.overtimeUsers,
            statusMessageId: db.statusMessageId,
            panelInfo: db.panelInfo,
            announceData: db.announceData,
            dayOffReservations: db.dayOffReservations,
            liveExceptions: db.liveExceptions
        };
    }

    function serialize(state = db, extra = {}) {
        return JSON.stringify({
            ...normalizeState(state, db),
            ...extra
        }, null, 2);
    }

    async function writeJsonAtomic(filePath, payload) {
        const tmpPath = `${filePath}.tmp`;
        await fs.writeFile(tmpPath, payload);
        await fs.rename(tmpPath, filePath);
    }

    function loadSystem() {
        try {
            if (!fsSync.existsSync(config.FILES.DATA)) return db;
            const parsed = JSON.parse(fsSync.readFileSync(config.FILES.DATA, 'utf8'));
            assignState(parsed);
            return db;
        } catch (e) {
            console.error('[LOAD ERROR]', e);
            return db;
        }
    }

    async function saveSystemAsync(state = db) {
        assignState(state);
        if (meta.isSaving) {
            meta.pendingSave = true;
            return;
        }

        meta.isSaving = true;
        try {
            const payload = serialize(db);
            await writeJsonAtomic(config.FILES.DATA, payload);
            await writeJsonAtomic(config.FILES.BACKUP, payload);
            meta.lastSavedAt = moment().tz(config.TIMEZONE).toISOString();
        } catch (e) {
            console.error('[SAVE ERROR]', e);
        } finally {
            meta.isSaving = false;
            if (meta.pendingSave) {
                meta.pendingSave = false;
                saveSystemAsync(db);
            }
        }
    }

    async function createBackupSnapshot(reason = 'manual', state = db) {
        try {
            assignState(state);
            await fs.mkdir(config.FILES.BACKUP_DIR, { recursive: true });
            const stamp = moment().tz(config.TIMEZONE).format('YYYY-MM-DD-HH-mm-ss');
            const fileName = `attendanceData-${stamp}-${reason}.json`;
            const backupPath = `${config.FILES.BACKUP_DIR}/${fileName}`;
            const payload = serialize(db, {
                backupReason: reason,
                createdAt: moment().tz(config.TIMEZONE).toISOString()
            });

            await fs.writeFile(backupPath, payload);
            meta.lastBackupAt = moment().tz(config.TIMEZONE).toISOString();

            const files = (await fs.readdir(config.FILES.BACKUP_DIR))
                .filter(name => name.startsWith('attendanceData-') && name.endsWith('.json'))
                .sort();
            const overflow = files.length - config.FILES.MAX_BACKUPS;
            if (overflow > 0) {
                for (const oldFile of files.slice(0, overflow)) {
                    await fs.unlink(`${config.FILES.BACKUP_DIR}/${oldFile}`).catch(() => {});
                }
            }
            return backupPath;
        } catch (e) {
            console.error('[BACKUP ERROR]', e);
            return null;
        }
    }

    async function createScheduledBackupIfDue(state = db) {
        const now = moment().tz(config.TIMEZONE);
        if (meta.lastBackupAt && now.diff(moment(meta.lastBackupAt), 'hours') < 6) return null;
        return createBackupSnapshot('auto', state);
    }

    async function listBackupSnapshots() {
        try {
            await fs.mkdir(config.FILES.BACKUP_DIR, { recursive: true });
            return (await fs.readdir(config.FILES.BACKUP_DIR))
                .filter(name => name.startsWith('attendanceData-') && name.endsWith('.json'))
                .sort()
                .reverse();
        } catch (e) {
            console.error('[BACKUP LIST ERROR]', e);
            return [];
        }
    }

    async function restoreBackupSnapshot(fileName = null, currentState = db) {
        try {
            assignState(currentState);
            const backups = await listBackupSnapshots();
            const targetName = fileName || backups[0];
            if (!targetName || !backups.includes(targetName)) return false;

            await createBackupSnapshot('pre-restore', db);
            const raw = await fs.readFile(`${config.FILES.BACKUP_DIR}/${targetName}`, 'utf8');
            assignState(JSON.parse(raw));
            await saveSystemAsync(db);
            return targetName;
        } catch (e) {
            console.error('[BACKUP RESTORE ERROR]', e);
            return false;
        }
    }

    return {
        db,
        meta,
        assignState,
        getState,
        loadSystem,
        saveSystemAsync,
        createBackupSnapshot,
        createScheduledBackupIfDue,
        listBackupSnapshots,
        restoreBackupSnapshot
    };
}

const defaultStore = createDataStore();

module.exports = {
    ...defaultStore,
    createDataStore,
    createInitialState,
    normalizeState
};
