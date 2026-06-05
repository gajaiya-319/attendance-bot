'use strict';

require('dotenv').config();

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.PURCHASE_SPREADSHEET_ID || '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk';
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json';

const EXPECTED = [
    { range: 'C17', formula: '=C9*AI14' }
];

async function main() {
    const apply = process.argv.includes('--apply');
    const tabs = process.argv.filter(arg => arg.startsWith('--sheet=')).map(arg => arg.slice('--sheet='.length));
    const targetTabs = tabs.length > 0 ? tabs : ['Paagrio Great', 'Heine Great'];

    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const updates = [];
    const checked = [];

    for (const tab of targetTabs) {
        for (const item of EXPECTED) {
            const fullRange = `'${tab}'!${item.range}`;
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: fullRange,
                valueRenderOption: 'FORMULA'
            });
            const current = response.data.values?.[0]?.[0] || '';
            const ok = current === item.formula;
            checked.push({ tab, range: item.range, current, expected: item.formula, ok });
            if (!ok) {
                updates.push({ range: fullRange, values: [[item.formula]] });
            }
        }
    }

    console.log(JSON.stringify({ apply, checked, updateCount: updates.length }, null, 2));
    if (!apply || updates.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates
        }
    });
    console.log(JSON.stringify({ updated: updates.map(item => item.range) }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
