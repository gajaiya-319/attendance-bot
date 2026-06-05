'use strict';

/**
 * Apply 3-day payroll totals from screenshot JSON into Raw_Data (upsert by server).
 *
 *   node scripts/apply-paagrio-screenshot-raw-data.js scripts/data/heine-3day-screenshot-2026-06-03.json
 *   node scripts/apply-paagrio-screenshot-raw-data.js --both-3day
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const RAW_DATA_SHEET = 'Raw_Data';
const PAAGRIO_FILE = path.join(__dirname, 'data', 'paagrio-3day-screenshot-2026-06-03.json');
const HEINE_FILE = path.join(__dirname, 'data', 'heine-3day-screenshot-2026-06-03.json');

function loadPayload(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toRawRow(payload, row) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return [
        timestamp,
        payload.periodLabel,
        row.server,
        row.totalAdena,
        row.grossSalary,
        row.txFee,
        row.playerShare,
        row.ownerShare,
        row.totalPeso,
        payload.savedBy
    ];
}

function upsertRows(existingValues, payloads) {
    const byServer = new Map();
    for (const row of existingValues.slice(1)) {
        const server = String(row[2] || '').trim();
        if (server) byServer.set(server, [...row]);
    }
    for (const payload of payloads) {
        for (const row of payload.rows) {
            byServer.set(row.server, toRawRow(payload, row));
        }
    }
    const order = ['파아그리오', '하이네'];
    return [...byServer.entries()]
        .sort((a, b) => {
            const ai = order.indexOf(a[0]);
            const bi = order.indexOf(b[0]);
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        })
        .map(([, row]) => row);
}

async function main() {
    const argv = process.argv.slice(2);
    const both = argv.includes('--both-3day');
    const filePath = argv.find(a => a.endsWith('.json'));
    const payloads = both
        ? [loadPayload(PAAGRIO_FILE), loadPayload(HEINE_FILE)]
        : [loadPayload(filePath || PAAGRIO_FILE)];

    const writeId = process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
    const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.PURCHASE_GOOGLE_KEY_FILE;

    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: writeId,
        range: `'${RAW_DATA_SHEET}'!A:J`
    });
    const values = res.data.values || [];
    const header = values[0] || [
        '저장일시', '회차', '서버', '총 획득 아데나', '총 급여',
        '수수료 5%', '직원 65%', '오너 35%', '총 페소', '저장자'
    ];
    const dataRows = upsertRows(values, payloads);
    const out = [header, ...dataRows];

    await sheets.spreadsheets.values.update({
        spreadsheetId: writeId,
        range: `'${RAW_DATA_SHEET}'!A1:J${out.length}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: out }
    });

    console.log(JSON.stringify({
        ok: true,
        spreadsheetId: writeId,
        sheet: RAW_DATA_SHEET,
        rowsWritten: dataRows.length,
        servers: dataRows.map(r => r[2])
    }, null, 2));
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
