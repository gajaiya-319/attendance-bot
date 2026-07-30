'use strict';

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const SHEET = 'Current_Workers';
const VALAKAS_LABEL = '\uBC1C\uB77C\uCE74\uC2A4';
const PAAGRIO_LABEL = '\uD30C\uC544\uADF8\uB9AC\uC624';

function spreadsheetId() {
    return process.env.RAW_ATTENDANCE_SPREADSHEET_ID
        || process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID
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
    const upper = text.toUpperCase();
    return upper === 'HEINE'
        || upper === 'VALACAS'
        || upper === 'VALAKAS'
        || text === '\uD558\uC774\uB124';
}

function normalizedServer(value) {
    const text = String(value || '').trim();
    const upper = text.toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS' || text === '\uD558\uC774\uB124') {
        return VALAKAS_LABEL;
    }
    if (upper === 'PAAGRIO' || text === PAAGRIO_LABEL) {
        return PAAGRIO_LABEL;
    }
    return text;
}

async function main() {
    const id = spreadsheetId();
    if (!id) throw new Error('Missing raw attendance spreadsheet id');

    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${SHEET}!A1:E5000`
    });
    const values = response.data.values || [];
    const updates = [];

    values.forEach((row, index) => {
        if (index === 0) return;
        const next = normalizedServer(row?.[1]);
        if (next && next !== String(row?.[1] || '').trim()) {
            updates.push({
                range: `${SHEET}!B${index + 1}`,
                values: [[next]]
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

    const verify = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${SHEET}!A1:E5000`
    });
    const rows = verify.data.values || [];
    const counts = {};
    const remaining = [];
    for (let i = 1; i < rows.length; i += 1) {
        const server = String(rows[i]?.[1] || '').trim();
        if (server) counts[server] = (counts[server] || 0) + 1;
        if (normalizedServer(server) !== server) remaining.push({ row: i + 1, name: rows[i]?.[0] || '', server });
    }

    console.log(JSON.stringify({
        ok: true,
        spreadsheetId: id,
        sheet: SHEET,
        updated: updates.length,
        to: { valakas: VALAKAS_LABEL, paagrio: PAAGRIO_LABEL },
        counts,
        remaining
    }, null, 2));
}

main().catch(error => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
