'use strict';

const {
    SERVER_LABELS,
    parseNumber,
    parseGreatTabPayrollRows
} = require('../utils/payrollGreatTabParser');

const RAW_DATA_SHEET = 'Raw_Data';
const PAYROLL_PERIOD_STATE_SHEET = 'Payroll_Period_State';
const RECENT_SUMMARY_SHEET = '\uCD5C\uADFC_3\uC77C_\uC694\uC57D';
const LEGACY_SUMMARY_SHEET = '\uC804\uCCB4 \uC694\uC57D';
const WORKLIST_DAY_DATE_RANGES = ['A8:A10', 'A34:A36'];
const PAYROLL_PERIOD_STATE_HEADERS = [
    'periodKey',
    'periodStart',
    'periodEnd',
    'status',
    'manualSavedAt',
    'autoSavedAt',
    'closedAt',
    'source',
    'worklistEndDate',
    'updatedAt',
    'notes'
];

function hasSheetError(rows) {
    return rows.some(row => row.some(value => String(value || '').startsWith('#')));
}

function mapSummaryRows(rows) {
    return rows.map(row => ({
        server: String(row[0] || '').trim(),
        totalAdena: parseNumber(row[1]),
        grossSalary: parseNumber(row[2]),
        txFee: parseNumber(row[3]),
        playerShare: parseNumber(row[4]),
        ownerShare: parseNumber(row[5]),
        totalPeso: parseNumber(row[6])
    })).filter(row => row.server);
}

function parseWorklistDayNumber(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31) return value;
    const text = String(value || '').trim();
    if (!/^\d{1,2}$/.test(text)) return null;
    const day = Number(text);
    return day >= 1 && day <= 31 ? day : null;
}

function buildNearestDateFromDayNumber(day, now = new Date()) {
    if (!day) return null;
    const base = new Date(now);
    const candidates = [-1, 0, 1]
        .map(offset => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, day)))
        .filter(date => date.getUTCDate() === day && Number.isFinite(date.getTime()));
    if (!candidates.length) return null;
    candidates.sort((a, b) => Math.abs(a.getTime() - base.getTime()) - Math.abs(b.getTime() - base.getTime()));
    return candidates[0];
}

function findLatestWorklistDateFromDayRows(rows, now = new Date()) {
    let latest = null;
    for (const row of rows || []) {
        const day = parseWorklistDayNumber(row?.[0]);
        const date = buildNearestDateFromDayNumber(day, now);
        if (date && (!latest || date > latest)) latest = date;
    }
    return latest;
}

function formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

function parseGoogleSerialDate(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date : null;
}

