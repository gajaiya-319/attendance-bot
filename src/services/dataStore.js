'use strict';

const fsSyncDefault = require('fs');
const fsDefault = require('fs').promises;
const pathDefault = require('path');
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
        liveExceptions: {},
        attendanceEventLog: []
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
        liveExceptions: input.liveExceptions || {},
        attendanceEventLog: Array.isArray(input.attendanceEventLog) ? input.attendanceEventLog : []
    };
}

function createDataStore({
    config = CONFIG,
    fsSync = fsSyncDefault,
    fs = fsDefault,
    moment = momentDefault,
    path = pathDefault
} = {}) {
    const db = createInitialState(config);
    const meta = {
        isSaving: false,
        pendingSave: false,
        lastSavedAt: null,
        lastBackupAt: null,
        lastLoadSource: null,
        lastLoadRecoveredAt: null,
        lastLoadError: null,
        lastSaveError: null
    };
    let activeSavePromise = null;

    function assignState(next = {}) {
        const normalized = normalizeState(next, db);
        db.attendanceData = normalized.attendanceData;
        db.overtimeUsers = normalized.overtimeUsers;
        db.statusMessageId = normalized.statusMessageId;
        db.panelInfo = normalized.panelInfo;
        db.announceData = normalized.announceData;
        db.dayOffReservations = normalized.dayOffReservations;
        db.liveExceptions = normalized.liveExceptions;
        db.attendanceEventLog = normalized.attendanceEventLog;
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
            liveExceptions: db.liveExceptions,
            attendanceEventLog: db.attendanceEventLog
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
        await fs.writeFile(tmpPath, payload, { mode: 0o600 });
        await fs.rename(tmpPath, filePath);
    }

    function sanitizeBackupReason(reason = 'manual') {
        const safe = String(reason || 'manual')
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        return safe || 'manual';
    }

    function isSafeBackupFileName(fileName) {
        if (!fileName || typeof fileName !== 'string') return false;
        if (fileName !== path.basename(fileName)) return false;
        return /^attendanceData-(?:\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}|\d{8}-\d{6}|\d{12}|\d{14})-[a-zA-Z0-9._-]+\.json$/.test(fileName);
    }

    function validateRestorableState(state) {
        const issues = [];
        if (!state || typeof state !== 'object' || Array.isArray(state)) {
            return ['backup root must be an object'];
        }
        if (!state.attendanceData || typeof state.attendanceData !== 'object' || Array.isArray(state.attendanceData)) {
            issues.push('attendanceData must be an object');
        }
        if (!Array.isArray(state.overtimeUsers)) issues.push('overtimeUsers must be an array');
        if (state.dayOffReservations && (typeof state.dayOffReservations !== 'object' || Array.isArray(state.dayOffReservations))) {
            issues.push('dayOffReservations must be an object');
        }
        if (state.liveExceptions && (typeof state.liveExceptions !== 'object' || Array.isArray(state.liveExceptions))) {
            issues.push('liveExceptions must be an object');
        }
        if (state.attendanceEventLog && !Array.isArray(state.attendanceEventLog)) {
            issues.push('attendanceEventLog must be an array');
        }
        for (const [id, user] of Object.entries(state.attendanceData || {})) {
            if (!user || typeof user !== 'object' || Array.isArray(user)) {
                issues.push(`attendanceData.${id} must be an object`);
                continue;
            }
            if (user.id && String(user.id) !== String(id)) {
                issues.push(`attendanceData.${id} id mismatch (${user.id})`);
            }
            if (user.sessions && !Array.isArray(user.sessions)) {
                issues.push(`attendanceData.${id}.sessions must be an array`);
            }
        }
        return issues;
    }

    function loadSystem() {
        const primaryExists = fsSync.existsSync(config.FILES.DATA);
        const backupExists = fsSync.existsSync(config.FILES.BACKUP);
        if (!primaryExists && !backupExists) {
            meta.lastLoadSource = 'initial';
            return db;
        }

        let primaryError = null;
        if (primaryExists) {
            try {
                const parsed = JSON.parse(fsSync.readFileSync(config.FILES.DATA, 'utf8'));
                const issues = validateRestorableState(parsed);
                if (issues.length) throw new Error(`Primary state validation failed: ${issues.join('; ')}`);
                assignState(parsed);
                meta.lastLoadSource = 'primary';
                meta.lastLoadError = null;
                return db;
            } catch (error) {
                primaryError = error;
                console.error('[LOAD PRIMARY ERROR]', error);
            }
        } else {
            primaryError = new Error('Primary state file is missing');
        }

        try {
            if (!backupExists) throw new Error('Backup state file is missing');
            const parsed = JSON.parse(fsSync.readFileSync(config.FILES.BACKUP, 'utf8'));
            const issues = validateRestorableState(parsed);
            if (issues.length) throw new Error(`Backup state validation failed: ${issues.join('; ')}`);
            assignState(parsed);
            meta.lastLoadSource = 'backup';
            meta.lastLoadRecoveredAt = moment().tz(config.TIMEZONE).toISOString();
            meta.lastLoadError = primaryError?.message || String(primaryError);
            console.error('[LOAD RECOVERY] Primary state unavailable; validated backup loaded.');
            return db;
        } catch (backupError) {
            const error = new Error(
                `State load failed. Primary: ${primaryError?.message || primaryError}. Backup: ${backupError?.message || backupError}`
            );
            error.cause = backupError;
            meta.lastLoadSource = 'failed';
            meta.lastLoadError = error.message;
            console.error('[LOAD FATAL]', error);
            throw error;
        }
    }

    async function flushSaveQueue() {
        meta.isSaving = true;
        try {
            do {
                meta.pendingSave = false;
                const payload = serialize(db);
                await writeJsonAtomic(config.FILES.DATA, payload);
                await writeJsonAtomic(config.FILES.BACKUP, payload);
                meta.lastSavedAt = moment().tz(config.TIMEZONE).toISOString();
                meta.lastSaveError = null;
            } while (meta.pendingSave);
        } catch (e) {
            meta.lastSaveError = e?.message || String(e);
            console.error('[SAVE ERROR]', e);
            throw e;
        } finally {
            meta.isSaving = false;
            activeSavePromise = null;
        }
    }

    async function saveSystemAsync(state = db) {
        assignState(state);
        if (meta.isSaving) {
            meta.pendingSave = true;
            return activeSavePromise;
        }

        activeSavePromise = flushSaveQueue();
        return activeSavePromise;
    }

    async function createBackupSnapshot(reason = 'manual', state = db) {
        try {
            assignState(state);
            await fs.mkdir(config.FILES.BACKUP_DIR, { recursive: true });
            const stamp = moment().tz(config.TIMEZONE).format('YYYY-MM-DD-HH-mm-ss');
            const safeReason = sanitizeBackupReason(reason);
            const fileName = `attendanceData-${stamp}-${safeReason}.json`;
            const backupPath = path.join(config.FILES.BACKUP_DIR, fileName);
            const payload = serialize(db, {
                backupReason: safeReason,
                createdAt: moment().tz(config.TIMEZONE).toISOString()
            });

            await writeJsonAtomic(backupPath, payload);
            meta.lastBackupAt = moment().tz(config.TIMEZONE).toISOString();

            const files = (await fs.readdir(config.FILES.BACKUP_DIR))
                .filter(name => name.startsWith('attendanceData-') && name.endsWith('.json'))
                .sort();
            const overflow = files.length - config.FILES.MAX_BACKUPS;
            if (overflow > 0) {
                for (const oldFile of files.slice(0, overflow)) {
                    await fs.unlink(path.join(config.FILES.BACKUP_DIR, oldFile)).catch(() => {});
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
            if (!targetName || !isSafeBackupFileName(targetName) || !backups.includes(targetName)) return false;

            await createBackupSnapshot('pre-restore', db);
            const raw = await fs.readFile(path.join(config.FILES.BACKUP_DIR, targetName), 'utf8');
            const parsed = JSON.parse(raw);
            const issues = validateRestorableState(parsed);
            if (issues.length) {
                console.error('[BACKUP RESTORE VALIDATION ERROR]', issues.join('; '));
                return false;
            }
            assignState(parsed);
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
        restoreBackupSnapshot,
        sanitizeBackupReason,
        isSafeBackupFileName,
        validateRestorableState
    };
}

const defaultStore = createDataStore();

module.exports = {
    ...defaultStore,
    createDataStore,
    createInitialState,
    normalizeState
};
