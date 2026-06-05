'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function cleanExtractBody(body) {
    return body
        .replace(/^\uFEFF/, '')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\* \[[^\]]+\]\s*$/gm, '')
        .replace(/^\s*\*\/\s*$/gm, '')
        .trimStart();
}

function commonStateReplacements(body) {
    let out = body.replace(
        /overtimeUsers\s*=\s*overtimeUsers\.filter\(([^;]+)\);/g,
        'setOvertimeUsers(getOvertimeUsers().filter($1));'
    );
    out = out
        .replace(/\battendanceData\b/g, 'getAttendanceData()')
        .replace(/\bovertimeUsers\b/g, 'getOvertimeUsers()');
    return out
        .replace(/\{\s*getAttendanceData\(\),/g, '{ attendanceData: getAttendanceData(),')
        .replace(/,\s*getAttendanceData\(\),/g, ', attendanceData: getAttendanceData(),');
}

const extractPath = path.join(root, 'src/workflows/_extract-clock.txt');
let body = commonStateReplacements(cleanExtractBody(fs.readFileSync(extractPath, 'utf8').replace(/\r\n/g, '\n')));
body = body.replace(/\n\/\*\*[\s\S]*$/g, '').trimEnd();

const fnNames = [...body.matchAll(/^(?:async )?function (\w+)/gm)].map(m => m[1]);
const returnEntries = fnNames.map(name => `        ${name}`).join(',\n');

const header = `    const {
        client,
        CONFIG,
        moment,
        attendanceService,
        roleService,
        rawAttendanceSheetService,
        dashboardStateUtils,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        saveSystemAsync,
        updateWorkingRole,
        getActiveLiveException,
        getOperationalShift,
        getDashboardShift,
        getShiftBounds,
        isWithinPreShiftWindow,
        getTimeLogicRecentMaintenanceEnd,
        formatDuration,
        RAW_ATTENDANCE_STATUS,
        mapRawClockInStatus,
        mapRawClockOutStatus,
        logger = console
    } = deps;`;

const content = [
    "'use strict';",
    '',
    'function createClockWorkflow(deps) {',
    header,
    '',
    body,
    '',
    '    return {',
    returnEntries,
    '    };',
    '}',
    '',
    'module.exports = { createClockWorkflow };',
    ''
].join('\n');

fs.writeFileSync(path.join(root, 'src/workflows/clockWorkflow.js'), content, 'utf8');
console.log('clockWorkflow.js built with', fnNames.length, 'exports');
