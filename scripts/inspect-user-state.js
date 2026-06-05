'use strict';

const fs = require('fs');

const pattern = new RegExp(process.argv[2] || '', 'i');
const db = JSON.parse(fs.readFileSync('attendanceData.json', 'utf8'));
const users = db.attendanceData || db.users || db;
const matches = Object.values(users || {})
    .filter(user => user && pattern.test(user.name || user.id || ''))
    .map(user => ({
        id: user.id,
        name: user.name,
        shift: user.shift,
        checkedIn: user.checkedIn,
        dayOff: user.dayOff,
        disconnected: user.disconnected,
        isFinished: user.isFinished,
        attendanceStatus: user.attendanceStatus,
        voiceStatus: user.voiceStatus,
        status: user.status,
        pendingManualOT: user.pendingManualOT,
        pendingClockOut: user.pendingClockOut,
        checkInRaw: user.checkInRaw,
        checkOutRaw: user.checkOutRaw,
        checkInTime: user.checkInTime,
        checkOutTime: user.checkOutTime,
        lastClockOutSource: user.lastClockOutSource,
        activeSessionId: user.activeSessionId,
        openSessions: (user.sessions || []).filter(session => session && !session.clockOutAt),
        latestSession: (user.sessions || []).slice(-1)[0] || null,
        overtimeEntry: (db.overtimeUsers || []).find(ot => ot.id === user.id) || null
    }));

console.log(JSON.stringify({
    overtimeUsers: db.overtimeUsers || [],
    matches
}, null, 2));