function parseDateOnly(value) {
    if (typeof value === 'number') return parseGoogleSerialDate(value);
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeDateCell(value) {
    return formatDate(parseDateOnly(value)) || String(value || '').trim();
}

function payrollSavedByLabel(trigger) {
    const automatic = isAutomaticPayrollTrigger(trigger);
    return automatic ? '시스템자동저장' : 'GREAT 수동저장';
}

function isAutomaticPayrollTrigger(trigger) {
    const normalized = String(trigger || '').toLowerCase();
    return normalized.includes('cron')
        || normalized.includes('auto')
        || normalized.includes('three-day-night-close');
}

function extractPayrollRoundNumber(value) {
    const match = String(value || '').match(/(\d+)\s*회차/);
    return match ? Number(match[1]) : null;
}

function payrollDayRangeLabel(periodState, requestedLabel = '') {
    const start = String(periodState?.periodStart || '').match(/-(\d{2})$/);
    const end = String(periodState?.periodEnd || '').match(/-(\d{2})$/);
    if (start && end) return `${Number(start[1])}~${Number(end[1])}일`;
    const requested = String(requestedLabel || '').match(/(\d{1,2})\s*~\s*(\d{1,2})\s*일?/);
    return requested ? `${Number(requested[1])}~${Number(requested[2])}일` : '';
}

function formatPayrollPeriodLabel(roundNumber, periodState, requestedLabel = '') {
    const round = Number.isInteger(roundNumber) && roundNumber > 0 ? roundNumber : 1;
    const dayRange = payrollDayRangeLabel(periodState, requestedLabel);
    return `${round}회차${dayRange ? ` ${dayRange}` : ''}`;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function createPeriodStateFromEndDate(periodEndDate, {
    now = new Date(),
    source = 'worklist-great',
    worklistEndDate = periodEndDate,
    status = 'OPEN',
    notes = ''
} = {}) {
    const end = new Date(periodEndDate);
    const start = addDays(end, -2);
    const periodStart = formatDate(start);
    const periodEnd = formatDate(end);
    const key = `${periodStart}_${periodEnd}`;
    return {
        periodKey: key,
        periodStart,
        periodEnd,
        status,
        manualSavedAt: '',
        autoSavedAt: '',
        closedAt: '',
        source,
        worklistEndDate: formatDate(worklistEndDate),
        updatedAt: new Date(now).toISOString(),
        notes,
        rowNumber: null
    };
}

function periodStateToRow(state) {
    return PAYROLL_PERIOD_STATE_HEADERS.map(header => state?.[header] || '');
}

function rowToPeriodState(row, rowNumber) {
    const state = {};
    PAYROLL_PERIOD_STATE_HEADERS.forEach((header, index) => {
        const value = row?.[index];
        state[header] = ['periodStart', 'periodEnd', 'worklistEndDate'].includes(header)
            ? normalizeDateCell(value)
            : String(value || '').trim();
    });
    state.rowNumber = rowNumber;
    return state;
}

function createPayrollArchiveService({
    google,
    keyFile,
    spreadsheetId,
    greatSpreadsheetId = spreadsheetId,
    serverTabs = {},
    serverSheetIds = {},
    operationLog = null,
    logger = console
}) {
    if (!google) throw new TypeError('google must be provided');
    if (!keyFile) throw new TypeError('keyFile must be provided');
    if (!spreadsheetId) throw new TypeError('spreadsheetId must be provided');
    if (spreadsheetId === greatSpreadsheetId && process.env.ALLOW_WORKLIST_PAYROLL_WRITES !== '1') {
        throw new Error('Refusing to write payroll Raw_Data into the Work list spreadsheet.');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    let saveInProgress = false;
    let resolvedServerTabs = null;

    async function resolveRequiredServerTabs() {
        if (resolvedServerTabs) return resolvedServerTabs;
        const required = Object.entries(serverSheetIds)
            .filter(([, sheetId]) => Number.isInteger(Number(sheetId)) && Number(sheetId) >= 0);
        if (!required.length) {
            resolvedServerTabs = { ...serverTabs };
            return resolvedServerTabs;
        }
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId: greatSpreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const byId = new Map((metadata.data.sheets || []).map(sheet => [
            Number(sheet.properties?.sheetId),
            String(sheet.properties?.title || '')
        ]));
        resolvedServerTabs = {};
        for (const [server, sheetId] of required) {
            const title = byId.get(Number(sheetId));
            if (!title) throw new Error(`Required Work list source gid missing: ${server}=${sheetId}`);
            resolvedServerTabs[server] = title;
        }
        return resolvedServerTabs;
    }

    async function getSheetRows(tabName, sheetId = greatSpreadsheetId, range = 'A1:ZZ120') {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: `'${tabName}'!${range}`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        return response.data.values || [];
    }

    async function getWorklistPayrollReferenceDate(now = new Date()) {
        const exactTabs = await resolveRequiredServerTabs();
        const tabs = [exactTabs.PAAGRIO, exactTabs.HEINE].filter(Boolean);
        let latest = null;

        for (const tab of tabs) {
            for (const range of WORKLIST_DAY_DATE_RANGES) {
                try {
                    const rows = await getSheetRows(tab, greatSpreadsheetId, range);
                    const found = findLatestWorklistDateFromDayRows(rows, now);
                    if (found && (!latest || found > latest)) latest = found;
                } catch (error) {
                    logger.warn?.('[PAYROLL READ] Work list date rows read failed.', {
                        tab,
                        range,
                        message: error?.message,
                        code: error?.code || error?.status
                    });
                }
            }
        }

        return latest;
    }

    async function ensurePayrollPeriodStateSheet() {
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const exists = (metadata.data.sheets || []).some(sheet => sheet.properties?.title === PAYROLL_PERIOD_STATE_SHEET);
        if (!exists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: PAYROLL_PERIOD_STATE_SHEET,
                                gridProperties: { rowCount: 200, columnCount: PAYROLL_PERIOD_STATE_HEADERS.length }
                            }
                        }
                    }]
                }
            });
        }

        const headerResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${PAYROLL_PERIOD_STATE_SHEET}'!A1:K1`
        }).catch(() => ({ data: { values: [] } }));
        const currentHeaders = headerResponse.data.values?.[0] || [];
        const needsHeader = PAYROLL_PERIOD_STATE_HEADERS.some((header, index) => currentHeaders[index] !== header);
        if (needsHeader) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${PAYROLL_PERIOD_STATE_SHEET}'!A1:K1`,
                valueInputOption: 'RAW',
                requestBody: { values: [PAYROLL_PERIOD_STATE_HEADERS] }
            });
        }
    }

    async function readPayrollPeriodStates() {
        await ensurePayrollPeriodStateSheet();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${PAYROLL_PERIOD_STATE_SHEET}'!A2:K500`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        return (response.data.values || [])
            .map((row, index) => rowToPeriodState(row, index + 2))
            .filter(state => state.periodKey);
    }

    function chooseLatestPeriodState(states) {
        return [...states].sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)))[0] || null;
    }

    async function getOrCreatePayrollPeriodState({ referenceDate = null, now = new Date(), source = 'worklist-great' } = {}) {
        const states = await readPayrollPeriodStates();
        const worklistEnd = referenceDate ? new Date(referenceDate) : null;

        if (worklistEnd && Number.isFinite(worklistEnd.getTime())) {
            const next = createPeriodStateFromEndDate(worklistEnd, {
                now,
                source,
                worklistEndDate: worklistEnd
            });
            const existing = states.find(state => state.periodKey === next.periodKey);
            if (existing) return { ...existing, referenceDate: worklistEnd };

            const latest = chooseLatestPeriodState(states);
            if (!latest || String(next.periodEnd).localeCompare(String(latest.periodEnd)) > 0) {
                const targetRow = states.length + 2;
                await sheets.spreadsheets.values.update({
                    spreadsheetId,
                    range: `'${PAYROLL_PERIOD_STATE_SHEET}'!A${targetRow}:K${targetRow}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [periodStateToRow(next)] }
                });
                return { ...next, rowNumber: targetRow, referenceDate: worklistEnd };
            }
        }

        const latest = chooseLatestPeriodState(states);
        return latest ? { ...latest, referenceDate: parseDateOnly(latest.periodEnd) } : null;
    }

    async function markPayrollPeriodStateClosed(state, {
        savedAt = new Date(),
        trigger = 'manual',
        savedBy = '',
        result = null
    } = {}) {
        if (!state?.periodKey || !state.rowNumber) return null;
        await ensurePayrollPeriodStateSheet();
        const closedAt = new Date(savedAt).toISOString();
        const isAuto = String(trigger || '').toLowerCase().includes('cron')
            || String(trigger || '').toLowerCase().includes('auto')
            || String(trigger || '').toLowerCase().includes('three-day-night-close');
        const next = {
            ...state,
            status: 'CLOSED',
            manualSavedAt: isAuto ? state.manualSavedAt || '' : closedAt,
            autoSavedAt: isAuto ? closedAt : state.autoSavedAt || '',
            closedAt,
            updatedAt: closedAt,
            notes: [
                state.notes,
                `${trigger || 'manual'} by ${savedBy || '-'} row ${result?.row || '-'}`
            ].filter(Boolean).join(' / ')
        };

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${PAYROLL_PERIOD_STATE_SHEET}'!A${state.rowNumber}:K${state.rowNumber}`,
            valueInputOption: 'RAW',
            requestBody: { values: [periodStateToRow(next)] }
        });
        return next;
    }

    async function readFromGreatTabs() {
        const exactTabs = await resolveRequiredServerTabs();
        const specs = [
            { tab: exactTabs.PAAGRIO, server: SERVER_LABELS.PAAGRIO },
            { tab: exactTabs.HEINE, server: SERVER_LABELS.HEINE }
        ].filter(item => item.tab);

        const rows = [];
        for (const spec of specs) {
            const tabRows = await getSheetRows(spec.tab);
            const parsed = parseGreatTabPayrollRows(tabRows, spec.server);
            if (!parsed.ok) {
                return { ok: false, code: `great-tab-${spec.server}-${parsed.code}` };
            }
            rows.push(parsed.row);
        }

        if (rows.length < 1) return { ok: false, code: 'missing-great-tabs' };
        return { ok: true, rows, source: 'great-tabs' };
    }

    async function readFromRecentSummarySheet() {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${RECENT_SUMMARY_SHEET}'!B5:H6`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        const rows = response.data.values || [];
        if (rows.length < 2 || hasSheetError(rows)) {
            return { ok: false, code: 'recent-summary-not-ready' };
        }
        return {
            ok: true,
            rows: rows.map(row => ({
                server: String(row[0] || '').trim(),
                totalAdena: parseNumber(row[1]),
                grossSalary: parseNumber(row[2]),
                txFee: parseNumber(row[3]),
                playerShare: parseNumber(row[4]),
                ownerShare: parseNumber(row[5]),
                totalPeso: parseNumber(row[6])
            })).filter(row => row.server),
            source: RECENT_SUMMARY_SHEET
        };
    }

    async function readFromLegacySummarySheet() {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${LEGACY_SUMMARY_SHEET}'!A4:G5`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        const rows = response.data.values || [];
        if (rows.length < 2 || hasSheetError(rows)) {
            return { ok: false, code: 'summary-not-ready' };
        }
        return { ok: true, rows: mapSummaryRows(rows), source: LEGACY_SUMMARY_SHEET };
    }

    async function readCurrentSummary() {
        try {
            const great = await readFromGreatTabs();
            if (great.ok) return great;
            logger.warn?.('[PAYROLL READ] Great tabs unavailable, trying summary sheets.', { code: great.code });
        } catch (error) {
            logger.warn?.('[PAYROLL READ] Great tabs read failed.', { message: error?.message });
        }

        try {
            const recent = await readFromRecentSummarySheet();
            if (recent.ok) return recent;
        } catch (error) {
            logger.warn?.('[PAYROLL READ] Recent summary read failed.', { message: error?.message });
        }

        return readFromLegacySummarySheet();
    }

    async function ensureRawDataSheet() {
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const exists = (metadata.data.sheets || []).some(sheet => sheet.properties?.title === RAW_DATA_SHEET);
        if (exists) return;

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    addSheet: {
                        properties: {
                            title: RAW_DATA_SHEET,
                            gridProperties: { rowCount: 500, columnCount: 12 }
                        }
                    }
                }]
            }
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${RAW_DATA_SHEET}'!A1:J1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    '\uC800\uC7A5\uC77C\uC2DC',
                    '\uD68C\uCC28',
                    '\uC11C\uBC84',
                    '\uCD1D \uD68D\uB4DD \uC544\uB370\uB098',
                    '\uCD1D \uAE09\uC5EC',
                    '\uC218\uC218\uB8CC 5%',
                    '\uC9C1\uC6D0 65%',
                    '\uC624\uB108 35%',
                    '\uCD1D \uD398\uC18C',
                    '\uC800\uC7A5\uC790'
                ]]
            }
        });
    }

    async function getNextRawDataRow() {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${RAW_DATA_SHEET}'!A:A`
        });
        const rows = response.data.values || [];
        return Math.max(rows.length + 1, 2);
    }

    async function getNextPayrollRoundNumber() {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${RAW_DATA_SHEET}'!B2:B5000`,
            valueRenderOption: 'FORMATTED_VALUE'
        });
        const maxRound = (response.data.values || []).reduce((max, row) => {
            const round = extractPayrollRoundNumber(row?.[0]);
            return round && round > max ? round : max;
        }, 0);
        return maxRound + 1;
    }

    async function findClosedPeriodArchiveTarget(state, requiredRowCount = 2) {
        const dayRange = payrollDayRangeLabel(state);
        if (!dayRange) return null;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${RAW_DATA_SHEET}'!A2:J5000`,
            valueRenderOption: 'FORMATTED_VALUE'
        });
        const rows = response.data.values || [];
        const matches = rows
            .map((row, index) => ({
                rowNumber: index + 2,
                label: String(row?.[1] || '').trim()
            }))
            .filter(item => item.label.includes(dayRange));
        if (!matches.length) return null;

        const latestLabel = matches[matches.length - 1].label;
        const sameLabel = matches.filter(item => item.label === latestLabel);
        const lastGroup = sameLabel.slice(-Math.max(1, requiredRowCount));
        if (lastGroup.length < requiredRowCount) return null;
        const contiguous = lastGroup.every((item, index) => (
            index === 0 || item.rowNumber === lastGroup[index - 1].rowNumber + 1
        ));
        if (!contiguous) return null;
        return {
            row: lastGroup[0].rowNumber,
            label: latestLabel
        };
    }

    async function getLastRawDataTimestamp() {
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `'${RAW_DATA_SHEET}'!A2:A5000`,
                valueRenderOption: 'UNFORMATTED_VALUE'
            });
            const rows = response.data.values || [];
            for (let i = rows.length - 1; i >= 0; i -= 1) {
                const text = String(rows[i]?.[0] || '').trim();
                const parsed = Date.parse(text.replace(' ', 'T'));
                if (Number.isFinite(parsed)) return parsed;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    async function saveCurrent({ periodLabel, savedBy, savedAt = new Date(), trigger = 'manual', periodState = null } = {}) {
        if (saveInProgress) {
            return { ok: false, code: 'archive-in-progress' };
        }
        saveInProgress = true;
        try {
            const state = periodState || await getOrCreatePayrollPeriodState({
                referenceDate: await getWorklistPayrollReferenceDate(savedAt),
                now: savedAt,
                source: 'save-current'
            });
            const closedPeriod = Boolean(state && String(state.status || '').toUpperCase() === 'CLOSED');
            const automaticTrigger = isAutomaticPayrollTrigger(trigger);
            if (closedPeriod && automaticTrigger) {
                return {
                    ok: false,
                    code: 'period-already-closed',
                    periodLabel: periodLabel || `${state.periodStart}~${state.periodEnd}`,
                    periodState: state
                };
            }

            const current = await readCurrentSummary();
            if (!current.ok) return current;

            await ensureRawDataSheet();
            const correctionTarget = closedPeriod
                ? await findClosedPeriodArchiveTarget(state, current.rows.length)
                : null;
            if (closedPeriod && !correctionTarget) {
                return {
                    ok: false,
                    code: 'closed-period-archive-not-found',
                    periodLabel: periodLabel || `${state.periodStart}~${state.periodEnd}`,
                    periodState: state
                };
            }
            const nextRow = correctionTarget?.row || await getNextRawDataRow();
            const nextRound = correctionTarget ? null : await getNextPayrollRoundNumber();
            const timestamp = savedAt.toISOString().replace('T', ' ').slice(0, 19);
            const label = correctionTarget?.label || formatPayrollPeriodLabel(nextRound, state, periodLabel);
            const sheetSavedBy = payrollSavedByLabel(trigger);
            const values = current.rows.map(row => [
                timestamp,
                label,
                row.server,
                row.totalAdena,
                row.grossSalary,
                row.txFee,
                row.playerShare,
                row.ownerShare,
                row.totalPeso,
                sheetSavedBy
            ]);

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${RAW_DATA_SHEET}'!A${nextRow}:J${nextRow + values.length - 1}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values }
            });

            const result = {
                ok: true,
                row: nextRow,
                count: values.length,
                periodLabel: label,
                saved: current.rows,
                source: current.source,
                sheet: RAW_DATA_SHEET,
                savedAt: timestamp,
                savedBy: sheetSavedBy,
                corrected: Boolean(correctionTarget)
            };
            if (operationLog && typeof operationLog.record === 'function') {
                await operationLog.record({
                    kind: 'payroll-archive',
                    action: correctionTarget ? 'replace' : 'save',
                    payload: {
                        periodLabel: label,
                        savedBy: savedBy || '',
                        savedAt: timestamp,
                        trigger,
                        spreadsheetId,
                        row: nextRow,
                        rows: current.rows
                    },
                    source: 'payroll-archive-service'
                });
            }
            if (state) {
                result.periodState = await markPayrollPeriodStateClosed(state, {
                    savedAt,
                    trigger,
                    savedBy,
                    result
                });
            }
            return result;
        } catch (error) {
            logger.error?.('[PAYROLL ARCHIVE ERROR]', {
                message: error?.message,
                code: error?.code || error?.status
            });
            return {
                ok: false,
                code: 'sheet-api-error',
                errorMessage: error?.message
            };
        } finally {
            saveInProgress = false;
        }
    }

    return {
        readCurrentSummary,
        getLastRawDataTimestamp,
        getWorklistPayrollReferenceDate,
        getOrCreatePayrollPeriodState,
        markPayrollPeriodStateClosed,
        saveCurrent
    };
}

module.exports = {
    createPayrollArchiveService,
    parseNumber,
    parseWorklistDayNumber,
    buildNearestDateFromDayNumber,
    findLatestWorklistDateFromDayRows,
    createPeriodStateFromEndDate,
    normalizeDateCell,
    payrollSavedByLabel,
    isAutomaticPayrollTrigger,
    extractPayrollRoundNumber,
    payrollDayRangeLabel,
    formatPayrollPeriodLabel,
    RAW_DATA_SHEET,
    PAYROLL_PERIOD_STATE_SHEET,
    RECENT_SUMMARY_SHEET,
    LEGACY_SUMMARY_SHEET,
    PAYROLL_PERIOD_STATE_HEADERS,
    WORKLIST_DAY_DATE_RANGES
};
