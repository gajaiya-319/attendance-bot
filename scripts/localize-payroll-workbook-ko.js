'use strict';

require('dotenv').config();

const { google } = require('googleapis');

const SPREADSHEET_ID = process.argv[2] || '1IFZ-oBqatX0cEN7k7JiUr_UkqyAoXPi2LgmEifNG0eY';
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json';

const RENAME = {
    'Total Summary': '전체 요약',
    'Paagrio 3-Day': '파아그리오 3일정산',
    'Heine 3-Day': '하이네 3일정산',
    'Paagrio Raw': '파아그리오 원본',
    'Heine Raw': '하이네 원본'
};

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

function periodRow(rawTab, label, server, row, dayRows, nightRows, daySalaryRows, nightSalaryRows) {
    return [
        label,
        server,
        `=${sumPlayerColumns(rawTab, dayRows[0], dayRows[1])}+${sumPlayerColumns(rawTab, nightRows[0], nightRows[1])}`,
        `=${sumPlayerColumns(rawTab, daySalaryRows[0], daySalaryRows[1])}+${sumPlayerColumns(rawTab, nightSalaryRows[0], nightSalaryRows[1])}`,
        `=D${row}*0.05`,
        `=D${row}*0.65`,
        `=D${row}*0.35`,
        `=F${row}*0.04`
    ];
}

function serverValues(title, rawTab) {
    return [
        [`${title} 3일 급여 정산`],
        ['원본 시트 ID', '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk'],
        ['기간', '서버', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소'],
        periodRow(rawTab, '1~3일', title, 4, [8, 10], [34, 36], [16, 18], [42, 44]),
        periodRow(rawTab, '4~6일', title, 5, [11, 13], [37, 39], [19, 21], [45, 47]),
        ['전체 합계', title, '=SUM(C4:C5)', '=SUM(D4:D5)', '=SUM(E4:E5)', '=SUM(F4:F5)', '=SUM(G4:G5)', '=SUM(H4:H5)']
    ];
}

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const metadata = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: 'sheets(properties(sheetId,title,hidden))'
    });

    const requests = [];
    for (const sheet of metadata.data.sheets || []) {
        const current = sheet.properties?.title;
        const next = RENAME[current];
        if (next) {
            requests.push({
                updateSheetProperties: {
                    properties: {
                        sheetId: sheet.properties.sheetId,
                        title: next,
                        hidden: next.endsWith('원본')
                    },
                    fields: 'title,hidden'
                }
            });
        }
    }
    if (requests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests }
        });
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: "'전체 요약'!A1:H7",
                    values: [
                        ['3일 단위 급여 전체 요약'],
                        ['원본 시트 ID', '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk'],
                        ['서버', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소', '비고'],
                        ['파아그리오', "='파아그리오 3일정산'!C6", "='파아그리오 3일정산'!D6", "='파아그리오 3일정산'!E6", "='파아그리오 3일정산'!F6", "='파아그리오 3일정산'!G6", "='파아그리오 3일정산'!H6", ''],
                        ['하이네', "='하이네 3일정산'!C6", "='하이네 3일정산'!D6", "='하이네 3일정산'!E6", "='하이네 3일정산'!F6", "='하이네 3일정산'!G6", "='하이네 3일정산'!H6", ''],
                        ['전체 합계', '=SUM(B4:B5)', '=SUM(C4:C5)', '=SUM(D4:D5)', '=SUM(E4:E5)', '=SUM(F4:F5)', '=SUM(G4:G5)', ''],
                        ['안내', '', '', '', '', '', '', '값이 #REF!로 보이면 숨김 원본 탭에서 액세스 허용을 한 번 눌러주세요.']
                    ]
                },
                {
                    range: "'파아그리오 3일정산'!A1:H6",
                    values: serverValues('파아그리오', '파아그리오 원본')
                },
                {
                    range: "'하이네 3일정산'!A1:H6",
                    values: serverValues('하이네', '하이네 원본')
                },
                {
                    range: "'파아그리오 원본'!A1",
                    values: [['=IMPORTRANGE("1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk","\'Paagrio Great\'!A1:AF80")']]
                },
                {
                    range: "'하이네 원본'!A1",
                    values: [['=IMPORTRANGE("1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk","\'Heine Great\'!A1:AF80")']]
                }
            ]
        }
    });

    console.log(JSON.stringify({ ok: true, spreadsheetId: SPREADSHEET_ID }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
