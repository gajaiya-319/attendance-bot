'use strict';

require('dotenv').config({ override: true });

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

async function main() {
    const [tabName, cell, value, expectedCurrent] = process.argv.slice(2);
    if (!tabName || !cell || value === undefined) {
        throw new Error('Usage: node scripts/fix-end-adena-summary-cell.js "<tab>" <cell> <value> [expected-current]');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const range = `'${tabName}'!${cell}`;
    const readCell = async () => {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
            range
        });
        return response.data.values?.[0]?.[0] ?? '';
    };
    const normalize = input => String(input ?? '').replace(/[\s,]/g, '');
    const before = await readCell();
    if (expectedCurrent !== undefined && normalize(before) !== normalize(expectedCurrent)) {
        throw new Error(`Refusing to update ${range}: expected ${expectedCurrent}, found ${before}`);
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[value]]
        }
    });

    const verified = await readCell();
    if (normalize(verified) !== normalize(value)) {
        throw new Error(`Verification failed for ${range}: expected ${value}, found ${verified}`);
    }
    console.log(JSON.stringify({ ok: true, range, before, value: verified }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
