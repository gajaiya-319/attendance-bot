'use strict';

function getShiftSheetDayOfMonth(moment, timezone, shift, dateInput = Date.now()) {
    const base = moment(dateInput).tz(timezone);
    const sheetDate = shift === 'NIGHT' && typeof base.clone === 'function'
        ? base.clone().subtract(1, 'day')
        : shift === 'NIGHT' && typeof base.subtract === 'function'
            ? base.subtract(1, 'day')
            : base;
    return sheetDate.date();
}

module.exports = {
    getShiftSheetDayOfMonth
};
