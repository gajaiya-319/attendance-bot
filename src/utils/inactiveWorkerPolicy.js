'use strict';

const ACTIVE_ATTENDANCE_STATUSES = new Set(['WORKING', 'OVERTIME', 'PRE_SHIFT', 'DAY_OFF']);

function hasOpenAttendanceSession(user) {
    return Array.isArray(user?.sessions) && user.sessions.some(session => session && !session.clockOutAt);
}

function hasOperationalAttendanceState(user, overtimeIds = new Set()) {
    if (!user) return false;
    return Boolean(
        user.checkedIn ||
        user.disconnected ||
        user.dayOff ||
        user.pendingManualOT ||
        user.manualResumeRequired ||
        hasOpenAttendanceSession(user) ||
        overtimeIds.has(user.id) ||
        ACTIVE_ATTENDANCE_STATUSES.has(user.attendanceStatus)
    );
}

function getInactiveArchiveReason(user, member, overtimeIds = new Set()) {
    if (member || hasOperationalAttendanceState(user, overtimeIds)) return null;
    return 'member-not-in-discord-and-no-active-attendance-state';
}

module.exports = {
    ACTIVE_ATTENDANCE_STATUSES,
    hasOpenAttendanceSession,
    hasOperationalAttendanceState,
    getInactiveArchiveReason
};
