'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const id = process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE || CONFIG.PURCHASE_GOOGLE_KEY_FILE;

async function dumpPlayers(sheets, tab) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${tab}'!A1:M80`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    console.log(`\n=== ${tab} player-ish rows (R7-R20 Day block) ===`);
    for (let r = 6; r < Math.min(20, rows.length); r += 1) {
        const row = rows[r] || [];
        console.log(`R${r + 1}`, {
            a: row[0],
            b: row[1],
            c: row[2],
            d: row[3],
            e: row[4],
            f: row[5],
            g: row[6],
            h: row[7],
            i: row[8],
            j: row[9],
            k: row[10],
            l: row[11],
            m: row[12]
        });
    }
    const recent = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: "'최근_3일_요약'!B3:H8",
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    console.log('\n최근_3일_요약 values:', JSON.stringify(recent.data.values, null, 2));
    const formulas = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: "'최근_3일_요약'!C5:H6",
        valueRenderOption: 'FORMULA'
    });
    console.log('\nC5:H6 formulas:', JSON.stringify(formulas.data.values, null, 2));
}

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    await dumpPlayers(sheets, 'Paagrio Great');
    await dumpPlayers(sheets, 'Heine Great');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
