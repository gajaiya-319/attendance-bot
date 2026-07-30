'use strict';

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const RAW_DATA_SHEET = 'Raw_Data';
const MONTHLY_SHEET = '\uC6D4\uAC04_\uB204\uC801_\uC694\uC57D';
const FROM_LABELS = new Set(['\uD558\uC774\uB124', 'Heine', 'HEINE', 'Valacas', 'VALACAS']);
const TO_LABEL = '\uBC1C\uB77C\uCE74\uC2A4';

function spreadsheetId() {
    return process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

function shouldRename(value) {
    const text = String(value || '').trim();
    const lower = text.toLowerCase();
    return FROM_LABELS.has(text)
        || text.includes('\uD558\uC774\uB124')
        || lower.includes('heine')
        || lower.includes('valacas');
}

function monthlyRawSumifFormulas(serverName) {
    return ['D', 'E', 'F', 'G', 'H', 'I'].map(column =>
        `=ROUND(SUMIF(${RAW_DATA_SHEET}!$C:$C, "${serverName}", ${RAW_DATA_SHEET}!$${column}:$${column}), 0)`
    );
}

async function updateRawData(sheets, id) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${RAW_DATA_SHEET}'!A1:J5000`
    });
    const values = response.data.values || [];
    const updates = [];

    values.forEach((row, index) => {
        if (index === 0) return;
        if (shouldRename(row?.[2])) {
            updates.push({
                range: `'${RAW_DATA_SHEET}'!C${index + 1}`,
                values: [[TO_LABEL]]
            });
        }
    });

    if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: id,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
    }

    return updates.length;
}

async function updateMonthlySheet(sheets, id) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: 'sheets.properties.title'
    });
    const titles = (meta.data.sheets || []).map(sheet => String(sheet.properties?.title || ''));
    const title = titles.find(name => name === MONTHLY_SHEET)
        || titles.find(name => name.includes('\uC6D4\uAC04') && name.includes('\uB204\uC801'));

    if (!title) return { updated: false, reason: 'monthly-sheet-not-found' };

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: id,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                { range: `'${title}'!B6`, values: [[TO_LABEL]] },
                { range: `'${title}'!C6:H6`, values: [monthlyRawSumifFormulas(TO_LABEL)] }
            ]
        }
    });

    return { updated: true, title };
}

async function verify(sheets, id) {
    const verifyResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${RAW_DATA_SHEET}'!A1:J5000`
    });
    const verifyRows = verifyResponse.data.values || [];
    const counts = {};
    const remaining = [];
    for (let i = 1; i < verifyRows.length; i += 1) {
        const row = verifyRows[i] || [];
        const server = String(row[2] || '').trim();
        if (server) counts[server] = (counts[server] || 0) + 1;
        if (shouldRename(server)) {
            remaining.push({ row: i + 1, period: row[1] || '', server });
        }
    }

    return {
        counts,
        remaining,
        lastRows: verifyRows.slice(-6).map(row => ({
            time: row[0] || '',
            period: row[1] || '',
            server: row[2] || ''
        }))
    };
}

async function main() {
    const id = spreadsheetId();
    if (!id) throw new Error('Missing payroll spreadsheet id');
    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const updated = await updateRawData(sheets, id);
    const monthly = await updateMonthlySheet(sheets, id);
    const result = await verify(sheets, id);

    console.log(JSON.stringify({
        ok: true,
        spreadsheetId: id,
        sheet: RAW_DATA_SHEET,
        updated,
        to: TO_LABEL,
        monthly,
        ...result
    }, null, 2));
}

main().catch(error => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
