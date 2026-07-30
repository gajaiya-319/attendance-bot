'use strict';

const { google } = require('googleapis');
const { CONFIG } = require('../../src/config/constants');
const { parseGreatTabPayrollRows, SERVER_LABELS } = require('../../src/utils/payrollGreatTabParser');

const RECENT_SHEET = '\uCD5C\uADFC_3\uC77C_\uC694\uC57D';
const PAAGRIO_TAB = process.env.PURCHASE_PAAGRIO_TAB_NAME || 'Paagrio Great';
const HEINE_TAB = process.env.PURCHASE_VALACAS_TAB_NAME || process.env.PURCHASE_HEINE_TAB_NAME || 'Valakas Great';
const PAAGRIO_SHEET_ID = Number(process.env.PURCHASE_PAAGRIO_SHEET_ID || CONFIG.PURCHASE_SERVER_SHEET_IDS?.PAAGRIO || 354531306);
const HEINE_SHEET_ID = Number(process.env.PURCHASE_VALACAS_SHEET_ID || process.env.PURCHASE_HEINE_SHEET_ID || CONFIG.PURCHASE_SERVER_SHEET_IDS?.HEINE || 140599828);
const CLOSED_SIGNATURE_CELL = 'Z1';

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

/** Work list 요약을 API로 갱신한다. false이면 수식만 유지한다. */
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

async function resolveRequiredSourceTabs(sheets, spreadsheetId) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title))'
    });
    const byId = new Map((meta.data.sheets || []).map(sheet => [
        Number(sheet.properties?.sheetId),
        String(sheet.properties?.title || '')
    ]));
    const paagrioTitle = byId.get(PAAGRIO_SHEET_ID);
    const heineTitle = byId.get(HEINE_SHEET_ID);
    if (!paagrioTitle || !heineTitle) {
        throw new Error(`Required Work list source gid missing: PAAGRIO=${PAAGRIO_SHEET_ID}, VALACAS=${HEINE_SHEET_ID}`);
    }
    return {
        paagrio: { sheetId: PAAGRIO_SHEET_ID, title: paagrioTitle },
        heine: { sheetId: HEINE_SHEET_ID, title: heineTitle }
    };
}

async function writeRecentSummarySheet(sheets, spreadsheetId, {
    paagrioVals,
    heineVals,
    totalVals,
    syncedAt,
    bannerNote
}) {
    const closedResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${RECENT_SHEET}'!${CLOSED_SIGNATURE_CELL}`,
        valueRenderOption: 'FORMATTED_VALUE'
    }).catch(() => ({ data: { values: [] } }));
    const closedSignature = String(closedResponse.data.values?.[0]?.[0] || '');
    const currentSignature = JSON.stringify([paagrioVals, heineVals]);
    if (closedSignature && closedSignature === currentSignature) {
        return { heldAfterClose: true };
    }
    if (closedSignature) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `'${RECENT_SHEET}'!${CLOSED_SIGNATURE_CELL}`,
            requestBody: {}
        });
    }
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
                {
                    range: `'${RECENT_SHEET}'!B3`,
                    values: [[`\uC11C\uBC84\uBCC4 3\uC77C \uAE09\uC5EC \uAE30\uB85D \uB0B4\uC5ED (${bannerNote})`]]
                },
                {
                    range: `'${RECENT_SHEET}'!B4:H4`,
                    values: [[
                        '\uC11C\uBC84\uBA85',
                        '\uCD1D \uD68D\uB4DD \uC544\uB370\uB098',
                        '\uCD1D \uAE09\uC5EC',
                        '\uC218\uC218\uB8CC 5%',
                        '\uC9C1\uC6D0 70%',
                        '\uC624\uB108 30%',
                        '\uCD1D \uD398\uC18C'
                    ]]
                },
                { range: `'${RECENT_SHEET}'!C5:H5`, values: [paagrioVals] },
                { range: `'${RECENT_SHEET}'!C6:H6`, values: [heineVals] },
                { range: `'${RECENT_SHEET}'!C7:H7`, values: [totalVals] }
            ]
        }
    });
    return { heldAfterClose: false };
}

async function readGreatSnapshots(sheets) {
    const greatId = greatSpreadsheetId();
    const sourceTabs = await resolveRequiredSourceTabs(sheets, greatId);
    const [paagrioRes, heineRes] = await Promise.all([
        sheets.spreadsheets.values.get({
            spreadsheetId: greatId,
            range: `'${sourceTabs.paagrio.title}'!A1:ZZ120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        }),
        sheets.spreadsheets.values.get({
            spreadsheetId: greatId,
            range: `'${sourceTabs.heine.title}'!A1:ZZ120`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        })
    ]);
    const paagrio = parseGreatTabPayrollRows(paagrioRes.data.values || [], SERVER_LABELS.PAAGRIO, { allowEmptyTotals: true });
    const heine = parseGreatTabPayrollRows(heineRes.data.values || [], SERVER_LABELS.HEINE, { allowEmptyTotals: true });
    return { paagrio, heine, greatId, sourceTabs };
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
    const { paagrio, heine, greatId, sourceTabs } = await readGreatSnapshots(sheets);

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

    const sourceLabel = `${sourceTabs.paagrio.title} (gid=${sourceTabs.paagrio.sheetId}) / ${sourceTabs.heine.title} (gid=${sourceTabs.heine.sheetId})`;
    const targets = [{ spreadsheetId: payrollId, bannerNote: `\uAC31\uC2E0 ${syncedAt} - Work list ${sourceLabel}` }];
    if (shouldSyncWorklistSummary()
        && greatId !== payrollId
        && await spreadsheetHasSheet(sheets, greatId, RECENT_SHEET)) {
        targets.push({
            spreadsheetId: greatId,
            bannerNote: `\uAC31\uC2E0 ${syncedAt} - \uC6D0\uBCF8 ${sourceLabel}`
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
        sourceTabs,
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
    shouldSyncWorklistSummary,
    resolveRequiredSourceTabs
};
