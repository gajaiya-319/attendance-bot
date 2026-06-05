'use strict';

const { google } = require('googleapis');
const { CONFIG } = require('../../src/config/constants');
const { parseGreatTabPayrollRows, SERVER_LABELS } = require('../../src/utils/payrollGreatTabParser');

const RECENT_SHEET = '최근_3일_요약';
const PAAGRIO_TAB = process.env.PURCHASE_PAAGRIO_TAB_NAME || 'Paagrio Great';
const HEINE_TAB = process.env.PURCHASE_HEINE_TAB_NAME || 'Heine Great';

function payrollSpreadsheetId() {
    return process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
}

function greatSpreadsheetId() {
    return process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

/** Work list 요약도 API로 갱신(열 밀림 시 수식보다 정확). false 로 끄면 수식만. */
function shouldSyncWorklistSummary() {
    const v = String(process.env.PAYROLL_SYNC_WORKLIST_SUMMARY || '').trim().toLowerCase();
    const allow = String(process.env.ALLOW_WORKLIST_PAYROLL_WRITES || '').trim() === '1';
    return allow && ['1', 'true', 'yes'].includes(v);
}

function payrollRowValues(row) {
    return [
        Math.round(row.totalAdena || 0),
        Math.round(row.grossSalary || 0),
        Math.round(row.txFee || 0),
        Math.round(row.playerShare || 0),
        Math.round(row.ownerShare || 0),
        Math.round(Number(row.totalPeso || 0) * 100) / 100
    ];
}

function sumRows(a, b) {
    return a.map((v, i) => v + b[i]);
}

async function spreadsheetHasSheet(sheets, spreadsheetId, title) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties.title'
    });
    return (meta.data.sheets || []).some(s => s.properties?.title === title);
}

async function writeRecentSummarySheet(sheets, spreadsheetId, {
    paagrioVals,
    heineVals,
    totalVals,
    syncedAt,
    bannerNote
}) {
    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${RECENT_SHEET}'!B8:H20`,
        requestBody: {}
    });

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: `'${RECENT_SHEET}'!B3`,
                    values: [[`▶ 서버별 3일 급여 기록 내역 (${bannerNote})`]]
                },
                { range: `'${RECENT_SHEET}'!C5:H5`, values: [paagrioVals] },
                { range: `'${RECENT_SHEET}'!C6:H6`, values: [heineVals] },
                { range: `'${RECENT_SHEET}'!C7:H7`, values: [totalVals] }
            ]
        }
    });
}

async function readGreatSnapshots(sheets) {
    const greatId = greatSpreadsheetId();
    const [paagrioRes, heineRes] = await Promise.all([
        sheets.spreadsheets.values.get({
            spreadsheetId: greatId,
            range: `'${PAAGRIO_TAB}'!A1:ZZ120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId: greatId,
            range: `'${HEINE_TAB}'!A1:ZZ120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        })
    ]);
    const paagrio = parseGreatTabPayrollRows(paagrioRes.data.values || [], SERVER_LABELS.PAAGRIO);
    const heine = parseGreatTabPayrollRows(heineRes.data.values || [], SERVER_LABELS.HEINE);
    return { paagrio, heine, greatId };
}

async function syncLiveThreeDaySummaryValues({ sheets: sheetsClient } = {}) {
    let sheets = sheetsClient;
    if (!sheets) {
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFile(),
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        sheets = google.sheets({ version: 'v4', auth });
    }
    const payrollId = payrollSpreadsheetId();
    const { paagrio, heine, greatId } = await readGreatSnapshots(sheets);

    if (!paagrio.ok || !heine.ok) {
        return {
            ok: false,
            code: 'great-tabs-not-ready',
            paagrio: paagrio.code,
            heine: heine.code,
            greatSpreadsheetId: greatId
        };
    }

    const paagrioVals = payrollRowValues(paagrio.row);
    const heineVals = payrollRowValues(heine.row);
    const totalVals = sumRows(paagrioVals, heineVals);
    const syncedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const valueBundle = { paagrioVals, heineVals, totalVals, syncedAt };

    const targets = [{ spreadsheetId: payrollId, bannerNote: `갱신 ${syncedAt} · Work list ${PAAGRIO_TAB} / ${HEINE_TAB}` }];
    if (shouldSyncWorklistSummary()
        && greatId !== payrollId
        && await spreadsheetHasSheet(sheets, greatId, RECENT_SHEET)) {
        targets.push({
            spreadsheetId: greatId,
            bannerNote: `갱신 ${syncedAt} · 이 파일 ${PAAGRIO_TAB} / ${HEINE_TAB}`
        });
    }

    for (const target of targets) {
        await writeRecentSummarySheet(sheets, target.spreadsheetId, {
            ...valueBundle,
            bannerNote: target.bannerNote
        });
    }

    return {
        ok: true,
        mode: 'sync-live-3day-summary-values',
        payrollSpreadsheetId: payrollId,
        greatSpreadsheetId: greatId,
        syncedTargets: targets.map(t => t.spreadsheetId),
        syncedAt,
        paagrio: paagrio.row,
        heine: heine.row,
        total: {
            totalAdena: paagrio.row.totalAdena + heine.row.totalAdena,
            grossSalary: paagrio.row.grossSalary + heine.row.grossSalary
        }
    };
}

module.exports = {
    RECENT_SHEET,
    syncLiveThreeDaySummaryValues,
    payrollSpreadsheetId,
    greatSpreadsheetId,
    shouldSyncWorklistSummary
};
