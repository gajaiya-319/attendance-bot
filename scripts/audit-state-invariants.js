'use strict';

const fs = require('fs');

const ATTENDANCE_STATUSES = new Set([
    'PRE_SHIFT',
    'WORKING',
    'OVERTIME',
    'FINISHED',
    'DAY_OFF',
    'ABSENT'
]);
const VOICE_STATUSES = new Set([
    'OFFLINE',
    'LIVE_ON',
    'LIVE_OFF',
    'DISCONNECTED',
    'EXCEPTION'
]);
const VALID_SHIFTS = new Set(['day', 'night']);

function addIssue(issues, user, type, extra = {}) {
    issues.push({
        id: user?.id || null,
        name: user?.name || user?.displayName || null,
        type,
        ...extra
    });
}

function auditStateInvariants(input) {
    const db = typeof input === 'string'
        ? JSON.parse(fs.readFileSync(input, 'utf8'))
        : input;
    const users = db.attendanceData || db.users || db;
    const hasOvertimeUsers = db && Object.prototype.hasOwnProperty.call(db, 'overtimeUsers');
    const overtimeUsers = Array.isArray(db?.overtimeUsers) ? db.overtimeUsers : [];
    const overtimeIds = new Set();
    const issues = [];

    if (hasOvertimeUsers && !Array.isArray(db.overtimeUsers)) {
        issues.push({ id: null, name: null, type: 'invalid-overtimeUsers' });
    }

    for (const user of Object.values(users || {})) {
        if (!user || !user.id) continue;
        if (!user.name || user.name === 'Unknown') {
            addIssue(issues, user, 'missing-name');
        }
        if (user.shift && !VALID_SHIFTS.has(user.shift)) {
            addIssue(issues, user, 'invalid-shift', { shift: user.shift });
        }
        if (user.attendanceStatus && !ATTENDANCE_STATUSES.has(user.attendanceStatus)) {
            addIssue(issues, user, 'invalid-attendanceStatus', { attendanceStatus: user.attendanceStatus });
        }
        if (user.voiceStatus && !VOICE_STATUSES.has(user.voiceStatus)) {
            addIssue(issues, user, 'invalid-voiceStatus', { voiceStatus: user.voiceStatus });
        }
        if (user.sessions && !Array.isArray(user.sessions)) {
            addIssue(issues, user, 'invalid-sessions');
            continue;
        }
        const open = (user.sessions || []).filter(session => session && !session.clockOutAt);
        if (open.length > 1) {
            addIssue(issues, user, 'multiple-open-sessions', { open: open.length });
        }
        if (user.activeSessionId) {
            const activeSession = (user.sessions || []).find(session => session?.id === user.activeSessionId);
            if (!activeSession) {
                addIssue(issues, user, 'activeSessionId-missing-session', { activeSessionId: user.activeSessionId });
            } else if (activeSession.clockOutAt) {
                addIssue(issues, user, 'activeSessionId-closed-session', { activeSessionId: user.activeSessionId });
            }
        }
        if (user.dayOff && open.length) {
            addIssue(issues, user, 'dayOff-open-session', { open: open.length });
        }
        if (user.checkedIn && user.dayOff) {
            addIssue(issues, user, 'checkedIn-dayOff');
        }
        if (user.checkedIn && user.isFinished) {
            addIssue(issues, user, 'checkedIn-finished');
        }
        if (user.disconnected && !user.checkedIn) {
            addIssue(issues, user, 'dc-without-checkedIn');
        }
        if (user.checkedIn && ['FINISHED', 'DAY_OFF', 'PRE_SHIFT', 'ABSENT'].includes(user.attendanceStatus)) {
            addIssue(issues, user, 'checkedIn-invalid-attendanceStatus', { attendanceStatus: user.attendanceStatus });
        }
        if (user.dayOff && user.attendanceStatus && user.attendanceStatus !== 'DAY_OFF') {
            addIssue(issues, user, 'dayOff-invalid-attendanceStatus', { attendanceStatus: user.attendanceStatus });
        }
        if (user.disconnected && user.voiceStatus && user.voiceStatus !== 'DISCONNECTED') {
            addIssue(issues, user, 'dc-invalid-voiceStatus', { voiceStatus: user.voiceStatus });
        }
        if (!user.checkedIn && !user.disconnected && !user.dayOff && open.length) {
            addIssue(issues, user, 'inactive-open-session', { open: open.length });
        }
    }

    if (Array.isArray(db?.overtimeUsers)) {
        for (const ot of db.overtimeUsers) {
            if (!ot?.id) {
                issues.push({ id: null, name: ot?.name || null, type: 'overtime-missing-id' });
                continue;
            }
            if (overtimeIds.has(ot.id)) {
                issues.push({ id: ot.id, name: ot.name || users?.[ot.id]?.name || null, type: 'duplicate-overtime-entry' });
            }
            overtimeIds.add(ot.id);
            const user = users?.[ot.id];
            if (!user) {
                issues.push({ id: ot.id, name: ot.name || null, type: 'overtime-user-missing' });
                continue;
            }
            if (user.dayOff) {
                addIssue(issues, user, 'overtime-dayOff');
            }
            if (!user.checkedIn) {
                addIssue(issues, user, 'overtime-not-checkedIn');
            }
            if (user.attendanceStatus && user.attendanceStatus !== 'OVERTIME') {
                addIssue(issues, user, 'overtime-invalid-attendanceStatus', { attendanceStatus: user.attendanceStatus });
            }
        }
    }

    return {
        issueCount: issues.length,
        issues
    };
}

if (require.main === module) {
    const file = process.argv[2] || 'attendanceData.json';
    const result = auditStateInvariants(file);
    console.log(JSON.stringify(result, null, 2));
    if (result.issueCount > 0) process.exit(1);
}

module.exports = {
    auditStateInvariants
};
