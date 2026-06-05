'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const {
    parseGreatTabPayrollRows,
    SERVER_LABELS,
    sumLabelRowNumericCells
} = require('../src/utils/payrollGreatTabParser');

const id = process.env.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE;

async function main() {
    const sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    }) });
    for (const tab of ['Paagrio Great', 'Heine Great']) {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: id,
            range: `'${tab}'!A1:ZZ120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });
        const rows = res.data.values || [];
        const parsed = parseGreatTabPayrollRows(rows, tab.includes('Paagrio') ? SERVER_LABELS.PAAGRIO : SERVER_LABELS.HEINE);
        console.log('\n', tab, parsed.row || parsed);
        for (let r = 0; r < rows.length; r += 1) {
            const left = `${rows[r][0] || ''} ${rows[r][1] || ''}`.trim();
            if (!/total\s*gain\s*adena/i.test(left)) continue;
            console.log(`  R${r + 1} sum=${sumLabelRowNumericCells(rows[r])}`);
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
