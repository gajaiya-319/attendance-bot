'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const id = process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE || CONFIG.PURCHASE_GOOGLE_KEY_FILE;

async function dumpTab(sheets, tab) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${tab}'!A1:M200`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    console.log(`\n=== ${tab} (${rows.length} rows) ===`);
    for (let r = 0; r < rows.length; r += 1) {
        const a = String(rows[r][0] || '').trim();
        const b = String(rows[r][1] || '').trim();
        const left = `${a} ${b}`.trim();
        if (/total|gain|adena|^\s*day\s*$/i.test(left) || /^night$/i.test(a) || /^TOTAL$/i.test(a)) {
            console.log(`R${r + 1}`, { a, b, c: rows[r][2], m: rows[r][12] });
        }
    }
}

async function checkRecentOnWorklist(sheets) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
    const titles = (meta.data.sheets || []).map(s => s.properties?.title);
    if (!titles.includes('최근_3일_요약')) {
        console.log('\nWork list: no 최근_3일_요약 tab');
        return;
    }
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: "'최근_3일_요약'!B3:H8",
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    console.log('\nWork list 최근_3일_요약 B3:H8:', JSON.stringify(res.data.values, null, 2));
}

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    await dumpTab(sheets, process.env.PURCHASE_PAAGRIO_TAB_NAME || 'Paagrio Great');
    await dumpTab(sheets, process.env.PURCHASE_HEINE_TAB_NAME || 'Heine Great');
    await checkRecentOnWorklist(sheets);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
