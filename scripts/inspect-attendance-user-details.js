'use strict';

const fs = require('fs');
const path = require('path');

const [, , file = 'attendanceData.json', query = ''] = process.argv;
if (!query) {
    console.error('Usage: node scripts/inspect-attendance-user-details.js <attendanceData.json> <user-id-or-name>');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const root = data.attendanceData || data;
const needle = String(query).toLowerCase();
const users = Object.entries(root)
    .filter(([, user]) => user && typeof user === 'object')
    .filter(([id, user]) => `${id} ${user.id || ''} ${user.name || ''}`.toLowerCase().includes(needle))
    .map(([id, user]) => ({
        id,
        name: user.name,
        shift: user.shift,
        checkedIn: user.checkedIn,
        dayOff: user.dayOff,
        disconnected: user.disconnected,
        isFinished: user.isFinished,
        attendanceStatus: user.attendanceStatus,
        voiceStatus: user.voiceStatus,
        status: user.status,
        points: user.points,
        totalNormal: user.totalNormal,
        totalLate: user.totalLate,
        totalExcessiveLate: user.totalExcessiveLate,
        totalEarly: user.totalEarly,
        totalAbsent: user.totalAbsent,
        totalOT: user.totalOT,
        monthlyStats: user.monthlyStats || null,
        checkInTime: user.checkInTime,
        checkInRaw: user.checkInRaw,
        checkOutTime: user.checkOutTime,
        checkOutRaw: user.checkOutRaw,
        pendingClockOut: user.pendingClockOut || null,
        activeSessionId: user.activeSessionId || null,
        sessions: Array.isArray(user.sessions) ? user.sessions : [],
        attendanceEvents: Array.isArray(user.attendanceEvents) ? user.attendanceEvents.slice(-120) : []
    }));

console.log(JSON.stringify({
    file: path.basename(file),
    query,
    matches: users
}, null, 2));
