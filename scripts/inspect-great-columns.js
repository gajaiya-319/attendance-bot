'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const { parseGreatTabPayrollRows, SERVER_LABELS } = require('../src/utils/payrollGreatTabParser');

const id = process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
const key = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.PURCHASE_GOOGLE_KEY_FILE || CONFIG.PURCHASE_GOOGLE_KEY_FILE;

function colLetter(i) {
    let n = i;
    let s = '';
    do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
}

async function inspectTab(sheets, tab) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `'${tab}'!A1:Z90`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    console.log(`\n=== ${tab} ===`);

    const nameRow = rows[6] || [];
    console.log('R7 names:', nameRow.map((v, i) => (v ? `${colLetter(i)}:${v}` : null)).filter(Boolean));

    for (let r = 0; r < rows.length; r += 1) {
        const a = String(rows[r][0] || '').trim();
        if (!/total\s*gain\s*adena|^total$/i.test(a)) continue;
        const cells = [];
        for (let c = 0; c < (rows[r].length || 0); c += 1) {
            const v = rows[r][c];
            if (typeof v === 'number' && v !== 0) cells.push(`${colLetter(c)}=${v}`);
        }
        console.log(`R${r + 1} [${a}]`, cells.join(', ') || '(no numbers)');
        let sumCtoM = 0;
        let sumAll = 0;
        for (let c = 2; c <= 12 && c < rows[r].length; c += 1) sumCtoM += Number(rows[r][c]) || 0;
        for (let c = 2; c < rows[r].length; c += 1) sumAll += Number(rows[r][c]) || 0;
        console.log(`  sum C:M=${sumCtoM}, sum C:Z=${sumAll}`);
    }

    const parsed = parseGreatTabPayrollRows(rows.slice(0, 120).map(r => {
        const copy = [...(r || [])];
        while (copy.length < 13) copy.push('');
        return copy;
    }), tab.includes('Paagrio') ? SERVER_LABELS.PAAGRIO : SERVER_LABELS.HEINE);
    console.log('parser:', parsed.ok ? parsed.row : parsed);
}

async function inspectSummary(sheets) {
    const [vals, forms] = await Promise.all([
        sheets.spreadsheets.values.get({
            spreadsheetId: id,
            range: "'최근_3일_요약'!B3:H12",
            valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId: id,
            range: "'최근_3일_요약'!B3:H12",
            valueRenderOption: 'FORMULA'
        })
    ]);
    console.log('\n=== 최근_3일_요약 ===');
    console.log('values:', JSON.stringify(vals.data.values, null, 2));
}

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    await inspectTab(sheets, 'Paagrio Great');
    await inspectTab(sheets, 'Heine Great');
    await inspectSummary(sheets);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
