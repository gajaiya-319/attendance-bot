'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appsScriptHtml = path.join(root, 'scripts', 'AttendanceDashboard.html');
const appsScriptCode = path.join(root, 'scripts', 'raw-attendance-apps-script.js');
const constantsFile = path.join(root, 'src', 'config', 'constants.js');
const currentWebAppBase = 'https://script.google.com/macros/s/AKfycbx3a9-T71S_zfRwf-hCCwmLfzJR2mW3E3FTNXHWNaa1s-p5gdJqmCd3L6W9IoVNvBGj/exec';
const retiredWebAppBase = 'https://script.google.com/macros/s/AKfycbyXYC-WsPTcW16ozt1OSoCrLY2WcOpRMgiyveMpBtZVwYdNsIoBrX1KtWjH_vRsHq_H/exec';
const LIVE_AUDIT_DEFAULT_URL = `${currentWebAppBase}?api=raw`;
const RAW_COLUMNS = {
    date: '\uB0A0\uC9DC',
    server: '\uC11C\uBC84',
    shift: '\uADFC\uBB34\uC870',
    name: '\uC774\uB984',
    status: '\uC0C1\uD0DC',
    key: '\uD0A4'
};
const VALID_STATUSES = new Set(['\uC815\uCD9C', '\uC9C0\uAC01', '\uACB0\uC11D', '\uC870\uD1F4', '\uC5F0\uC7A5\uADFC\uBB34', '\uD734\uBB34', '-']);
const VALID_SERVERS = new Set(['HEINE', 'PAAGRIO']);
const VALID_SHIFTS = new Set(['DAY', 'NIGHT']);

function read(file) {
    if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
    return fs.readFileSync(file, 'utf8');
}

function assertIncludes(text, needle, label) {
    if (!text.includes(needle)) throw new Error(`${label} is missing required fragment: ${needle}`);
}

function assertNotIncludes(text, needle, label) {
    if (text.includes(needle)) throw new Error(`${label} contains forbidden fragment: ${needle}`);
}

function assertInlineScriptsCompile(html, label) {
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    if (scripts.length === 0) throw new Error(`${label} has no inline scripts to validate`);

    scripts.forEach((script, index) => {
        try {
            new vm.Script(script, { filename: `${label}#script-${index + 1}.js` });
        } catch (error) {
            throw new Error(`${label} inline script ${index + 1} has invalid JavaScript: ${error.message}`);
        }
    });
}

function normalize(value) {
    return String(value ?? '').trim();
}

function rowValue(row, key) {
    return normalize(row?.[key]);
}

function parseArgs(argv = []) {
    const options = {
        live: false,
        url: process.env.RAW_ATTENDANCE_AUDIT_URL || LIVE_AUDIT_DEFAULT_URL,
        maxRows: 12
    };
    for (const arg of argv) {
        if (arg === '--live') options.live = true;
        else if (arg === '--no-live') options.live = false;
        else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
        else if (arg.startsWith('--max-rows=')) options.maxRows = Number(arg.slice('--max-rows='.length));
    }
    return options;
}

function auditRows(rows = []) {
    const issues = [];
    const seenByDate = new Map();
    const seenProfileKeys = new Map();

    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const date = rowValue(row, RAW_COLUMNS.date);
        const server = rowValue(row, RAW_COLUMNS.server).toUpperCase();
        const shift = rowValue(row, RAW_COLUMNS.shift).toUpperCase();
        const name = rowValue(row, RAW_COLUMNS.name);
        const status = rowValue(row, RAW_COLUMNS.status);
        const key = rowValue(row, RAW_COLUMNS.key);
        const isProfilePlaceholder = date === '-' && status === '-' && Boolean(server && shift && name && key);
        const emptyScope = !date && !server && !shift && !status && !key;

        if (!name || name === 'Unknown') {
            issues.push({ code: 'UNKNOWN_NAME', rowNumber, row });
        }
        if (emptyScope) {
            issues.push({ code: 'EMPTY_ROW_EXPOSED', rowNumber, row });
        }
        if (!isProfilePlaceholder && (!server || !VALID_SERVERS.has(server))) {
            issues.push({ code: 'BAD_SERVER', rowNumber, value: server || '(blank)', row });
        }
        if (!isProfilePlaceholder && (!shift || !VALID_SHIFTS.has(shift))) {
            issues.push({ code: 'BAD_SHIFT', rowNumber, value: shift || '(blank)', row });
        }
        if (status && !VALID_STATUSES.has(status)) {
            issues.push({ code: 'BAD_STATUS', rowNumber, value: status, row });
        }

        const identityKey = `${server}|${shift}|${name.toLowerCase()}`;
        if (isProfilePlaceholder) {
            const profileRows = seenProfileKeys.get(identityKey) || [];
            profileRows.push(rowNumber);
            seenProfileKeys.set(identityKey, profileRows);
            return;
        }
        if (date && date !== '-' && server && shift && name) {
            const dayKey = `${date}|${identityKey}`;
            const dayRows = seenByDate.get(dayKey) || [];
            dayRows.push(rowNumber);
            seenByDate.set(dayKey, dayRows);
        }
    });

    for (const [key, rowsForKey] of seenByDate.entries()) {
        if (rowsForKey.length > 1) {
            issues.push({ code: 'DUPLICATE_ATTENDANCE_DAY', key, rows: rowsForKey });
        }
    }
    for (const [key, rowsForKey] of seenProfileKeys.entries()) {
        if (rowsForKey.length > 1) {
            issues.push({ code: 'DUPLICATE_PROFILE_PLACEHOLDER', key, rows: rowsForKey });
        }
    }

    return issues;
}

