'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const {
    parseGreatTabPayrollRows,
    discoverPlayerAdenaColumnIndices,
    columnIndexToLetter,
    SERVER_LABELS
} = require('../src/utils/payrollGreatTabParser');

const id = process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
const payrollId = process.env.PAYROLL_SUMMARY_SPREADSHEET_ID || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;

async function scanTab(sheets, tab) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${tab}'!A1:ZZ120`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    console.log(`\n======== ${tab} ========`);
    console.log('discovered player cols:', discoverPlayerAdenaColumnIndices(rows).map(columnIndexToLetter));
    console.log('parser:', JSON.stringify(parseGreatTabPayrollRows(rows, tab.includes('Paagrio') ? SERVER_LABELS.PAAGRIO : SERVER_LABELS.HEINE), null, 2));

    for (let r = 0; r < rows.length; r += 1) {
        const row = rows[r] || [];
        const a = String(row[0] || '').trim();
        const left = `${a} ${String(row[1] || '').trim()}`.trim();
        if (/total\s*gain\s*adena|^total$/i.test(left) || /total\s*gain\s*adena/i.test(a)) {
            const nums = [];
            for (let c = 0; c < row.length; c += 1) {
                const v = row[c];
                if (typeof v === 'number' && v !== 0) nums.push(`${columnIndexToLetter(c)}=${v}`);
            }
            console.log(`R${r + 1} [${a || left}]`, nums.join(', ') || '(empty)');
        }
    }

    // Row 7 all non-empty headers
    const h = rows[6] || [];
    const headers = [];
    for (let c = 0; c < h.length; c += 1) {
        if (h[c] !== undefined && h[c] !== null && String(h[c]).trim() !== '') {
            headers.push(`${columnIndexToLetter(c)}=${JSON.stringify(h[c])}`);
        }
    }
    console.log('R7 headers:', headers.join(' | '));
}

async function scanSummary(sheets, spreadsheetId, label) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title'
    });
    const hasRecentSummary = (meta.data.sheets || [])
        .some(sheet => sheet.properties?.title === '\uCD5C\uADFC_3\uC77C_\uC694\uC57D');
    if (!hasRecentSummary) {
        console.log(`\n======== ${label} recent 3-day summary (${spreadsheetId}) ========`);
        console.log('SKIP: recent 3-day summary sheet is not present in this workbook.');
        return;
    }

    const [vals, forms] = await Promise.all([
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'\uCD5C\uADFC_3\uC77C_\uC694\uC57D'!A1:H30",
            valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range: "'\uCD5C\uADFC_3\uC77C_\uC694\uC57D'!C5:H6",
            valueRenderOption: 'FORMULA'
        })
    ]);
    console.log(`\n======== ${label} recent 3-day summary (${spreadsheetId}) ========`);
    (vals.data.values || []).forEach((row, i) => {
        if (row?.some(c => c !== '' && c != null)) console.log(`R${i + 1}`, row);
    });
    console.log('FORMULAS C5:H6:');
    (forms.data.values || []).forEach((row, i) => {
        console.log(`R${i + 5}`, row?.map(c => String(c || '').slice(0, 120)) || []);
    });
}

async function main() {
    const sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    }) });
    await scanTab(sheets, 'Paagrio Great');
    await scanTab(sheets, 'Valakas Great');
    await scanSummary(sheets, id, 'Work list');
    if (payrollId && payrollId !== id) {
        await scanSummary(sheets, payrollId, '급여통합관리');
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
