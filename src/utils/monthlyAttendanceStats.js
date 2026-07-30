'use strict';

function getMonthKey(moment, at, timezone) {
    return moment(at).tz(timezone).format('YYYY-MM');
}

function createEmptyMonthlyStats(month) {
    return {
        month,
        totalNormal: 0,
        totalLate: 0,
        totalExcessiveLate: 0,
        totalEarly: 0,
        totalAbsent: 0,
        totalOT: 0,
        points: 0
    };
}

function ensureMonthlyAttendanceStats(user, { moment, at, timezone }) {
    if (!user) return createEmptyMonthlyStats(getMonthKey(moment, at, timezone));
    const month = getMonthKey(moment, at, timezone);
    if (!user.monthlyStats || user.monthlyStats.month !== month) {
        user.monthlyStats = createEmptyMonthlyStats(month);
    }
    for (const key of ['totalNormal', 'totalLate', 'totalExcessiveLate', 'totalEarly', 'totalAbsent', 'totalOT', 'points']) {
        user.monthlyStats[key] = Number(user.monthlyStats[key] || 0);
    }
    return user.monthlyStats;
}

function getMonthlyOvertimeAwardKey({ moment, at, timezone, sourceKey = null }) {
    const eventAt = moment(at).tz(timezone);
    const month = eventAt.format('YYYY-MM');
    return `${month}:${sourceKey || eventAt.toISOString()}`;
}

function getSessionWorkMonthMoment(moment, session, timezone) {
    const raw = session?.workDateAt || session?.scheduledStartAt || session?.otStartedAt;
    const at = moment(raw).tz(timezone);
    return at.isValid() ? at : null;
}

function markMonthlyOvertimeAward(user, { moment, at, timezone, sourceKey = null }) {
    if (!user) return false;
    if (!Array.isArray(user.monthlyOtAwardKeys)) user.monthlyOtAwardKeys = [];
    const key = getMonthlyOvertimeAwardKey({ moment, at, timezone, sourceKey });
    if (user.monthlyOtAwardKeys.includes(key)) return false;
    user.monthlyOtAwardKeys.push(key);
    if (user.monthlyOtAwardKeys.length > 80) {
        user.monthlyOtAwardKeys = user.monthlyOtAwardKeys.slice(-80);
    }
    return true;
}

function countMonthlyOvertimeSessions(user, { moment, month, timezone }) {
    if (!user || !Array.isArray(user.sessions)) return 0;
    const seen = new Set();
    for (const session of user.sessions) {
        if (!session || !session.otStartedAt) continue;
        const workAt = getSessionWorkMonthMoment(moment, session, timezone);
        if (!workAt || workAt.format('YYYY-MM') !== month) continue;
        const key = session.id || session.otStartedAt;
        seen.add(key);
    }
    return seen.size;
}

function hasMonthlyOvertimeSessionData(user, { moment, month, timezone }) {
    if (!user || !Array.isArray(user.sessions)) return false;
    return user.sessions.some(session => {
        if (!session || !session.otStartedAt) return false;
        const workAt = getSessionWorkMonthMoment(moment, session, timezone);
        return Boolean(workAt && workAt.format('YYYY-MM') === month);
    });
}

function calculateMonthlyAttendancePoints(stats, points = {}) {
    if (!stats) return 0;
    return (Number(stats.totalNormal || 0) * Number(points.NORMAL_IN || 0)) +
        (Number(stats.totalLate || 0) * Number(points.LATE || 0)) +
        (Number(stats.totalExcessiveLate || 0) * Number(points.EXCESSIVE_LATE || 0)) +
        (Number(stats.totalEarly || 0) * Number(points.EARLY_OUT || 0)) +
        (Number(stats.totalAbsent || 0) * Number(points.ABSENT || 0)) +
        (Number(stats.totalOT || 0) * Number(points.OT || 0));
}

function reconcileMonthlyOvertimeStats(user, { moment, at, timezone, overtimePoints = 0, points = null }) {
    const stats = ensureMonthlyAttendanceStats(user, { moment, at, timezone });
    const hasSessionData = hasMonthlyOvertimeSessionData(user, {
        moment,
        month: stats.month,
        timezone
    });
    const actualOt = countMonthlyOvertimeSessions(user, {
        moment,
        month: stats.month,
        timezone
    });
    const storedOt = Number(stats.totalOT || 0);
    const clearlyInflated = storedOt > 31;
    if ((hasSessionData || clearlyInflated) && actualOt < storedOt) {
        const delta = storedOt - actualOt;
        stats.totalOT = actualOt;
        stats.points = Number(stats.points || 0) - (delta * Number(overtimePoints || 0));
        if (Number(user.totalOT || 0) > actualOt) user.totalOT = actualOt;
        if (Number(user.points || 0) > Number(stats.points || 0)) {
            user.points = Number(user.points || 0) - (delta * Number(overtimePoints || 0));
        }
    }
    if (points) {
        const expectedPoints = calculateMonthlyAttendancePoints(stats, points);
        if (Number(stats.points || 0) !== expectedPoints) {
            const delta = expectedPoints - Number(stats.points || 0);
            stats.points = expectedPoints;
            user.points = Number(user.points || 0) + delta;
        }
    }
    return stats;
}

function incrementMonthlyAttendanceStat(user, { moment, at, timezone, field, pointsDelta = 0, countDelta = 1 }) {
    const stats = ensureMonthlyAttendanceStats(user, { moment, at, timezone });
    if (field) stats[field] = Number(stats[field] || 0) + countDelta;
    stats.points = Number(stats.points || 0) + Number(pointsDelta || 0);
    return stats;
}

module.exports = {
    createEmptyMonthlyStats,
    ensureMonthlyAttendanceStats,
    markMonthlyOvertimeAward,
    countMonthlyOvertimeSessions,
    calculateMonthlyAttendancePoints,
    reconcileMonthlyOvertimeStats,
    incrementMonthlyAttendanceStat
};
