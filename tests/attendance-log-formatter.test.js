'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const { buildAttendanceDecisionLog, normalizeBrokenKorean } = require('../src/utils/attendanceLogFormatter');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    EXCEPTIONS: { SHARED_SEAT_USER: null }
};

function buildLog(user, eventTimeText = '2026-06-28 23:30') {
    return buildAttendanceDecisionLog({
        CONFIG,
        moment,
        formatDuration: mins => `${mins}m`,
        user,
        actionType: 'out',
        eventTime: moment.tz(eventTimeText, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
        baseText: 'clock out [work: 150m]',
        sessionSummary: {
            liveOffMinutes: 3,
            dcMinutes: 0
        }
    });
}

const text = buildLog({
    id: 'u1',
    name: 'BitShelby',
    shift: 'night',
    checkInRaw: moment.tz('2026-06-28 21:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString(),
    monthlyStats: {
        month: '2026-06',
        totalNormal: 1,
        totalLate: 0,
        totalEarly: 1,
        totalAbsent: 0,
        totalOT: 1,
        points: 5
    }
});

const lines = text.split('\n');
const monthIndex = lines.findIndex(line => line.includes('2026-06'));
assert(monthIndex >= 0, 'monthly heading is shown');
assert(lines[monthIndex + 1].includes('1'), 'monthly metrics line is shown after heading');
assert.match(lines[monthIndex + 1], /1.*0.*1.*0.*1.*5/, 'all monthly stats are on one line');
assert(!/0.*1.*5/.test(lines[monthIndex + 2] || ''), 'monthly stats are not split into a second line');

const liveOffLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-liveoff',
        name: 'Timmyboy - V Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 06:42', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'disconnect',
    eventTime: moment.tz('2026-06-29 06:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '라이브 OFF 시작 - 방송 종료'
});
assert(liveOffLog.includes('라이브 OFF 시작 - 방송 종료 (종료 06:12)'), 'live off reason shows exact stop time');

const dcLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-dc',
        name: 'Gab - P Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:20', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'disconnect',
    eventTime: moment.tz('2026-06-29 22:47', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: 'DC (음성채널 이탈 감지)'
});
assert(dcLog.includes('DC (음성채널 이탈 감지) (이탈 22:47)'), 'dc reason shows exact disconnect time');

