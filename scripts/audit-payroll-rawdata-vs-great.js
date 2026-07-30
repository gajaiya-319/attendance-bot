'use strict';

/**
 * Audit Raw_Data payroll archive rows against the live Great tabs.
 *
 * Default mode is dry-run. Use --apply to repair only high-confidence rows.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const {
    SERVER_LABELS,
    columnIndexToLetter,
    parseGreatTabPayrollRows,
    parseNumber
} = require('../src/utils/payrollGreatTabParser');

const RAW_DATA_SHEET = 'Raw_Data';
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LATEST_LOG = path.join(LOG_DIR, 'payroll-rawdata-audit-latest.json');
const REPAIR_LOG = path.join(LOG_DIR, 'payroll-rawdata-repair-log.jsonl');

const METRICS = [
    { key: 'totalAdena', rawIndex: 3, label: '총 획득 아데나', tolerance: 0 },
    { key: 'grossSalary', rawIndex: 4, label: '총 급여', tolerance: 0.5 },
    { key: 'txFee', rawIndex: 5, label: '수수료 5%', tolerance: 0.5 },
    { key: 'playerShare', rawIndex: 6, label: '직원 70%', tolerance: 0.5 },
    { key: 'ownerShare', rawIndex: 7, label: '오너 30%', tolerance: 0.5 },
    { key: 'totalPeso', rawIndex: 8, label: '총 페소', tolerance: 0.01 }
];

function parseArgs(argv) {
    return {
        apply: argv.includes('--apply'),
        allServers: argv.includes('--all-servers'),
        server: readArg(argv, '--server') || 'PAAGRIO',
        period: readArg(argv, '--period') || '',
        log: !argv.includes('--no-log')
    };
}

function readArg(argv, name) {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : '';
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

function payrollSpreadsheetId() {
    return process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
}

function greatSpreadsheetId() {
    return process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
}

function tabName(serverKey) {
    if (serverKey === 'PAAGRIO') {
        return process.env.PURCHASE_PAAGRIO_TAB_NAME || CONFIG.PURCHASE_SERVER_TABS.PAAGRIO || 'Paagrio Great';
    }
    return process.env.PURCHASE_VALACAS_TAB_NAME
        || process.env.PURCHASE_HEINE_TAB_NAME
        || CONFIG.PURCHASE_SERVER_TABS.VALAKAS
        || CONFIG.PURCHASE_SERVER_TABS.HEINE
        || 'Valakas Great';
}

function serverLabel(serverKey) {
    return serverKey === 'PAAGRIO' ? SERVER_LABELS.PAAGRIO : SERVER_LABELS.HEINE;
}

function normalizeServer(value) {
    const text = String(value || '').trim().toUpperCase();
    if (!text) return '';
    if (text.includes('PAAGRIO') || text.includes('파아그리오')) return 'PAAGRIO';
    if (text.includes('VALAKAS') || text.includes('HEINE') || text.includes('발라카스')) return 'VALAKAS';
    return text;
}

function metricValuesFromRawRow(row) {
    return Object.fromEntries(METRICS.map(metric => [metric.key, parseNumber(row?.[metric.rawIndex])]));
}

function metricValuesFromParsedRow(row) {
    return Object.fromEntries(METRICS.map(metric => [metric.key, Number(row?.[metric.key]) || 0]));
}

function diffMetrics(before, after) {
    return Object.fromEntries(METRICS.map(metric => {
        const beforeValue = before[metric.key] || 0;
        const afterValue = after[metric.key] || 0;
        return [metric.key, {
            label: metric.label,
            before: beforeValue,
            after: afterValue,
            delta: afterValue - beforeValue
        }];
    }));
}

function approxEqual(a, b, epsilon = 0.0001) {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= epsilon;
}

function materiallyDifferent(metric, before, after) {
    return Math.abs((Number(after) || 0) - (Number(before) || 0)) > metric.tolerance;
}

function findLatestRawRow(rows, serverKey, period = '') {
    const target = normalizeServer(serverKey);
    const periodText = String(period || '').trim();
    for (let i = rows.length - 1; i >= 1; i -= 1) {
        const row = rows[i] || [];
        if (normalizeServer(row[2]) !== target) continue;
        if (periodText && !String(row[1] || '').includes(periodText)) continue;
        return { rowNumber: i + 1, row };
    }
    return null;
}

function columnLetterToIndex(letter) {
    let index = 0;
    for (const char of String(letter || '').toUpperCase()) {
        const code = char.charCodeAt(0);
        if (code < 65 || code > 90) return -1;
        index = (index * 26) + (code - 64);
    }
    return index - 1;
}

function labelText(row) {
    return `${String(row?.[0] || '').trim()} ${String(row?.[1] || '').trim()}`.trim();
}

function parseDayNumber(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31) return value;
    const match = String(value || '').trim().match(/^(\d{1,2})$/);
    if (!match) return null;
    const day = Number(match[1]);
    return day >= 1 && day <= 31 ? day : null;
}

function extractGreatDayRange(rows) {
    const dayRows = [7, 8, 9, 33, 34, 35]
        .map(index => parseDayNumber(rows?.[index]?.[0]))
        .filter(day => day !== null);
    const unique = [...new Set(dayRows)];
    if (!unique.length) return null;
    unique.sort((a, b) => a - b);
    return {
        start: unique[0],
        end: unique[unique.length - 1],
        label: `${unique[0]}~${unique[unique.length - 1]}일`,
        days: unique
    };
}

function periodLabelMatchesGreatRange(periodLabel, greatDayRange) {
    if (!greatDayRange) return false;
    const compact = String(periodLabel || '').replace(/\s/g, '');
    return compact.includes(`${greatDayRange.start}~${greatDayRange.end}`);
}

function collectAdenaCells(rows, playerColumns) {
    const cols = playerColumns
        .map(columnLetterToIndex)
        .filter(index => index >= 0);
    const cells = [];
    for (let r = 0; r < rows.length; r += 1) {
        const row = rows[r] || [];
        if (!/total\s*gain\s*adena/i.test(labelText(row))) continue;
        for (const col of cols) {
            const value = parseNumber(row[col]);
            if (!value) continue;
            cells.push({
                row: r + 1,
                column: columnIndexToLetter(col),
                a1: `${columnIndexToLetter(col)}${r + 1}`,
                value,
                label: labelText(row)
            });
        }
    }
    return cells;
}

function findExactSubset(cells, target) {
    const wanted = Math.round((Number(target) || 0) * 10000);
    if (wanted <= 0) return [];

    const candidates = cells
        .map(cell => ({ ...cell, scaled: Math.round(cell.value * 10000) }))
        .filter(cell => cell.scaled > 0 && cell.scaled <= wanted)
        .sort((a, b) => b.scaled - a.scaled);

    const suffix = new Array(candidates.length + 1).fill(0);
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
        suffix[i] = suffix[i + 1] + candidates[i].scaled;
    }

    let best = null;
    function dfs(index, remaining, picked) {
        if (remaining === 0) {
            best = [...picked];
            return true;
        }
        if (remaining < 0 || index >= candidates.length || suffix[index] < remaining) return false;
        if (picked.length >= 6) return false;

        for (let i = index; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            if (candidate.scaled > remaining) continue;
            picked.push(candidate);
            if (dfs(i + 1, remaining - candidate.scaled, picked)) return true;
            picked.pop();
        }
        return false;
    }

    dfs(0, wanted, []);
    return (best || []).map(({ scaled, ...cell }) => cell);
}

function buildServerAudit({ serverKey, rawHit, parsed, greatRows, tab }) {
    if (!rawHit) {
        return {
            serverKey,
            server: serverLabel(serverKey),
            tab,
            ok: false,
            code: 'raw-row-not-found',
            safeToRepair: false
        };
    }

    const before = metricValuesFromRawRow(rawHit.row);
    const after = metricValuesFromParsedRow(parsed.row);
    const diffs = diffMetrics(before, after);
    const playerColumns = parsed.playerColumns || [];
    const greatDayRange = extractGreatDayRange(greatRows);
    const periodMatches = periodLabelMatchesGreatRange(rawHit.row?.[1], greatDayRange);
    const currentHasPayrollTotals = after.totalAdena > 0 || after.grossSalary > 0;
    const adenaCells = collectAdenaCells(greatRows, playerColumns);
    const totalDelta = diffs.totalAdena.delta;
    const subset = findExactSubset(adenaCells, totalDelta);
    const exactChanged = METRICS.some(metric => !approxEqual(before[metric.key], after[metric.key]));
    const changed = METRICS.some(metric => materiallyDifferent(metric, before[metric.key], after[metric.key]));
    const roundingOnly = exactChanged && !changed;
    const totalEvidenceMatches = totalDelta > 0
        && subset.length > 0
        && approxEqual(subset.reduce((sum, cell) => sum + cell.value, 0), totalDelta);

    const safeToRepair = serverKey === 'PAAGRIO'
        && changed
        && totalEvidenceMatches
        && subset.length <= 4
        && periodMatches
        && before.totalAdena > 0
        && after.totalAdena > before.totalAdena;

    if (!currentHasPayrollTotals || !periodMatches) {
        return {
            serverKey,
            server: parsed.row.server,
            tab,
            ok: false,
            code: !currentHasPayrollTotals ? 'great-tab-no-current-payroll-totals' : 'period-mismatch',
            rowNumber: rawHit.rowNumber,
            periodLabel: String(rawHit.row?.[1] || '').trim(),
            savedAt: rawHit.row?.[0] || '',
            savedBy: rawHit.row?.[9] || '',
            greatDayRange,
            periodMatches,
            playerColumns,
            changed: false,
            roundingOnly: false,
            safeToRepair: false,
            confidence: !currentHasPayrollTotals ? 'NOT_READY' : 'PERIOD_MISMATCH',
            before,
            after,
            diffs,
            evidence: {
                totalAdenaDelta: totalDelta,
                exactMissingCellSubset: subset,
                adenaCellCount: adenaCells.length
            }
        };
    }

    return {
        serverKey,
        server: parsed.row.server,
        tab,
        ok: true,
        rowNumber: rawHit.rowNumber,
        periodLabel: String(rawHit.row?.[1] || '').trim(),
        savedAt: rawHit.row?.[0] || '',
        savedBy: rawHit.row?.[9] || '',
        greatDayRange,
        periodMatches,
        playerColumns,
        changed,
        roundingOnly,
        safeToRepair,
        confidence: safeToRepair ? 'HIGH' : (changed ? 'REVIEW' : (roundingOnly ? 'ROUNDING_ONLY' : 'MATCH')),
        before,
        after,
        diffs,
        evidence: {
            totalAdenaDelta: totalDelta,
            exactMissingCellSubset: subset,
            adenaCellCount: adenaCells.length
        }
    };
}

async function readGreatServer(sheets, spreadsheetId, serverKey) {
    const tab = tabName(serverKey);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!A1:ZZ120`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = response.data.values || [];
    const parsed = parseGreatTabPayrollRows(rows, serverLabel(serverKey));
    return { tab, rows, parsed };
}

function buildGreatNotReadyAudit(serverKey, great, error = null) {
    return {
        serverKey,
        server: serverLabel(serverKey),
        tab: great?.tab || tabName(serverKey),
        ok: false,
        code: error ? 'great-tab-read-failed' : `great-tab-${great?.parsed?.code || 'not-ready'}`,
        errorMessage: error?.message || null,
        changed: false,
        roundingOnly: false,
        safeToRepair: false,
        confidence: 'NOT_READY'
    };
}

async function readRawRows(sheets, spreadsheetId) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${RAW_DATA_SHEET}'!A1:J5000`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    return response.data.values || [];
}

async function applyRepair(sheets, spreadsheetId, audit) {
    const values = [METRICS.map(metric => audit.after[metric.key] || 0)];
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${RAW_DATA_SHEET}'!D${audit.rowNumber}:I${audit.rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
    });
}

function writeAuditLog(report) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LATEST_LOG, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (report.applied.length) {
        for (const item of report.applied) {
            fs.appendFileSync(REPAIR_LOG, `${JSON.stringify({ at: report.generatedAt, ...item })}\n`, 'utf8');
        }
    }
}

async function runPayrollRawAudit(options = {}) {
    const args = {
        apply: false,
        allServers: true,
        server: 'PAAGRIO',
        period: '',
        log: true,
        ...options
    };
    const payrollId = payrollSpreadsheetId();
    const greatId = greatSpreadsheetId();
    const key = keyFile();
    if (!payrollId) throw new Error('Missing PAYROLL_ARCHIVE_SPREADSHEET_ID/PAYROLL_SUMMARY_SPREADSHEET_ID');
    if (!greatId) throw new Error('Missing PURCHASE_SPREADSHEET_ID');
    if (!key) throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS/PURCHASE_GOOGLE_KEY_FILE');

    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const rawRows = await readRawRows(sheets, payrollId);
    const serverKeys = args.allServers ? ['PAAGRIO', 'VALAKAS'] : [String(args.server || 'PAAGRIO').toUpperCase()];

    const audits = [];
    for (const serverKey of serverKeys) {
        let great = null;
        try {
            great = await readGreatServer(sheets, greatId, serverKey);
        } catch (error) {
            audits.push(buildGreatNotReadyAudit(serverKey, great, error));
            continue;
        }
        if (!great.parsed.ok) {
            audits.push(buildGreatNotReadyAudit(serverKey, great));
            continue;
        }
        const rawHit = findLatestRawRow(rawRows, serverKey, args.period);
        audits.push(buildServerAudit({
            serverKey,
            rawHit,
            parsed: great.parsed,
            greatRows: great.rows,
            tab: great.tab
        }));
    }

    const applied = [];
    if (args.apply) {
        for (const audit of audits) {
            if (!audit.safeToRepair) continue;
            await applyRepair(sheets, payrollId, audit);
            applied.push({
                serverKey: audit.serverKey,
                rowNumber: audit.rowNumber,
                periodLabel: audit.periodLabel,
                before: audit.before,
                after: audit.after,
                evidence: audit.evidence
            });
        }
    }

    const report = {
        ok: true,
        mode: args.apply ? 'apply' : 'dry-run',
        generatedAt: new Date().toISOString(),
        payrollSpreadsheetId: payrollId,
        greatSpreadsheetId: greatId,
        rawDataSheet: RAW_DATA_SHEET,
        audited: audits,
        applied,
        summary: {
            audited: audits.length,
            changed: audits.filter(item => item.changed).length,
            roundingOnly: audits.filter(item => item.roundingOnly).length,
            highConfidenceRepairs: audits.filter(item => item.safeToRepair).length,
            applied: applied.length,
            reviewRequired: audits.filter(item => item.changed && !item.safeToRepair).length
        }
    };

    if (args.log) writeAuditLog(report);
    return report;
}

async function main() {
    const report = await runPayrollRawAudit(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error?.stack || error?.message || error);
        process.exit(1);
    });
}

module.exports = {
    runPayrollRawAudit,
    buildServerAudit,
    buildGreatNotReadyAudit,
    findLatestRawRow
};
