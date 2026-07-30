'use strict';

const {
    appendAttendanceEventLog,
    backfillAttendanceEventLog,
    trimAttendanceEventLog
} = require('./attendanceEventLedger');
const {
    reconcileMonthlyOvertimeStats
} = require('../utils/monthlyAttendanceStats');

const NOISY_HEARTBEAT_EVENT_TYPES = new Set([
    'live_on_recovered',
    'voice_live_off_snapshot'
]);
const NOISY_HEARTBEAT_RUN_GAP_MS = 2 * 60 * 1000;

function collapseNoisyHeartbeatEvents(events, { moment, timezone, userId = null } = {}) {
    if (!Array.isArray(events) || events.length < 2) return { events, removed: 0 };
    const lastSeenByKey = new Map();
    const kept = [];
    let removed = 0;

    for (const event of events) {
        if (!NOISY_HEARTBEAT_EVENT_TYPES.has(event?.type) || event?.source !== 'heartbeat') {
            kept.push(event);
            continue;
        }
        const eventAt = moment(event.at).tz(timezone);
        if (!eventAt.isValid()) {
            kept.push(event);
            continue;
        }
        const key = `${event.userId || userId || 'unknown'}:${event.type}:${event.source}`;
        const lastSeenAt = lastSeenByKey.get(key);
        lastSeenByKey.set(key, eventAt.valueOf());
        const gapMs = lastSeenAt == null ? null : eventAt.valueOf() - lastSeenAt;
        if (gapMs != null && gapMs >= 0 && gapMs <= NOISY_HEARTBEAT_RUN_GAP_MS) {
            removed += 1;
            continue;
        }
        kept.push(event);
    }

    return { events: kept, removed };
}

function latestOpenSession(openSessions, moment, timezone) {
    return openSessions
        .slice()
        .sort((a, b) => {
            const aAt = moment(a.clockInAt || a.scheduledStartAt || 0).tz(timezone).valueOf();
            const bAt = moment(b.clockInAt || b.scheduledStartAt || 0).tz(timezone).valueOf();
            return aAt - bAt;
        })
        .pop() || null;
}

function closeDuplicateOpenSessions(user, keep, openSessions, now, moment, timezone) {
    let count = 0;
    const keepStart = keep?.clockInAt ? moment(keep.clockInAt).tz(timezone) : moment(now).tz(timezone);
    for (const session of openSessions) {
        if (!session || session === keep || session.id === keep?.id) continue;
        const closeAt = moment.min(moment(now).tz(timezone), keepStart);
        session.clockOutAt = closeAt.toISOString();
        session.clockOutDetectedAt = moment(now).tz(timezone).toISOString();
        session.clockOutSource = 'auto-repair';
        session.clockOutReason = 'duplicate open session auto-closed';
        if (session.clockInAt) {
            session.workedMinutes = Math.max(0, closeAt.diff(moment(session.clockInAt).tz(timezone), 'minutes'));
        }
        count += 1;
    }
    return count;
}

function repairDuplicateSessionIds(user, now) {
    if (!Array.isArray(user?.sessions)) return [];
    const groups = new Map();
    user.sessions.forEach((session, index) => {
        if (!session) return;
        if (!session.id) {
            session.id = `session:auto:${now.valueOf?.() || Date.now()}:${index}`;
        }
        if (!groups.has(session.id)) groups.set(session.id, []);
        groups.get(session.id).push({ session, index });
    });

    const repairs = [];
    for (const [sessionId, entries] of groups.entries()) {
        if (entries.length <= 1) continue;
        const keep = entries.find(entry => entry.session.id === user.activeSessionId && !entry.session.clockOutAt)
            || entries.find(entry => !entry.session.clockOutAt)
            || entries[0];
        for (const entry of entries) {
            if (entry === keep) continue;
            const before = entry.session.id;
            entry.session.id = `${before}:repair:${entry.index}:${now.valueOf?.() || Date.now()}`;
            repairs.push({ before, after: entry.session.id, index: entry.index });
        }
    }
    return repairs;
}

function isStaleAutoOvertimeEntry(ot, user, { CONFIG, moment, now, timezone }) {
    if (ot?.type !== 'AUTO') return false;
    const maxMins = Number(CONFIG?.MAX_AUTO_OT_MINS || 0);
    if (!maxMins) return false;
    const startedAt = getAutoOvertimeStartMoment(ot, user, { moment, timezone });
    if (!startedAt?.isValid?.()) return false;
    return moment(now).tz(timezone).diff(startedAt, 'minutes') > maxMins;
}

