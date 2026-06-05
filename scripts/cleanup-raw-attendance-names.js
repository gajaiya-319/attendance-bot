'use strict';

require('dotenv').config();

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const {
    canonicalName,
    normalizeStatus,
    chooseFinalStatus
} = require('../src/services/rawAttendanceSheetService');

const spreadsheetId = CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID;
const keyFile = CONFIG.PURCHASE_GOOGLE_KEY_FILE;
const RAW_SHEET = 'Raw_Attendance';
const PROFILE_SHEET = 'Current_Workers';

function clean(value, fallback = '-') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function mergeNote(previousNote, nextNote) {
    const previous = clean(previousNote);
    const next = clean(nextNote);
    if (!previous || previous === '-') return next;
    if (!next || next === '-' || previous.includes(next)) return previous;
    return previous + ' / ' + next;
}

function splitKey(key) {
    const parts = String(key || '').split('|');
    return {
        date: clean(parts[0]),
        server: clean(parts[1]).toUpperCase(),
        shift: clean(parts[2]).toUpperCase(),
        name: canonicalName(parts.slice(3).join('|') || '')
    };
}

function makeKey({ date, server, shift, name }) {
    return [
        clean(date).toLowerCase(),
        clean(server).toUpperCase(),
        clean(shift).toUpperCase(),
        canonicalName(name).toLowerCase()
    ].join('|');
}

function isBlankRow(row) {
    return !row || row.every(cell => clean(cell, '') === '');
}

async function main() {
    if (!spreadsheetId || !keyFile) throw new Error('Missing spreadsheetId or keyFile');

    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await cleanupRawAttendance(sheets);
    await cleanupProfiles(sheets);
}

async function cleanupRawAttendance(sheets) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${RAW_SHEET}!A2:J`
    });
    const rows = response.data.values || [];
    const groups = new Map();

    rows.forEach((row, index) => {
        if (isBlankRow(row)) return;
        const keyInfo = splitKey(row[8]);
        const name = canonicalName(row[3] || keyInfo.name);
        const date = keyInfo.date && keyInfo.date !== '-' ? keyInfo.date : clean(row[0]);
        const server = keyInfo.server && keyInfo.server !== '-' ? keyInfo.server : clean(row[1]).toUpperCase();
        const shift = keyInfo.shift && keyInfo.shift !== '-' ? keyInfo.shift : clean(row[2]).toUpperCase();
        const groupKey = makeKey({ date, server, shift, name });
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push({ row, index, rowNumber: index + 2, date, server, shift, name, key: groupKey });
    });

    const updates = [];
    const clears = [];

    for (const [groupKey, items] of groups.entries()) {
        const activeItems = items.filter(item => clean(item.row[0]) !== '-' || clean(item.row[4]) !== '-');
        const keep = activeItems[0] || items[0];
        const merged = [...items].reduce((acc, item) => {
            const row = item.row;
            return {
                date: keep.date,
                server: keep.server,
                shift: keep.shift,
                name: keep.name,
                status: chooseFinalStatus(acc.status, normalizeStatus(row[4]), true),
                inTime: acc.inTime !== '-' ? acc.inTime : clean(row[5]),
                outTime: clean(row[6]) !== '-' ? clean(row[6]) : acc.outTime,
                note: mergeNote(acc.note, row[7]),
                key: groupKey
            };
        }, {
            status: '-',
            inTime: '-',
            outTime: '-',
            note: '-'
        });

        updates.push({
            range: `${RAW_SHEET}!A${keep.rowNumber}:J${keep.rowNumber}`,
            values: [[
                merged.date,
                merged.server,
                merged.shift,
                merged.name,
                merged.status,
                merged.inTime,
                merged.outTime,
                merged.note,
                merged.key,
                new Date().toISOString()
            ]]
        });

        items
            .filter(item => item.rowNumber !== keep.rowNumber)
            .forEach(item => clears.push(`${RAW_SHEET}!A${item.rowNumber}:J${item.rowNumber}`));
    }

    if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
    }

    for (const range of clears) {
        await sheets.spreadsheets.values.clear({ spreadsheetId, range });
    }

    console.log(`[cleanup] Raw_Attendance updated=${updates.length} cleared=${clears.length}`);
}

async function cleanupProfiles(sheets) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${PROFILE_SHEET}!A2:E`
    }).catch(() => ({ data: { values: [] } }));
    const rows = response.data.values || [];
    const groups = new Map();

    rows.forEach((row, index) => {
        if (isBlankRow(row)) return;
        const name = canonicalName(row[0] || row[3]);
        const key = name.toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ row, rowNumber: index + 2, name, key });
    });

    const updates = [];
    const clears = [];
    for (const [key, items] of groups.entries()) {
        const keep = items[0];
        updates.push({
            range: `${PROFILE_SHEET}!A${keep.rowNumber}:E${keep.rowNumber}`,
            values: [[
                keep.name,
                clean(keep.row[1], '').toUpperCase(),
                clean(keep.row[2], '').toUpperCase(),
                key,
                new Date().toISOString()
            ]]
        });
        items
            .filter(item => item.rowNumber !== keep.rowNumber)
            .forEach(item => clears.push(`${PROFILE_SHEET}!A${item.rowNumber}:E${item.rowNumber}`));
    }

    if (updates.length) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
    }
    for (const range of clears) {
        await sheets.spreadsheets.values.clear({ spreadsheetId, range });
    }

    console.log(`[cleanup] Current_Workers updated=${updates.length} cleared=${clears.length}`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
