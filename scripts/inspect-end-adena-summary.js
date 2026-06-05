'use strict';

require('dotenv').config();

const { google } = require('googleapis');

async function main() {
    const spreadsheetId = process.env.PURCHASE_SPREADSHEET_ID || '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk';
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json';
    const tab = process.argv[2] || 'Paagrio Great';
    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!A1:ZZ160`,
        valueRenderOption: process.argv.includes('--formulas') ? 'FORMULA' : 'FORMATTED_VALUE'
    });
    const rows = response.data.values || [];
    rows.forEach((row, index) => {
        const text = row.join(' | ');
        if (index >= 55 || /player|adena|gain adena|day time|night time/i.test(text)) {
            console.log(`${index + 1}: ${text}`);
        }
    });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
