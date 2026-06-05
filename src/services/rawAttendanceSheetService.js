'use strict';

function normalizeText(value, fallback = '-') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function createAttendanceKey({ date, server, shift, name }) {
    return [
        normalizeText(date).toLowerCase(),
        normalizeText(server).toUpperCase(),
        normalizeText(shift).toUpperCase(),
        normalizeText(name, 'Unknown').toLowerCase()
    ].join('|');
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
        .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:[PH]\s*)?(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i, ' ')
        .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:Heine|Paagrio)\s*(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i, ' ')
        .replace(/\s*[-\u2013\u2014]\s*(?:Great\s*)?(?:Manager|Trainee|Guest)(?:\s+.*)?$/i, ' ')
        .replace(/\(\s*(?:over\s*time|overtime|ot)\s*\)/gi, ' ')
        .replace(/\b(?:over\s*time|overtime|ot)\b/gi, ' ')
        .replace(/ding\s*[-\u2013\u2014]\s*dong/gi, 'Ding dong')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
    const aliases = {
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
    return statusRank(next) >= statusRank(previous) ? next : previous;
}

function mergeNote(previousNote, nextNote) {
    const previous = normalizeText(previousNote);
    const next = normalizeText(nextNote);
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
    timeoutMs = 7000
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

    async function withRetry(task, attempts = 2) {
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (attempt < attempts) {
                    await new Promise(resolve => setTimeout(resolve, 350 * attempt));
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
        const key = name.toLowerCase();
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
            normalizeText(profile.server, '').toUpperCase(),
            normalizeText(profile.shift, '').toUpperCase(),
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
            const server = normalizeText(profile.server, '').toUpperCase();
            const shift = normalizeText(profile.shift, '').toUpperCase();
            if (!name || name === 'Unknown' || !server || !shift) continue;
            unique.set(name.toLowerCase(), { name, server, shift });
        }

        const nextRows = [...unique.values()]
            .sort((a, b) => `${a.server}|${a.shift}|${a.name}`.localeCompare(`${b.server}|${b.shift}|${b.name}`))
            .map(profile => [
                profile.name,
                profile.server,
                profile.shift,
                profile.name.toLowerCase(),
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
        const key = canonicalName(profile.name).toLowerCase();
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
            server: normalizeText(row.server).toUpperCase(),
            shift: normalizeText(row.shift).toUpperCase(),
            name: canonicalName(row.name),
            status: normalizeStatus(row.status),
            inTime: normalizeText(row.inTime),
            outTime: normalizeText(row.outTime),
            note: normalizeText(row.note),
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

        const targetRow = index >= 0 ? index + 2 : rows.length + 2;
        await withRetry(() => sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${RAW_ATTENDANCE_SHEET_NAME}!A${targetRow}:J${targetRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rowValues }
        }));

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

        const rawValues = rawResponse.data.values || [];
        const headers = rawValues[0] && rawValues[0].length ? rawValues[0] : RAW_ATTENDANCE_HEADERS;
        const rows = rawValues.slice(1)
            .filter(row => row.some(cell => String(cell || '').trim() !== ''))
            .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));

        for (const worker of workersResponse.data.values || []) {
            const name = canonicalName(worker[0]);
            const server = normalizeText(worker[1], '').toUpperCase();
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
            server: normalizeText(profile.server, '').toUpperCase(),
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

    async function sendAttendanceRow(row = {}) {
        if (directEnabled) {
            try {
                return await directUpsertAttendanceRow(row);
            } catch (error) {
                logger.warn?.('[RAW ATTENDANCE DIRECT SHEET WARN]', {
                    name: canonicalName(row.name),
                    message: error?.message,
                    code: error?.code || error?.status
                });
            }
        }

        const payload = {
            mode: 'upsert',
            date: normalizeText(row.date),
            server: normalizeText(row.server).toUpperCase(),
            shift: normalizeText(row.shift).toUpperCase(),
            name: canonicalName(row.name),
            status: normalizeText(row.status),
            inTime: normalizeText(row.inTime),
            outTime: normalizeText(row.outTime),
            note: normalizeText(row.note),
            forceStatus: Boolean(row.forceStatus)
        };
        payload.key = createAttendanceKey(payload);

        return postPayload(payload, `${payload.name} ${payload.status}`);
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
            unique.set(payload.name.toLowerCase(), {
                name: payload.name,
                server: payload.server,
                shift: payload.shift
            });
        }

        let count = 0;
        for (const profile of unique.values()) {
            const result = await postWorkerProfile(profile);
            if (result?.ok) count += 1;
        }
        logger.log?.(`[RAW ATTENDANCE PROFILE BULK WEBAPP SYNC] ${count} current worker profile(s) synced.`);
        return { ok: true, direct: false, count };
    }

    return {
        enabled: enabled || directEnabled,
        sendAttendanceRow,
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
    chooseFinalStatus,
    normalizeText
};
