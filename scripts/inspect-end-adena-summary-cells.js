'use strict';

require('dotenv').config({ override: true });

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const {
    resolveAdenaSummaryCell,
    getColumnLetter
} = require('../src/services/purchaseSheetService');

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const names = process.argv.slice(2);
    const playerNames = names.length ? names : ['Jure', 'coco tarmin', 'denxie', 'Zurin', 'BitShelby'];

    for (const [server, tabName] of Object.entries(CONFIG.PURCHASE_SERVER_TABS || {})) {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
            range: `'${tabName}'!A1:ZZ160`
        });
        const rows = response.data.values || [];
        for (const playerName of playerNames) {
            for (const shift of ['DAY', 'NIGHT']) {
                const cell = resolveAdenaSummaryCell(rows, {
                    shift,
                    userName: playerName,
                    aliases: {}
                });
                if (!cell.ok) continue;
                const address = `${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`;
                const current = rows[cell.rowIndex]?.[cell.colIndex] || '';
                console.log(`${server}\t${tabName}\t${shift}\t${playerName}\t${address}\t${current}`);
            }
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