function getAutoOvertimeStartMoment(ot, user, { moment, timezone }) {
    const direct = ot?.startedAt ? moment(ot.startedAt).tz(timezone) : null;
    if (direct?.isValid?.()) return direct;
    const session = findMatchingAutoOvertimeSession(user, ot);
    const raw = session?.otStartedAt || session?.scheduledEndAt || session?.clockInAt;
    const fromSession = raw ? moment(raw).tz(timezone) : null;
    return fromSession?.isValid?.() ? fromSession : null;
}

function findMatchingAutoOvertimeSession(user, ot) {
    return findMatchingAutoOvertimeSessions(user, ot)[0] || null;
}

function findMatchingAutoOvertimeSessions(user, ot) {
    if (!Array.isArray(user?.sessions)) return null;
    return user.sessions.filter(session => {
        if (!session || session.clockOutAt) return false;
        if (session.otType && session.otType !== 'AUTO') return false;
        if (!session.otStartedAt && !session.scheduledEndAt) return false;
        if (ot?.shiftSessionKey && session.sessionKey && ot.shiftSessionKey === session.sessionKey) return true;
        if (ot?.startedAt && session.otStartedAt && session.otStartedAt === ot.startedAt) return true;
        return false;
    });
}

function closeStaleAutoOvertimeSession(user, ot, { moment, now, timezone }) {
    const sessions = findMatchingAutoOvertimeSessions(user, ot);
    if (!sessions.length) return null;
    const start = getAutoOvertimeStartMoment(ot, user, { moment, timezone }) || moment(now).tz(timezone);
    const closeAt = start.clone();
    const closed = [];
    for (const session of sessions) {
        session.clockOutAt = closeAt.toISOString();
        session.clockOutDetectedAt = moment(now).tz(timezone).toISOString();
        session.clockOutSource = 'auto-repair-stale-overtime';
        session.clockOutReason = 'stale auto overtime cleared';
        session.workedMinutes = session.clockInAt
            ? Math.max(0, closeAt.diff(moment(session.clockInAt).tz(timezone), 'minutes'))
            : 0;
        closed.push(session.id || null);
    }
    if (sessions.some(session => user.activeSessionId === session.id)) user.activeSessionId = null;
    return {
        sessionId: sessions[0]?.id || null,
        sessionIds: closed,
        closedAt: closeAt.toISOString()
    };
}

function latestOpenSessionAfterStaleRepair(user, moment, timezone) {
    const openSessions = Array.isArray(user?.sessions)
        ? user.sessions.filter(session => session && !session.clockOutAt)
        : [];
    return latestOpenSession(openSessions, moment, timezone);
}

function latestSession(user, moment, timezone) {
    if (!Array.isArray(user?.sessions)) return null;
    return user.sessions
        .filter(Boolean)
        .slice()
        .sort((a, b) => {
            const aAt = moment(a.clockOutAt || a.clockInAt || a.scheduledStartAt || 0).tz(timezone).valueOf();
            const bAt = moment(b.clockOutAt || b.clockInAt || b.scheduledStartAt || 0).tz(timezone).valueOf();
            return aAt - bAt;
        })
        .pop() || null;
}

function finalizeCheckedInUserWithoutOpenSession(user, now, moment, timezone) {
    if (!user || !user.checkedIn || user.dayOff || user.isFinished) return null;
    const openSessions = Array.isArray(user.sessions)
        ? user.sessions.filter(session => session && !session.clockOutAt)
        : [];
    if (openSessions.length) return null;

    const session = latestSession(user, moment, timezone);
    const rawOut = session?.clockOutAt || user.checkOutRaw || now;
    const outAt = moment(rawOut).tz(timezone);
    user.checkedIn = false;
    user.disconnected = false;
    user.pendingClockOut = null;
    user.liveOffStartedAt = null;
    user.activeSessionId = null;
    user.isFinished = true;
    user.attendanceStatus = 'FINISHED';
    user.voiceStatus = user.voiceStatus || 'OFFLINE';
    user.checkOutRaw = outAt.isValid() ? outAt.toISOString() : moment(now).tz(timezone).toISOString();
    user.checkOutTime = moment(user.checkOutRaw).tz(timezone).format('hh:mm A');
    user.lastClockOutSource = user.lastClockOutSource || 'auto-repair-no-open-session';
    return {
        sessionId: session?.id || null,
        checkOutRaw: user.checkOutRaw
    };
}

