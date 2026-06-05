'use strict';

const PAYROLL_ARCHIVE_KIND = 'payroll-archive';
const PAYROLL_ARCHIVE_ACTION = 'save';

/** 마지막 /급여기록(또는 자동 마감) 시각(ms). 로그·Raw_Data 순으로 조회. */
async function getLastPayrollArchiveTimestamp({ operationLog, payrollArchiveService } = {}) {
    let best = 0;

    if (operationLog && typeof operationLog.listRecent === 'function') {
        const entries = await operationLog.listRecent({ limit: 500 });
        for (const entry of entries) {
            if (entry.kind !== PAYROLL_ARCHIVE_KIND || entry.action !== PAYROLL_ARCHIVE_ACTION) continue;
            const at = Date.parse(entry.createdAt || entry.payload?.savedAt || '');
            if (Number.isFinite(at) && at > best) best = at;
        }
    }

    if (payrollArchiveService && typeof payrollArchiveService.getLastRawDataTimestamp === 'function') {
        const rawAt = await payrollArchiveService.getLastRawDataTimestamp();
        if (rawAt > best) best = rawAt;
    }

    return best;
}

function hoursSince(ms) {
    if (!ms) return Infinity;
    return (Date.now() - ms) / (1000 * 60 * 60);
}

function shouldAutoArchiveAfterHours(lastArchiveMs, thresholdHours = 75) {
    return hoursSince(lastArchiveMs) >= thresholdHours;
}

function parseClockToMoment(base, clock) {
    const [hour, minute] = String(clock || '00:00').split(':').map(Number);
    return base.clone().hour(hour || 0).minute(minute || 0).second(0).millisecond(0);
}

function getNightShiftEndForWorkDate({ moment, timezone, shiftSchedule, workDate }) {
    const localWorkDate = moment.tz(workDate, timezone).startOf('day');
    const dayName = localWorkDate.format('dddd');
    const nightSchedule = shiftSchedule?.night || {};
    const rule = nightSchedule[dayName] || nightSchedule.default || { end: '09:00', endOffsetDays: 1 };
    return parseClockToMoment(localWorkDate, rule.end).add(Number(rule.endOffsetDays || 0), 'days');
}

function buildThreeDayPayrollClose({ moment, timezone, shiftSchedule, periodEndDate, graceMinutes = 10 }) {
    const endDate = moment.tz(periodEndDate, timezone).startOf('day');
    const startDate = endDate.clone().subtract(2, 'days');
    const nightEndAt = getNightShiftEndForWorkDate({ moment, timezone, shiftSchedule, workDate: endDate });
    const dueAt = nightEndAt.clone().add(Number(graceMinutes || 0), 'minutes');
    return {
        periodStart: startDate,
        periodEnd: endDate,
        nightEndAt,
        dueAt,
        periodLabel: `${startDate.date()}~${endDate.date()}일 야간마감`
    };
}

function getLatestThreeDayPayrollClose({ now, referenceDate = null, moment, timezone, shiftSchedule, graceMinutes = 10 }) {
    const localNow = moment.tz(now, timezone);
    if (referenceDate) {
        return buildThreeDayPayrollClose({
            moment,
            timezone,
            shiftSchedule,
            periodEndDate: referenceDate,
            graceMinutes
        });
    }

    const localReferenceDate = localNow;
    let latest = null;
    const cursor = localReferenceDate.clone().subtract(40, 'days').startOf('day');
    const last = localReferenceDate.clone().startOf('day');

    while (cursor.isSameOrBefore(last, 'day')) {
        if (cursor.date() % 3 === 0) {
            const candidate = buildThreeDayPayrollClose({
                moment,
                timezone,
                shiftSchedule,
                periodEndDate: cursor,
                graceMinutes
            });
            if (!latest || candidate.periodEnd.isAfter(latest.periodEnd)) {
                latest = candidate;
            }
        }
        cursor.add(1, 'day');
    }

    return latest;
}

function getThreeDayAutoArchiveDecision({
    now,
    referenceDate = null,
    lastArchiveMs,
    moment,
    timezone,
    shiftSchedule,
    graceMinutes = 10
}) {
    const latestClose = getLatestThreeDayPayrollClose({
        now,
        referenceDate,
        moment,
        timezone,
        shiftSchedule,
        graceMinutes
    });

    if (!latestClose) {
        return { due: false, reason: 'before-three-day-night-close' };
    }

    const localNow = moment.tz(now, timezone);
    if (latestClose.dueAt.isAfter(localNow)) {
        return {
            due: false,
            reason: 'before-three-day-night-close',
            latestClose
        };
    }

    if (lastArchiveMs && lastArchiveMs >= latestClose.periodStart.valueOf()) {
        return {
            due: false,
            reason: 'already-archived',
            latestClose
        };
    }

    return {
        due: true,
        reason: 'three-day-night-close',
        latestClose
    };
}

module.exports = {
    PAYROLL_ARCHIVE_KIND,
    PAYROLL_ARCHIVE_ACTION,
    getLastPayrollArchiveTimestamp,
    hoursSince,
    shouldAutoArchiveAfterHours,
    getNightShiftEndForWorkDate,
    buildThreeDayPayrollClose,
    getLatestThreeDayPayrollClose,
    getThreeDayAutoArchiveDecision
};
