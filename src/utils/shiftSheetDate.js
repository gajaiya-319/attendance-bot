'use strict';

function getShiftSheetDayOfMonth(moment, timezone, shift, dateInput = Date.now()) {
    const base = moment(dateInput).tz(timezone);
    const isNightCarryover = shift === 'NIGHT' && typeof base.hour === 'function' && base.hour() < 12;
    const sheetDate = isNightCarryover && typeof base.clone === 'function'
        ? base.clone().subtract(1, 'day')
        : isNightCarryover && typeof base.subtract === 'function'
            ? base.subtract(1, 'day')
            : base;
    return sheetDate.date();
}

module.exports = {
    getShiftSheetDayOfMonth
};
