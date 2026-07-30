'use strict';

require('dotenv').config({ override: true });

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');

async function main() {
    const [tabName, cell, value] = process.argv.slice(2);
    if (!tabName || !cell || value === undefined) {
        throw new Error('Usage: node scripts/fix-end-adena-summary-cell.js "<tab>" <cell> <value>');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const range = `'${tabName}'!${cell}`;

    await sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[value]]
        }
    });

    console.log(`updated ${range} = ${value}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
