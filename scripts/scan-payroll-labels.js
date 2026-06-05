'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

async function main() {
    const id = process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
    const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
    console.log('tabs:', (meta.data.sheets || []).map(s => s.properties.title).join(' | '));

    for (const tab of ['old sheet', 'Paagrio Great', 'Heine Great', 'Raw_Data']) {
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: id,
                range: `'${tab}'!A1:J30`
            });
            const rows = res.data.values || [];
            console.log(`\n--- ${tab} (${rows.length} rows) ---`);
            rows.forEach((row, index) => {
                const text = row.slice(0, 3).join(' | ');
                if (/total|gain|adena|5%|0\.65|0\.35|peso|합계|저장|파아|하이/i.test(text)) {
                    console.log(`${index + 1}: ${text}`);
                }
            });
            if (tab === 'Raw_Data' && rows.length > 1) {
                rows.forEach((row, index) => console.log(`${index + 1}: ${row.join(' | ')}`));
            }
        } catch (error) {
            console.log(`\n--- ${tab}: ${error.message}`);
        }
    }
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
