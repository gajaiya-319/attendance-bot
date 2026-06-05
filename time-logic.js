function createTimeLogic({ CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS, MAINTENANCE_OVERRIDES = {}, getMaintenanceOverrides = null, moment }) {
    function applyClockTime(base, clockText) {
        const [hour, minute] = clockText.split(':').map(Number);
        return base.clone().hour(hour).minute(minute).second(0).millisecond(0);
    }

    function getOverrideMap() {
        return typeof getMaintenanceOverrides === 'function'
            ? (getMaintenanceOverrides() || {})
            : (MAINTENANCE_OVERRIDES || {});
    }

    function getMaintenanceOverride(dateKeyOrMoment) {
        const dateKey = typeof dateKeyOrMoment === 'string'
            ? dateKeyOrMoment
            : moment(dateKeyOrMoment).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD');
        const override = getOverrideMap()[dateKey];
        if (!override || typeof override !== 'object') return null;
        return override;
    }

    function getDefaultUpdateRule(shift) {
        return SHIFT_SCHEDULE[shift]?.Tuesday || SHIFT_SCHEDULE[shift]?.default || null;
    }

    function buildOverrideShiftRule(shift, override) {
        if (!override || override.enabled !== true) return null;
        const fallback = getDefaultUpdateRule(shift);
        if (!fallback) return null;
        if (shift === 'day') {
            return {
                start: override.dayStart || fallback.start,
                end: override.dayEnd || fallback.end,
                endOffsetDays: Number.isInteger(override.dayEndOffsetDays) ? override.dayEndOffsetDays : (fallback.endOffsetDays || 0)
            };
        }
        return {
            start: override.nightStart || fallback.start,
            end: override.nightEnd || fallback.end,
            endOffsetDays: Number.isInteger(override.nightEndOffsetDays) ? override.nightEndOffsetDays : (fallback.endOffsetDays || 0)
        };
    }

    function getShiftRuleForDate(shift, businessDate) {
        const rules = SHIFT_SCHEDULE[shift];
        if (!rules) return null;
        const override = getMaintenanceOverride(businessDate);
        if (override?.enabled === false) return rules.default;
        if (override?.enabled === true) return buildOverrideShiftRule(shift, override) || rules.default;
        return rules[businessDate.format('dddd')] || rules.default;
    }

    function buildShiftBoundsForBusinessDate(shift, businessDate) {
        const dayStart = moment(businessDate).tz(CONFIG.TIMEZONE).startOf('day');
        const rule = getShiftRuleForDate(shift, dayStart);
        if (!rule) return null;
        return {
            start: applyClockTime(dayStart, rule.start),
            end: applyClockTime(dayStart.clone().add(rule.endOffsetDays || 0, 'days'), rule.end)
        };
    }

    function getShiftBusinessDate(shift, now) {
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        if (shift !== 'night') return mNow.clone().startOf('day');

        const todayBounds = buildShiftBoundsForBusinessDate('night', mNow);
        const previousBounds = buildShiftBoundsForBusinessDate('night', mNow.clone().subtract(1, 'day'));
        if (!todayBounds) return mNow.clone().startOf('day');
        if (previousBounds && mNow.isBefore(previousBounds.end) && mNow.isBefore(todayBounds.start)) {
            return mNow.clone().subtract(1, 'day').startOf('day');
        }
        return mNow.clone().startOf('day');
    }

    function getOperationalShift(now = moment().tz(CONFIG.TIMEZONE)) {
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        if (isMaintenanceWindow(mNow)) return null;
        const dayBounds = getShiftBounds('day', mNow);
        if (mNow.isSameOrAfter(dayBounds.start) && mNow.isBefore(dayBounds.end)) return 'day';
        const nightBounds = getShiftBounds('night', mNow);
        if (mNow.isSameOrAfter(nightBounds.start) && mNow.isBefore(nightBounds.end)) return 'night';
        return mNow.hour() >= 9 && mNow.hour() < 21 ? 'day' : 'night';
    }

    function getOverrideMaintenanceWindow(now, includeRecentGraceMins = 0) {
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        const overrides = getOverrideMap();
        for (const [dateKey, override] of Object.entries(overrides)) {
            if (!override || override.enabled !== true) continue;
            const businessDate = moment.tz(dateKey, 'YYYY-MM-DD', CONFIG.TIMEZONE).startOf('day');
            const windowDate = override.windowDate
                ? moment.tz(override.windowDate, 'YYYY-MM-DD', CONFIG.TIMEZONE).startOf('day')
                : businessDate.clone().add(1, 'day');
            const start = applyClockTime(windowDate, override.windowStart || MAINTENANCE_WINDOWS[0]?.start || '04:00');
            const end = applyClockTime(windowDate, override.windowEnd || MAINTENANCE_WINDOWS[0]?.end || '09:00');
            if (end.isSameOrBefore(start)) end.add(1, 'day');
            const activeEnd = includeRecentGraceMins ? end.clone().add(includeRecentGraceMins, 'minutes') : end;
            if (mNow.isSameOrAfter(start) && mNow.isBefore(activeEnd)) {
                return { day: windowDate.format('dddd'), start: start.format('HH:mm'), end: end.format('HH:mm'), sourceDate: dateKey, override: true, startedAt: start, endedAt: end };
            }
        }
        return null;
    }

    function getDefaultMaintenanceBusinessDate(now, window) {
        return moment(now).tz(CONFIG.TIMEZONE).startOf('day').subtract(1, 'day');
    }

    function getActiveMaintenanceWindow(now = moment().tz(CONFIG.TIMEZONE), includeRecentGraceMins = 0) {
        const overrideWindow = getOverrideMaintenanceWindow(now, includeRecentGraceMins);
        if (overrideWindow) return overrideWindow;
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        return MAINTENANCE_WINDOWS.map(window => {
            if (mNow.format('dddd') !== window.day) return false;
            const sourceDate = getDefaultMaintenanceBusinessDate(mNow, window).format('YYYY-MM-DD');
            if (getMaintenanceOverride(sourceDate)?.enabled === false) return false;
            const start = applyClockTime(mNow, window.start);
            const end = applyClockTime(mNow, window.end);
            const activeEnd = includeRecentGraceMins ? end.clone().add(includeRecentGraceMins, 'minutes') : end;
            return mNow.isSameOrAfter(start) && mNow.isBefore(activeEnd)
                ? { ...window, sourceDate, override: false, startedAt: start, endedAt: end }
                : false;
        }).find(Boolean) || null;
    }

    function isMaintenanceWindow(now = moment().tz(CONFIG.TIMEZONE)) {
        return Boolean(getActiveMaintenanceWindow(now));
    }

    function getRecentMaintenanceEnd(now = moment().tz(CONFIG.TIMEZONE), graceMins = CONFIG.FINISHED_VISIBLE_AFTER_MINS || 30) {
        const window = getActiveMaintenanceWindow(now, graceMins);
        if (!window) return null;
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        const minsSinceEnd = mNow.diff(window.endedAt, 'minutes');
        return minsSinceEnd >= 0 && minsSinceEnd <= graceMins ? { ...window, minsSinceEnd } : null;
    }

    function getDayOffLogicalDateForShift(shift, now = moment().tz(CONFIG.TIMEZONE)) {
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        if (shift === 'night' && mNow.hour() < 9) {
            return mNow.clone().subtract(1, 'days').format('YYYY-MM-DD');
        }
        return mNow.format('YYYY-MM-DD');
    }

    function getShiftBounds(shift, now) {
        const businessDate = getShiftBusinessDate(shift, now);
        const bounds = buildShiftBoundsForBusinessDate(shift, businessDate);
        if (bounds) return bounds;
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        return { start: mNow.clone().second(0).millisecond(0), end: mNow.clone().second(0).millisecond(0) };
    }

    function getShiftSessionKey(shift, now) {
        const bounds = getShiftBounds(shift, now);
        return `${shift || 'none'}:${bounds.start.format('YYYY-MM-DD HH:mm')}`;
    }

    function getRecognizedClockInMoment(shift, now) {
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        const bounds = getShiftBounds(shift, mNow);
        const bufferStart = bounds.start.clone().subtract(CONFIG.PRE_SHIFT_LIVE_BUFFER_MINS, 'minutes');
        if (mNow.isBefore(bufferStart)) {
            return { ok: false, recognizedAt: null, bounds, tooEarly: true, preShift: true };
        }
        if (mNow.isBefore(bounds.start)) {
            return { ok: true, recognizedAt: bounds.start.clone(), bounds, tooEarly: false, preShift: true };
        }
        return { ok: true, recognizedAt: mNow, bounds, tooEarly: false, preShift: false };
    }

    function isWithinPreShiftWindow(shift, now) {
        if (!shift) return false;
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        const bounds = getShiftBounds(shift, mNow);
        const bufferStart = bounds.start.clone().subtract(CONFIG.PRE_SHIFT_LIVE_BUFFER_MINS, 'minutes');
        return mNow.isSameOrAfter(bufferStart) && mNow.isBefore(bounds.start);
    }

    function getDashboardShift(now = moment().tz(CONFIG.TIMEZONE)) {
        if (isWithinPreShiftWindow('day', now)) return 'day';
        if (isWithinPreShiftWindow('night', now)) return 'night';
        const operationalShift = getOperationalShift(now);
        if (operationalShift) return operationalShift;
        return 'night';
    }

    return {
        applyClockTime,
        getShiftRuleForDate,
        buildShiftBoundsForBusinessDate,
        getShiftBusinessDate,
        getOperationalShift,
        getActiveMaintenanceWindow,
        getRecentMaintenanceEnd,
        isMaintenanceWindow,
        getDayOffLogicalDateForShift,
        getShiftBounds,
        getShiftSessionKey,
        getRecognizedClockInMoment,
        isWithinPreShiftWindow,
        getDashboardShift
    };
}

module.exports = createTimeLogic;