const nextMonthUser = {
    id: 'u2',
    name: 'Month Reset',
    shift: 'day',
    monthlyStats: {
        month: '2026-06',
        totalNormal: 9,
        totalLate: 9,
        totalEarly: 9,
        totalAbsent: 9,
        totalOT: 9,
        points: 999
    }
};
const nextMonthText = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}m`,
    user: nextMonthUser,
    actionType: 'in',
    eventTime: moment.tz('2026-07-01 09:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: 'clock in'
});
const nextMonthLines = nextMonthText.split('\n');
const nextMonthIndex = nextMonthLines.findIndex(line => line.includes('2026-07'));
assert(nextMonthIndex >= 0, 'monthly heading resets to the current month');
assert.match(nextMonthLines[nextMonthIndex + 1], /0.*0.*0.*0.*0.*0/, 'new month stats reset and stay on one line');

const brokenReason = '\u003f\uC1F1\uC520\u91C9\u003fOFF \u003f\uC88E\uC081 \u73E5\uB347\uB0B5 \u003f\uBA2E\uB8DE \u003f\uB2FF\uB810 (\u003f\uBA84\uC819 \u003f\uB2FF\uB810 10:23 AM / \uF9E3\uC10E\u2501 10:53 AM) (\u003f\uC891\uD218 \u8B70\uACCC\uB9B0\u003f\uB2FF\uB810 10시간 36분 \u003f\u003f [\u6D39\uC1F0\u0422: 30분]';
const fixedReason = normalizeBrokenKorean(brokenReason);
assert(fixedReason.includes('라이브 OFF 유예 초과 자동 퇴근'), 'broken live off text is normalized');
assert(fixedReason.includes('인정 퇴근 10:23 AM / 처리 10:53 AM'), 'broken time labels are normalized');
assert(fixedReason.includes('⚠️ 조기퇴근 10시간 36분 전'), 'broken early-out text is normalized');
assert(fixedReason.includes('[근무: 30분]'), 'broken work label is normalized');

const brokenLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u3',
        name: 'Deia - P Day Time',
        shift: 'day',
        checkInRaw: moment.tz('2026-06-29 09:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'out',
    eventTime: moment.tz('2026-06-29 10:53', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: brokenReason
});
[
    '\uF9E3',
    '\u8B70',
    '\u6D39',
    '\u003f\uC1F1\uC520',
    '\u003f\uC88E\uC081',
    '\u003f\uBA2E\uB8DE',
    '\u003f\uB2FF\uB810'
].forEach(fragment => {
    assert(!brokenLog.includes(fragment), 'final log does not contain known mojibake fragments');
});
assert(brokenLog.includes('라이브 OFF 유예 초과 자동 퇴근'), 'final log shows readable Korean reason');

const cleanLiveOffLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-liveoff-clean',
        name: 'Timmyboy - V Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 06:42', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString(),
        checkOutRaw: moment.tz('2026-06-29 06:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'disconnect',
    eventTime: moment.tz('2026-06-29 06:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '라이브 OFF 시작 - 방송 종료'
});
assert(cleanLiveOffLog.includes('출근 06:42 | 퇴근 -'), 'disconnect logs do not show stale clock-out time');
assert(cleanLiveOffLog.includes('라이브 종료 06:12'), 'disconnect logs show live off time in the time block');
assert(cleanLiveOffLog.includes('🟠📴 LIVE OFF 이탈 중'), 'disconnect logs show live off note');

const cleanDcLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-dc-clean',
        name: 'Gab - P Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:20', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'disconnect',
    eventTime: moment.tz('2026-06-29 22:47', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: 'DC (음성채널 이탈 감지)'
});
assert(cleanDcLog.includes('DC 이탈 22:47'), 'dc logs show disconnect time in the time block');

const cleanReconnectLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-reconnect-clean',
        name: 'Timmyboy - V Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 06:42', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'reconnect',
    eventTime: moment.tz('2026-06-29 06:27', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '라이브 ON 복구 - 방송 재개',
    eventDetails: {
        presenceStartedAt: moment.tz('2026-06-29 06:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    }
});
assert(cleanReconnectLog.includes('출근 06:42 | 퇴근 -'), 'reconnect logs do not show clock-out time');
assert(cleanReconnectLog.includes('라이브 종료 06:12 | 라이브 복귀 06:27'), 'reconnect logs show stop and recovery time');
assert(cleanReconnectLog.includes('🟢📴 LIVE 복귀 완료'), 'reconnect logs show recovery note');

const excessiveLateLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${Math.floor(mins / 60)}시간 ${mins % 60}분`,
    user: {
        id: 'u-2h-late',
        name: 'Late Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 23:20', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'in',
    eventTime: moment.tz('2026-06-29 23:20', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '디스코드 자동 출근',
    eventDetails: {
        clockInStatus: 'excessiveLate',
        lateMinutes: 140
    }
});
assert(excessiveLateLog.includes('⚠️ 2H+ 지각 출근 23:20 / 2시간 20분 지각'), '2H+ late note shows clock-in time and late duration');

const onTimeLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-ontime',
        name: 'On Time Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:02', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'in',
    eventTime: moment.tz('2026-06-29 21:02', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '디스코드 자동 출근',
    eventDetails: {
        clockInStatus: 'ontime',
        lateMinutes: 2
    }
});
assert(onTimeLog.includes('✅ 정시출근 21:02'), 'on-time note shows clock-in time');

const overtimeOutLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${Math.floor(mins / 60)}시간 ${mins % 60}분`,
    user: {
        id: 'u-ot',
        name: 'OT Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'out',
    eventTime: moment.tz('2026-06-30 10:30', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '퇴근',
    eventDetails: {
        otStartedAt: moment.tz('2026-06-30 09:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    }
});
assert(overtimeOutLog.includes('🔥 오버타임 09:00 시작 | 10:30 종료 | 총 1시간 30분'), 'overtime out note shows start, end, and total');

const cleanEarlyOutLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${Math.floor(mins / 60)}시간 ${mins % 60}분`,
    user: {
        id: 'u-early-clean',
        name: 'Timmyboy - V Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:10', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'out',
    eventTime: moment.tz('2026-06-30 06:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '라이브 OFF 유예 초과 자동 퇴근 (인정 퇴근 06:12 AM / 처리 06:42 AM) (⚠️ 조기퇴근 2시간 47분 전)'
});
assert(cleanEarlyOutLog.includes('🔴 **퇴근 판정**'), 'early out decision uses red circle');
assert(cleanEarlyOutLog.includes('🔴 조기퇴근 출근 21:10 | 퇴근 06:12 | 총 근무 9시간 2분 | 2시간 47분 전'), 'early out note shows in/out/worked/early time');

const spacedEarlyOutLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${Math.floor(mins / 60)}시간 ${mins % 60}분`,
    user: {
        id: 'u-spaced-early',
        name: 'coco tarmin - V Night Time',
        shift: 'night',
        checkInRaw: moment.tz('2026-07-01 21:04', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'out',
    eventTime: moment.tz('2026-07-01 22:45', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: 'DC 유예 시간 초과 (조기 퇴근) (10시간 14분 남음)'
});
assert(spacedEarlyOutLog.includes('🔴 **퇴근 판정**'), 'spaced early-out reason uses red circle');
assert(spacedEarlyOutLog.includes('🔴 조기퇴근 출근 21:04 | 퇴근 22:45'), 'spaced early-out reason does not render normal clock-out');

const cleanLateInLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-late-clean',
        name: 'Late Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'in',
    eventTime: moment.tz('2026-06-29 21:12', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '디스코드 자동 출근',
    eventDetails: {
        clockInStatus: 'late',
        lateMinutes: 12
    }
});
assert(cleanLateInLog.includes('🟡 **출근 판정**'), 'late clock-in decision uses yellow circle');

const cleanOnTimeInLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-ontime-clean',
        name: 'On Time Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:01', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'in',
    eventTime: moment.tz('2026-06-29 21:01', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '디스코드 자동 출근',
    eventDetails: {
        clockInStatus: 'ontime',
        lateMinutes: 1
    }
});
assert(cleanOnTimeInLog.includes('🔵 **출근 판정**'), 'on-time clock-in decision uses blue circle');

const cleanLiveOffTitleLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-liveoff-title',
        name: 'Live Off Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:02', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'disconnect',
    eventTime: moment.tz('2026-06-30 08:18', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '라이브 OFF 시작 - 방송 종료'
});
assert(cleanLiveOffTitleLog.includes('🟠📴 **이탈 판정 LIVE OFF**'), 'live off disconnect title is explicit');

const cleanDcTitleLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-dc-title',
        name: 'DC Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:02', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'disconnect',
    eventTime: moment.tz('2026-06-30 08:18', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: 'DC (음성채널 이탈 감지)'
});
assert(cleanDcTitleLog.includes('🔴⚡ **이탈 판정 DC**'), 'dc disconnect title is explicit');

const cleanLiveRecoveryTitleLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-live-recovery-title',
        name: 'Live Recovery Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:02', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'reconnect',
    eventTime: moment.tz('2026-06-30 08:20', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: '라이브 ON 복구 - 방송 재개'
});
assert(cleanLiveRecoveryTitleLog.includes('🟢📴 **복귀 판정 LIVE 복귀**'), 'live recovery title is explicit');

const cleanDcRecoveryTitleLog = buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration: mins => `${mins}분`,
    user: {
        id: 'u-dc-recovery-title',
        name: 'DC Recovery Worker',
        shift: 'night',
        checkInRaw: moment.tz('2026-06-29 21:02', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    },
    actionType: 'reconnect',
    eventTime: moment.tz('2026-06-30 08:20', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE),
    baseText: 'DC 복구 - 음성채널 재접속',
    eventDetails: {
        presenceStartedAt: moment.tz('2026-06-30 08:05', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE).toISOString()
    }
});
assert(cleanDcRecoveryTitleLog.includes('🟢⚡ **복구 판정 DC 복구**'), 'dc recovery title is explicit');
assert(cleanDcRecoveryTitleLog.includes('DC 이탈 08:05 | DC 복구 08:20'), 'dc recovery shows start and recovery time');

assert.strictEqual(
    normalizeBrokenKorean('DC \u003f\uC88E\uC081 \u003f\uC493\uCED9 \u73E5\uB347\uB0B5 (\u003f\uBEA4\uAE3D \u003f\uB2FF\uB810)'),
    'DC 유예 시간 초과 (정상 퇴근)',
    'dc timeout normal clock-out mojibake is normalized'
);
assert.strictEqual(
    normalizeBrokenKorean('\u003f\uC1F1\uC520\u91C9\u003fOFF \u003f\uC88E\uC081 \u73E5\uB347\uB0B5 \u003f\uBA2E\uB8DE \u003f\uB2FF\uB810 (\u003f\uBA84\uC819 \u003f\uB2FF\uB810 03:57 AM / \uF9E3\uC10E\u2501 04:28 AM)'),
    '라이브 OFF 유예 초과 자동 퇴근 (인정 퇴근 03:57 AM / 처리 04:28 AM)',
    'live off timeout auto clock-out mojibake is normalized'
);

console.log('attendance-log-formatter tests passed');
