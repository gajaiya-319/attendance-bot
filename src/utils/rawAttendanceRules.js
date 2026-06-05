'use strict';

const STATUS = Object.freeze({
    ON_TIME: '정출',
    LATE: '지각',
    ABSENT: '결석',
    EARLY_OUT: '조퇴',
    OVERTIME: '연장근무',
    DAY_OFF: '휴무'
});

function mapClockInStatus(status) {
    if (status === 'late') return STATUS.LATE;
    if (status === 'absent') return STATUS.LATE;
    return STATUS.ON_TIME;
}

function mapClockOutStatus({ user, outMoment, session, moment }) {
    const scheduledEndAt = session?.scheduledEndAt || user?.dayOffExpireAt || null;
    if (scheduledEndAt && moment(outMoment).isBefore(moment(scheduledEndAt), 'minute')) {
        return STATUS.EARLY_OUT;
    }
    if (session?.otType || session?.otStartedAt) return STATUS.OVERTIME;
    return mapClockInStatus(user?.status);
}

function calculateAttendanceRates(counts = {}) {
    const onTime = Number(counts.jung || counts.onTime || 0);
    const late = Number(counts.ji || counts.late || 0);
    const absent = Number(counts.gyul || counts.absent || 0);
    const earlyOut = Number(counts.jo || counts.earlyOut || 0);
    const overtime = Number(counts.yeon || counts.overtime || 0);
    const attended = onTime + late + earlyOut + overtime;
    const base = attended + absent;
    return {
        attended,
        base,
        attRate: base === 0 ? 0 : (attended / base) * 100,
        absRate: base === 0 ? 0 : (absent / base) * 100,
        lateRate: base === 0 ? 0 : (late / base) * 100
    };
}

function compareAttendanceRows(sort, a, b) {
    if (sort === 'ATT') {
        return b.attRate - a.attRate ||
            b.jung - a.jung ||
            a.gyul - b.gyul ||
            a.ji - b.ji ||
            a.jo - b.jo ||
            b.yeon - a.yeon ||
            a.order - b.order;
    }
    if (sort === 'ABS') return b.gyul - a.gyul || a.order - b.order;
    if (sort === 'LATE') return b.ji - a.ji || a.order - b.order;
    if (sort === 'OT') return b.yeon - a.yeon || a.order - b.order;
    return a.order - b.order;
}

module.exports = {
    STATUS,
    mapClockInStatus,
    mapClockOutStatus,
    calculateAttendanceRates,
    compareAttendanceRows
};
