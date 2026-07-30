'use strict';

const {
    selectEndAdenaOperations,
    reduceEndAdenaOperations
} = require('../utils/endAdenaOperations');

function normalize(value) {
    return String(value || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(?:over\s*time|overtime|ot)\b/gi, ' ')
        .replace(/[*_~`]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeAliasMap(aliases = {}) {
    return Object.fromEntries(
        Object.entries(aliases || {})
            .map(([from, to]) => [normalize(from), normalize(to)])
            .filter(([from, to]) => from && to)
    );
}

function normalizePayrollServer(value) {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS') return 'VALAKAS';
    return upper || '';
}

function resolveServerTab(serverTabs, server) {
    const normalized = normalizePayrollServer(server);
    return serverTabs[normalized] || (normalized === 'VALAKAS' ? serverTabs.HEINE : null);
}

function resolveServerSheetId(serverSheetIds = {}, server) {
    const normalized = normalizePayrollServer(server);
    const value = serverSheetIds[normalized] || (normalized === 'VALAKAS' ? serverSheetIds.HEINE : null);
    const sheetId = Number(value);
    return Number.isInteger(sheetId) && sheetId >= 0 ? sheetId : null;
}

function quoteSheetName(title) {
    return `'${String(title || '').replace(/'/g, "''")}'`;
}

function resolveSheetName(userName, aliases = {}) {
    const normalized = normalize(userName);
    return aliases[normalized] || normalized;
}

function getSheetNameVariants(value) {
    const normalized = normalize(value);
    if (!normalized) return [];

    const variants = [normalized];
    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length > 1) {
        variants.push(parts[0]);
        variants.push(parts.slice(0, -1).join(' '));
    }

    return [...new Set(variants.filter(Boolean))];
}

function resolveSheetNameCandidates(userName, aliases = {}) {
    const variants = getSheetNameVariants(userName);
    const candidates = [];
    for (const variant of variants) {
        candidates.push(variant);
        if (aliases[variant]) candidates.push(aliases[variant]);
    }
    return [...new Set(candidates.filter(Boolean))];
}

function namesReferToSameSheetUser(left, right, aliases = {}) {
    const leftCandidates = new Set(resolveSheetNameCandidates(left, aliases));
    return resolveSheetNameCandidates(right, aliases).some(candidate => leftCandidates.has(candidate));
}

