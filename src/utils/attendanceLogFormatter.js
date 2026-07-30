'use strict';

const {
    ensureMonthlyAttendanceStats,
    reconcileMonthlyOvertimeStats
} = require('./monthlyAttendanceStats');

function getShiftLabel(CONFIG, user) {
    if (CONFIG.EXCEPTIONS?.SHARED_SEAT_USER && user.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return '공용';
    if (user.shift === 'day') return '주간';
    if (user.shift === 'night') return '야간';
    return '-';
}

function getActionMeta(actionType) {
    const map = {
        in: { icon: '✅', label: '출근', code: 'IN' },
        out: { icon: '🔵', label: '퇴근', code: 'OUT' },
        ot: { icon: '🔥', label: '연장', code: 'OT' },
        disconnect: { icon: '⚡', label: '이탈', code: 'DISCONNECT' },
        reconnect: { icon: '🟢', label: '복구', code: 'RECONNECT' },
        off: { icon: '🔵', label: '휴무', code: 'OFF' },
        absent: { icon: '❌', label: '결석', code: 'ABSENT' }
    };
    return map[actionType] || { icon: '📝', label: '기록', code: String(actionType || 'LOG').toUpperCase() };
}

function normalizeBrokenKorean(text) {
    return String(text || '')
        .replace(/\?\uC1F1\uC520\u91C9\?/g, '라이브 ')
        .replace(/\?\uC88E\uC081/g, '유예')
        .replace(/\?\uC493\uCED9/g, '시간')
        .replace(/\u73E5\uB347\uB0B5/g, '초과')
        .replace(/\?\uBEA4\uAE3D/g, '정상')
        .replace(/\?\uBA2E\uB8DE/g, '자동')
        .replace(/\?\uB2FF\uB810/g, '퇴근')
        .replace(/\?\uBA84\uC819/g, '인정')
        .replace(/\uF9E3\uC10E\u2501/g, '처리')
        .replace(/\u8B70\uACCC\uB9B0\s?\?\uB2FF\uB810/g, '조기퇴근')
        .replace(/\u8B70\uACCC\uB9B0/g, '조기')
        .replace(/\?\uC891\uD218/g, '⚠️')
        .replace(/\?\?/g, '전')
        .replace(/\?\u2465\uC4EC/g, '남음')
        .replace(/\u6D39\uC1F0\u0422/g, '근무')
        .replace(/\u7570\uC493\uB810/g, '출근')
        .replace(/\uF9DE\x80\u5A9B\?/g, '지각')
        .replace(/\u5BC3\uACD7\uAF4D/g, '결석')
        .replace(/\?\uACD7\uC623/g, '연장')
        .replace(/\?\uBA2F\uB2D4/g, '점수')
        .replace(/\?\uB300\u0422/g, '휴무')
        .replace(/\u8E42\uB4E6\uB384/g, '복구')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatMetric(value) {
    return Number(value || 0).toLocaleString('ko-KR');
}

function splitReasonText(reason) {
    const clean = normalizeBrokenKorean(reason);
    const workMatch = clean.match(/\s*\[(근무|work):\s*([^\]]+)\]\s*$/i);
    if (!workMatch) return [clean];
    const main = clean.slice(0, workMatch.index).trim();
    return [main || clean, `근무 ${workMatch[2].trim()}`];
}

function appendReasonTime(reason, actionType, eventTime) {
    const text = String(reason || '').trim();
    if (!eventTime || !eventTime.isValid?.()) return text;
    if (/(발생|종료|이탈|복구|복귀)\s*\d{1,2}:\d{2}/.test(text)) return text;
    const timeText = eventTime.format('HH:mm');
    if (actionType === 'disconnect') {
        if (/DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(text)) return `${text} (이탈 ${timeText})`;
        if (/LIVE\s*OFF|라이브\s*OFF|방송\s*종료/i.test(text)) return `${text} (종료 ${timeText})`;
    }
    if (actionType === 'reconnect') {
        if (/DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(text) && /복구|재접속|접속/i.test(text)) {
            return `${text} (복구 ${timeText})`;
        }
        if (/복구|복귀|LIVE\s*ON|라이브\s*ON|방송\s*재개|음성채널.*접속|채널.*접속/i.test(text)) {
            return `${text} (복귀 ${timeText})`;
        }
    }
    return text;
}

function getPresenceTimeline(actionType, reason, eventTime, eventDetails = {}, moment, timezone) {
    if (!eventTime || !eventTime.isValid?.()) return null;
    const text = normalizeBrokenKorean(reason || '');
    const eventText = eventTime.format('HH:mm');
    const startedAt = eventDetails.presenceStartedAt
        ? moment(eventDetails.presenceStartedAt).tz(timezone)
        : null;
    const startedText = startedAt?.isValid() ? startedAt.format('HH:mm') : null;
    const isDc = /DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(text);

    if (actionType === 'disconnect') {
        return isDc ? `DC 이탈 ${eventText}` : `라이브 종료 ${eventText}`;
    }
    if (actionType === 'reconnect') {
        if (isDc) {
            return startedText ? `DC 이탈 ${startedText} | DC 복구 ${eventText}` : `DC 복구 ${eventText}`;
        }
        return startedText ? `라이브 종료 ${startedText} | 라이브 복귀 ${eventText}` : `라이브 복귀 ${eventText}`;
    }
    return null;
}

function buildDailyNoteLines({
    actionType,
    eventTime,
    checkInText,
    checkOutText,
    reasonText,
    eventDetails,
    checkInAt,
    sessionSummary,
    moment,
    timezone,
    formatDuration
}) {
    const lines = [];
    const lateMins = Math.max(0, Number(eventDetails.lateMinutes || 0));
    const clockInStatus = eventDetails.clockInStatus || null;

    if (actionType === 'in') {
        if (clockInStatus === 'excessiveLate' || lateMins >= 120) {
            lines.push(`⚠️ 2H+ 지각 출근 ${checkInText} / ${formatDuration(lateMins)} 지각`);
        } else if (clockInStatus === 'late' || lateMins > 5) {
            lines.push(`🟡 지각 출근 ${checkInText} / ${formatDuration(lateMins)} 지각`);
        } else {
            lines.push(`✅ 정시출근 ${checkInText}`);
        }
    } else if (actionType === 'ot') {
        const startedAt = eventDetails.otStartedAt
            ? moment(eventDetails.otStartedAt).tz(timezone)
            : eventTime;
        const startText = startedAt?.isValid() ? startedAt.format('HH:mm') : eventTime.format('HH:mm');
        lines.push(`🔥 오버타임 ${startText} 시작`);
    } else if (actionType === 'out') {
        const otStartedAt = eventDetails.otStartedAt ? moment(eventDetails.otStartedAt).tz(timezone) : null;
        const workedMins = Number.isFinite(sessionSummary?.grossMinutes)
            ? sessionSummary.grossMinutes
            : (checkInAt?.isValid?.() ? Math.max(0, eventTime.diff(checkInAt, 'minutes')) : 0);
        if (otStartedAt?.isValid()) {
            const totalMins = Math.max(0, eventTime.diff(otStartedAt, 'minutes'));
            lines.push(`🔥 오버타임 ${otStartedAt.format('HH:mm')} 시작 | ${eventTime.format('HH:mm')} 종료 | 총 ${formatDuration(totalMins)}`);
        } else if (/조기\s*퇴근|early/i.test(reasonText)) {
            const earlyMatch = reasonText.match(/조기\s*퇴근\s*([^)]*?(?:전|남음))/);
            const earlyText = earlyMatch?.[1]?.trim();
            lines.push(`🔴 조기퇴근 출근 ${checkInText} | 퇴근 ${checkOutText} | 총 근무 ${formatDuration(workedMins)}${earlyText ? ` | ${earlyText}` : ''}`);
        } else {
            lines.push(`🔵 정상퇴근 출근 ${checkInText} | 퇴근 ${checkOutText} | 총 근무 ${formatDuration(workedMins)}`);
        }
    } else if (actionType === 'disconnect') {
        lines.push(/DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(reasonText) ? '🔴⚡ DC 이탈 중' : '🟠📴 LIVE OFF 이탈 중');
    } else if (actionType === 'reconnect') {
        lines.push(/DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(reasonText) ? '🟢⚡ DC 복구 완료' : '🟢📴 LIVE 복귀 완료');
    } else if (actionType === 'absent') {
        lines.push('❌ 무단결근 처리');
    } else if (actionType === 'off') {
        lines.push('🔵 휴무');
    }

    return lines;
}

