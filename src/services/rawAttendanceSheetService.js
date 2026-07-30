'use strict';

const fsPromises = require('fs').promises;
const path = require('path');
const { normalizeBrokenKorean } = require('../utils/attendanceLogFormatter');

function normalizeText(value, fallback = '-') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function normalizeNoteText(value, fallback = '-') {
    return normalizeText(normalizeBrokenKorean(value), fallback);
}

function safeJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function createAttendanceKey({ date, server, shift, name }) {
    return [
        normalizeText(date).toLowerCase(),
        normalizeServerDisplay(server),
        normalizeText(shift).toUpperCase(),
        normalizeText(name, 'Unknown').toLowerCase()
    ].join('|');
}

function normalizeServerDisplay(value) {
    const text = normalizeText(value, '').trim();
    const upper = text.toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS' || text === '\uD558\uC774\uB124') {
        return '\uBC1C\uB77C\uCE74\uC2A4';
    }
    if (upper === 'PAAGRIO' || text === '\uD30C\uC544\uADF8\uB9AC\uC624') {
        return '\uD30C\uC544\uADF8\uB9AC\uC624';
    }
    return text || '-';
}

const RAW_ATTENDANCE_SHEET_NAME = 'Raw_Attendance';
const RAW_ATTENDANCE_HEADERS = [
    '\uB0A0\uC9DC',
    '\uC11C\uBC84',
    '\uADFC\uBB34\uC870',
    '\uC774\uB984',
    '\uC0C1\uD0DC',
    '\uCD9C\uADFC\uC2DC\uAC04',
    '\uD1F4\uADFC\uC2DC\uAC04',
    '\uBE44\uACE0',
    '\uD0A4',
    '\uC218\uC815\uC2DC\uAC04'
];
const CURRENT_WORKERS_SHEET_NAME = 'Current_Workers';
const CURRENT_WORKERS_HEADERS = [
    '\uC774\uB984',
    '\uC11C\uBC84',
    '\uADFC\uBB34\uC870',
    '\uD0A4',
    '\uC218\uC815\uC2DC\uAC04'
];

function canonicalName(value) {
    const name = normalizeText(value, 'Unknown')
        .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:[PVH]\s*)?(?:Day|Night)\s*Time.*$/i, ' ')
        .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:Valacas|Heine|Paagrio)\s*(?:Day|Night)\s*Time.*$/i, ' ')
        .replace(/\s*[-\u2013\u2014]\s*(?:Great\s*)?(?:Manager|Trainee|Guest)(?:\s+.*)?$/i, ' ')
        .replace(/\(\s*(?:over\s*time|overtime|ot)\s*\)/gi, ' ')
        .replace(/\b(?:over\s*time|overtime|ot)\b/gi, ' ')
        .replace(/ding\s*[-\u2013\u2014]\s*dong/gi, 'Ding dong')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
    const aliases = {
        'deia#1024': 'Deia',
        'deia#7347': 'Deia',
        ding: 'Ding dong',
        'ding-dong': 'Ding dong',
        'ding dong': 'Ding dong',
        shijiro: 'Shiijiro'
    };
    return aliases[name.toLowerCase()] || name;
}

function normalizeStatus(status) {
    const text = normalizeText(status).toLowerCase();
    const map = {
        normal: '\uC815\uCD9C',
        on_time: '\uC815\uCD9C',
        ontime: '\uC815\uCD9C',
        clock_in: '\uC815\uCD9C',
        '\uC815': '\uC815\uCD9C',
        '\uC815\uCD9C': '\uC815\uCD9C',
        late: '\uC9C0\uAC01',
        '\uC9C0': '\uC9C0\uAC01',
        '\uC9C0\uAC01': '\uC9C0\uAC01',
        absent: '\uACB0\uC11D',
        '\uACB0': '\uACB0\uC11D',
        '\uACB0\uC11D': '\uACB0\uC11D',
        early: '\uC870\uD1F4',
        early_out: '\uC870\uD1F4',
        '\uC870': '\uC870\uD1F4',
        '\uC870\uD1F4': '\uC870\uD1F4',
        overtime: '\uC5F0\uC7A5\uADFC\uBB34',
        ot: '\uC5F0\uC7A5\uADFC\uBB34',
        '\uC5F0': '\uC5F0\uC7A5\uADFC\uBB34',
        '\uC5F0\uC7A5\uADFC\uBB34': '\uC5F0\uC7A5\uADFC\uBB34',
        day_off: '\uD734\uBB34',
        off: '\uD734\uBB34',
        '\uD734': '\uD734\uBB34',
        '\uD734\uBB34': '\uD734\uBB34'
    };
    return map[text] || normalizeText(status);
}

function statusRank(status) {
    const ranks = {
        '\uD734\uBB34': 5,
        '\uC815\uCD9C': 10,
        '\uC5F0\uC7A5\uADFC\uBB34': 20,
        '\uC9C0\uAC01': 30,
        '\uACB0\uC11D': 40,
        '\uC870\uD1F4': 50
    };
    return ranks[normalizeStatus(status)] || 0;
}

