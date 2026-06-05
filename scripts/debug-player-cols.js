'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const {
    discoverPlayerAdenaColumnIndices,
    columnIndexToLetter,
    sumLabelRowNumericCells,
    parseGreatTabPayrollRows,
    SERVER_LABELS
} = require('../src/utils/payrollGreatTabParser');

const id = process.env.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE;

async function main() {
    const sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    }) });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: "'Paagrio Great'!A1:ZZ120",
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    const cols = discoverPlayerAdenaColumnIndices(rows);
    console.log('player cols', cols.map(columnIndexToLetter));
    console.log('parsed', parseGreatTabPayrollRows(rows, SERVER_LABELS.PAAGRIO));
    const r14 = rows[13];
    console.log('R14 per col', cols.map(c => `${columnIndexToLetter(c)}=${r14?.[c]}`));
    console.log('R14 sum', sumLabelRowNumericCells(r14, cols));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
