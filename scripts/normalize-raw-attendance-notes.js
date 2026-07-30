'use strict';

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const { normalizeBrokenKorean } = require('../src/utils/attendanceLogFormatter');

const RAW_SHEET = 'Raw_Attendance';
const NOTE_COLUMN = 8;
const UPDATED_AT_COLUMN = 10;

function isDryRun() {
    return process.argv.includes('--dry-run');
}

function columnLetter(index) {
    return String.fromCharCode(64 + index);
}

function hasKnownMojibake(value) {
    return /[\uF9E3\u8B70\u6D39\u73E5]|\?\uC1F1\uC520|\?\uC88E\uC081|\?\uC493\uCED9|\?\uBEA4\uAE3D|\?\uB2FF\uB810/.test(String(value || ''));
}

async function main() {
    const spreadsheetId = CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID ||
        CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID ||
        CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
    const keyFile = CONFIG.PURCHASE_GOOGLE_KEY_FILE;
    if (!spreadsheetId || !keyFile) throw new Error('Missing spreadsheet id or Google key file');

    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${RAW_SHEET}!A2:J`
    });
    const rows = response.data.values || [];
    const now = new Date().toISOString();
    const updates = [];

    rows.forEach((row, index) => {
        const note = String(row[NOTE_COLUMN - 1] || '');
        if (!note || !hasKnownMojibake(note)) return;
        const normalized = normalizeBrokenKorean(note);
        if (normalized === note) return;
        const rowNumber = index + 2;
        updates.push({
            rowNumber,
            name: row[3] || '-',
            status: row[4] || '-',
            before: note,
            after: normalized,
            data: [
                {
                    range: `${RAW_SHEET}!${columnLetter(NOTE_COLUMN)}${rowNumber}`,
                    values: [[normalized]]
                },
                {
                    range: `${RAW_SHEET}!${columnLetter(UPDATED_AT_COLUMN)}${rowNumber}`,
                    values: [[now]]
                }
            ]
        });
    });

    console.log(`Raw attendance note normalization candidates: ${updates.length}`);
    updates.forEach(item => {
        console.log(`#${item.rowNumber} ${item.name} ${item.status}`);
        console.log(`  before: ${item.before}`);
        console.log(`  after : ${item.after}`);
    });

    if (!updates.length || isDryRun()) {
        if (isDryRun()) console.log('Dry run only; no sheet updates were written.');
        return;
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'RAW',
            data: updates.flatMap(item => item.data)
        }
    });
    console.log(`Updated Raw_Attendance note cells: ${updates.length}`);
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