function fetchJson(url) {
    const target = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    return fetch(target).then(response => {
        if (!response.ok) throw new Error(`GET ${target} failed with HTTP ${response.status}`);
        return response.json();
    });
}

function formatIssue(issue) {
    if (issue.rows) return `${issue.code}: ${issue.key} rows=${issue.rows.join(',')}`;
    const name = rowValue(issue.row, RAW_COLUMNS.name) || '-';
    const server = rowValue(issue.row, RAW_COLUMNS.server) || '-';
    const shift = rowValue(issue.row, RAW_COLUMNS.shift) || '-';
    const status = rowValue(issue.row, RAW_COLUMNS.status) || '-';
    const value = issue.value ? ` value=${issue.value}` : '';
    return `${issue.code}: row=${issue.rowNumber} ${server}/${shift} ${name} status=${status}${value}`;
}

function runStaticAudit() {
    const html = read(appsScriptHtml);
    const code = read(appsScriptCode);
    const constants = read(constantsFile);

    assertIncludes(code, "params.api === 'raw'", 'raw-attendance-apps-script.js');
    assertIncludes(code, "createHtmlOutputFromFile('AttendanceDashboard')", 'raw-attendance-apps-script.js');
    assertIncludes(code, 'function getRawAttendanceRows()', 'raw-attendance-apps-script.js');
    assertIncludes(code, 'const attendanceCells = row.slice(0, RAW_ATTENDANCE_HEADERS.length)', 'raw-attendance-apps-script.js');
    assertIncludes(code, 'if (!hasIdentity && !hasAttendanceScope && !hasAttendanceFact) return null', 'raw-attendance-apps-script.js');

    assertIncludes(constants, currentWebAppBase, 'constants.js');
    assertNotIncludes(constants, retiredWebAppBase, 'constants.js');
    assertIncludes(html, `const API_URL = '${currentWebAppBase}?api=raw';`, 'AttendanceDashboard.html');
    assertIncludes(html, "if (window.google && google.script && google.script.run)", 'AttendanceDashboard.html');
    assertIncludes(html, 'google.script.run', 'AttendanceDashboard.html');
    assertIncludes(html, "fetch(API_URL + '&t=' + Date.now()", 'AttendanceDashboard.html');
    assertIncludes(html, 'function showLoadError(error)', 'AttendanceDashboard.html');
    assertIncludes(html, "let currentSort = 'ATT'", 'AttendanceDashboard.html');
    assertIncludes(html, "else if (status === '\\uc5f0\\uc7a5\\uadfc\\ubb34')", 'AttendanceDashboard.html');
    assertIncludes(html, 'const attended = d.jung + d.ji + d.jo', 'AttendanceDashboard.html');
    assertIncludes(html, 'tBase += d.jung + d.ji + d.jo + d.gyul', 'AttendanceDashboard.html');
    assertIncludes(html, 'const base = attended + d.gyul', 'AttendanceDashboard.html');
    assertIncludes(html, 'b.attRate - a.attRate', 'AttendanceDashboard.html');
    assertIncludes(html, 'b.jung - a.jung', 'AttendanceDashboard.html');
    assertIncludes(html, 'class="control-row filter-row"', 'AttendanceDashboard.html');
    assertIncludes(html, 'class="control-label shift-label"', 'AttendanceDashboard.html');
    assertNotIncludes(html, 'class="description"', 'AttendanceDashboard.html');
    assertNotIncludes(html, 'Raw_Attendance&#50640;', 'AttendanceDashboard.html');
    assertNotIncludes(html, '???', 'AttendanceDashboard.html');
    assertNotIncludes(html, '??', 'AttendanceDashboard.html');
    assertInlineScriptsCompile(html, 'AttendanceDashboard.html');

    console.log('Raw attendance dashboard static audit passed.');
}

async function runLiveAudit(options) {
    const rows = await fetchJson(options.url);
    if (!Array.isArray(rows)) throw new Error('Live raw attendance response is not an array.');
    const issues = auditRows(rows);
    console.log(`Raw attendance live rows: ${rows.length}`);
    console.log(`Raw attendance live issues: ${issues.length}`);
    if (issues.length) {
        issues.slice(0, options.maxRows).forEach(issue => console.log(`- ${formatIssue(issue)}`));
        if (issues.length > options.maxRows) console.log(`- ... ${issues.length - options.maxRows} more`);
        throw new Error('Raw attendance live audit found data issues.');
    }
    console.log('Raw attendance live audit passed.');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    runStaticAudit();
    if (options.live) await runLiveAudit(options);
}

if (require.main === module) {
    main().catch(error => {
        console.error('Raw attendance dashboard audit failed.');
        console.error(error.message || error);
        process.exit(1);
    });
}

module.exports = {
    auditRows,
    parseArgs,
    runStaticAudit,
    runLiveAudit
};
