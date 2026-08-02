'use strict';

const ACTIVE_DAY_OFF_STATUSES = new Set(['approved', 'applied']);

function findApprovedDayOffReservation(reservations, { userId, shift, businessDate } = {}) {
    if (!userId || !shift || !businessDate) return null;
    const normalizedShift = String(shift).trim().toLowerCase();
    return Object.values(reservations || {}).find(reservation => (
        reservation &&
        ACTIVE_DAY_OFF_STATUSES.has(String(reservation.status || '').trim().toLowerCase()) &&
        String(reservation.userId || '') === String(userId) &&
        String(reservation.shift || '').trim().toLowerCase() === normalizedShift &&
        String(reservation.leaveDate || '') === String(businessDate)
    )) || null;
}

module.exports = {
    ACTIVE_DAY_OFF_STATUSES,
    findApprovedDayOffReservation
};
