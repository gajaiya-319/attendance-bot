'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

const id = process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.PURCHASE_GOOGLE_KEY_FILE;

async function main() {
    const sheets = google.sheets({
        version: 'v4',
        auth: new google.auth.GoogleAuth({
            keyFile: key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        })
    });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: "'최근_3일_요약'!C5:H8",
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    console.log(JSON.stringify(res.data.values, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
