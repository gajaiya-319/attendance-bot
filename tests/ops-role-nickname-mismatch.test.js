'use strict';

const assert = require('assert');
const { createOpsMonitoringWorkflow } = require('../src/workflows/opsMonitoringWorkflow');

const CONFIG = {
    ROLES: {
        HEINE: 'valakas-role',
        PAAGRIO: 'paagrio-role',
        DAY: 'day-role',
        NIGHT: 'night-role',
        WORKING: 'working-role'
    }
};

function member(id, displayName, roles = []) {
    const roleSet = new Set(roles);
    return {
        id,
        displayName,
        user: { bot: false, username: displayName },
        roles: {
            cache: {
                has: roleId => roleSet.has(roleId)
            }
        }
    };
}

const attendanceData = {
    shiftMismatch: { id: 'shiftMismatch', name: 'Shift Mismatch', shift: 'day' },
    missing: { id: 'missing', name: 'Gone Worker', attendanceStatus: 'WORKING', checkedIn: true },
    oldFinished: { id: 'oldFinished', name: 'Old Finished', attendanceStatus: 'FINISHED', isFinished: true }
};

const guild = {
    members: {
        cache: new Map([
            ['shiftMismatch', member('shiftMismatch', 'Shift Mismatch - V Night Time', ['valakas-role', 'night-role'])],
            ['serverMismatch', member('serverMismatch', 'Server Mismatch - P Day Time', ['valakas-role', 'day-role'])],
            ['incomplete', member('incomplete', 'Incomplete Worker', ['valakas-role'])]
        ])
    }
};

const ops = createOpsMonitoringWorkflow({
    client: {},
    CONFIG,
    moment: () => ({ tz: () => ({}) }),
    EmbedBuilder: function EmbedBuilder() {},
    padWidth: value => String(value),
    truncateWidth: value => String(value),
    renderEmbedCodeBlock: value => value,
    safeAddFields: () => {},
    getAttendanceData: () => attendanceData,
    getOvertimeUsers: () => [],
    getDayOffReservations: () => ({}),
    getDashboardName: user => user.name || user.id,
    getActiveLiveException: () => null,
    getMemberShiftRole: () => null,
    getOperationalShift: () => null,
    opsQueueService: {},
    purchaseSheetService: {},
    retryQueuedItem: async () => null,
    alertState: {}
});

const issues = ops.collectRoleNicknameDataMismatchIssues(guild);
const codes = issues.map(issue => issue.code);

assert(codes.includes('saved-user-missing'), 'saved data without Discord member is reported');
assert(!issues.some(issue => issue.detail.includes('Old Finished')), 'old finished saved data is not reported as missing');
assert(codes.includes('saved-shift-mismatch'), 'saved shift and role shift mismatch is reported');
assert(codes.includes('nickname-server-mismatch'), 'nickname server and role server mismatch is reported');
assert(codes.includes('worker-role-incomplete'), 'incomplete worker roles are reported');
assert(codes.includes('worker-data-missing'), 'worker with roles but no saved data is reported');

let overtimeUsers = [{ id: 'missing', name: 'Gone Worker' }];
let saveCount = 0;
const archiveOps = createOpsMonitoringWorkflow({
    client: { channels: { fetch: async () => null }, guilds: { cache: { get: () => guild } } },
    CONFIG,
    moment: () => ({ tz: () => ({ toISOString: () => '2026-06-29T00:00:00.000Z' }) }),
    EmbedBuilder: function EmbedBuilder() {},
    padWidth: value => String(value),
    truncateWidth: value => String(value),
    renderEmbedCodeBlock: value => value,
    safeAddFields: () => {},
    getAttendanceData: () => attendanceData,
    getOvertimeUsers: () => overtimeUsers,
    setOvertimeUsers: next => { overtimeUsers = next; },
    getDayOffReservations: () => ({}),
    getDashboardName: user => user.name || user.id,
    getActiveLiveException: () => null,
    getMemberShiftRole: () => null,
    getOperationalShift: () => null,
    saveSystemAsync: async () => { saveCount += 1; },
    transitionRecordedStatus: (user, status) => Object.assign(user, status),
    opsQueueService: {},
    purchaseSheetService: {},
    retryQueuedItem: async () => null,
    alertState: {}
});

archiveOps.archiveMissingActiveUsers(guild, { toISOString: () => '2026-06-29T00:00:00.000Z' });
assert.strictEqual(attendanceData.missing.checkedIn, false, 'missing active member is no longer checked in');
assert.strictEqual(attendanceData.missing.isFinished, true, 'missing active member is marked finished');
assert.strictEqual(attendanceData.missing.attendanceStatus, 'FINISHED', 'missing active member status is finished');
assert.strictEqual(overtimeUsers.length, 0, 'missing active member is removed from overtime list');

attendanceData.missing.checkedIn = true;
attendanceData.missing.isFinished = false;
attendanceData.missing.attendanceStatus = 'WORKING';
overtimeUsers = [{ id: 'missing', name: 'Gone Worker' }];
archiveOps.checkOperationalIssues(guild).then(result => {
    assert(result.some(issue => issue.code === 'inactive-auto-archived'), 'checkOperationalIssues reports auto archive');
    assert.strictEqual(saveCount, 1, 'auto archive is saved once');
    console.log('ops-role-nickname-mismatch tests passed');
}).catch(error => {
    console.error(error);
    process.exit(1);
});
