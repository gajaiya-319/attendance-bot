'use strict';

const ATTENDANCE_STATUSES = new Set([
    'PRE_SHIFT',
    'WORKING',
    'OVERTIME',
    'FINISHED',
    'DAY_OFF',
    'ABSENT'
]);

const VOICE_STATUSES = new Set([
    'OFFLINE',
    'LIVE_ON',
    'LIVE_OFF',
    'DISCONNECTED',
    'EXCEPTION'
]);

function evaluateStatusTransition({ user, next = {}, source = 'system', reason = null } = {}) {
    const warnings = [];
    if (!user) return { warnings: ['missing-user'] };

    const fromAttendance = user.attendanceStatus || null;
    const toAttendance = next.attendanceStatus || null;
    const fromVoice = user.voiceStatus || null;
    const toVoice = next.voiceStatus || null;

    if (toAttendance && !ATTENDANCE_STATUSES.has(toAttendance)) {
        warnings.push(`unknown-attendance-status:${toAttendance}`);
    }

    if (toVoice && !VOICE_STATUSES.has(toVoice)) {
        warnings.push(`unknown-voice-status:${toVoice}`);
    }

    if (user.dayOff && toAttendance && toAttendance !== 'DAY_OFF') {
        warnings.push(`dayoff-user-attendance-change:${fromAttendance || 'null'}->${toAttendance}`);
    }

    if (fromAttendance === 'DAY_OFF' && toAttendance && toAttendance !== 'DAY_OFF') {
        warnings.push(`leaving-dayoff:${source}:${reason || 'no-reason'}`);
    }

    if (fromAttendance === 'FINISHED' && toAttendance && !['PRE_SHIFT', 'WORKING', 'OVERTIME', 'DAY_OFF'].includes(toAttendance)) {
        warnings.push(`finished-user-unusual-transition:${fromAttendance}->${toAttendance}`);
    }

    if (toAttendance === 'DAY_OFF' && toVoice && toVoice !== 'OFFLINE') {
        warnings.push(`dayoff-voice-not-offline:${toVoice}`);
    }

    if (toVoice === 'EXCEPTION' && toAttendance && !['WORKING', 'OVERTIME'].includes(toAttendance)) {
        warnings.push(`exception-voice-with-${toAttendance}`);
    }

    return {
        warnings,
        from: {
            attendanceStatus: fromAttendance,
            voiceStatus: fromVoice
        },
        to: {
            attendanceStatus: toAttendance,
            voiceStatus: toVoice
        }
    };
}

function collectStatusTransitionWarnings(users, { limit = 10 } = {}) {
    const sourceUsers = Array.isArray(users) ? users : Object.values(users || {});
    const warnings = [];

    for (const user of sourceUsers) {
        if (!user || !Array.isArray(user.statusTransitionWarnings)) continue;
        for (const entry of user.statusTransitionWarnings) {
            warnings.push({
                userId: user.id || null,
                userName: user.name || user.displayName || user.username || 'Unknown',
                at: entry?.at || null,
                source: entry?.source || 'unknown',
                reason: entry?.reason || 'no-reason',
                warnings: Array.isArray(entry?.warnings) ? entry.warnings : [],
                from: entry?.from || {},
                to: entry?.to || {}
            });
        }
    }

    warnings.sort((a, b) => {
        const aTime = a.at ? Date.parse(a.at) : 0;
        const bTime = b.at ? Date.parse(b.at) : 0;
        return bTime - aTime;
    });

    return warnings.slice(0, Math.max(0, limit));
}

module.exports = {
    ATTENDANCE_STATUSES,
    VOICE_STATUSES,
    evaluateStatusTransition,
    collectStatusTransitionWarnings
};
