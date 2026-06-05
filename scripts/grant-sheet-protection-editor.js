'use strict';

require('dotenv').config();

const { google } = require('googleapis');

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        spreadsheetId: process.env.PURCHASE_SPREADSHEET_ID,
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json',
        email: null,
        sheetTitles: [],
        apply: false
    };

    for (const arg of argv) {
        if (arg === '--apply') {
            options.apply = true;
        } else if (arg.startsWith('--spreadsheet-id=')) {
            options.spreadsheetId = arg.slice('--spreadsheet-id='.length);
        } else if (arg.startsWith('--key-file=')) {
            options.keyFile = arg.slice('--key-file='.length);
        } else if (arg.startsWith('--email=')) {
            options.email = arg.slice('--email='.length);
        } else if (arg.startsWith('--sheet=')) {
            options.sheetTitles.push(arg.slice('--sheet='.length));
        }
    }

    return options;
}

function normalizeEditors(editors = {}, email) {
    const users = Array.from(new Set([...(editors.users || []), email]));
    return {
        ...editors,
        users
    };
}

async function main() {
    const options = parseArgs();
    if (!options.spreadsheetId) throw new Error('Missing --spreadsheet-id or PURCHASE_SPREADSHEET_ID');
    if (!options.email) throw new Error('Missing --email');

    const auth = new google.auth.GoogleAuth({
        keyFile: options.keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.get({
        spreadsheetId: options.spreadsheetId,
        fields: 'sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description,warningOnly,editors,range))'
    });

    const targetTitles = new Set(options.sheetTitles);
    const requests = [];
    const summary = [];

    for (const sheet of response.data.sheets || []) {
        const title = sheet.properties?.title;
        if (targetTitles.size > 0 && !targetTitles.has(title)) continue;

        for (const protectedRange of sheet.protectedRanges || []) {
            if (protectedRange.warningOnly) continue;
            const currentUsers = protectedRange.editors?.users || [];
            const alreadyAllowed = currentUsers.includes(options.email);
            summary.push({
                sheet: title,
                protectedRangeId: protectedRange.protectedRangeId,
                description: protectedRange.description || '',
                alreadyAllowed
            });
            if (alreadyAllowed) continue;

            requests.push({
                updateProtectedRange: {
                    protectedRange: {
                        protectedRangeId: protectedRange.protectedRangeId,
                        editors: normalizeEditors(protectedRange.editors, options.email)
                    },
                    fields: 'editors'
                }
            });
        }
    }

    console.log(JSON.stringify({ apply: options.apply, checked: summary, updateCount: requests.length }, null, 2));

    if (!options.apply || requests.length === 0) return;

    const update = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: options.spreadsheetId,
        requestBody: { requests }
    });
    console.log(JSON.stringify({ updated: update.data.replies?.length || 0 }, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
