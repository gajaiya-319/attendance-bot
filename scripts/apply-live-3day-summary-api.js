'use strict';

/**
 * Setup 최근_3일_요약: hidden Great mirrors + local formulas, then API value sync.
 *
 *   node scripts/apply-live-3day-summary-api.js
 *   node scripts/apply-live-3day-summary-api.js --formulas-only
 */

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const {
    PAAGRIO_TAB,
    HEINE_TAB,
    MIRROR_PAAGRIO,
    MIRROR_HEINE,
    buildGreatTabPayrollFormulaRow,
    loadPlayerColumnLetters,
    mirrorImportFormula
} = require('./lib/payroll-live-summary-formulas');
const { syncLiveThreeDaySummaryValues } = require('./lib/payroll-live-summary-sync');
const { buildSimpleMonthlySheetBatch } = require('./lib/payroll-monthly-summary-simple');

const RECENT_SHEET = '최근_3일_요약';

function payrollSpreadsheetId() {
    return process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
}

function greatSpreadsheetId() {
    return process.env.PURCHASE_SPREADSHEET_ID
        || process.env.SPREADSHEET_ID
        || CONFIG.PURCHASE_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

async function ensureHiddenMirrorSheet(sheets, spreadsheetId, title, greatId, sourceTab) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,hidden))'
    });
    let sheet = (meta.data.sheets || []).find(s => s.properties?.title === title);
    if (!sheet) {
        const created = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{
                    addSheet: {
                        properties: {
                            title,
                            hidden: true,
                            gridProperties: { rowCount: 130, columnCount: 20 }
                        }
                    }
                }]
            }
        });
        const newId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
        sheet = { properties: { sheetId: newId, title, hidden: true } };
    } else if (!sheet.properties.hidden) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{ updateSheetProperties: {
                    properties: { sheetId: sheet.properties.sheetId, hidden: true },
                    fields: 'hidden'
                } }]
            }
        });
    }
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${title}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[mirrorImportFormula(greatId, sourceTab)]] }
    });
    return sheet;
}

async function main() {
    const formulasOnly = process.argv.includes('--formulas-only');
    const payrollId = payrollSpreadsheetId();
    const greatId = greatSpreadsheetId();
    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await ensureHiddenMirrorSheet(sheets, payrollId, MIRROR_PAAGRIO, greatId, PAAGRIO_TAB);
    await ensureHiddenMirrorSheet(sheets, payrollId, MIRROR_HEINE, greatId, HEINE_TAB);

    const paagrioCols = await loadPlayerColumnLetters(PAAGRIO_TAB, greatId, keyFile());
    const heineCols = await loadPlayerColumnLetters(HEINE_TAB, greatId, keyFile());
    const paagrioFormulas = buildGreatTabPayrollFormulaRow(greatId, PAAGRIO_TAB, paagrioCols, true);
    const heineFormulas = buildGreatTabPayrollFormulaRow(greatId, HEINE_TAB, heineCols, true);
    const monthlyLayout = buildSimpleMonthlySheetBatch();

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: payrollId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: `'${RECENT_SHEET}'!B3`,
                    values: [[`▶ 서버별 3일 급여 기록 내역 (실시간: ${PAAGRIO_TAB} / ${HEINE_TAB} ← Work list)`]]
                },
                { range: `'${RECENT_SHEET}'!C5:H5`, values: [paagrioFormulas] },
                { range: `'${RECENT_SHEET}'!C6:H6`, values: [heineFormulas] },
                { range: `'${RECENT_SHEET}'!C7:H7`, values: [['=SUM(C5:C6)', '=SUM(D5:D6)', '=SUM(E5:E6)', '=SUM(F5:F6)', '=SUM(G5:G6)', '=SUM(H5:H6)']] },
                ...monthlyLayout
            ]
        }
    });
    await sheets.spreadsheets.values.clear({
        spreadsheetId: payrollId,
        range: `'${RECENT_SHEET}'!B8:H20`,
        requestBody: {}
    });

    const out = {
        success: true,
        mode: 'apply-live-3day-summary-api',
        payrollSpreadsheetId: payrollId,
        greatSpreadsheetId: greatId,
        mirrors: [MIRROR_PAAGRIO, MIRROR_HEINE],
        note: 'Open 급여토탈관리 → allow IMPORTRANGE on mirror tabs once. Until then, API sync fills numbers every 5 min.'
    };

    if (!formulasOnly) {
        out.sync = await syncLiveThreeDaySummaryValues({ sheets });
    }

    console.log(JSON.stringify(out, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
