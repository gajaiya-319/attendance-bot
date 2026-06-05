'use strict';

/**
 * Delete legacy "월간 기록" tab from the payroll workbook (급여토탈관리).
 *   node scripts/delete-legacy-monthly-record-sheet.js
 *   node scripts/delete-legacy-monthly-record-sheet.js --dry-run
 */

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const LEGACY_SHEET = '월간 기록';

function spreadsheetId() {
    const summary = process.env.PAYROLL_SUMMARY_SPREADSHEET_ID || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
    const archive = process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID;
    if (archive && archive !== process.env.PURCHASE_SPREADSHEET_ID) return archive;
    return summary || archive || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const id = spreadsheetId();

    const meta = await sheets.spreadsheets.get({
        spreadsheetId: id,
        fields: 'sheets(properties(sheetId,title))'
    });
    const target = (meta.data.sheets || []).find(s => s.properties?.title === LEGACY_SHEET);
    if (!target) {
        console.log(`No "${LEGACY_SHEET}" tab on ${id} — nothing to delete.`);
        return;
    }

    if (dryRun) {
        console.log(`Would delete sheetId=${target.properties.sheetId} "${LEGACY_SHEET}" from ${id}`);
        return;
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: {
            requests: [{ deleteSheet: { sheetId: target.properties.sheetId } }]
        }
    });
    console.log(`Deleted "${LEGACY_SHEET}" from ${id}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