function normalizeOvertimeUsers(state, changes, context = {}) {
    if (!Array.isArray(state.overtimeUsers)) {
        state.overtimeUsers = [];
        changes.push({ type: 'overtime-users-reset', severity: 'safe' });
        return;
    }
    const users = state.attendanceData || {};
    const seen = new Set();
    const next = [];
    for (const ot of state.overtimeUsers) {
        if (!ot?.id) {
            changes.push({ type: 'overtime-entry-removed', severity: 'safe', reason: 'missing-id' });
            continue;
        }
        if (seen.has(ot.id)) {
            changes.push({ type: 'overtime-entry-removed', severity: 'safe', userId: ot.id, reason: 'duplicate' });
            continue;
        }
        seen.add(ot.id);
        const user = users[ot.id];
        if (!user) {
            changes.push({ type: 'overtime-entry-removed', severity: 'safe', userId: ot.id, reason: 'missing-user' });
            continue;
        }
        if (user.dayOff || user.isFinished || !user.checkedIn) {
            changes.push({ type: 'overtime-entry-removed', severity: 'safe', userId: ot.id, reason: 'not-active-overtime' });
            continue;
        }
        if (isStaleAutoOvertimeEntry(ot, user, context)) {
            const closedSession = closeStaleAutoOvertimeSession(user, ot, context);
            changes.push({
                type: 'overtime-entry-removed',
                severity: 'safe',
                userId: ot.id,
                userName: user.name || null,
                reason: 'stale-auto-overtime',
                startedAt: ot.startedAt || null,
                closedSession
            });
            if (user.attendanceStatus === 'OVERTIME') {
                const remainingOpen = latestOpenSessionAfterStaleRepair(user, context.moment, context.timezone);
                if (remainingOpen) {
                    user.activeSessionId = remainingOpen.id || null;
                    user.attendanceStatus = user.checkedIn ? 'WORKING' : 'FINISHED';
                } else {
                    user.checkedIn = false;
                    user.disconnected = false;
                    user.pendingClockOut = null;
                    user.liveOffStartedAt = null;
                    user.isFinished = true;
                    user.attendanceStatus = 'FINISHED';
                    user.voiceStatus = user.voiceStatus || 'OFFLINE';
                    user.checkOutRaw = closedSession?.closedAt || user.checkOutRaw || null;
                    user.checkOutTime = user.checkOutRaw
                        ? context.moment(user.checkOutRaw).tz(context.timezone).format('hh:mm A')
                        : null;
                    user.lastClockOutSource = 'auto-repair-stale-overtime';
                }
            }
            if (user.checkedIn && !user.isFinished) {
                user.checkOutRaw = null;
                user.checkOutTime = null;
                user.lastClockOutSource = null;
            }
            continue;
        }
        next.push(ot);
    }
    if (next.length !== state.overtimeUsers.length) {
        state.overtimeUsers.splice(0, state.overtimeUsers.length, ...next);
    }
}

function reconcileMonthlyStats(user, { CONFIG, moment, now, changes }) {
    if (!user?.monthlyStats) return;
    const before = {
        totalOT: Number(user.monthlyStats.totalOT || 0),
        points: Number(user.monthlyStats.points || 0),
        userTotalOT: Number(user.totalOT || 0),
        userPoints: Number(user.points || 0)
    };
    reconcileMonthlyOvertimeStats(user, {
        moment,
        at: now,
        timezone: CONFIG.TIMEZONE,
        overtimePoints: CONFIG.POINTS?.OT || 0,
        points: CONFIG.POINTS || null
    });
    const after = {
        totalOT: Number(user.monthlyStats.totalOT || 0),
        points: Number(user.monthlyStats.points || 0),
        userTotalOT: Number(user.totalOT || 0),
        userPoints: Number(user.points || 0)
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        changes.push({
            type: 'monthly-stats-reconciled',
            severity: 'safe',
            userId: user.id || null,
            userName: user.name || null,
            before,
            after
        });
    }
}