function parseNumber(value) {
    const parsed = Number.parseInt(String(value || '0').replace(/,/g, '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getNextSummaryAdenaValue(previousValue, rawAmount) {
    return Math.max(0, previousValue + rawAmount);
}

function getColumnLetter(columnIndex) {
    let col = columnIndex + 1;
    let letters = '';
    while (col > 0) {
        const rem = (col - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        col = Math.floor((col - rem - 1) / 26);
    }
    return letters;
}

function isRetryableSheetError(error) {
    const code = error?.code || error?.status || error?.error?.code || error?.cause?.code;
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;
    const status = Number(error?.status || error?.code);
    return status === 429 || (status >= 500 && status < 600);
}

function getRetryDelayMs(attempt) {
    // Google recommends exponential backoff for quota and transient failures.
    // Keep the cap modest so a Discord interaction is not held indefinitely.
    const base = 750 * (2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(5000, base + jitter);
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withGoogleSheetRetry(operation, logger, label, context = {}) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxAttempts || !isRetryableSheetError(error)) throw error;
            const retryDelayMs = getRetryDelayMs(attempt);
            logger.warn?.('[' + label + ' SHEET RETRY]', {
                ...context,
                attempt,
                nextAttempt: attempt + 1,
                retryDelayMs,
                message: error?.message,
                code: error?.code || error?.status || error?.cause?.code
            });
            await wait(retryDelayMs);
        }
    }
    return null;
}

function findSectionHeader(rows, sectionLabel) {
    const target = normalize(sectionLabel);
    return rows.findIndex(row => normalize(row?.[0]) === target);
}

function findNextSectionHeader(rows, startRow, sectionLabels) {
    const labels = new Set(Object.values(sectionLabels || {}).map(normalize));
    for (let r = startRow + 1; r < rows.length; r += 1) {
        if (labels.has(normalize(rows[r]?.[0]))) return r;
    }
    return rows.length;
}

function findUserColumnInHeader(row, userName, aliases = {}) {
    const targets = new Set(resolveSheetNameCandidates(userName, aliases));
    for (let c = 0; c < (row || []).length; c += 1) {
        if (targets.has(normalize(row[c]))) return c;
    }
    return -1;
}

function listHeaderUserNames(row) {
    const ignored = new Set(['day', 'night', 'player', 'p', 'adena', 'gain adena', 'bonus', 'd&c', 'dc']);
    return [...new Set((row || [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .filter(value => !ignored.has(normalize(value))))];
}

function findDayRow(rows, dayOfMonth, startRow, endRow) {
    const target = String(dayOfMonth);
    for (let r = startRow; r < endRow; r += 1) {
        if (String(rows[r]?.[0] || '').trim() === target) return r;
    }
    return -1;
}

function getSectionCandidates(rows, { sectionLabel, sectionLabels, userName, aliases }) {
    const labels = sectionLabel
        ? [[Object.keys(sectionLabels || {}).find(key => sectionLabels[key] === sectionLabel) || null, sectionLabel]]
        : Object.entries(sectionLabels || {});

    return labels
        .map(([shift, label]) => {
            const headerRowIndex = findSectionHeader(rows, label);
            if (headerRowIndex === -1) return null;
            const userColIndex = findUserColumnInHeader(rows[headerRowIndex], userName, aliases);
            if (userColIndex === -1) return null;
            return { shift, sectionLabel: label, headerRowIndex, userColIndex };
        })
        .filter(Boolean);
}

function resolveSheetCell(rows, { sectionLabel, sectionLabels, userName, dayOfMonth, userColumnOffset, aliases }) {
    const candidates = getSectionCandidates(rows, { sectionLabel, sectionLabels, userName, aliases });
    if (sectionLabel && candidates.length === 0) {
        const headerRowIndex = findSectionHeader(rows, sectionLabel);
        return {
            ok: false,
            code: headerRowIndex === -1 ? 'section-not-found' : 'user-not-found',
            availableUsers: headerRowIndex === -1 ? [] : listHeaderUserNames(rows[headerRowIndex]).slice(0, 40)
        };
    }
    if (!sectionLabel && candidates.length === 0) return { ok: false, code: 'user-not-found' };
    if (!sectionLabel && candidates.length > 1) return { ok: false, code: 'ambiguous-shift' };

    const candidate = candidates[0];
    const endRow = findNextSectionHeader(rows, candidate.headerRowIndex, sectionLabels);
    const dayRowIndex = findDayRow(rows, dayOfMonth, candidate.headerRowIndex + 1, endRow);
    if (dayRowIndex === -1) return { ok: false, code: 'day-not-found', inferredShift: candidate.shift };

    return {
        ok: true,
        rowIndex: dayRowIndex,
        colIndex: candidate.userColIndex + userColumnOffset,
        inferredShift: candidate.shift
    };
}

function resolvePurchaseCell(rows, options) {
    return resolveSheetCell(rows, { ...options, userColumnOffset: 2 });
}

function resolveAdenaCell(rows, options) {
    return resolveSheetCell(rows, { ...options, userColumnOffset: 0 });
}

function findSummaryGroups(rows) {
    for (let r = 0; r < rows.length; r += 1) {
        const groups = [];
        const row = rows[r] || [];
        for (let c = 0; c < row.length; c += 1) {
            if (normalize(row[c]) !== 'player') continue;
            let adenaColIndex = -1;
            for (let offset = 1; offset <= 5 && c + offset < row.length; offset += 1) {
                if (normalize(row[c + offset]) === 'adena') {
                    adenaColIndex = c + offset;
                    break;
                }
            }
            if (adenaColIndex !== -1) {
                groups.push({ headerRowIndex: r, playerColIndex: c, adenaColIndex });
            }
        }
        if (groups.length >= 2) return groups;
    }
    return [];
}

function resolveAdenaSummaryCell(rows, { shift, userName, aliases }) {
    const groups = findSummaryGroups(rows);
    const groupEntries = shift
        ? [[shift, shift === 'NIGHT' ? groups[1] : groups[0]]]
        : [['DAY', groups[0]], ['NIGHT', groups[1]]];
    const targets = new Set(resolveSheetNameCandidates(userName, aliases));

    for (const [candidateShift, group] of groupEntries) {
        if (!group) continue;
        for (let r = group.headerRowIndex + 1; r < rows.length; r += 1) {
            const name = normalize(rows[r]?.[group.playerColIndex]);
            if (name === 'total') break;
            if (targets.has(name)) {
                return {
                    ok: true,
                    rowIndex: r,
                    colIndex: group.adenaColIndex,
                    inferredShift: candidateShift
                };
            }
        }
    }

    return { ok: false, code: shift ? 'summary-user-not-found' : 'summary-shift-not-found' };
}

function collectAdenaSummaryResetCells(rows, shift) {
    const normalizedShift = String(shift || '').trim().toUpperCase();
    const groups = findSummaryGroups(rows);
    const group = normalizedShift === 'NIGHT' ? groups[1] : (normalizedShift === 'DAY' ? groups[0] : null);
    if (!group) return [];

    const cells = [];
    for (let r = group.headerRowIndex + 1; r < rows.length; r += 1) {
        const userName = String(rows[r]?.[group.playerColIndex] || '').trim();
        if (normalize(userName) === 'total') break;
        if (!userName) continue;
        cells.push({
            rowIndex: r,
            colIndex: group.adenaColIndex,
            userName,
            previousValue: parseNumber(rows[r]?.[group.adenaColIndex])
        });
    }
    return cells;
}

function createPurchaseSheetService({
    google,
    keyFile,
    spreadsheetId,
    serverTabs,
    serverSheetIds = {},
    sectionLabels,
    sheetNameAliases = {},
    operationLog = null,
    logger = console
}) {
    if (!google) throw new TypeError('google must be provided');
    if (!spreadsheetId) throw new TypeError('spreadsheetId must be provided');
    if (!serverTabs || typeof serverTabs !== 'object') throw new TypeError('serverTabs must be an object');
    if (!sectionLabels || typeof sectionLabels !== 'object') throw new TypeError('sectionLabels must be an object');

    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const aliases = normalizeAliasMap(sheetNameAliases);
    const tabTitleCache = new Map();
    const summaryWriteQueues = new Map();
    const mutationWriteQueues = new Map();

    function runWithQueue(queues, key, task) {
        const previous = queues.get(key) || Promise.resolve();
        const current = previous.then(task);
        const settled = current.then(() => undefined, () => undefined);

        queues.set(key, settled);
        settled.then(() => {
            if (queues.get(key) === settled) queues.delete(key);
        });
        return current;
    }

    function runWithSummaryWriteLock({ shift } = {}, task) {
        const key = String(shift || 'UNKNOWN').trim().toUpperCase();
        return runWithQueue(summaryWriteQueues, key, task);
    }

    function runWithMutationWriteLock(payload = {}, task) {
        const server = normalizePayrollServer(payload.server) || 'UNKNOWN';
        const shift = String(payload.shift || 'UNKNOWN').trim().toUpperCase();
        return runWithQueue(mutationWriteQueues, `${server}:${shift}`, task);
    }

    async function resolveServerTabTitle(server) {
        const normalizedServer = normalizePayrollServer(server);
        const configuredTab = resolveServerTab(serverTabs, normalizedServer);
        const sheetId = resolveServerSheetId(serverSheetIds, normalizedServer);
        if (sheetId === null || !sheets.spreadsheets?.get) return configuredTab;

        const cacheKey = `${normalizedServer}:${sheetId}`;
        if (tabTitleCache.has(cacheKey)) return tabTitleCache.get(cacheKey);

        try {
            const response = await withGoogleSheetRetry(() => sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets(properties(sheetId,title))'
            }), logger, 'PURCHASE TAB META', { server: normalizedServer, sheetId });
            const title = (response.data.sheets || [])
                .find(sheet => Number(sheet.properties?.sheetId) === sheetId)
                ?.properties?.title || null;
            const resolvedTab = title || configuredTab;
            if (title && configuredTab && title !== configuredTab) {
                logger.warn?.('[PURCHASE TAB AUTO RESOLVE]', {
                    server: normalizedServer,
                    configuredTab,
                    sheetId,
                    resolvedTab: title
                });
            }
            tabTitleCache.set(cacheKey, resolvedTab);
            return resolvedTab;
        } catch (error) {
            logger.warn?.('[PURCHASE TAB META SKIP]', {
                server: normalizedServer,
                configuredTab,
                sheetId,
                message: error?.message,
                code: error?.code || error?.status
            });
            return configuredTab;
        }
    }

    async function recordOperation(kind, payload, extra = {}) {
        if (!operationLog || typeof operationLog.record !== 'function') return null;
        const server = normalizePayrollServer(payload?.server);
        const normalizedPayload = payload ? { ...payload, server } : payload;
        return operationLog.record({
            kind,
            action: payload?.amount < 0 || payload?.rawAmount < 0 ? 'cancel' : 'approve',
            server,
            shift: payload?.shift,
            userName: payload?.userName,
            payload: normalizedPayload,
            ...extra
        }).catch(error => {
            logger.warn?.('[PAYROLL OPERATION LOG SKIP]', error?.message || error);
            return null;
        });
    }

    function operationAction(payload = {}) {
        return payload?.amount < 0 || payload?.rawAmount < 0 ? 'cancel' : 'approve';
    }

    async function hasSuccessfulMessageOperation(kind, payload = {}, extra = {}) {
        const messageId = extra.messageId || payload.messageId;
        if (!messageId || !operationLog || typeof operationLog.listRecent !== 'function') return false;
        const action = extra.action || operationAction(payload);
        const server = normalizePayrollServer(payload.server);
        const entries = await operationLog.listRecent({ limit: 5000 }).catch(error => {
            logger.warn?.('[PAYROLL OPERATION LOG DEDUPE SKIP]', error?.message || error);
            return [];
        });
        return entries.some(entry => (
            entry?.kind === kind &&
            entry?.action === action &&
            String(entry?.messageId || '') === String(messageId) &&
            (!server || normalizePayrollServer(entry?.server || entry?.payload?.server) === server) &&
            (entry?.status === 'success' || entry?.result?.ok === true)
        ));
    }

    function duplicateResult(payload = {}, extra = {}) {
        return {
            ok: true,
            duplicate: true,
            skipped: true,
            server: normalizePayrollServer(payload.server),
            inferredShift: payload.shift || null,
            previousValue: null,
            nextValue: null,
            range: null,
            messageId: extra.messageId || payload.messageId || null
        };
    }

    async function verifyCellValue({ range, expectedValue, logLabel, context = {} }) {
        try {
            const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            }), logger, `${logLabel} VERIFY`, { ...context, range });
            const actualValue = parseNumber(response.data.values?.[0]?.[0]);
            if (actualValue !== Number(expectedValue || 0)) {
                logger.warn?.(`[${logLabel} SHEET VERIFY FAIL]`, {
                    ...context,
                    range,
                    expectedValue,
                    actualValue
                });
                return {
                    ok: false,
                    code: 'write-verify-failed',
                    range,
                    expectedValue,
                    actualValue,
                    errorMessage: `sheet write verification failed: expected ${expectedValue}, got ${actualValue}`
                };
            }
            return { ok: true, range, actualValue };
        } catch (error) {
            logger.warn?.(`[${logLabel} SHEET VERIFY ERROR]`, {
                ...context,
                range,
                expectedValue,
                message: error?.message,
                code: error?.code || error?.status
            });
            return {
                ok: false,
                code: 'write-verify-failed',
                range,
                expectedValue,
                errorMessage: error?.message || 'sheet write verification failed'
            };
        }
    }

    async function adjustAmount({ server, shift, userName, amount, dayOfMonth, resolveCell, logLabel }) {
        let attemptedRange = null;
        const normalizedServer = normalizePayrollServer(server);
        try {
            const tabName = await resolveServerTabTitle(normalizedServer);
            const sectionLabel = sectionLabels[shift];
            if (!tabName || (shift && !sectionLabel)) {
                logger.warn?.(`[${logLabel} SHEET SKIP] Missing tab or section config.`, { server: normalizedServer, shift });
                return { ok: false, code: 'missing-config' };
            }

            const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${quoteSheetName(tabName)}!A1:ZZ120`
            }), logger, logLabel, { server: normalizedServer, shift, userName });
            const rows = response.data.values || [];
            const cell = resolveCell(rows, { sectionLabel, sectionLabels, userName, dayOfMonth, aliases });
            if (!cell.ok) {
                logger.warn?.(`[${logLabel} SHEET MISS]`, {
                    server: normalizedServer,
                    shift,
                    userName,
                    dayOfMonth,
                    code: cell.code,
                    availableUsers: cell.availableUsers
                });
                return { ...cell, server: normalizedServer };
            }

            const previousValue = parseNumber(rows[cell.rowIndex]?.[cell.colIndex]);
            const nextValue = previousValue + amount;
            const range = `${quoteSheetName(tabName)}!${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`;
            attemptedRange = range;

            await withGoogleSheetRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[nextValue]]
                }
            }), logger, logLabel, { server: normalizedServer, shift, userName, range });

            const verified = await verifyCellValue({
                range,
                expectedValue: nextValue,
                logLabel,
                context: { server: normalizedServer, shift, userName, dayOfMonth }
            });
            if (!verified.ok) return { ...verified, server: normalizedServer };

            return {
                ok: true,
                range,
                server: normalizedServer,
                inferredShift: cell.inferredShift || shift,
                previousValue,
                nextValue
            };
        } catch (error) {
            logger.error?.(`[${logLabel} SHEET API ERROR]`, {
                server: normalizedServer,
                shift,
                userName,
                dayOfMonth,
                amount,
                range: attemptedRange,
                message: error?.message,
                code: error?.code || error?.status
            });
            return {
                ok: false,
                code: 'sheet-api-error',
                errorMessage: error?.message,
                range: attemptedRange
            };
        }
    }

    async function addPurchaseUnlocked(payload, extra = {}) {
        const normalizedPayload = { ...payload, server: normalizePayrollServer(payload.server) };
        const kind = normalizedPayload.payrollKind || 'purchase';
        if (await hasSuccessfulMessageOperation(kind, normalizedPayload, extra)) {
            logger.warn?.('[PURCHASE SHEET DEDUPE SKIP]', {
                kind,
                action: operationAction(normalizedPayload),
                messageId: extra.messageId || normalizedPayload.messageId,
                server: normalizedPayload.server,
                shift: normalizedPayload.shift,
                userName: normalizedPayload.userName
            });
            return duplicateResult(normalizedPayload, extra);
        }
        const result = await adjustAmount({ ...normalizedPayload, resolveCell: resolvePurchaseCell, logLabel: 'PURCHASE' });
        if (result.ok) {
            await recordOperation(kind, normalizedPayload, {
                ...extra,
                status: 'success',
                result: { ok: true, range: result.range, nextValue: result.nextValue, duplicate: Boolean(result.duplicate) }
            });
        }
        return result;
    }

    function addPurchase(payload, extra = {}) {
        return runWithMutationWriteLock(payload, () => addPurchaseUnlocked(payload, extra));
    }

    async function addAdenaUnlocked(payload, extra = {}) {
        const normalizedPayload = { ...payload, server: normalizePayrollServer(payload.server) };
        if (await hasSuccessfulMessageOperation('end-adena', normalizedPayload, extra)) {
            logger.warn?.('[ADENA SHEET DEDUPE SKIP]', {
                action: operationAction(normalizedPayload),
                messageId: extra.messageId || normalizedPayload.messageId,
                server: normalizedPayload.server,
                shift: normalizedPayload.shift,
                userName: normalizedPayload.userName
            });
            return duplicateResult(normalizedPayload, extra);
        }
        const result = await adjustAmount({ ...normalizedPayload, resolveCell: resolveAdenaCell, logLabel: 'ADENA' });
        if (result.ok) {
            await recordOperation('end-adena', normalizedPayload, {
                ...extra,
                status: 'success',
                result: { ok: true, range: result.range, nextValue: result.nextValue, duplicate: Boolean(result.duplicate) }
            });
        }
        return result;
    }

    function addAdena(payload, extra = {}) {
        return runWithMutationWriteLock(payload, () => addAdenaUnlocked(payload, extra));
    }

    async function addAdenaWithSummaryUnlocked({ server, shift, userName, amount, rawAmount, dayOfMonth, messageId = null, channelId = null, audit = null }, extra = {}) {
        const normalizedServer = normalizePayrollServer(server);
        const normalizedPayload = { server: normalizedServer, shift, userName, amount, rawAmount, dayOfMonth, messageId, channelId, audit };
        if (await hasSuccessfulMessageOperation('end-adena', normalizedPayload, { method: 'addAdenaWithSummary', ...extra })) {
            logger.warn?.('[ADENA WITH SUMMARY SHEET DEDUPE SKIP]', {
                action: operationAction(normalizedPayload),
                messageId: extra.messageId || messageId,
                server: normalizedServer,
                shift,
                userName
            });
            return duplicateResult(normalizedPayload, extra);
        }
        let attemptedRanges = [];
        try {
            const tabName = await resolveServerTabTitle(normalizedServer);
            const sectionLabel = sectionLabels[shift];
            if (!tabName || (shift && !sectionLabel)) {
                logger.warn?.('[ADENA WITH SUMMARY SHEET SKIP] Missing tab or section config.', { server: normalizedServer, shift });
                return { ok: false, code: 'missing-config' };
            }

            const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${quoteSheetName(tabName)}!A1:ZZ160`
            }), logger, 'ADENA WITH SUMMARY', { server: normalizedServer, shift, userName });
            const rows = response.data.values || [];
            const adenaCell = resolveAdenaCell(rows, { sectionLabel, sectionLabels, userName, dayOfMonth, aliases });
            if (!adenaCell.ok) {
                logger.warn?.('[ADENA WITH SUMMARY SHEET MISS]', {
                    server: normalizedServer,
                    shift,
                    userName,
                    dayOfMonth,
                    code: adenaCell.code,
                    availableUsers: adenaCell.availableUsers
                });
                return { ...adenaCell, server: normalizedServer };
            }
            const summaryCell = resolveAdenaSummaryCell(rows, { shift: shift || adenaCell.inferredShift, userName, aliases });
            if (!summaryCell.ok) {
                logger.warn?.('[ADENA WITH SUMMARY SHEET MISS]', {
                    server: normalizedServer,
                    shift: shift || adenaCell.inferredShift,
                    userName,
                    dayOfMonth,
                    code: summaryCell.code
                });
                return { ...summaryCell, server: normalizedServer };
            }

            const adenaPreviousValue = parseNumber(rows[adenaCell.rowIndex]?.[adenaCell.colIndex]);
            const adenaNextValue = adenaPreviousValue + amount;
            const summaryPreviousValue = parseNumber(rows[summaryCell.rowIndex]?.[summaryCell.colIndex]);
            const summaryNextValue = getNextSummaryAdenaValue(summaryPreviousValue, rawAmount);
            const adenaRange = `${quoteSheetName(tabName)}!${getColumnLetter(adenaCell.colIndex)}${adenaCell.rowIndex + 1}`;
            const summaryRange = `${quoteSheetName(tabName)}!${getColumnLetter(summaryCell.colIndex)}${summaryCell.rowIndex + 1}`;
            attemptedRanges = [adenaRange, summaryRange];

            await withGoogleSheetRetry(() => sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                        { range: adenaRange, values: [[adenaNextValue]] },
                        { range: summaryRange, values: [[summaryNextValue]] }
                    ]
                }
            }), logger, 'ADENA WITH SUMMARY', { server: normalizedServer, shift, userName, ranges: attemptedRanges });

            const adenaVerified = await verifyCellValue({
                range: adenaRange,
                expectedValue: adenaNextValue,
                logLabel: 'ADENA WITH SUMMARY',
                context: { server: normalizedServer, shift, userName, dayOfMonth }
            });
            if (!adenaVerified.ok) return { ...adenaVerified, server: normalizedServer, ranges: attemptedRanges };

            const summaryVerified = await verifyCellValue({
                range: summaryRange,
                expectedValue: summaryNextValue,
                logLabel: 'ADENA WITH SUMMARY',
                context: { server: normalizedServer, shift, userName, dayOfMonth, summary: true }
            });
            if (!summaryVerified.ok) return { ...summaryVerified, server: normalizedServer, ranges: attemptedRanges };

            const result = {
                ok: true,
                range: adenaRange,
                summaryRange,
                server: normalizedServer,
                inferredShift: adenaCell.inferredShift || summaryCell.inferredShift || shift,
                previousValue: adenaPreviousValue,
                nextValue: adenaNextValue,
                summaryPreviousValue,
                summaryNextValue
            };
            await recordOperation('end-adena', normalizedPayload, {
                method: 'addAdenaWithSummary',
                ...extra,
                status: 'success',
                result: {
                    ok: true,
                    range: result.range,
                    summaryRange: result.summaryRange,
                    nextValue: result.nextValue,
                    summaryNextValue: result.summaryNextValue
                }
            });
            return result;
        } catch (error) {
            logger.error?.('[ADENA WITH SUMMARY SHEET API ERROR]', {
                server: normalizedServer,
                shift,
                userName,
                dayOfMonth,
                amount,
                rawAmount,
                ranges: attemptedRanges,
                message: error?.message,
                code: error?.code || error?.status
            });
            return {
                ok: false,
                code: 'sheet-api-error',
                errorMessage: error?.message,
                ranges: attemptedRanges
            };
        }
    }

    function addAdenaWithSummary(payload, extra = {}) {
        return runWithSummaryWriteLock(payload, () => (
            runWithMutationWriteLock(payload, () => addAdenaWithSummaryUnlocked(payload, extra))
        ));
    }

    async function resetAdenaSummaryUnlocked({ shift, bounds = null, scheduledAt = null } = {}) {
        const normalizedShift = String(shift || '').trim().toUpperCase();
        if (!['DAY', 'NIGHT'].includes(normalizedShift)) {
            return { ok: false, code: 'invalid-shift', shift: normalizedShift || null };
        }

        let approvedOperations = [];
        if (bounds?.start?.toISOString && bounds?.end?.toISOString && typeof operationLog?.listRecent === 'function') {
            try {
                const recentOperations = await operationLog.listRecent({ limit: 10_000 });
                approvedOperations = selectEndAdenaOperations(recentOperations, {
                    shift: normalizedShift,
                    from: bounds.start.toISOString(),
                    to: new Date().toISOString(),
                    shiftStartAt: bounds.start.toISOString(),
                    shiftEndAt: bounds.end.toISOString()
                });
            } catch (error) {
                logger.error?.('[ADENA SUMMARY RESET APPROVAL LOG ERROR]', {
                    shift: normalizedShift,
                    message: error?.message,
                    code: error?.code || error?.status
                });
                return {
                    ok: false,
                    code: 'approval-log-read-failed',
                    shift: normalizedShift,
                    inspected: 0,
                    cleared: 0,
                    preserved: 0,
                    results: []
                };
            }
        }

        const servers = [...new Set(Object.keys(serverTabs)
            .map(normalizePayrollServer)
            .filter(Boolean))];
        const results = [];
        const snapshots = [];

        for (const server of servers) {
            let ranges = [];
            try {
                const tabName = await resolveServerTabTitle(server);
                if (!tabName) {
                    results.push({ ok: false, server, code: 'missing-config' });
                    continue;
                }

                const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `${quoteSheetName(tabName)}!A1:ZZ160`
                }), logger, 'ADENA SUMMARY RESET', { server, shift: normalizedShift });
                const rows = response.data.values || [];
                const cells = collectAdenaSummaryResetCells(rows, normalizedShift);
                if (!cells.length) {
                    results.push({ ok: false, server, code: 'summary-shift-not-found' });
                    continue;
                }
                const serverOperations = approvedOperations.filter(operation => (
                    normalizePayrollServer(operation.server || operation.payload?.server) === server
                ));
                const resetCells = cells.map(cell => {
                    const cellOperations = serverOperations.filter(operation => namesReferToSameSheetUser(
                        cell.userName,
                        operation.userName || operation.payload?.userName,
                        aliases
                    ));
                    const reduced = reduceEndAdenaOperations(cellOperations, { fromZero: true });
                    return { ...cell, expectedValue: reduced.expectedValue };
                });
                snapshots.push({
                    server,
                    tabName,
                    cells: resetCells.map(cell => ({
                        userName: cell.userName,
                        previousValue: cell.previousValue,
                        expectedValue: cell.expectedValue,
                        range: `${quoteSheetName(tabName)}!${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`
                    }))
                });

                const changedCells = resetCells.filter(cell => cell.previousValue !== cell.expectedValue);
                ranges = changedCells.map(cell => (
                    `${quoteSheetName(tabName)}!${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`
                ));
                if (ranges.length) {
                    await withGoogleSheetRetry(() => sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId,
                        requestBody: {
                            valueInputOption: 'USER_ENTERED',
                            data: changedCells.map((cell, index) => ({
                                range: ranges[index],
                                values: [[cell.expectedValue]]
                            }))
                        }
                    }), logger, 'ADENA SUMMARY RESET', { server, shift: normalizedShift, ranges });

                    const verification = await withGoogleSheetRetry(() => sheets.spreadsheets.values.batchGet({
                        spreadsheetId,
                        ranges
                    }), logger, 'ADENA SUMMARY RESET VERIFY', { server, shift: normalizedShift, ranges });
                    const failedRanges = ranges.filter((range, index) => (
                        parseNumber(verification.data.valueRanges?.[index]?.values?.[0]?.[0]) !== changedCells[index].expectedValue
                    ));
                    if (failedRanges.length) {
                        results.push({
                            ok: false,
                            server,
                            code: 'verification-failed',
                            ranges: failedRanges
                        });
                        continue;
                    }
                }

                results.push({
                    ok: true,
                    server,
                    tabName,
                    inspected: resetCells.length,
                    cleared: changedCells.filter(cell => cell.expectedValue === 0).length,
                    preserved: resetCells.filter(cell => cell.expectedValue > 0).length,
                    corrected: changedCells.filter(cell => cell.expectedValue > 0).length,
                    ranges
                });
            } catch (error) {
                logger.error?.('[ADENA SUMMARY RESET SHEET API ERROR]', {
                    server,
                    shift: normalizedShift,
                    ranges,
                    message: error?.message,
                    code: error?.code || error?.status
                });
                results.push({
                    ok: false,
                    server,
                    code: 'sheet-api-error',
                    errorMessage: error?.message,
                    ranges
                });
            }
        }

        const summary = {
            ok: results.length > 0 && results.every(result => result.ok),
            shift: normalizedShift,
            inspected: results.reduce((sum, result) => sum + (result.inspected || 0), 0),
            cleared: results.reduce((sum, result) => sum + (result.cleared || 0), 0),
            preserved: results.reduce((sum, result) => sum + (result.preserved || 0), 0),
            corrected: results.reduce((sum, result) => sum + (result.corrected || 0), 0),
            results
        };
        await operationLog?.record?.({
            kind: 'end-adena-summary-reset',
            action: 'reset',
            shift: normalizedShift,
            status: summary.ok ? 'success' : 'failed',
            payload: {
                shift: normalizedShift,
                scheduledAt,
                shiftStartAt: bounds?.start?.toISOString?.() || null,
                shiftEndAt: bounds?.end?.toISOString?.() || null
            },
            result: { ...summary, snapshots },
            source: 'scheduler'
        });
        return summary;
    }

    function resetAdenaSummary(payload = {}) {
        return runWithSummaryWriteLock(payload, () => resetAdenaSummaryUnlocked(payload));
    }

    async function readAdenaSummary({ shift } = {}) {
        const normalizedShift = String(shift || '').trim().toUpperCase();
        if (!['DAY', 'NIGHT'].includes(normalizedShift)) {
            return { ok: false, code: 'invalid-shift', shift: normalizedShift || null, cells: [], results: [] };
        }

        const servers = [...new Set(Object.keys(serverTabs).map(normalizePayrollServer).filter(Boolean))];
        const results = [];
        const cells = [];
        for (const server of servers) {
            try {
                const tabName = await resolveServerTabTitle(server);
                if (!tabName) {
                    results.push({ ok: false, server, code: 'missing-config' });
                    continue;
                }
                const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                    spreadsheetId,
                    range: `${quoteSheetName(tabName)}!A1:ZZ160`
                }), logger, 'ADENA SUMMARY READ', { server, shift: normalizedShift });
                const rows = response.data.values || [];
                const serverCells = collectAdenaSummaryResetCells(rows, normalizedShift).map(cell => ({
                    server,
                    tabName,
                    shift: normalizedShift,
                    userName: cell.userName,
                    value: cell.previousValue,
                    range: `${quoteSheetName(tabName)}!${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`
                }));
                if (!serverCells.length) {
                    results.push({ ok: false, server, code: 'summary-shift-not-found' });
                    continue;
                }
                cells.push(...serverCells);
                results.push({ ok: true, server, tabName, inspected: serverCells.length });
            } catch (error) {
                logger.error?.('[ADENA SUMMARY READ ERROR]', {
                    server,
                    shift: normalizedShift,
                    message: error?.message,
                    code: error?.code || error?.status
                });
                results.push({ ok: false, server, code: 'sheet-api-error', errorMessage: error?.message });
            }
        }
        return {
            ok: results.length > 0 && results.every(result => result.ok),
            shift: normalizedShift,
            cells,
            results
        };
    }

    async function repairAdenaSummaryUnlocked({ shift, expectedValues = [] } = {}) {
        const snapshot = await readAdenaSummary({ shift });
        if (!snapshot.ok) return { ...snapshot, corrected: 0, corrections: [], unresolved: [] };

        const unresolved = [];
        const correctionByRange = new Map();
        for (const expected of expectedValues || []) {
            const server = normalizePayrollServer(expected.server);
            const candidates = new Set(resolveSheetNameCandidates(expected.userName, aliases));
            const cell = snapshot.cells.find(item => (
                item.server === server && candidates.has(normalize(item.userName))
            ));
            if (!cell) {
                unresolved.push({ server, userName: expected.userName, code: 'summary-user-not-found' });
                continue;
            }
            const expectedValue = Math.max(0, parseNumber(expected.value));
            if (cell.value === expectedValue) continue;
            correctionByRange.set(cell.range, {
                ...cell,
                previousValue: cell.value,
                expectedValue
            });
        }

        const corrections = [...correctionByRange.values()];
        const grouped = new Map();
        for (const correction of corrections) {
            const list = grouped.get(correction.server) || [];
            list.push(correction);
            grouped.set(correction.server, list);
        }
        const failures = [];

        for (const [server, serverCorrections] of grouped) {
            const ranges = serverCorrections.map(item => item.range);
            try {
                await withGoogleSheetRetry(() => sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: serverCorrections.map(item => ({
                            range: item.range,
                            values: [[item.expectedValue]]
                        }))
                    }
                }), logger, 'ADENA SUMMARY REPAIR', { server, shift: snapshot.shift, ranges });
                const verification = await withGoogleSheetRetry(() => sheets.spreadsheets.values.batchGet({
                    spreadsheetId,
                    ranges
                }), logger, 'ADENA SUMMARY REPAIR VERIFY', { server, shift: snapshot.shift, ranges });
                const failedRanges = ranges.filter((range, index) => (
                    parseNumber(verification.data.valueRanges?.[index]?.values?.[0]?.[0]) !== serverCorrections[index].expectedValue
                ));
                if (failedRanges.length) throw Object.assign(new Error('Adena summary repair verification failed'), { failedRanges });
            } catch (error) {
                let rolledBack = false;
                try {
                    await withGoogleSheetRetry(() => sheets.spreadsheets.values.batchUpdate({
                        spreadsheetId,
                        requestBody: {
                            valueInputOption: 'USER_ENTERED',
                            data: serverCorrections.map(item => ({
                                range: item.range,
                                values: [[item.previousValue]]
                            }))
                        }
                    }), logger, 'ADENA SUMMARY REPAIR ROLLBACK', { server, shift: snapshot.shift, ranges });
                    rolledBack = true;
                } catch (rollbackError) {
                    logger.error?.('[ADENA SUMMARY REPAIR ROLLBACK ERROR]', {
                        server,
                        shift: snapshot.shift,
                        message: rollbackError?.message
                    });
                }
                failures.push({
                    server,
                    code: 'repair-failed',
                    errorMessage: error?.message,
                    ranges: error?.failedRanges || ranges,
                    rolledBack
                });
            }
        }

        return {
            ok: unresolved.length === 0 && failures.length === 0,
            shift: snapshot.shift,
            inspected: snapshot.cells.length,
            corrected: corrections.length - failures.reduce((sum, failure) => (
                sum + corrections.filter(item => item.server === failure.server).length
            ), 0),
            corrections,
            unresolved,
            failures
        };
    }

    function repairAdenaSummary(payload = {}) {
        return runWithSummaryWriteLock(payload, () => repairAdenaSummaryUnlocked(payload));
    }

    return {
        addPurchase,
        addAdena,
        addAdenaWithSummary,
        resetAdenaSummary,
        readAdenaSummary,
        repairAdenaSummary
    };
}

module.exports = {
    createPurchaseSheetService,
    resolvePurchaseCell,
    resolveAdenaCell,
    resolveAdenaSummaryCell,
    collectAdenaSummaryResetCells,
    findSectionHeader,
    findUserColumnInHeader,
    findDayRow,
    getColumnLetter,
    parseNumber,
    getNextSummaryAdenaValue,
    normalizePayrollServer,
    resolveServerSheetId,
    normalizeAliasMap,
    resolveSheetName,
    resolveSheetNameCandidates,
    getSectionCandidates,
    listHeaderUserNames
};







