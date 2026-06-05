'use strict';

const { google } = require('googleapis');
const { CONFIG } = require('../../src/config/constants');
const { playerAdenaColumnLetters, parseGreatTabPayrollRows, SERVER_LABELS } = require('../../src/utils/payrollGreatTabParser');

const PAAGRIO_TAB = 'Paagrio Great';
const HEINE_TAB = 'Heine Great';
const MIRROR_PAAGRIO = '_Great_Paagrio_Mirror';
const MIRROR_HEINE = '_Great_Heine_Mirror';

function quoteSheet(tabName) {
    return `'${String(tabName).replace(/'/g, "''")}'`;
}

async function loadPlayerColumnLetters(tabName, spreadsheetId, keyFile) {
    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName}'!A1:ZZ120`,
        valueRenderOption: 'UNFORMATTED_VALUE'
    });
    const rows = res.data.values || [];
    const label = tabName.includes('Paagrio') ? SERVER_LABELS.PAAGRIO : SERVER_LABELS.HEINE;
    const parsed = parseGreatTabPayrollRows(rows, label);
    return parsed.playerColumns || playerAdenaColumnLetters(rows);
}

function buildPlayerAdenaColumnSumExpr(tabName, columnLetters) {
    const sheet = quoteSheet(tabName);
    return columnLetters
        .map(col => `IFERROR(VALUE(${sheet}!${col}2:${col}120),0)`)
        .join('+');
}

function buildHorizontalGreatMetricFormula(tabName, rowRegex, columnLetters) {
    const sheet = quoteSheet(tabName);
    const colSum = buildPlayerAdenaColumnSumExpr(tabName, columnLetters);
    const matchA = `REGEXMATCH(TO_TEXT(${sheet}!A2:A120), "${rowRegex}")`;
    const matchB = `REGEXMATCH(TO_TEXT(${sheet}!B2:B120), "${rowRegex}")`;
    return `=SUM(ARRAYFORMULA(((${matchA})+(${matchB})>0)*(${colSum})))`;
}

function buildMirrorMetricFormula(mirrorTab, metric, columnLetters) {
    if (metric === 'totalAdena') {
        return buildHorizontalGreatMetricFormula(mirrorTab, '(?i)total\\s*gain\\s*adena', columnLetters);
    }
    if (metric === 'grossSalary') {
        return buildHorizontalGreatMetricFormula(mirrorTab, '(?i)^total$', columnLetters);
    }
    if (metric === 'txFee') {
        return buildHorizontalGreatMetricFormula(mirrorTab, '(?i)^5%$|tx\\s*fee', columnLetters);
    }
    if (metric === 'playerShare') {
        return buildHorizontalGreatMetricFormula(mirrorTab, '(?i)^0\\.65$|^player$', columnLetters);
    }
    if (metric === 'ownerShare') {
        return buildHorizontalGreatMetricFormula(mirrorTab, '(?i)^0\\.35$|^owner$', columnLetters);
    }
    if (metric === 'totalPeso') {
        return buildHorizontalGreatMetricFormula(mirrorTab, '(?i)expected\\s*peso', columnLetters);
    }
    return '=0';
}

function buildGreatTabPayrollFormulaRow(greatSpreadsheetId, tabName, columnLetters, useMirror = true) {
    const targetTab = useMirror
        ? (tabName === PAAGRIO_TAB ? MIRROR_PAAGRIO : (tabName === HEINE_TAB ? MIRROR_HEINE : tabName))
        : tabName;
    return [
        buildMirrorMetricFormula(targetTab, 'totalAdena', columnLetters),
        buildMirrorMetricFormula(targetTab, 'grossSalary', columnLetters),
        buildMirrorMetricFormula(targetTab, 'txFee', columnLetters),
        buildMirrorMetricFormula(targetTab, 'playerShare', columnLetters),
        buildMirrorMetricFormula(targetTab, 'ownerShare', columnLetters),
        buildMirrorMetricFormula(targetTab, 'totalPeso', columnLetters)
    ];
}

function mirrorImportFormula(greatSpreadsheetId, sourceTab) {
    return `=IMPORTRANGE("${greatSpreadsheetId}","${quoteSheet(sourceTab)}!A1:ZZ120")`;
}

function keyFile() {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS
        || process.env.PURCHASE_GOOGLE_KEY_FILE
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
}

function worklistSpreadsheetId() {
    return process.env.PURCHASE_SPREADSHEET_ID || CONFIG.PURCHASE_SPREADSHEET_ID;
}

module.exports = {
    PAAGRIO_TAB,
    HEINE_TAB,
    MIRROR_PAAGRIO,
    MIRROR_HEINE,
    buildGreatTabPayrollFormulaRow,
    buildHorizontalGreatMetricFormula,
    loadPlayerColumnLetters,
    mirrorImportFormula,
    keyFile,
    worklistSpreadsheetId
};
