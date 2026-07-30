'use strict';

const crypto = require('crypto');

const DEFAULT_MAX_EVENTS = 10000;

function hashEventParts(parts) {
    return crypto
        .createHash('sha1')
        .update(parts.map(part => part == null ? '' : String(part)).join('|'))
        .digest('hex')
        .slice(0, 20);
}

function normalizeMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    return { ...meta };
}

function createEventId(event) {
    return `evt_${hashEventParts([
        event.userId,
        event.at,
        event.type,
        event.source,
        event.sessionId || event.meta?.sessionId || '',
        event.meta?.transitionId || event.meta?.reason || ''
    ])}`;
}

function normalizeLedgerEvent(input = {}, options = {}) {
    const {
        moment,
        timezone = 'Asia/Manila',
        recordedAt = null
    } = options;
    const at = input.at
        ? (moment ? moment(input.at).tz(timezone).toISOString() : new Date(input.at).toISOString())
        : (recordedAt || new Date().toISOString());
    const meta = normalizeMeta(input.meta);
    const event = {
        id: input.id || null,
        at,
        recordedAt: input.recordedAt || recordedAt || new Date().toISOString(),
        type: String(input.type || 'unknown'),
        source: String(input.source || 'system'),
        userId: input.userId ? String(input.userId) : null,
        userName: input.userName ? String(input.userName) : null,
        shift: input.shift || null,
        attendanceStatus: input.attendanceStatus || null,
        voiceStatus: input.voiceStatus || null,
        sessionId: input.sessionId || meta.sessionId || null,
        confidence: input.confidence || 'observed',
        meta
    };
    event.id = event.id || createEventId(event);
    return event;
}

function ensureAttendanceEventLog(state) {
    if (!state || typeof state !== 'object') return [];
    if (!Array.isArray(state.attendanceEventLog)) state.attendanceEventLog = [];
    return state.attendanceEventLog;
}

function semanticEventKey(event = {}) {
    return [
        event.userId || '',
        event.at || '',
        event.type || '',
        event.source || ''
    ].join('|');
}

function appendAttendanceEventLog(state, event, options = {}) {
    const log = ensureAttendanceEventLog(state);
    const normalized = normalizeLedgerEvent(event, options);
    if (log.some(existing => existing?.id === normalized.id)) {
        return { appended: false, event: normalized, reason: 'duplicate-id' };
    }
    log.push(normalized);
    trimAttendanceEventLog(state, options.maxEvents);
    return { appended: true, event: normalized };
}

function buildLedgerEventFromUserEvent(user, userEvent, options = {}) {
    if (!user || !userEvent) return null;
    const meta = normalizeMeta(userEvent.meta);
    return normalizeLedgerEvent({
        at: userEvent.at,
        type: userEvent.type,
        source: userEvent.source,
        userId: user.id,
        userName: user.name,
        shift: user.shift || null,
        attendanceStatus: user.attendanceStatus || null,
        voiceStatus: user.voiceStatus || null,
        sessionId: meta.sessionId || user.activeSessionId || null,
        confidence: 'observed',
        meta
    }, options);
}

function backfillAttendanceEventLog(state, options = {}) {
    const {
        attendanceData = state?.attendanceData || {},
        maxEvents = DEFAULT_MAX_EVENTS
    } = options;
    const log = ensureAttendanceEventLog(state);
    const known = new Set(log.map(event => event?.id).filter(Boolean));
    const knownSemantic = new Set(log.map(semanticEventKey));
    const limit = Math.max(100, Number(maxEvents || DEFAULT_MAX_EVENTS));
    const oldestRetainedAt = log.length >= limit
        ? log.reduce((oldest, event) => {
            const at = event?.at ? String(event.at) : null;
            if (!at) return oldest;
            return !oldest || at < oldest ? at : oldest;
        }, null)
        : null;
    let added = 0;

    for (const user of Object.values(attendanceData || {})) {
        if (!user || !Array.isArray(user.attendanceEvents)) continue;
        for (const userEvent of user.attendanceEvents) {
            const event = buildLedgerEventFromUserEvent(user, userEvent, options);
            const semanticKey = event ? semanticEventKey(event) : null;
            if (!event || known.has(event.id) || knownSemantic.has(semanticKey)) continue;
            if (oldestRetainedAt && String(event.at) <= oldestRetainedAt) continue;
            log.push(event);
            known.add(event.id);
            knownSemantic.add(semanticKey);
            added += 1;
        }
    }

    trimAttendanceEventLog(state, maxEvents);
    return { added, total: log.length };
}

function trimAttendanceEventLog(state, maxEvents = DEFAULT_MAX_EVENTS) {
    const limit = Math.max(100, Number(maxEvents || DEFAULT_MAX_EVENTS));
    const log = ensureAttendanceEventLog(state);
    log.sort((a, b) => String(a?.at || '').localeCompare(String(b?.at || '')));
    if (log.length > limit) {
        state.attendanceEventLog = log.slice(log.length - limit);
    }
    return state.attendanceEventLog.length;
}

function createAttendanceEventLedger({
    state,
    moment,
    timezone = 'Asia/Manila',
    maxEvents = DEFAULT_MAX_EVENTS
}) {
    function append(event) {
        return appendAttendanceEventLog(state, event, {
            moment,
            timezone,
            maxEvents
        });
    }

    function backfill(attendanceData = state?.attendanceData || {}) {
        return backfillAttendanceEventLog(state, {
            moment,
            timezone,
            maxEvents,
            attendanceData
        });
    }

    function trim() {
        return trimAttendanceEventLog(state, maxEvents);
    }

    return {
        append,
        backfill,
        trim
    };
}

module.exports = {
    DEFAULT_MAX_EVENTS,
    appendAttendanceEventLog,
    backfillAttendanceEventLog,
    buildLedgerEventFromUserEvent,
    createAttendanceEventLedger,
    ensureAttendanceEventLog,
    normalizeLedgerEvent,
    trimAttendanceEventLog
};