function getDecisionIcon(actionType, reasonText, eventDetails = {}) {
    const normalizedReason = normalizeBrokenKorean(reasonText || '');
    const isDc = /DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(normalizedReason);
    if (actionType === 'absent') return '❌';
    if (actionType === 'in') {
        const lateMins = Math.max(0, Number(eventDetails.lateMinutes || 0));
        if (eventDetails.clockInStatus === 'excessiveLate' || lateMins >= 120) return '⚠️';
        if (eventDetails.clockInStatus === 'late' || lateMins > 5) return '🟡';
        return '🔵';
    }
    if (actionType === 'out') {
        if (/조기\s*퇴근|early/i.test(reasonText || '')) return '🔴';
        return '🔵';
    }
    if (actionType === 'ot') return '🔥';
    if (actionType === 'disconnect') return isDc ? '🔴⚡' : '🟠📴';
    if (actionType === 'reconnect') return isDc ? '🟢⚡' : '🟢📴';
    return getActionMeta(actionType).icon;
}

function getDecisionTitle(actionType, meta, reasonText, eventDetails = {}) {
    const icon = getDecisionIcon(actionType, reasonText, eventDetails);
    const normalizedReason = normalizeBrokenKorean(reasonText || '');
    const isDc = /DC|디스커넥트|음성채널.*이탈|채널.*이탈/i.test(normalizedReason);
    if (actionType === 'disconnect') {
        return `${icon} **${meta.label} 판정 ${isDc ? 'DC' : 'LIVE OFF'}**`;
    }
    if (actionType === 'reconnect') {
        return `${icon} **${isDc ? '복구 판정 DC 복구' : '복귀 판정 LIVE 복귀'}**`;
    }
    return `${icon} **${meta.label} 판정**`;
}

