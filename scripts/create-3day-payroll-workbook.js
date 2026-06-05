'use strict';

require('dotenv').config();

const { google } = require('googleapis');

const SOURCE_SPREADSHEET_ID = process.env.PURCHASE_SPREADSHEET_ID || '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk';
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json';
const OWNER_EMAIL = process.argv.find(arg => arg.startsWith('--email='))?.slice('--email='.length);
const TITLE = process.argv.find(arg => arg.startsWith('--title='))?.slice('--title='.length) || '3-Day Payroll Summary';
const TARGET_SPREADSHEET_ID = process.argv.find(arg => arg.startsWith('--target-spreadsheet-id='))?.slice('--target-spreadsheet-id='.length);

function col(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) {
        const rem = (value - 1) % 26;
        result = String.fromCharCode(65 + rem) + result;
        value = Math.floor((value - rem - 1) / 26);
    }
    return result;
}

function sumPlayerColumns(rawTab, rowStart, rowEnd) {
    const parts = [];
    for (let c = 2; c <= 26; c += 3) {
        parts.push(`'${rawTab}'!${col(c)}${rowStart}:${col(c)}${rowEnd}`);
    }
    return `SUM(${parts.join(',')})`;
}

function periodFormula(rawTab, periodIndex, source) {
    const row = periodIndex === 1 ? 4 : 5;
    const dayRows = periodIndex === 1 ? [8, 10] : [11, 13];
    const nightRows = periodIndex === 1 ? [34, 36] : [37, 39];
    const daySalaryRows = periodIndex === 1 ? [16, 18] : [19, 21];
    const nightSalaryRows = periodIndex === 1 ? [42, 44] : [45, 47];
    return [
        `Period ${periodIndex}`,
        source,
        `=${sumPlayerColumns(rawTab, dayRows[0], dayRows[1])}+${sumPlayerColumns(rawTab, nightRows[0], nightRows[1])}`,
        `=${sumPlayerColumns(rawTab, daySalaryRows[0], daySalaryRows[1])}+${sumPlayerColumns(rawTab, nightSalaryRows[0], nightSalaryRows[1])}`,
        `=D${row}*0.05`,
        `=D${row}*0.65`,
        `=D${row}*0.35`,
        `=F${row}*0.04`
    ];
}

function serverSummaryValues(title, rawTab) {
    return [
        [`${title} 3-Day Payroll`],
        ['Source workbook', SOURCE_SPREADSHEET_ID],
        ['Period', 'Server', 'Total Gained Adena', 'Gross Salary', 'TX Fee 5%', 'Player 65%', 'Owner 35%', 'Total Peso'],
        periodFormula(rawTab, 1, title),
        periodFormula(rawTab, 2, title),
        ['TOTAL', title, '=SUM(C4:C5)', '=SUM(D4:D5)', '=SUM(E4:E5)', '=SUM(F4:F5)', '=SUM(G4:G5)', '=SUM(H4:H5)']
    ];
}

