'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { CONFIG } = require('../src/config/constants');
const {
    calculateMonthlyAttendancePoints
} = require('../src/utils/monthlyAttendanceStats');

const [, , file = 'attendanceData.json', ...ids] = process.argv;
const targetIds = new Set(ids);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const users = data.attendanceData || data;
const now = moment().tz(CONFIG.TIMEZONE);
const changed = [];

function hasConfirmedAutoOt(user, session) {
    const events = Array.isArray(user.attendanceEvents) ? user.attendanceEvents : [];
    return events.some(event => {
        if (event?.type !== 'auto_ot_confirmation_accepted') return false;
        const eventEnd = event?.meta?.scheduledEndAt || null;
        return !eventEnd || !session?.scheduledEndAt || eventEnd === session.scheduledEndAt;
    });
}

function isUnconfirmedPostShiftAutoOt(user, ot, session) {
    if (!user || !ot || !session) return false;
    if (ot.type !== 'AUTO') return false;
    if (session.otType !== 'AUTO') return false;
    if (session.clockInSource !== 'post-shift-auto-ot') return false;
    if (hasConfirmedAutoOt(user, session)) return false;
    if (targetIds.size > 0 && !targetIds.has(user.id)) return false;
    return true;
}

function removeMonthlyOtAwardKey(user, session) {
    if (!Array.isArray(user.monthlyOtAwardKeys) || !session?.scheduledEndAt) return;
    const month = moment(session.workDateAt || session.scheduledStartAt || session.scheduledEndAt).tz(CONFIG.TIMEZONE).format('YYYY-MM');
    const sourceKey = `auto:${moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE).toISOString()}`;
    const key = `${month}:${sourceKey}`;
    user.monthlyOtAwardKeys = user.monthlyOtAwardKeys.filter(existing => existing !== key);
}

function recalculateUserPoints(user) {
    if (!user.monthlyStats) return;
    for (const key of ['totalNormal', 'totalLate', 'totalExcessiveLate', 'totalEarly', 'totalAbsent', 'totalOT', 'points']) {
        user.monthlyStats[key] = Number(user.monthlyStats[key] || 0);
    }
    user.monthlyStats.points = calculateMonthlyAttendancePoints(user.monthlyStats, CONFIG.POINTS || {});
    user.points = user.monthlyStats.points;
}

if (!Array.isArray(data.overtimeUsers)) data.overtimeUsers = [];

const nextOvertimeUsers = [];
for (const ot of data.overtimeUsers) {
    const user = users[ot.id];
    const sessions = Array.isArray(user?.sessions) ? user.sessions : [];
    const session = sessions.find(candidate => candidate && !candidate.clockOutAt && candidate.otType === 'AUTO') ||
        sessions.find(candidate => candidate && candidate.otType === 'AUTO' && candidate.clockInSource === 'post-shift-auto-ot');

    if (!isUnconfirmedPostShiftAutoOt(user, ot, session)) {
        nextOvertimeUsers.push(ot);
        continue;
    }

    const closeAt = session.otStartedAt || session.scheduledEndAt || ot.startedAt || now.toISOString();
    const before = {
        totalOT: Number(user.totalOT || 0),
        points: Number(user.points || 0),
        monthlyStats: user.monthlyStats ? { ...user.monthlyStats } : null
    };

    session.canceledOtType = session.otType || null;
    session.canceledOtStartedAt = session.otStartedAt || null;
    session.canceledByPolicy = 'unconfirmed-auto-ot-repair';
    session.clockOutAt = session.clockOutAt || closeAt;
    session.clockOutDetectedAt = now.toISOString();
    session.clockOutSource = 'auto-repair-unconfirmed-auto-ot';
    session.clockOutReason = 'Unconfirmed automatic OT cleared by policy repair';
    session.workedMinutes = session.clockInAt
        ? Math.max(0, moment(session.clockOutAt).tz(CONFIG.TIMEZONE).diff(moment(session.clockInAt).tz(CONFIG.TIMEZONE), 'minutes'))
        : 0;
    session.otType = null;
    session.otStartedAt = null;

    user.activeSessionId = null;
    user.checkedIn = false;
    user.isFinished = true;
    user.disconnected = false;
    user.disconnectedAt = null;
    user.pendingClockOut = null;
    user.liveOffStartedAt = null;
    user.liveOffWarnedFor = null;
    user.pendingManualOT = false;
    user.pendingAutoOTConfirm = null;
    user.attendanceStatus = 'FINISHED';
    if (!user.voiceStatus || user.voiceStatus === 'OVERTIME') user.voiceStatus = 'OFFLINE';
    user.checkOutRaw = user.checkOutRaw || closeAt;
    user.checkOutTime = moment(user.checkOutRaw).tz(CONFIG.TIMEZONE).format('hh:mm A');
    user.lastClockOutSource = user.lastClockOutSource || 'auto-repair-unconfirmed-auto-ot';

    if (Number(user.totalOT || 0) > 0) user.totalOT = Number(user.totalOT || 0) - 1;
    if (user.monthlyStats && Number(user.monthlyStats.totalOT || 0) > 0) {
        user.monthlyStats.totalOT = Number(user.monthlyStats.totalOT || 0) - 1;
    }
    removeMonthlyOtAwardKey(user, session);
    recalculateUserPoints(user);

    if (!Array.isArray(user.attendanceEvents)) user.attendanceEvents = [];
    user.attendanceEvents.push({
        at: now.toISOString(),
        type: 'unconfirmed_auto_ot_cleared',
        source: 'repair-script',
        meta: {
            overtimeStartedAt: session.canceledOtStartedAt,
            overtimeEntryStartedAt: ot.startedAt || null,
            sessionId: session.id || null
        }
    });
    if (user.attendanceEvents.length > 100) user.attendanceEvents = user.attendanceEvents.slice(-100);

    changed.push({
        id: user.id,
        name: user.name,
        removedOvertimeStartedAt: ot.startedAt || null,
        before,
        after: {
            totalOT: Number(user.totalOT || 0),
            points: Number(user.points || 0),
            monthlyStats: user.monthlyStats ? { ...user.monthlyStats } : null
        }
    });
}

data.overtimeUsers = nextOvertimeUsers;

if (changed.length > 0) {
    const backupDir = path.resolve('backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = now.format('YYYY-MM-DD-HH-mm-ss');
    const backup = path.join(backupDir, `attendanceData-${stamp}-before-unconfirmed-auto-ot-clear.json`);
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.copyFileSync(file, 'attendanceData.json.bak');
    console.log(JSON.stringify({ changed: true, count: changed.length, backup, repairs: changed }, null, 2));
} else {
    console.log(JSON.stringify({ changed: false, count: 0 }, null, 2));
}
