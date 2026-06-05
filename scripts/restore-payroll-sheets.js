'use strict';

/**
 * Recreate Raw_Data (+ optional summary tabs via web app) from Great tabs or JSON backup.
 *
 *   node scripts/restore-payroll-sheets.js --from-great --period "3일 마감"
 *   node scripts/restore-payroll-sheets.js --from-great --apply-summary-via-webapp
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const { parseGreatTabPayrollRows, SERVER_LABELS } = require('../src/utils/payrollGreatTabParser');

const RAW_DATA_SHEET = 'Raw_Data';
const RAW_HEADERS = [
    '저장일시', '회차', '서버', '총 획득 아데나', '총 급여',
    '수수료 5%', '직원 65%', '오너 35%', '총 페소', '저장자'
];

function parseArgs(argv) {
    const writeIdx = argv.indexOf('--write-spreadsheet');
    const readIdx = argv.indexOf('--read-great-from');
    return {
        dryRun: argv.includes('--dry-run'),
        fromGreat: argv.includes('--from-great'),
        applySummary: argv.includes('--apply-summary-via-webapp'),
        jsonPath: argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null,
        periodLabel: argv.includes('--period') ? argv[argv.indexOf('--period') + 1] : '3일 마감 복구',
        savedBy: argv.includes('--saved-by') ? argv[argv.indexOf('--saved-by') + 1] : 'restore-payroll-sheets.js',
        writeSpreadsheetId: writeIdx >= 0 ? argv[writeIdx + 1] : null,
        readGreatSpreadsheetId: readIdx >= 0 ? argv[readIdx + 1] : null
    };
}

function writeSpreadsheetId(args) {
    return args.writeSpreadsheetId
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
}

function readGreatSpreadsheetId(args) {
    return args.readGreatSpreadsheetId
        || process.env.PURCHASE_SPREADSHEET_ID
        || CONFIG.PURCHASE_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

function timestampNow() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function loadRowsFromJson(filePath) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : parsed.rows;
    if (!Array.isArray(rows) || rows.length < 1) throw new Error('JSON must be array or { rows: [] }');
    return rows;
}

function toRawRow(row, meta) {
    return [
        row.savedAt || meta.savedAt || timestampNow(),
        row.periodLabel || meta.periodLabel,
        row.server,
        Number(row.totalAdena) || 0,
        Number(row.grossSalary) || 0,
        Number(row.txFee) || 0,
        Number(row.playerShare) || 0,
        Number(row.ownerShare) || 0,
        Number(row.totalPeso) || 0,
        row.savedBy || meta.savedBy
    ];
}

async function readGreatRows(sheets, id) {
    const specs = [
        { tab: process.env.PURCHASE_PAAGRIO_TAB_NAME || CONFIG.PURCHASE_SERVER_TABS.PAAGRIO, server: SERVER_LABELS.PAAGRIO },
        { tab: process.env.PURCHASE_HEINE_TAB_NAME || CONFIG.PURCHASE_SERVER_TABS.HEINE, server: SERVER_LABELS.HEINE }
    ];
    const rows = [];
    for (const spec of specs) {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: id,
            range: `'${spec.tab}'!A1:ZZ120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        const parsed = parseGreatTabPayrollRows(res.data.values || [], spec.server);
        if (!parsed.ok) throw new Error(`${spec.tab}: ${parsed.code}`);
        rows.push(parsed.row);
    }
    return rows;
}

async function ensureRawDataSheet(sheets, id) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
    if ((meta.data.sheets || []).some(s => s.properties.title === RAW_DATA_SHEET)) return false;
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
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
        spreadsheetId: id,
        range: `'${RAW_DATA_SHEET}'!A1:J1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [RAW_HEADERS] }
    });
    return true;
}

async function appendRawData(sheets, id, payrollRows, meta) {
    const colA = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${RAW_DATA_SHEET}'!A:A` });
    const nextRow = Math.max((colA.data.values || []).length + 1, 2);
    const values = payrollRows.map(row => toRawRow(row, meta));
    await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `'${RAW_DATA_SHEET}'!A${nextRow}:J${nextRow + values.length - 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
    });
    return { nextRow, count: values.length };
}

async function applySummaryViaWebApp() {
    const url = process.env.RAW_ATTENDANCE_WEBAPP_URL;
    if (!url) return { ok: false, code: 'missing-RAW_ATTENDANCE_WEBAPP_URL' };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'enable-live-3day-summary' })
    });
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return { ok: false, preview: text.slice(0, 200) };
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const writeId = writeSpreadsheetId(args);
    const readId = readGreatSpreadsheetId(args);
    const key = keyFile();
    if (!writeId || !key) throw new Error('Need PAYROLL_SUMMARY_SPREADSHEET_ID + GOOGLE_APPLICATION_CREDENTIALS in .env');
    if (!args.fromGreat && !args.jsonPath) throw new Error('Use --from-great and/or --json <file>');

    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    let payrollRows = args.jsonPath ? loadRowsFromJson(args.jsonPath) : [];
    let source = args.jsonPath ? 'json' : '';
    if (args.fromGreat) {
        const greatRows = await readGreatRows(sheets, readId);
        if (payrollRows.length < 1) {
            payrollRows = greatRows;
            source = `great-tabs@${readId}`;
        }
    }

    const meta = { periodLabel: args.periodLabel, savedBy: args.savedBy, savedAt: timestampNow() };
    if (args.dryRun) {
        console.log(JSON.stringify({
            ok: true,
            dryRun: true,
            writeSpreadsheetId: writeId,
            readGreatSpreadsheetId: readId,
            source,
            rows: payrollRows
        }, null, 2));
        return;
    }

    const created = await ensureRawDataSheet(sheets, writeId);
    const appended = await appendRawData(sheets, writeId, payrollRows, meta);
    const summary = args.applySummary ? await applySummaryViaWebApp() : null;

    console.log(JSON.stringify({
        ok: true,
        writeSpreadsheetId: writeId,
        readGreatSpreadsheetId: readId,
        source,
        createdRawDataSheet: created,
        appended,
        summary,
        rows: payrollRows
    }, null, 2));
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
