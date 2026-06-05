'use strict';

/**
 * Create/update 최근_3일_요약 + 월간_누적_요약 on the Work list (same file as Great tabs).
 *
 *   node scripts/setup-payroll-summary-worklist.js
 */

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const {
    PAAGRIO_TAB,
    HEINE_TAB,
    buildGreatTabPayrollFormulaRow,
    loadPlayerColumnLetters
} = require('./lib/payroll-live-summary-formulas');
const { buildSimpleMonthlySheetBatch } = require('./lib/payroll-monthly-summary-simple');

const RECENT = '최근_3일_요약';
const MONTHLY = '월간_누적_요약';

function worklistId() {
    return process.env.PURCHASE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || CONFIG.PURCHASE_SPREADSHEET_ID;
}

function payrollSpreadsheetId() {
    return process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

async function ensureSheet(sheets, spreadsheetId, title, hidden = false) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,hidden))'
    });
    let sheet = (meta.data.sheets || []).find(s => s.properties?.title === title);
    if (!sheet) {
        const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    addSheet: {
                        properties: {
                            title,
                            hidden,
                            gridProperties: { rowCount: 40, columnCount: 10 }
                        }
                    }
                }]
            }
        });
        sheet = { properties: res.data.replies[0].addSheet.properties };
    }
    return sheet;
}

async function main() {
    if (process.env.ALLOW_WORKLIST_PAYROLL_WRITES !== '1') {
        throw new Error('Refusing to create payroll tabs in Work list. Use PAYROLL_SUMMARY_SPREADSHEET_ID / PAYROLL_ARCHIVE_SPREADSHEET_ID instead.');
    }

    const spreadsheetId = worklistId();
    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const payrollId = payrollSpreadsheetId();
    await ensureSheet(sheets, spreadsheetId, RECENT, false);
    await ensureSheet(sheets, payrollId, MONTHLY, false);

    const paagrioCols = await loadPlayerColumnLetters(PAAGRIO_TAB, spreadsheetId, keyFile());
    const heineCols = await loadPlayerColumnLetters(HEINE_TAB, spreadsheetId, keyFile());
    const paagrioFormulas = buildGreatTabPayrollFormulaRow(spreadsheetId, PAAGRIO_TAB, paagrioCols, false);
    const heineFormulas = buildGreatTabPayrollFormulaRow(spreadsheetId, HEINE_TAB, heineCols, false);

    const monthlyLayout = buildSimpleMonthlySheetBatch();

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                { range: `'${RECENT}'!B1:H1`, values: [['⏱️ [2회차] 3일 단위 급여 기록 요약', '', '', '', '', '', '']] },
                {
                    range: `'${RECENT}'!B3`,
                    values: [[`▶ 서버별 3일 급여 기록 내역 (실시간: ${PAAGRIO_TAB} / ${HEINE_TAB})`]]
                },
                {
                    range: `'${RECENT}'!B4:H4`,
                    values: [['서버명', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소']]
                },
                { range: `'${RECENT}'!B5`, values: [['🔥 파아그리오']] },
                { range: `'${RECENT}'!C5:H5`, values: [paagrioFormulas] },
                { range: `'${RECENT}'!B6`, values: [['💧 하이네']] },
                { range: `'${RECENT}'!C6:H6`, values: [heineFormulas] },
                { range: `'${RECENT}'!B8`, values: [['💰 3일 총합']] },
                {
                    range: `'${RECENT}'!C8:H8`,
                    values: [['=SUM(C5:C6)', '=SUM(D5:D6)', '=SUM(E5:E6)', '=SUM(F5:F6)', '=SUM(G5:G6)', '=SUM(H5:H6)']]
                },
            ]
        }
    });

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: payrollId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: monthlyLayout
        }
    });

    console.log(JSON.stringify({
        success: true,
        spreadsheetId,
        recentSheet: RECENT,
        monthlySheet: MONTHLY,
        payrollSpreadsheetId: payrollId,
        note: '월간_누적_요약: Raw_Data SUMIF 5~7행만. 최근_3일_요약 = Great 실시간.'
    }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
