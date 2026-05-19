function createTimeLogic({ CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS, moment }) {
    function applyClockTime(base, clockText) {
        const [hour, minute] = clockText.split(':').map(Number);
        return base.clone().hour(hour).minute(minute).second(0).millisecond(0);
    }

    function getShiftRuleForDate(shift, businessDate) {
        const rules = SHIFT_SCHEDULE[shift];
        if (!rules) return null;
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
        const day = mNow.format('dddd');
        const hour = mNow.hour();
        if (day === 'Tuesday') return hour >= 9 && hour < 19 ? 'day' : 'night';
        if (day === 'Wednesday' && hour < 4) return 'night';
        if (day === 'Wednesday' && hour < 9) return null;
        return hour >= 9 && hour < 21 ? 'day' : 'night';
    }

    function isMaintenanceWindow(now = moment().tz(CONFIG.TIMEZONE)) {
        const mNow = moment(now).tz(CONFIG.TIMEZONE);
        return MAINTENANCE_WINDOWS.some(window => {
            if (mNow.format('dddd') !== window.day) return false;
            const start = applyClockTime(mNow, window.start);
            const end = applyClockTime(mNow, window.end);
            return mNow.isSameOrAfter(start) && mNow.isBefore(end);
        });
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
        const operationalShift = getOperationalShift(now);
        if (operationalShift) return operationalShift;
        if (isWithinPreShiftWindow('day', now)) return 'day';
        return 'night';
    }

    return {
        applyClockTime,
        getShiftRuleForDate,
        buildShiftBoundsForBusinessDate,
        getShiftBusinessDate,
        getOperationalShift,
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
