'use strict';

function getEventMoment(event, moment, timezone) {
    return moment(event?.at || event?.recordedAt || 0).tz(timezone);
}

function getLogicalWorkDate(event, { moment, timezone, dayShiftBoundaryHour = 9 }) {
    const at = getEventMoment(event, moment, timezone);
    const shift = String(event?.shift || '').toLowerCase();
    if (shift === 'night' && at.hour() < 12) {
        return at.clone().subtract(1, 'day').format('YYYY-MM-DD');
    }
    if (shift === 'day' && at.hour() < dayShiftBoundaryHour) {
        return at.clone().subtract(1, 'day').format('YYYY-MM-DD');
    }
    return at.format('YYYY-MM-DD');
}

function createEmptyProjection(event, workDate) {
    return {
        userId: event.userId || null,
        userName: event.userName || null,
        shift: event.shift || null,
        workDate,
        clockInAt: null,
        clockOutAt: null,
        liveOffStarts: [],
        liveOffRestores: [],
        dcStarts: [],
        dcRestores: [],
        dayOffAt: null,
        absentAt: null,
        overtimeStartAt: null,
        finalStatus: 'UNKNOWN',
        flags: []
    };
}

function updateProjectionFromEvent(record, event, { moment, timezone }) {
    const at = getEventMoment(event, moment, timezone);
    if (!at.isValid()) return;
    const iso = at.toISOString();
    const type = event.type;
    const attendanceTo = event.meta?.attendanceStatus?.to || event.attendanceStatus || null;
    const voiceTo = event.meta?.voiceStatus?.to || event.voiceStatus || null;

    if (!record.userName && event.userName) record.userName = event.userName;
    if (!record.shift && event.shift) record.shift = event.shift;

    if (type === 'clock_in_confirmed') {
        if (!record.clockInAt && record.clockOutAt && at.isAfter(moment(record.clockOutAt).tz(timezone))) {
            record.clockOutAt = null;
        }
        if (!record.clockInAt || at.isBefore(moment(record.clockInAt).tz(timezone))) {
            record.clockInAt = iso;
        }
    }
    if (type === 'clock_out_confirmed' || type === 'finished_state_applied') {
        if (!record.clockOutAt || at.isAfter(moment(record.clockOutAt).tz(timezone))) {
            record.clockOutAt = iso;
        }
    }
    if (type === 'day_off_applied') record.dayOffAt = iso;
    if (type === 'overtime_started') record.overtimeStartAt = iso;
    if (type === 'disconnected_started') record.dcStarts.push(iso);
    if (type === 'live_on_recovered' || type === 'clockout_candidate_recovered') {
        if (String(event.source || '').includes('voice_leave') || voiceTo === 'LIVE_ON') {
            record.dcRestores.push(iso);
        }
        record.liveOffRestores.push(iso);
    }
    if (type === 'clockout_candidate' && event.source === 'live_off') record.liveOffStarts.push(iso);
    if (type === 'recorded_status_changed') {
        if (attendanceTo === 'ABSENT') record.absentAt = iso;
        if (attendanceTo === 'FINISHED' && !record.clockOutAt) record.clockOutAt = iso;
        if (attendanceTo === 'OVERTIME' && !record.overtimeStartAt) record.overtimeStartAt = iso;
        if (voiceTo === 'DISCONNECTED') record.dcStarts.push(iso);
        if (voiceTo === 'LIVE_OFF') record.liveOffStarts.push(iso);
        if (voiceTo === 'LIVE_ON') record.liveOffRestores.push(iso);
    }
}

function classifyProjection(record, { moment, timezone, getShiftBounds = null, clockOutGraceMins = 5 }) {
    if (record.dayOffAt && !record.clockInAt) {
        record.finalStatus = 'DAY_OFF';
        return record;
    }
    if (record.clockInAt) {
        record.finalStatus = record.clockOutAt ? 'FINISHED' : (record.overtimeStartAt ? 'OVERTIME' : 'WORKING');
    } else if (record.absentAt) {
        record.finalStatus = 'ABSENT';
    }

    if (record.clockInAt && typeof getShiftBounds === 'function' && record.shift) {
        const inAt = moment(record.clockInAt).tz(timezone);
        const bounds = getShiftBounds(String(record.shift).toLowerCase(), inAt);
        if (bounds?.start) {
            const lateMins = Math.max(0, inAt.diff(bounds.start, 'minutes'));
            record.lateMinutes = lateMins;
            if (lateMins > 120) record.flags.push('EXCESSIVE_LATE');
            else if (lateMins > 5) record.flags.push('LATE');
            else record.flags.push('ON_TIME');
        }
        if (bounds?.end && record.clockOutAt) {
            const outAt = moment(record.clockOutAt).tz(timezone);
            const earlyMins = Math.max(0, bounds.end.diff(outAt, 'minutes'));
            record.earlyOutMinutes = earlyMins;
            if (earlyMins > clockOutGraceMins) record.flags.push('EARLY_OUT');
            if (outAt.isAfter(bounds.end)) {
                record.overtimeMinutes = Math.max(0, outAt.diff(bounds.end, 'minutes'));
            }
        }
    }

    if (record.overtimeStartAt) record.flags.push('OVERTIME');
    if (record.absentAt && record.clockInAt) record.flags.push('ABSENT_CONVERTED_TO_LATE');
    if (record.dcStarts.length) record.flags.push('DC_HISTORY');
    if (record.liveOffStarts.length) record.flags.push('LIVE_OFF_HISTORY');
    record.flags = Array.from(new Set(record.flags));
    return record;
}

function projectAttendanceFromEventLog(events = [], options = {}) {
    const {
        moment,
        timezone = 'Asia/Manila'
    } = options;
    if (!moment) throw new TypeError('moment is required');

    const records = new Map();
    const sorted = (Array.isArray(events) ? events : [])
        .filter(event => event?.userId && event?.type)
        .slice()
        .sort((a, b) => getEventMoment(a, moment, timezone).valueOf() - getEventMoment(b, moment, timezone).valueOf());

    for (const event of sorted) {
        const workDate = getLogicalWorkDate(event, { moment, timezone });
        const key = `${event.userId}:${workDate}`;
        if (!records.has(key)) records.set(key, createEmptyProjection(event, workDate));
        updateProjectionFromEvent(records.get(key), event, { moment, timezone });
    }

    return Array.from(records.values())
        .map(record => classifyProjection(record, options))
        .sort((a, b) => {
            const dateCompare = a.workDate.localeCompare(b.workDate);
            if (dateCompare) return dateCompare;
            return String(a.userName || a.userId).localeCompare(String(b.userName || b.userId));
        });
}

module.exports = {
    getLogicalWorkDate,
    projectAttendanceFromEventLog
};
