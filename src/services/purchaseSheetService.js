'use strict';

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

function resolveSheetName(userName, aliases = {}) {
    const normalized = normalize(userName);
    return aliases[normalized] || normalized;
}

function resolveSheetNameCandidates(userName, aliases = {}) {
    const normalized = normalize(userName);
    return [...new Set([normalized, aliases[normalized]].filter(Boolean))];
}

function parseNumber(value) {
    const parsed = Number.parseInt(String(value || '0').replace(/,/g, '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
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

async function withGoogleSheetRetry(operation, logger, label, context = {}) {
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxAttempts || !isRetryableSheetError(error)) throw error;
            logger.warn?.('[' + label + ' SHEET RETRY]', {
                ...context,
                attempt,
                nextAttempt: attempt + 1,
                retryDelayMs: 0,
                message: error?.message,
                code: error?.code || error?.status || error?.cause?.code
            });
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
        return { ok: false, code: headerRowIndex === -1 ? 'section-not-found' : 'user-not-found' };
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
            if (normalize(row[c]) === 'player' && normalize(row[c + 3]) === 'adena') {
                groups.push({ headerRowIndex: r, playerColIndex: c, adenaColIndex: c + 3 });
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

function createPurchaseSheetService({
    google,
    keyFile,
    spreadsheetId,
    serverTabs,
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

    async function recordOperation(kind, payload, extra = {}) {
        if (!operationLog || typeof operationLog.record !== 'function') return null;
        return operationLog.record({
            kind,
            action: payload?.amount < 0 || payload?.rawAmount < 0 ? 'cancel' : 'approve',
            server: payload?.server,
            shift: payload?.shift,
            userName: payload?.userName,
            payload,
            ...extra
        }).catch(error => {
            logger.warn?.('[PAYROLL OPERATION LOG SKIP]', error?.message || error);
            return null;
        });
    }

    async function adjustAmount({ server, shift, userName, amount, dayOfMonth, resolveCell, logLabel }) {
        let attemptedRange = null;
        try {
            const tabName = serverTabs[server];
            const sectionLabel = sectionLabels[shift];
            if (!tabName || (shift && !sectionLabel)) {
                logger.warn?.(`[${logLabel} SHEET SKIP] Missing tab or section config.`, { server, shift });
                return { ok: false, code: 'missing-config' };
            }

            const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!A1:ZZ120`
            }), logger, logLabel, { server, shift, userName });
            const rows = response.data.values || [];
            const cell = resolveCell(rows, { sectionLabel, sectionLabels, userName, dayOfMonth, aliases });
            if (!cell.ok) return cell;

            const previousValue = parseNumber(rows[cell.rowIndex]?.[cell.colIndex]);
            const nextValue = previousValue + amount;
            const range = `'${tabName}'!${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`;
            attemptedRange = range;

            await withGoogleSheetRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[nextValue]]
                }
            }), logger, logLabel, { server, shift, userName, range });

            return {
                ok: true,
                range,
                inferredShift: cell.inferredShift || shift,
                previousValue,
                nextValue
            };
        } catch (error) {
            logger.error?.(`[${logLabel} SHEET API ERROR]`, {
                server,
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
                errorMessage: error?.message
            };
        }
    }

    async function addPurchase(payload) {
        await recordOperation(payload.payrollKind || 'purchase', payload);
        return adjustAmount({ ...payload, resolveCell: resolvePurchaseCell, logLabel: 'PURCHASE' });
    }

    async function addAdena(payload) {
        await recordOperation('end-adena', payload);
        return adjustAmount({ ...payload, resolveCell: resolveAdenaCell, logLabel: 'ADENA' });
    }

    async function addAdenaWithSummary({ server, shift, userName, amount, rawAmount, dayOfMonth }) {
        await recordOperation('end-adena', { server, shift, userName, amount, rawAmount, dayOfMonth }, { method: 'addAdenaWithSummary' });
        let attemptedRanges = [];
        try {
            const tabName = serverTabs[server];
            const sectionLabel = sectionLabels[shift];
            if (!tabName || (shift && !sectionLabel)) {
                logger.warn?.('[ADENA WITH SUMMARY SHEET SKIP] Missing tab or section config.', { server, shift });
                return { ok: false, code: 'missing-config' };
            }

            const response = await withGoogleSheetRetry(() => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${tabName}'!A1:ZZ160`
            }), logger, 'ADENA WITH SUMMARY', { server, shift, userName });
            const rows = response.data.values || [];
            const adenaCell = resolveAdenaCell(rows, { sectionLabel, sectionLabels, userName, dayOfMonth, aliases });
            if (!adenaCell.ok) return adenaCell;
            const summaryCell = resolveAdenaSummaryCell(rows, { shift: shift || adenaCell.inferredShift, userName, aliases });
            if (!summaryCell.ok) return summaryCell;

            const adenaPreviousValue = parseNumber(rows[adenaCell.rowIndex]?.[adenaCell.colIndex]);
            const adenaNextValue = adenaPreviousValue + amount;
            const summaryPreviousValue = parseNumber(rows[summaryCell.rowIndex]?.[summaryCell.colIndex]);
            const summaryNextValue = summaryPreviousValue + rawAmount;
            const adenaRange = `'${tabName}'!${getColumnLetter(adenaCell.colIndex)}${adenaCell.rowIndex + 1}`;
            const summaryRange = `'${tabName}'!${getColumnLetter(summaryCell.colIndex)}${summaryCell.rowIndex + 1}`;
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
            }), logger, 'ADENA WITH SUMMARY', { server, shift, userName, ranges: attemptedRanges });

            return {
                ok: true,
                range: adenaRange,
                summaryRange,
                inferredShift: adenaCell.inferredShift || summaryCell.inferredShift || shift,
                previousValue: adenaPreviousValue,
                nextValue: adenaNextValue,
                summaryPreviousValue,
                summaryNextValue
            };
        } catch (error) {
            logger.error?.('[ADENA WITH SUMMARY SHEET API ERROR]', {
                server,
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
                errorMessage: error?.message
            };
        }
    }

    return {
        addPurchase,
        addAdena,
        addAdenaWithSummary
    };
}

module.exports = {
    createPurchaseSheetService,
    resolvePurchaseCell,
    resolveAdenaCell,
    resolveAdenaSummaryCell,
    findSectionHeader,
    findUserColumnInHeader,
    findDayRow,
    getColumnLetter,
    parseNumber,
    normalizeAliasMap,
    resolveSheetName,
    resolveSheetNameCandidates,
    getSectionCandidates
};







