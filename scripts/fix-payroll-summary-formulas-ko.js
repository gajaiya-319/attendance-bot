'use strict';

require('dotenv').config();

const { google } = require('googleapis');

const SPREADSHEET_ID = process.argv[2] || '1IFZ-oBqatX0cEN7k7JiUr_UkqyAoXPi2LgmEifNG0eY';
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'sheet-bot-key.json';

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

function sumPlayerColumns(rawTab, rows) {
    const parts = [];
    for (const row of rows) {
        for (let c = 2; c <= 26; c += 3) {
            parts.push(`'${rawTab}'!${col(c)}${row}`);
        }
    }
    return `SUM(${parts.join(',')})`;
}

function currentValues(server, rawTab) {
    return [
        [`${server} 현재 3일 급여 정산`],
        ['기준', '원본 워크리스트를 지우기 전 현재 3일치'],
        ['구분', '서버', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소'],
        [
            '이번 3일',
            server,
            `=${sumPlayerColumns(rawTab, [14, 40])}`,
            `=${sumPlayerColumns(rawTab, [22, 48])}`,
            `=${sumPlayerColumns(rawTab, [23, 49])}`,
            `=${sumPlayerColumns(rawTab, [24, 50])}`,
            `=${sumPlayerColumns(rawTab, [25, 51])}`,
            `=${sumPlayerColumns(rawTab, [28, 54])}`
        ]
    ];
}

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: "'파아그리오 3일정산'!A1:H6",
                    values: [
                        ...currentValues('파아그리오', '파아그리오 원본'),
                        ['', '', '', '', '', '', '', ''],
                        ['전체 합계', '파아그리오', '=C4', '=D4', '=E4', '=F4', '=G4', '=H4']
                    ]
                },
                {
                    range: "'하이네 3일정산'!A1:H6",
                    values: [
                        ...currentValues('하이네', '하이네 원본'),
                        ['', '', '', '', '', '', '', ''],
                        ['전체 합계', '하이네', '=C4', '=D4', '=E4', '=F4', '=G4', '=H4']
                    ]
                },
                {
                    range: "'전체 요약'!A1:H7",
                    values: [
                        ['현재 3일 급여 전체 요약'],
                        ['기준', '원본 워크리스트를 지우기 전 현재 3일치'],
                        ['서버', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소', '비고'],
                        ['파아그리오', "='파아그리오 3일정산'!C4", "='파아그리오 3일정산'!D4", "='파아그리오 3일정산'!E4", "='파아그리오 3일정산'!F4", "='파아그리오 3일정산'!G4", "='파아그리오 3일정산'!H4", ''],
                        ['하이네', "='하이네 3일정산'!C4", "='하이네 3일정산'!D4", "='하이네 3일정산'!E4", "='하이네 3일정산'!F4", "='하이네 3일정산'!G4", "='하이네 3일정산'!H4", ''],
                        ['전체 합계', '=SUM(B4:B5)', '=SUM(C4:C5)', '=SUM(D4:D5)', '=SUM(E4:E5)', '=SUM(F4:F5)', '=SUM(G4:G5)', ''],
                        ['안내', '', '', '', '', '', '', '원본 워크리스트를 지우기 전 현재 값을 월간 기록에 저장해야 과거 기록이 남습니다.']
                    ]
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
