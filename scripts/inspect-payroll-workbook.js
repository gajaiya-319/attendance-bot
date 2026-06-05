'use strict';

require('dotenv').config();

const { google } = require('googleapis');

async function main() {
    const spreadsheetId = process.argv[2];
    if (!spreadsheetId) throw new Error('Missing spreadsheet id');
    const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    for (const tab of process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['Total Summary', 'Paagrio 3-Day', 'Heine 3-Day']) {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${tab}'!A1:L14`,
            valueRenderOption: 'FORMULA'
        });
        console.log(`--- ${tab}`);
        console.log((response.data.values || []).map((row, index) => `${index + 1}: ${row.join(' | ')}`).join('\n'));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