function buildMonthlyStatsLine(monthlyStats) {
    return [
        `정출 ${formatMetric(monthlyStats.totalNormal)}`,
        `지각 ${formatMetric(monthlyStats.totalLate)}`,
        `2H+ ${formatMetric(monthlyStats.totalExcessiveLate)}`,
        `조퇴 ${formatMetric(monthlyStats.totalEarly)}`,
        `결석 ${formatMetric(monthlyStats.totalAbsent)}`,
        `연장 ${formatMetric(monthlyStats.totalOT)}`,
        `점수 ${formatMetric(monthlyStats.points)}`
    ].join(' | ');
}

function buildAttendanceDecisionLog({
    CONFIG,
    moment,
    formatDuration,
    user,
    actionType,
    eventTime,
    baseText,
    sessionSummary = null,
    eventDetails = {}
}) {
    const meta = getActionMeta(actionType);
    const checkInText = user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE).format('HH:mm') : '-';
    const checkInAt = user.checkInRaw ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE) : null;
    const checkOutText = actionType === 'out'
        ? eventTime.format('HH:mm')
        : '-';
    const liveOffText = sessionSummary ? formatDuration(sessionSummary.liveOffMinutes || 0) : '-';
    const dcText = sessionSummary ? formatDuration(sessionSummary.dcMinutes || 0) : '-';
    const timedReason = appendReasonTime(baseText || `${meta.label} 기록`, actionType, eventTime);
    const reasonLines = splitReasonText(timedReason);
    const presenceTimeline = getPresenceTimeline(actionType, timedReason, eventTime, eventDetails, moment, CONFIG.TIMEZONE);
    const dailyNoteLines = buildDailyNoteLines({
        actionType,
        eventTime,
        checkInText,
        checkOutText,
        reasonText: timedReason,
        eventDetails,
        checkInAt,
        sessionSummary,
        moment,
        timezone: CONFIG.TIMEZONE,
        formatDuration
    });
    const monthlyStats = reconcileMonthlyOvertimeStats(user, {
        moment,
        at: eventTime,
        timezone: CONFIG.TIMEZONE,
        overtimePoints: CONFIG.POINTS?.OT || 0,
        points: CONFIG.POINTS || null
    });

    return [
        `\`[${eventTime.format('MM/DD HH:mm')}]\` ${getDecisionTitle(actionType, meta, timedReason, eventDetails)}`,
        `👤 **${user.name || 'Unknown'}**`,
        `   ${getShiftLabel(CONFIG, user)} | ${meta.code}`,
        '',
        '🧾 **사유**',
        ...reasonLines.map(line => `   ${line}`),
        '',
        '⏱ **시간**',
        `   출근 ${checkInText} | 퇴근 ${checkOutText}`,
        ...(presenceTimeline ? [`   ${presenceTimeline}`] : []),
        `   LIVE OFF ${liveOffText} | DC ${dcText}`,
        ...(dailyNoteLines.length ? ['', '🧭 **특이사항**', ...dailyNoteLines.map(line => `   ${line}`)] : []),
        '',
        `📊 **이번달 ${monthlyStats.month}**`,
        `   ${buildMonthlyStatsLine(monthlyStats)}`
    ].join('\n');
}

module.exports = {
    buildAttendanceDecisionLog,
    normalizeBrokenKorean
};