function chooseFinalStatus(previousStatus, nextStatus, forceStatus) {
    const previous = normalizeStatus(previousStatus);
    const next = normalizeStatus(nextStatus);
    if (forceStatus) return next;
    if (!previous || previous === '-') return next;
    if (!next || next === '-') return previous;
    if (
        previous === '\uC870\uD1F4' &&
        ['\uC815\uCD9C', '\uC9C0\uAC01', '\uC5F0\uC7A5\uADFC\uBB34'].includes(next)
    ) {
        return next;
    }
    return statusRank(next) >= statusRank(previous) ? next : previous;
}

function mergeNote(previousNote, nextNote) {
    const previous = normalizeNoteText(previousNote);
    const next = normalizeNoteText(nextNote);
    if (!previous || previous === '-') return next;
    if (!next || next === '-' || previous.includes(next)) return previous;
    return previous + ' / ' + next;
}

function getColumnLetter(columnCount) {
    return String.fromCharCode(64 + columnCount);
}

function createRawAttendanceSheetService({
    google = null,
    keyFile = null,
    spreadsheetId = null,
    webAppUrl,
    fetchImpl = globalThis.fetch,
    logger = console,
    timeoutMs = 7000,
    pendingFilePath = null,
    repairAuditFilePath = null,
    maxPendingRows = 100,
    pendingReviewAttempts = 6,
    fs = fsPromises,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval
} = {}) {
    const enabled = Boolean(String(webAppUrl || '').trim());
    const directEnabled = Boolean(google && keyFile && spreadsheetId);
    const sheets = directEnabled
        ? google.sheets({
            version: 'v4',
            auth: new google.auth.GoogleAuth({
                keyFile,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            })
        })
        : null;
    let currentWorkersRowsCache = null;
    let directProfileBackoffUntilMs = 0;
    let pendingAttendanceRows = [];
    let pendingAttendanceRowsLoaded = false;
    let pendingAttendanceLock = Promise.resolve();
    let pendingRetryTimer = null;

    function withPendingAttendanceLock(task) {
        const run = pendingAttendanceLock.then(task, task);
        pendingAttendanceLock = run.catch(() => {});
        return run;
    }

    function pendingAttendanceKey(row = {}) {
        return createAttendanceKey({
            date: row.date,
            server: row.server,
            shift: row.shift,
            name: canonicalName(row.name)
        });
    }

    function normalizeAttendanceRow(row = {}) {
        return {
            ...safeJson(row),
            date: normalizeText(row.date),
            server: normalizeServerDisplay(row.server),
            shift: normalizeText(row.shift).toUpperCase(),
            name: canonicalName(row.name),
            status: normalizeStatus(row.status),
            inTime: normalizeText(row.inTime),
            outTime: normalizeText(row.outTime),
            note: normalizeNoteText(row.note),
            forceStatus: Boolean(row.forceStatus)
        };
    }

    function validateAttendanceRow(row = {}) {
        const errors = [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) errors.push('invalid-date');
        if (!row.name || row.name === 'Unknown' || row.name === '-') errors.push('invalid-name');
        if (!row.server || row.server === '-') errors.push('missing-server');
        if (!['DAY', 'NIGHT'].includes(row.shift)) errors.push('invalid-shift');
        if (!row.status || row.status === '-') errors.push('missing-status');
        return errors;
    }

    async function getCurrentWorkerProfiles() {
        if (!directEnabled) return [];
        let rows = currentWorkersRowsCache;
        if (!Array.isArray(rows)) {
            await ensureCurrentWorkersSheet();
            const valuesResponse = await withRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${CURRENT_WORKERS_SHEET_NAME}!A2:E`
            }));
            rows = valuesResponse.data.values || [];
            currentWorkersRowsCache = rows.map(row => row.slice());
        }
        return rows.map(row => ({
            name: canonicalName(row[0]),
            server: normalizeServerDisplay(row[1]),
            shift: normalizeText(row[2], '').toUpperCase()
        })).filter(profile => (
            profile.name && profile.name !== 'Unknown' && profile.server && ['DAY', 'NIGHT'].includes(profile.shift)
        ));
    }

    async function appendRepairAudit(event = {}) {
        if (!repairAuditFilePath) return;
        try {
            await fs.mkdir(path.dirname(repairAuditFilePath), { recursive: true });
            await fs.appendFile(repairAuditFilePath, JSON.stringify({
                at: new Date().toISOString(),
                ...safeJson(event)
            }) + '\n', 'utf8');
        } catch (error) {
            logger.error?.('[RAW ATTENDANCE REPAIR AUDIT ERROR]', error?.message || error);
        }
    }

    async function prepareAttendanceRow(row = {}) {
        const original = normalizeAttendanceRow(row);
        const prepared = { ...original };
        const repairs = [];
        const needsProfile = !prepared.server || prepared.server === '-' || !['DAY', 'NIGHT'].includes(prepared.shift);

        if (needsProfile && prepared.name && prepared.name !== 'Unknown') {
            try {
                const profiles = await getCurrentWorkerProfiles();
                const matches = profiles.filter(profile => profile.name.toLowerCase() === prepared.name.toLowerCase());
                const unique = new Map(matches.map(profile => [`${profile.server}|${profile.shift}`, profile]));
                if (unique.size === 1) {
                    const profile = [...unique.values()][0];
                    if (!prepared.server || prepared.server === '-') {
                        repairs.push({ field: 'server', before: prepared.server, after: profile.server, source: 'current-worker-profile' });
                        prepared.server = profile.server;
                    }
                    if (!['DAY', 'NIGHT'].includes(prepared.shift)) {
                        repairs.push({ field: 'shift', before: prepared.shift, after: profile.shift, source: 'current-worker-profile' });
                        prepared.shift = profile.shift;
                    }
                }
            } catch (error) {
                logger.warn?.('[RAW ATTENDANCE PROFILE RESOLVE WARN]', {
                    name: prepared.name,
                    message: error?.message
                });
            }
        }

        if (repairs.length) {
            logger.warn?.('[RAW ATTENDANCE AUTO REPAIR]', {
                key: pendingAttendanceKey(prepared),
                name: prepared.name,
                repairs
            });
            await appendRepairAudit({
                type: 'pending-row-auto-repair',
                key: pendingAttendanceKey(prepared),
                name: prepared.name,
                repairs,
                before: original,
                after: prepared
            });
        }

        const validationErrors = validateAttendanceRow(prepared);
        return {
            ok: validationErrors.length === 0,
            row: prepared,
            repairs,
            validationErrors
        };
    }

    function classifyAttendanceFailure(result = {}) {
        if (result.validationErrors?.length) return 'data';
        const status = Number(result.status || result.directError?.status || result.directError?.code);
        const code = result.error?.code || result.error?.cause?.code || result.directError?.code;
        if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ABORT_ERR'].includes(code)) return 'transient';
        if (status === 429 || status >= 500) return 'transient';
        if (status === 401 || status === 403) return 'auth';
        if (status >= 400 && status < 500) return 'data';
        if (['missing-webapp-url', 'missing-fetch'].includes(result.reason)) return 'config';
        return 'unknown';
    }

    function reviewAttemptThreshold(item = {}) {
        const threshold = {
            auth: 2,
            config: 2,
            data: 3
        }[item.failureClass] || pendingReviewAttempts;
        return Math.min(pendingReviewAttempts, threshold);
    }

    function normalizePendingAttendanceItem(item = {}) {
        const row = {
            ...safeJson(item.row),
            note: normalizeNoteText(item.row?.note),
            status: normalizeStatus(item.row?.status)
        };
        const now = new Date().toISOString();
        return {
            row,
            attempts: Math.max(0, Number(item.attempts || 0)),
            createdAt: item.createdAt || now,
            updatedAt: item.updatedAt || now,
            lastTriedAt: item.lastTriedAt || null,
            lastError: normalizeText(item.lastError, 'unknown'),
            failureClass: item.failureClass || 'unknown',
            validationErrors: Array.isArray(item.validationErrors) ? item.validationErrors : [],
            autoRepairs: Array.isArray(item.autoRepairs) ? item.autoRepairs : [],
            reviewNotifiedAt: item.reviewNotifiedAt || null
        };
    }

    function mergePendingAttendanceItems(items = []) {
        const merged = new Map();
        for (const rawItem of items) {
            if (!rawItem?.row) continue;
            const item = normalizePendingAttendanceItem(rawItem);
            const key = pendingAttendanceKey(item.row);
            const previous = merged.get(key);
            merged.set(key, previous ? {
                ...previous,
                ...item,
                createdAt: previous.createdAt || item.createdAt,
                attempts: Math.max(previous.attempts, item.attempts),
                reviewNotifiedAt: previous.reviewNotifiedAt || item.reviewNotifiedAt
            } : item);
        }
        return [...merged.values()].slice(-maxPendingRows);
    }

    async function persistPendingAttendanceRowsUnlocked() {
        if (!pendingFilePath) return { ok: true, skipped: true };
        try {
            await fs.mkdir(path.dirname(pendingFilePath), { recursive: true });
            await fs.writeFile(pendingFilePath, JSON.stringify({
                updatedAt: new Date().toISOString(),
                items: pendingAttendanceRows
            }, null, 2) + '\n', 'utf8');
            return { ok: true };
        } catch (error) {
            logger.error?.('[RAW ATTENDANCE PENDING SAVE ERROR]', {
                pendingFilePath,
                message: error?.message
            });
            return { ok: false, error };
        }
    }

    async function loadPendingAttendanceRowsUnlocked() {
        if (pendingAttendanceRowsLoaded) return pendingAttendanceRows;
        pendingAttendanceRowsLoaded = true;
        if (!pendingFilePath) return pendingAttendanceRows;
        try {
            const parsed = JSON.parse(await fs.readFile(pendingFilePath, 'utf8'));
            const items = Array.isArray(parsed) ? parsed : parsed?.items;
            pendingAttendanceRows = mergePendingAttendanceItems(Array.isArray(items) ? items : []);
            if (pendingAttendanceRows.length) {
                logger.warn?.('[RAW ATTENDANCE PENDING RESTORED]', {
                    pending: pendingAttendanceRows.length,
                    pendingFilePath
                });
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                logger.error?.('[RAW ATTENDANCE PENDING LOAD ERROR]', {
                    pendingFilePath,
                    message: error?.message
                });
            }
        }
        return pendingAttendanceRows;
    }

    function loadPendingAttendanceRows() {
        return withPendingAttendanceLock(async () => {
            await loadPendingAttendanceRowsUnlocked();
            return pendingAttendanceRows.map(item => safeJson(item));
        });
    }

    function canUseDirectProfileWrite() {
        return directEnabled && Date.now() >= directProfileBackoffUntilMs;
    }

    function pauseDirectProfileWrites(error) {
        directProfileBackoffUntilMs = Date.now() + 60_000;
        return {
            message: error?.message,
            code: error?.code || error?.status
        };
    }

    function isRetryableGoogleError(error) {
        const code = error?.code || error?.status || error?.error?.code || error?.cause?.code;
        if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;
        const status = Number(error?.status || error?.code);
        return status === 429 || (status >= 500 && status < 600);
    }

    async function withRetry(task, attempts = 2) {
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (attempt < attempts) {
                    const retryDelayMs = Math.min(5000, (750 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 250));
                    if (isRetryableGoogleError(error)) {
                        logger.warn?.('[RAW ATTENDANCE SHEET RETRY]', {
                            attempt,
                            nextAttempt: attempt + 1,
                            retryDelayMs,
                            message: error?.message,
                            code: error?.code || error?.status || error?.cause?.code
                        });
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                }
            }
        }
        throw lastError;
    }

    async function ensureSheet(sheetName, headers, hideColumnIndex = null) {
        const metadata = await withRetry(() => sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        }));
        let sheetId = metadata.data.sheets?.find(sheet => sheet.properties?.title === sheetName)?.properties?.sheetId;
        let created = false;
        if (sheetId === undefined) {
            await withRetry(() => sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: sheetName } } }]
                }
            }));
            const refreshed = await withRetry(() => sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets(properties(sheetId,title))'
            }));
            sheetId = refreshed.data.sheets?.find(sheet => sheet.properties?.title === sheetName)?.properties?.sheetId;
            created = true;
        }

        const headerResponse = await withRetry(() => sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A1:${getColumnLetter(headers.length)}1`
        }));
        const currentHeaders = headerResponse.data.values?.[0] || [];
        const needsHeaderUpdate = headers.some((header, index) => currentHeaders[index] !== header);
        if (needsHeaderUpdate) {
            await withRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A1:${getColumnLetter(headers.length)}1`,
                valueInputOption: 'RAW',
                requestBody: { values: [headers] }
            }));
        }

        if (hideColumnIndex && sheetId !== undefined && created) {
            await withRetry(() => sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        updateDimensionProperties: {
                            range: {
                                sheetId,
                                dimension: 'COLUMNS',
                                startIndex: hideColumnIndex - 1,
                                endIndex: hideColumnIndex
                            },
                            properties: { hiddenByUser: true },
                            fields: 'hiddenByUser'
                        }
                    }]
                }
            }));
        }
    }

    async function ensureCurrentWorkersSheet() {
        await ensureSheet(CURRENT_WORKERS_SHEET_NAME, CURRENT_WORKERS_HEADERS, 4);
    }

    async function ensureRawAttendanceSheet() {
        await ensureSheet(RAW_ATTENDANCE_SHEET_NAME, RAW_ATTENDANCE_HEADERS, 9);
    }

    async function directUpsertWorkerProfile(profile) {
        const name = canonicalName(profile.name);
        const server = normalizeServerDisplay(profile.server);
        const shift = normalizeText(profile.shift, '').toUpperCase();
        const key = `${server}|${shift}|${name.toLowerCase()}`;
        let rows = currentWorkersRowsCache;
        if (!Array.isArray(rows)) {
            await ensureCurrentWorkersSheet();
            const valuesResponse = await withRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${CURRENT_WORKERS_SHEET_NAME}!A2:E`
            }));
            rows = valuesResponse.data.values || [];
            currentWorkersRowsCache = rows.map(row => row.slice());
        }
        const index = rows.findIndex(row => String(row[3] || '') === key);
        const rowValues = [[
            name,
            server,
            shift,
            key,
            new Date().toISOString()
        ]];
        const targetRow = index >= 0 ? index + 2 : rows.length + 2;
        await withRetry(() => sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${CURRENT_WORKERS_SHEET_NAME}!A${targetRow}:E${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rowValues }
        }));
        if (index >= 0) {
            currentWorkersRowsCache[index] = rowValues[0].slice();
        } else {
            currentWorkersRowsCache.push(rowValues[0].slice());
        }
        logger.log?.(`[RAW ATTENDANCE PROFILE OK] ${name} ${rowValues[0][1]}/${rowValues[0][2]}`);
        return { ok: true, direct: true, row: targetRow, payload: { name, key } };
    }

    async function directSyncWorkerProfiles(profiles = []) {
        await ensureCurrentWorkersSheet();
        const unique = new Map();
        for (const profile of profiles) {
            const name = canonicalName(profile.name);
            const server = normalizeServerDisplay(profile.server);
            const shift = normalizeText(profile.shift, '').toUpperCase();
            if (!name || name === 'Unknown' || !server || !shift) continue;
            unique.set(`${server}|${shift}|${name.toLowerCase()}`, { name, server, shift });
        }

        const nextRows = [...unique.values()]
            .sort((a, b) => `${a.server}|${a.shift}|${a.name}`.localeCompare(`${b.server}|${b.shift}|${b.name}`))
            .map(profile => [
                profile.name,
                profile.server,
                profile.shift,
                `${profile.server}|${profile.shift}|${profile.name.toLowerCase()}`,
                new Date().toISOString()
            ]);

        const currentResponse = await withRetry(() => sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${CURRENT_WORKERS_SHEET_NAME}!A2:E`
        }));
        const currentRows = currentResponse.data.values || [];

        if (nextRows.length) {
            await withRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${CURRENT_WORKERS_SHEET_NAME}!A2:E${nextRows.length + 1}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: nextRows }
            }));
        }

        if (currentRows.length > nextRows.length) {
            const start = nextRows.length + 2;
            const end = currentRows.length + 1;
            await withRetry(() => sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `${CURRENT_WORKERS_SHEET_NAME}!A${start}:E${end}`
            }));
        }

        currentWorkersRowsCache = nextRows.map(row => row.slice());
        logger.log?.(`[RAW ATTENDANCE PROFILE BULK SYNC] ${nextRows.length} current worker profile(s) synced.`);
        return { ok: true, direct: true, count: nextRows.length };
    }

    async function directRemoveWorkerProfile(profile) {
        const nameKey = canonicalName(profile.name).toLowerCase();
        let rows = currentWorkersRowsCache;
        if (!Array.isArray(rows)) {
            await ensureCurrentWorkersSheet();
            const valuesResponse = await withRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${CURRENT_WORKERS_SHEET_NAME}!A2:E`
            }));
            rows = valuesResponse.data.values || [];
            currentWorkersRowsCache = rows.map(row => row.slice());
        }
        const index = rows.findIndex(row => {
            const key = String(row[3] || '').toLowerCase();
            return key === nameKey || key.endsWith(`|${nameKey}`);
        });
        if (index < 0) return { ok: true, direct: true, skipped: true, reason: 'profile-not-found' };
        const rowNumber = index + 2;
        await withRetry(() => sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${CURRENT_WORKERS_SHEET_NAME}!A${rowNumber}:E${rowNumber}`
        }));
        currentWorkersRowsCache.splice(index, 1);
        logger.log?.(`[RAW ATTENDANCE PROFILE REMOVE] ${profile.name}`);
        return { ok: true, direct: true, row: rowNumber };
    }

    async function directUpsertAttendanceRow(row = {}) {
        await ensureRawAttendanceSheet();
        const payload = {
            date: normalizeText(row.date),
            server: normalizeServerDisplay(row.server),
            shift: normalizeText(row.shift).toUpperCase(),
            name: canonicalName(row.name),
            status: normalizeStatus(row.status),
            inTime: normalizeText(row.inTime),
            outTime: normalizeText(row.outTime),
            note: normalizeNoteText(row.note),
            forceStatus: Boolean(row.forceStatus)
        };
        payload.key = createAttendanceKey(payload);

        const valuesResponse = await withRetry(() => sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${RAW_ATTENDANCE_SHEET_NAME}!A2:J`
        }));
        const rows = valuesResponse.data.values || [];
        const index = rows.findIndex(sheetRow => String(sheetRow[8] || '') === payload.key);
        const previousRow = index >= 0 ? rows[index] : [];
        const rowValues = [[
            payload.date,
            payload.server,
            payload.shift,
            payload.name,
            chooseFinalStatus(previousRow[4], payload.status, payload.forceStatus),
            previousRow[5] && previousRow[5] !== '-' && (!payload.inTime || payload.inTime === '-') ? previousRow[5] : payload.inTime,
            payload.outTime,
            mergeNote(previousRow[7], payload.note),
            payload.key,
            new Date().toISOString()
        ]];

        let targetRow = index >= 0 ? index + 2 : rows.length + 2;
        if (index >= 0) {
            await withRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${RAW_ATTENDANCE_SHEET_NAME}!A${targetRow}:J${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: rowValues }
            }));
        } else {
            const appendResponse = await withRetry(() => sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${RAW_ATTENDANCE_SHEET_NAME}!A:J`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: rowValues }
            }));
            const updatedRange = appendResponse?.data?.updates?.updatedRange || '';
            const rowMatch = updatedRange.match(/![A-Z]+(\d+):/i);
            if (rowMatch) targetRow = Number(rowMatch[1]);
        }

        logger.log?.(`[RAW ATTENDANCE SHEET OK] ${payload.name} ${rowValues[0][4]}`);
        return { ok: true, direct: true, row: targetRow, payload };
    }

    async function directReadRows() {
        const [rawResponse, workersResponse] = await Promise.all([
            withRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${RAW_ATTENDANCE_SHEET_NAME}!A1:J`
            })),
            withRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${CURRENT_WORKERS_SHEET_NAME}!A2:E`
            }))
        ]);
        currentWorkersRowsCache = (workersResponse.data.values || []).map(row => row.slice());

        const rawValues = rawResponse.data.values || [];
        const headers = rawValues[0] && rawValues[0].length ? rawValues[0] : RAW_ATTENDANCE_HEADERS;
        const serverHeader = RAW_ATTENDANCE_HEADERS[1];
        const shiftHeader = RAW_ATTENDANCE_HEADERS[2];
        const nameHeader = RAW_ATTENDANCE_HEADERS[3];
        const keyHeader = RAW_ATTENDANCE_HEADERS[8];
        const rows = rawValues.slice(1)
            .filter(row => row.some(cell => String(cell || '').trim() !== ''))
            .map(row => {
                const entry = Object.fromEntries(headers.map((header, index) => [header, row[index] || '']));
                if (entry[serverHeader]) entry[serverHeader] = normalizeServerDisplay(entry[serverHeader]);
                if (entry[keyHeader] && entry[keyHeader] !== '-') {
                    entry[keyHeader] = createAttendanceKey({
                        date: entry[RAW_ATTENDANCE_HEADERS[0]],
                        server: entry[serverHeader],
                        shift: entry[shiftHeader],
                        name: canonicalName(entry[nameHeader])
                    });
                }
                return entry;
            });

        for (const worker of workersResponse.data.values || []) {
            const name = canonicalName(worker[0]);
            const server = normalizeServerDisplay(worker[1]);
            const shift = normalizeText(worker[2], '').toUpperCase();
            if (!name || name === 'Unknown' || !server || !shift) continue;
            rows.push({
                [RAW_ATTENDANCE_HEADERS[0]]: '-',
                [RAW_ATTENDANCE_HEADERS[1]]: server,
                [RAW_ATTENDANCE_HEADERS[2]]: shift,
                [RAW_ATTENDANCE_HEADERS[3]]: name,
                [RAW_ATTENDANCE_HEADERS[4]]: '-',
                [RAW_ATTENDANCE_HEADERS[5]]: '-',
                [RAW_ATTENDANCE_HEADERS[6]]: '-',
                [RAW_ATTENDANCE_HEADERS[7]]: '-',
                [RAW_ATTENDANCE_HEADERS[8]]: createAttendanceKey({ date: '-', server, shift, name }),
                [RAW_ATTENDANCE_HEADERS[9]]: worker[4] || ''
            });
        }

        return rows;
    }

    async function postPayload(payload, logLabel, options = {}) {
        if (!enabled) return { ok: false, skipped: true, reason: 'missing-webapp-url' };
        if (typeof fetchImpl !== 'function') return { ok: false, skipped: true, reason: 'missing-fetch' };

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

        try {
            const response = await fetchImpl(webAppUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller?.signal
            });
            const text = await response.text().catch(() => '');
            let result = null;
            try {
                result = text ? JSON.parse(text) : null;
            } catch (_) {
                result = null;
            }

            if (!response.ok || result?.success === false) {
                const warnMethod = options.errorLevel === 'log' ? 'log' : 'warn';
                logger[warnMethod]?.('[RAW ATTENDANCE SHEET WARN]', {
                    status: response.status,
                    body: text.slice(0, 300),
                    payload
                });
                return { ok: false, status: response.status, body: text, payload };
            }

            logger.log?.(`[RAW ATTENDANCE SHEET OK] ${logLabel}`);
            return { ok: true, result, payload };
        } catch (error) {
            if (options.errorLevel === 'log') {
                const code = error?.code || error?.cause?.code || error?.message || 'unknown';
                logger.log?.(`[RAW ATTENDANCE PROFILE SYNC SKIP] ${payload.name || 'Unknown'} ${code}`);
                return { ok: false, error, payload };
            }
            const logMethod = ['warn', 'log'].includes(options.errorLevel) ? options.errorLevel : 'error';
            const label = options.errorLevel === 'log'
                ? '[RAW ATTENDANCE PROFILE SYNC SKIP]'
                : '[RAW ATTENDANCE SHEET ERROR]';
            logger[logMethod]?.(label, error);
            return { ok: false, error, payload };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function buildWorkerProfilePayload(profile = {}) {
        return {
            mode: 'profile',
            name: canonicalName(profile.name),
            server: normalizeServerDisplay(profile.server),
            shift: normalizeText(profile.shift, '').toUpperCase()
        };
    }

    function isValidWorkerProfilePayload(payload) {
        return Boolean(payload.name && payload.name !== 'Unknown' && payload.server && payload.shift);
    }

    async function postWorkerProfile(profile = {}) {
        const payload = buildWorkerProfilePayload(profile);

        if (!isValidWorkerProfilePayload(payload)) {
            return { ok: false, skipped: true, reason: 'missing-profile', payload };
        }

        return postPayload(payload, `profile ${payload.name} ${payload.server}/${payload.shift}`, { errorLevel: 'log' });
    }

    async function attemptSendAttendanceRow(row = {}) {
        const prepared = await prepareAttendanceRow(row);
        if (!prepared.ok) {
            return {
                ok: false,
                reason: 'invalid-attendance-row',
                validationErrors: prepared.validationErrors,
                preparedRow: prepared.row,
                autoRepairs: prepared.repairs,
                failureClass: 'data'
            };
        }
        const preparedRow = prepared.row;
        let directError = null;
        if (directEnabled) {
            try {
                return {
                    ...await directUpsertAttendanceRow(preparedRow),
                    preparedRow,
                    autoRepairs: prepared.repairs
                };
            } catch (error) {
                directError = error;
                logger.warn?.('[RAW ATTENDANCE DIRECT SHEET WARN]', {
                    name: preparedRow.name,
                    message: error?.message,
                    code: error?.code || error?.status
                });
            }
        }

        const payload = {
            mode: 'upsert',
            ...preparedRow,
            mode: 'upsert'
        };
        payload.key = createAttendanceKey(payload);

        const result = await postPayload(payload, `${payload.name} ${payload.status}`);
        const enriched = {
            ...result,
            directError,
            preparedRow,
            autoRepairs: prepared.repairs
        };
        enriched.failureClass = classifyAttendanceFailure(enriched);
        return enriched;
    }

    async function flushPendingAttendanceRowsUnlocked() {
        await loadPendingAttendanceRowsUnlocked();
        if (!pendingAttendanceRows.length) return { total: 0, succeeded: 0, failed: 0 };
        const pending = pendingAttendanceRows;
        pendingAttendanceRows = [];
        let succeeded = 0;
        const kept = [];

        for (const item of pending) {
            const result = await attemptSendAttendanceRow(item.row);
            if (result?.ok) {
                succeeded += 1;
            } else {
                const failureClass = result?.failureClass || classifyAttendanceFailure(result);
                kept.push({
                    ...item,
                    row: result?.preparedRow || item.row,
                    attempts: Number(item.attempts || 0) + 1,
                    lastError: result?.error?.message || result?.body || result?.reason || result?.status || 'unknown',
                    failureClass,
                    validationErrors: result?.validationErrors || [],
                    autoRepairs: [...(item.autoRepairs || []), ...(result?.autoRepairs || [])],
                    lastTriedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
        }

        pendingAttendanceRows = mergePendingAttendanceItems(kept);
        await persistPendingAttendanceRowsUnlocked();
        if (succeeded || kept.length) {
            logger.warn?.('[RAW ATTENDANCE PENDING FLUSH]', {
                total: pending.length,
                succeeded,
                failed: kept.length
            });
        }
        return { total: pending.length, succeeded, failed: kept.length };
    }

    function flushPendingAttendanceRows() {
        return withPendingAttendanceLock(() => flushPendingAttendanceRowsUnlocked());
    }

    function sendAttendanceRow(row = {}) {
        return withPendingAttendanceLock(async () => {
            await flushPendingAttendanceRowsUnlocked();
            const result = await attemptSendAttendanceRow(row);
            if (result?.ok) return result;

            const now = new Date().toISOString();
            const queuedRow = result?.preparedRow || normalizeAttendanceRow(row);
            const failureClass = result?.failureClass || classifyAttendanceFailure(result);
            pendingAttendanceRows = mergePendingAttendanceItems([
                ...pendingAttendanceRows,
                {
                    row: queuedRow,
                    attempts: 0,
                    createdAt: now,
                    updatedAt: now,
                    lastError: result?.error?.message || result?.body || result?.reason || result?.status || 'unknown',
                    failureClass,
                    validationErrors: result?.validationErrors || [],
                    autoRepairs: result?.autoRepairs || []
                }
            ]);
            await persistPendingAttendanceRowsUnlocked();
            logger.warn?.('[RAW ATTENDANCE PENDING ENQUEUED]', {
                name: canonicalName(row.name),
                date: row.date,
                status: row.status,
                pending: pendingAttendanceRows.length
            });
            return {
                ...result,
                queued: true,
                pending: pendingAttendanceRows.length
            };
        });
    }

    async function runPendingAttendanceRetryCycle({ onNeedsReview = null } = {}) {
        return withPendingAttendanceLock(async () => {
            const result = await flushPendingAttendanceRowsUnlocked();
            const needsReview = pendingAttendanceRows.filter(item => (
                item.attempts >= reviewAttemptThreshold(item) && !item.reviewNotifiedAt
            ));

            if (needsReview.length && typeof onNeedsReview === 'function') {
                try {
                    await onNeedsReview(needsReview.map(item => safeJson(item)));
                    const notifiedAt = new Date().toISOString();
                    const keys = new Set(needsReview.map(item => pendingAttendanceKey(item.row)));
                    pendingAttendanceRows = pendingAttendanceRows.map(item => (
                        keys.has(pendingAttendanceKey(item.row))
                            ? { ...item, reviewNotifiedAt: notifiedAt, updatedAt: notifiedAt }
                            : item
                    ));
                    await persistPendingAttendanceRowsUnlocked();
                } catch (error) {
                    logger.error?.('[RAW ATTENDANCE PENDING REVIEW NOTIFY ERROR]', error?.message || error);
                }
            }

            return { ...result, needsReview: needsReview.length };
        });
    }

    function startPendingAttendanceRetryLoop({
        intervalMs = 5 * 60 * 1000,
        onNeedsReview = null,
        runImmediately = true
    } = {}) {
        if (pendingRetryTimer) return () => stopPendingAttendanceRetryLoop();
        let running = false;
        const tick = async () => {
            if (running) return;
            running = true;
            try {
                await runPendingAttendanceRetryCycle({ onNeedsReview });
            } catch (error) {
                logger.error?.('[RAW ATTENDANCE PENDING RETRY ERROR]', error?.message || error);
            } finally {
                running = false;
            }
        };
        pendingRetryTimer = setIntervalImpl(tick, Math.max(1000, Number(intervalMs) || (5 * 60 * 1000)));
        pendingRetryTimer?.unref?.();
        if (runImmediately) void tick();
        return () => stopPendingAttendanceRetryLoop();
    }

    function stopPendingAttendanceRetryLoop() {
        if (!pendingRetryTimer) return;
        clearIntervalImpl(pendingRetryTimer);
        pendingRetryTimer = null;
    }

    async function sendWorkerProfile(profile = {}) {
        if (canUseDirectProfileWrite()) {
            try {
                return await directUpsertWorkerProfile(profile);
            } catch (error) {
                logger.log?.('[RAW ATTENDANCE PROFILE DIRECT SHEET FALLBACK]', {
                    name: canonicalName(profile.name),
                    ...pauseDirectProfileWrites(error)
                });
            }
        }

        return postWorkerProfile(profile);
    }

    async function removeWorkerProfile(profile = {}) {
        if (canUseDirectProfileWrite()) {
            try {
                return await directRemoveWorkerProfile(profile);
            } catch (error) {
                logger.log?.('[RAW ATTENDANCE PROFILE REMOVE DIRECT SHEET FALLBACK]', {
                    name: canonicalName(profile.name),
                    ...pauseDirectProfileWrites(error)
                });
            }
        }

        const payload = {
            mode: 'removeProfile',
            name: canonicalName(profile.name)
        };

        if (!payload.name || payload.name === 'Unknown') {
            return { ok: false, skipped: true, reason: 'missing-name', payload };
        }

        return postPayload(payload, `profile-remove ${payload.name}`, { errorLevel: 'log' });
    }

    async function syncWorkerProfiles(profiles = []) {
        if (canUseDirectProfileWrite()) {
            try {
                return await directSyncWorkerProfiles(profiles);
            } catch (error) {
                logger.log?.('[RAW ATTENDANCE PROFILE BULK DIRECT SHEET FALLBACK]', {
                    ...pauseDirectProfileWrites(error),
                    count: Array.isArray(profiles) ? profiles.length : 0
                });
            }
        }

        const unique = new Map();
        for (const profile of profiles || []) {
            const payload = buildWorkerProfilePayload(profile);
            if (!isValidWorkerProfilePayload(payload)) continue;
            unique.set(`${payload.server}|${payload.shift}|${payload.name.toLowerCase()}`, {
                name: payload.name,
                server: payload.server,
                shift: payload.shift
            });
        }

        const profileList = [...unique.values()].sort((a, b) => {
            return `${a.server}|${a.shift}|${a.name}`.localeCompare(`${b.server}|${b.shift}|${b.name}`);
        });

        const bulkResult = await postPayload({
            mode: 'syncProfiles',
            profiles: profileList
        }, `profile-sync ${profileList.length}`, { errorLevel: 'log' });

        if (bulkResult?.ok) {
            logger.log?.(`[RAW ATTENDANCE PROFILE BULK WEBAPP SYNC] ${profileList.length} current worker profile(s) synced.`);
            return { ok: true, direct: false, count: profileList.length };
        }

        let count = 0;
        for (const profile of profileList) {
            const result = await postWorkerProfile(profile);
            if (result?.ok) count += 1;
        }
        logger.log?.(`[RAW ATTENDANCE PROFILE BULK WEBAPP UPSERT FALLBACK] ${count} current worker profile(s) synced.`);
        return { ok: true, direct: false, count, staleCleanupSkipped: true };
    }

    return {
        enabled: enabled || directEnabled,
        sendAttendanceRow,
        loadPendingAttendanceRows,
        flushPendingAttendanceRows,
        runPendingAttendanceRetryCycle,
        startPendingAttendanceRetryLoop,
        stopPendingAttendanceRetryLoop,
        getPendingAttendanceRows: () => pendingAttendanceRows.map(item => safeJson(item)),
        sendWorkerProfile,
        removeWorkerProfile,
        readRows: directEnabled ? directReadRows : null,
        syncWorkerProfiles
    };
}

module.exports = {
    createRawAttendanceSheetService,
    createAttendanceKey,
    canonicalName,
    normalizeStatus,
    normalizeNoteText,
    chooseFinalStatus,
    normalizeText
};
