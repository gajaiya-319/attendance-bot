'use strict';

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const { parseGreatTabPayrollRows, SERVER_LABELS } = require('../src/utils/payrollGreatTabParser');

const RECENT = '최근_3일_요약';
const PAAGRIO = process.env.PURCHASE_PAAGRIO_TAB_NAME || 'Paagrio Great';
const HEINE = process.env.PURCHASE_HEINE_TAB_NAME || 'Heine Great';

function payrollId() {
    return process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
}

function greatId() {
    return process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

async function main() {
    const auth = new google.auth.GoogleAuth({
        keyFile: keyFile(),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const pid = payrollId();
    const gid = greatId();

    const [recentFormulas, recentValues, paagrioRows, heineRows] = await Promise.all([
        sheets.spreadsheets.values.get({
            spreadsheetId: pid,
            range: `'${RECENT}'!B3:H8`,
            valueRenderOption: 'FORMULA'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId: pid,
            range: `'${RECENT}'!B3:H8`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId: gid,
            range: `'${PAAGRIO}'!A1:M120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId: gid,
            range: `'${HEINE}'!A1:M120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        })
    ]);

    const paagrio = parseGreatTabPayrollRows(paagrioRows.data.values || [], SERVER_LABELS.PAAGRIO);
    const heine = parseGreatTabPayrollRows(heineRows.data.values || [], SERVER_LABELS.HEINE);

    const labelHits = (rows, pattern) => {
        const hits = [];
        for (let r = 0; r < (rows || []).length; r += 1) {
            const left = `${rows[r]?.[0] || ''} ${rows[r]?.[1] || ''}`.trim();
            if (pattern.test(left)) hits.push({ row: r + 1, a: rows[r][0], b: rows[r][1], m: rows[r][12], c: rows[r][2] });
        }
        return hits.slice(0, 8);
    };

    console.log(JSON.stringify({
        payrollSpreadsheetId: pid,
        greatSpreadsheetId: gid,
        recentFormulas: recentFormulas.data.values,
        recentValues: recentValues.data.values,
        greatParser: {
            paagrio: paagrio.ok ? paagrio.row : { ok: false, code: paagrio.code },
            heine: heine.ok ? heine.row : { ok: false, code: heine.code }
        },
        paagrioLabelSamples: {
            totalAdena: labelHits(paagrioRows.data.values, /total\s*gain\s*adena/i),
            totalRow: labelHits(paagrioRows.data.values, /^(TOTAL|total)/i),
            peso: labelHits(paagrioRows.data.values, /expected\s*peso/i)
        }
    }, null, 2));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
