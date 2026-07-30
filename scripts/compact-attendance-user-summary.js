'use strict';

const fs = require('fs');
const path = require('path');

const [, , file = 'attendanceData.json', query = ''] = process.argv;
if (!query) {
    console.error('Usage: node scripts/compact-attendance-user-summary.js <attendanceData.json> <user-id-or-name>');
    process.exit(1);
}

function lastItems(value, count = 12) {
    return Array.isArray(value) ? value.slice(-count) : [];
}

function compactSession(session) {
    return {
        id: session.id,
        shift: session.shift,
        sessionKey: session.sessionKey,
        scheduledStartAt: session.scheduledStartAt,
        scheduledEndAt: session.scheduledEndAt,
        clockInAt: session.clockInAt,
        clockInDetectedAt: session.clockInDetectedAt,
        clockInSource: session.clockInSource,
        clockOutAt: session.clockOutAt,
        clockOutDetectedAt: session.clockOutDetectedAt,
        clockOutSource: session.clockOutSource,
        clockOutReason: session.clockOutReason,
        liveOffPeriods: session.liveOffPeriods || [],
        dcPeriods: session.dcPeriods || [],
        grossMinutes: session.grossMinutes,
        liveOffMinutes: session.liveOffMinutes,
        dcMinutes: session.dcMinutes,
        creditedMinutes: session.creditedMinutes
    };
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const root = data.attendanceData || data;
const needle = String(query).toLowerCase();
const matches = Object.entries(root)
    .filter(([, user]) => user && typeof user === 'object')
    .filter(([id, user]) => `${id} ${user.id || ''} ${user.name || ''}`.toLowerCase().includes(needle))
    .map(([id, user]) => ({
        id,
        name: user.name,
        shift: user.shift,
        checkedIn: user.checkedIn,
        isFinished: user.isFinished,
        disconnected: user.disconnected,
        dayOff: user.dayOff,
        attendanceStatus: user.attendanceStatus,
        voiceStatus: user.voiceStatus,
        status: user.status,
        points: user.points,
        totals: {
            normal: user.totalNormal,
            late: user.totalLate,
            h2late: user.totalExcessiveLate,
            early: user.totalEarly,
            absent: user.totalAbsent,
            ot: user.totalOT
        },
        monthlyStats: user.monthlyStats || null,
        checkInRaw: user.checkInRaw,
        checkOutRaw: user.checkOutRaw,
        lastClockOutSource: user.lastClockOutSource,
        lastClockOutReason: user.lastClockOutReason,
        lastClockOutDetectedAt: user.lastClockOutDetectedAt,
        pendingClockOut: user.pendingClockOut || null,
        pendingAutoOTConfirm: user.pendingAutoOTConfirm || null,
        activeSessionId: user.activeSessionId || null,
        sessionCount: Array.isArray(user.sessions) ? user.sessions.length : 0,
        sessions: lastItems(user.sessions, 5).map(compactSession),
        events: lastItems(user.attendanceEvents, 25).map(event => ({
            type: event.type,
            at: event.at,
            source: event.source,
            meta: event.meta
        }))
    }));

console.log(JSON.stringify({ file: path.basename(file), query, matches }, null, 2));
