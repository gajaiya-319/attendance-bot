'use strict';

function getExcludedUserIds(CONFIG) {
    const configured = CONFIG?.EXCEPTIONS?.EXCLUDED_USER_IDS;
    const values = Array.isArray(configured)
        ? configured
        : String(configured || '').split(',');
    return new Set(values.map(value => String(value || '').trim()).filter(Boolean));
}

function resolveUserId(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }
    return String(value.id || value.user?.id || value.author?.id || '');
}

function isExcludedUserId(CONFIG, value) {
    const id = resolveUserId(value);
    return Boolean(id && getExcludedUserIds(CONFIG).has(id));
}

function purgeExcludedUserState(state, CONFIG) {
    const excludedIds = getExcludedUserIds(CONFIG);
    const removed = {
        attendanceUsers: 0,
        overtimeUsers: 0,
        liveExceptions: 0,
        dayOffReservations: 0,
        attendanceEvents: 0
    };
    if (!state || excludedIds.size === 0) return { changed: false, removed };

    if (state.attendanceData && typeof state.attendanceData === 'object') {
        for (const id of excludedIds) {
            if (!Object.prototype.hasOwnProperty.call(state.attendanceData, id)) continue;
            delete state.attendanceData[id];
            removed.attendanceUsers += 1;
        }
    }

    if (Array.isArray(state.overtimeUsers)) {
        const before = state.overtimeUsers.length;
        state.overtimeUsers = state.overtimeUsers.filter(entry => !excludedIds.has(String(entry?.id || '')));
        removed.overtimeUsers = before - state.overtimeUsers.length;
    }

    if (state.liveExceptions && typeof state.liveExceptions === 'object') {
        for (const id of excludedIds) {
            if (!Object.prototype.hasOwnProperty.call(state.liveExceptions, id)) continue;
            delete state.liveExceptions[id];
            removed.liveExceptions += 1;
        }
    }

    if (state.dayOffReservations && typeof state.dayOffReservations === 'object') {
        for (const [messageId, reservation] of Object.entries(state.dayOffReservations)) {
            const userIds = [
                reservation?.userId,
                reservation?.authorId,
                reservation?.requesterId,
                reservation?.submittedBy
            ].map(value => String(value || '')).filter(Boolean);
            if (!userIds.some(id => excludedIds.has(id))) continue;
            delete state.dayOffReservations[messageId];
            removed.dayOffReservations += 1;
        }
    }

    if (Array.isArray(state.attendanceEventLog)) {
        const before = state.attendanceEventLog.length;
        state.attendanceEventLog = state.attendanceEventLog.filter(event => {
            const userIds = [
                event?.userId,
                event?.memberId,
                event?.targetId,
                event?.meta?.userId,
                event?.meta?.memberId,
                event?.meta?.targetId
            ].map(value => String(value || '')).filter(Boolean);
            return !userIds.some(id => excludedIds.has(id));
        });
        removed.attendanceEvents = before - state.attendanceEventLog.length;
    }

    return {
        changed: Object.values(removed).some(count => count > 0),
        removed
    };
}

module.exports = {
    getExcludedUserIds,
    isExcludedUserId,
    purgeExcludedUserState,
    resolveUserId
};
