'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { playerAdenaColumnIndices } = require('../src/utils/payrollGreatTabParser');

function colLetter(i) {
    let n = i + 1;
    let s = '';
    while (n > 0) {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}

async function main() {
    const id = process.env.PURCHASE_SPREADSHEET_ID;
    const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE;
    const sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    }) });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: "'Paagrio Great'!A14:ZZ14",
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const row = res.data.values?.[0] || [];
    console.log('row length', row.length);
    const step = [];
    for (const col of playerAdenaColumnIndices()) {
        if (typeof row[col] === 'number' && row[col]) step.push(`${colLetter(col)}=${row[col]}`);
    }
    console.log('step-3 cols with numbers:', step.join(', '));
    const all = [];
    for (let c = 0; c < row.length; c += 1) {
        if (typeof row[c] === 'number' && row[c]) all.push(`${colLetter(c)}=${row[c]}`);
    }
    console.log('all numeric:', all.join(', '));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