async function main() {
    if (!OWNER_EMAIL && !TARGET_SPREADSHEET_ID) throw new Error('Missing --email=<google account> or --target-spreadsheet-id=<id>');

    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    let spreadsheetId = TARGET_SPREADSHEET_ID;
    let spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    if (!spreadsheetId) {
        const created = await sheets.spreadsheets.create({
            requestBody: {
                properties: { title: TITLE },
                sheets: [
                    { properties: { title: 'Total Summary', gridProperties: { rowCount: 30, columnCount: 10 } } },
                    { properties: { title: 'Paagrio 3-Day', gridProperties: { rowCount: 30, columnCount: 10 } } },
                    { properties: { title: 'Heine 3-Day', gridProperties: { rowCount: 30, columnCount: 10 } } },
                    { properties: { title: 'Paagrio Raw', hidden: true, gridProperties: { rowCount: 80, columnCount: 32 } } },
                    { properties: { title: 'Heine Raw', hidden: true, gridProperties: { rowCount: 80, columnCount: 32 } } }
                ]
            }
        });

        spreadsheetId = created.data.spreadsheetId;
        spreadsheetUrl = created.data.spreadsheetUrl;
    } else {
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets(properties(sheetId,title))'
        });
        const existingTitles = new Set((metadata.data.sheets || []).map(sheet => sheet.properties?.title));
        const wanted = ['Total Summary', 'Paagrio 3-Day', 'Heine 3-Day', 'Paagrio Raw', 'Heine Raw'];
        const requests = wanted
            .filter(title => !existingTitles.has(title))
            .map(title => ({
                addSheet: {
                    properties: {
                        title,
                        hidden: title.endsWith('Raw'),
                        gridProperties: { rowCount: title.endsWith('Raw') ? 80 : 30, columnCount: title.endsWith('Raw') ? 32 : 10 }
                    }
                }
            }));
        if (requests.length > 0) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests }
            });
        }
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: "'Paagrio Raw'!A1",
                    values: [[`=IMPORTRANGE("${SOURCE_SPREADSHEET_ID}","'Paagrio Great'!A1:AF80")`]]
                },
                {
                    range: "'Heine Raw'!A1",
                    values: [[`=IMPORTRANGE("${SOURCE_SPREADSHEET_ID}","'Heine Great'!A1:AF80")`]]
                },
                {
                    range: "'Paagrio 3-Day'!A1:H6",
                    values: serverSummaryValues('Paagrio', 'Paagrio Raw')
                },
                {
                    range: "'Heine 3-Day'!A1:H6",
                    values: serverSummaryValues('Heine', 'Heine Raw')
                },
                {
                    range: "'Total Summary'!A1:H7",
                    values: [
                        ['3-Day Payroll Total Summary'],
                        ['Source workbook', SOURCE_SPREADSHEET_ID],
                        ['Server', 'Total Gained Adena', 'Gross Salary', 'TX Fee 5%', 'Player 65%', 'Owner 35%', 'Total Peso', 'Note'],
                        ['Paagrio', "='Paagrio 3-Day'!C6", "='Paagrio 3-Day'!D6", "='Paagrio 3-Day'!E6", "='Paagrio 3-Day'!F6", "='Paagrio 3-Day'!G6", "='Paagrio 3-Day'!H6", ''],
                        ['Heine', "='Heine 3-Day'!C6", "='Heine 3-Day'!D6", "='Heine 3-Day'!E6", "='Heine 3-Day'!F6", "='Heine 3-Day'!G6", "='Heine 3-Day'!H6", ''],
                        ['TOTAL', '=SUM(B4:B5)', '=SUM(C4:C5)', '=SUM(D4:D5)', '=SUM(E4:E5)', '=SUM(F4:F5)', '=SUM(G4:G5)', ''],
                        ['Notice', '', '', '', '', '', '', 'If values show #REF!, open hidden Raw tabs and allow IMPORTRANGE access once.']
                    ]
                }
            ]
        }
    });

    const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const sheetIds = Object.fromEntries(
        (metadata.data.sheets || []).map(sheet => [sheet.properties.title, sheet.properties.sheetId])
    );

    const formatRequests = [];
    for (const title of ['Total Summary', 'Paagrio 3-Day', 'Heine 3-Day']) {
        const sheetId = sheetIds[title];
        formatRequests.push(
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 0.2, green: 0.62, blue: 0.3 },
                            textFormat: { bold: true, fontSize: 14 },
                            horizontalAlignment: 'CENTER'
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 8 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 0.74, green: 0.83, blue: 0.96 },
                            textFormat: { bold: true },
                            horizontalAlignment: 'CENTER'
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
                }
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: 3, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 7 },
                    cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
                    fields: 'userEnteredFormat.numberFormat'
                }
            },
            {
                updateDimensionProperties: {
                    range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 8 },
                    properties: { pixelSize: 155 },
                    fields: 'pixelSize'
                }
            }
        );
    }

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: formatRequests }
    });

    if (OWNER_EMAIL) {
        await drive.permissions.create({
            fileId: spreadsheetId,
            sendNotificationEmail: false,
            requestBody: {
                type: 'user',
                role: 'writer',
                emailAddress: OWNER_EMAIL
            }
        }).catch(error => {
            if (error?.code !== 403) throw error;
            console.warn('[SHARE WARN]', error.message);
        });
    }

    console.log(JSON.stringify({ ok: true, spreadsheetId, spreadsheetUrl, sharedWith: OWNER_EMAIL }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