function auditAndRepairAttendanceState(state, {
    CONFIG,
    moment,
    now = moment().tz(CONFIG.TIMEZONE),
    reason = 'scheduled-auto-repair',
    maxEvents = CONFIG.ATTENDANCE_EVENT_LOG_MAX || 10000
}) {
    const changes = [];
    if (!state || typeof state !== 'object') {
        return { changed: false, changes: [{ type: 'missing-state', severity: 'blocked' }] };
    }

    if (!Array.isArray(state.attendanceEventLog)) {
        state.attendanceEventLog = [];
        changes.push({ type: 'event-log-created', severity: 'safe' });
    }

    let userHeartbeatEventsRemoved = 0;
    let compactedUsers = 0;
    for (const [id, user] of Object.entries(state.attendanceData || {})) {
        if (!user || typeof user !== 'object') continue;
        if (!user.id) {
            user.id = id;
            changes.push({ type: 'user-id-restored', severity: 'safe', userId: id });
        }
        if (!Array.isArray(user.attendanceEvents)) {
            user.attendanceEvents = [];
            changes.push({ type: 'user-event-log-created', severity: 'safe', userId: id });
        }
        const userCompaction = collapseNoisyHeartbeatEvents(user.attendanceEvents, {
            moment,
            timezone: CONFIG.TIMEZONE,
            userId: id
        });
        if (userCompaction.removed > 0) {
            user.attendanceEvents = userCompaction.events;
            userHeartbeatEventsRemoved += userCompaction.removed;
            compactedUsers += 1;
        }
        if (!Array.isArray(user.sessions)) {
            continue;
        }

        const duplicateSessionRepairs = repairDuplicateSessionIds(user, now);
        if (duplicateSessionRepairs.length) {
            changes.push({
                type: 'duplicate-session-ids-repaired',
                severity: 'safe',
                userId: id,
                userName: user.name || null,
                repairs: duplicateSessionRepairs
            });
        }

        const openSessions = user.sessions.filter(session => session && !session.clockOutAt);
        if (openSessions.length > 1) {
            const keep = latestOpenSession(openSessions, moment, CONFIG.TIMEZONE);
            const closed = closeDuplicateOpenSessions(user, keep, openSessions, now, moment, CONFIG.TIMEZONE);
            if (keep?.id) user.activeSessionId = keep.id;
            changes.push({
                type: 'duplicate-open-sessions-closed',
                severity: 'safe',
                userId: id,
                userName: user.name || null,
                closed,
                keptSessionId: keep?.id || null
            });
        }

        const currentOpen = user.sessions.filter(session => session && !session.clockOutAt);
        const active = user.activeSessionId
            ? user.sessions.find(session => session?.id === user.activeSessionId)
            : null;
        if (user.activeSessionId && (!active || active.clockOutAt)) {
            const keep = latestOpenSession(currentOpen, moment, CONFIG.TIMEZONE);
            const before = user.activeSessionId;
            user.activeSessionId = keep?.id || null;
            changes.push({
                type: 'active-session-id-repaired',
                severity: 'safe',
                userId: id,
                userName: user.name || null,
                before,
                after: user.activeSessionId
            });
        } else if (!user.activeSessionId && currentOpen.length === 1 && user.checkedIn) {
            user.activeSessionId = currentOpen[0].id || null;
            changes.push({
                type: 'active-session-id-restored',
                severity: 'safe',
                userId: id,
                userName: user.name || null,
                after: user.activeSessionId
            });
        }

        const finalizedWithoutOpenSession = finalizeCheckedInUserWithoutOpenSession(user, now, moment, CONFIG.TIMEZONE);
        if (finalizedWithoutOpenSession) {
            changes.push({
                type: 'checked-in-without-open-session-finalized',
                severity: 'safe',
                userId: id,
                userName: user.name || null,
                ...finalizedWithoutOpenSession
            });
        }

        reconcileMonthlyStats(user, { CONFIG, moment, now, changes });
    }

    if (userHeartbeatEventsRemoved > 0) {
        changes.push({
            type: 'heartbeat-event-log-compacted',
            severity: 'safe',
            scope: 'users',
            removed: userHeartbeatEventsRemoved,
            users: compactedUsers
        });
    }

    normalizeOvertimeUsers(state, changes, {
        CONFIG,
        moment,
        now,
        timezone: CONFIG.TIMEZONE
    });
    const backfill = backfillAttendanceEventLog(state, {
        attendanceData: state.attendanceData || {},
        moment,
        timezone: CONFIG.TIMEZONE,
        maxEvents
    });
    if (backfill.added > 0) {
        changes.push({ type: 'event-log-backfilled', severity: 'safe', added: backfill.added });
    }
    const centralCompaction = collapseNoisyHeartbeatEvents(state.attendanceEventLog, {
        moment,
        timezone: CONFIG.TIMEZONE
    });
    if (centralCompaction.removed > 0) {
        state.attendanceEventLog = centralCompaction.events;
        changes.push({
            type: 'heartbeat-event-log-compacted',
            severity: 'safe',
            scope: 'central',
            removed: centralCompaction.removed
        });
    }
    trimAttendanceEventLog(state, maxEvents);

    for (const change of changes) {
        appendAttendanceEventLog(state, {
            at: now.toISOString(),
            type: 'auto_repair_applied',
            source: 'attendance-auto-repair',
            userId: change.userId || null,
            userName: change.userName || null,
            confidence: change.severity || 'safe',
            meta: {
                reason,
                change
            }
        }, {
            moment,
            timezone: CONFIG.TIMEZONE,
            maxEvents
        });
    }

    return {
        changed: changes.length > 0,
        changes
    };
}

function createAttendanceAutoRepairService({
    state,
    CONFIG,
    moment,
    logger = console
}) {
    function run(options = {}) {
        const result = auditAndRepairAttendanceState(state, {
            CONFIG,
            moment,
            ...options
        });
        if (result.changed) {
            logger.log?.(`[ATTENDANCE AUTO REPAIR] ${result.changes.length} change(s) applied.`);
        }
        return result;
    }

    return {
        run
    };
}

module.exports = {
    auditAndRepairAttendanceState,
    collapseNoisyHeartbeatEvents,
    createAttendanceAutoRepairService
};
