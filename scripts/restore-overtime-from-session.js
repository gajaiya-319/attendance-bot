'use strict';

const fs = require('fs');
const path = require('path');

const query = process.argv[2];
if (!query) {
    console.error('Usage: node scripts/restore-overtime-from-session.js <user-id-or-name>');
    process.exit(1);
}

const file = 'attendanceData.json';
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const users = db.attendanceData || db.users || db;
const user = Object.values(users || {}).find(candidate => {
    if (!candidate) return false;
    return candidate.id === query || String(candidate.name || '').toLowerCase().includes(query.toLowerCase());
});

if (!user) {
    console.error(`User not found: ${query}`);
    process.exit(1);
}

const sourceSession = (user.sessions || [])
    .filter(session => session && (session.otStartedAt || session.otType))
    .sort((a, b) => Date.parse(b.clockInAt || b.otStartedAt || b.scheduledEndAt || 0) -
        Date.parse(a.clockInAt || a.otStartedAt || a.scheduledEndAt || 0))[0];

if (!sourceSession) {
    console.error(`No overtime source session found for ${user.name || user.id}`);
    process.exit(1);
}

const now = new Date().toISOString();
const otStartedAt = sourceSession.otStartedAt || sourceSession.scheduledEndAt || sourceSession.clockOutAt || now;
const otType = sourceSession.otType || 'AUTO';
const stamp = now.replace(/[-:T]/g, '').slice(0, 12);
const backup = path.join('backups', `attendanceData-${stamp}-before-restore-ot-${user.id}.json`);
fs.copyFileSync(file, backup);

if (!Array.isArray(db.overtimeUsers)) db.overtimeUsers = [];
if (!db.overtimeUsers.some(ot => ot.id === user.id)) {
    db.overtimeUsers.push({
        id: user.id,
        name: user.name,
        type: otType,
        shift: user.shift || sourceSession.shift || null,
        shiftSessionKey: sourceSession.sessionKey || null,
        startedAt: otStartedAt
    });
}

user.checkedIn = true;
user.dayOff = false;
user.disconnected = false;
user.disconnectedAt = null;
user.isFinished = false;
user.attendanceStatus = 'OVERTIME';
user.voiceStatus = 'LIVE_ON';
user.status = user.status || 'ontime';
user.pendingManualOT = false;
user.pendingClockOut = null;
user.liveOffStartedAt = null;
user.liveOffWarnedFor = null;
user.lastLiveOnAt = now;
user.attendanceStatusChangedAt = now;
user.voiceStatusChangedAt = now;

if (!Array.isArray(user.sessions)) user.sessions = [];
const open = user.sessions.find(session => session && !session.clockOutAt);
if (open) {
    open.otType = otType;
    open.otStartedAt = otStartedAt;
    user.activeSessionId = open.id;
} else {
    const shift = user.shift || sourceSession.shift || 'unknown';
    const session = {
        id: `${shift}:ot-restore:${Date.now()}`,
        shift,
        sessionKey: sourceSession.sessionKey || null,
        scheduledStartAt: now,
        scheduledEndAt: now,
        clockInAt: now,
        clockInDetectedAt: now,
        clockInSource: 'overtime-restore-script',
        clockOutAt: null,
        clockOutDetectedAt: null,
        clockOutSource: null,
        clockOutReason: null,
        workedMinutes: 0,
        liveOffPeriods: [],
        dcPeriods: [],
        otType,
        otStartedAt,
        restoredFromSessionId: sourceSession.id || null
    };
    user.sessions.push(session);
    user.activeSessionId = session.id;
}

if (!Array.isArray(user.attendanceEvents)) user.attendanceEvents = [];
user.attendanceEvents.push({
    at: now,
    type: 'overtime_restored_from_session_script',
    source: 'repair-script',
    meta: {
        restoredFromSessionId: sourceSession.id || null,
        otStartedAt,
        otType
    }
});
if (user.attendanceEvents.length > 100) user.attendanceEvents = user.attendanceEvents.slice(-100);

fs.writeFileSync(file, JSON.stringify(db, null, 2));
fs.copyFileSync(file, 'attendanceData.json.bak');

console.log(JSON.stringify({
    backup,
    restored: {
        id: user.id,
        name: user.name,
        otType,
        otStartedAt,
        activeSessionId: user.activeSessionId
    }
}, null, 2));
