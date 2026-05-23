'use strict';

function createReportRenderer({
    truncateWidth,
    formatExactWidth,
    getUserLatestSessionSummary
}) {
    function safeNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function getReportName(user, width = 14) {
        return formatExactWidth((user.name || 'Unknown').split('-')[0].trim() || 'Unknown', width);
    }

    function getReportStatsColumns(user) {
        return [
            safeNumber(user.totalNormal),
            safeNumber(user.totalAbsent),
            safeNumber(user.totalLate),
            safeNumber(user.totalEarly),
            safeNumber(user.totalOT),
            safeNumber(user.offCount)
        ].map(v => String(v).padStart(3)).join(' ');
    }

    function getCompactReportStatsColumns(user) {
        return [
            safeNumber(user.totalNormal),
            safeNumber(user.totalAbsent),
            safeNumber(user.totalLate),
            safeNumber(user.totalEarly),
            safeNumber(user.totalOT),
            safeNumber(user.offCount)
        ].map(v => String(v).padStart(2)).join(' ');
    }

    function renderReportMetricRow(user) {
        const points = String(safeNumber(user.points)).padStart(4);
        const name = getReportName(user, 11);
        const stats = getCompactReportStatsColumns(user);
        const dc = String(safeNumber(user.dcCount)).padStart(2);
        return `${points}|${name}|${stats}|${dc}`;
    }

    function renderReportMetricHeader() {
        return '점수|이름       |정 결 지 조 연 휴|DC';
    }

    function renderReportTopRow(user, index) {
        const rank = String(index + 1).padStart(2, '0');
        const name = getReportName(user, 10);
        const points = String(safeNumber(user.points)).padStart(3);
        return `${rank}|${name}|${points}|${getCompactReportStatsColumns(user)}`;
    }

    function renderReportStatsLegend() {
        return '순위|이름      |점수|정 결 지 조 연 휴';
    }

    function formatDurationClock(minutes) {
        const safeMinutes = Math.max(0, Number(minutes) || 0);
        const hours = Math.floor(safeMinutes / 60);
        const mins = safeMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }

    function renderSessionMetricRow(user, now) {
        const summary = getUserLatestSessionSummary(user, now);
        const name = getReportName(user, 12);
        if (!summary) return `${name}|세션없음|00:00|00:00|00:00|00:00`;
        const session = summary.session;
        const state = session.clockOutAt ? '퇴근' : '근무';
        return [
            name,
            state,
            formatDurationClock(summary.creditedMinutes),
            formatDurationClock(summary.grossMinutes),
            formatDurationClock(summary.liveOffMinutes),
            formatDurationClock(summary.dcMinutes)
        ].join('|');
    }

    function renderEmbedCodeBlock(text, maxLength = 1010) {
        const body = truncateWidth(String(text || 'NONE'), maxLength);
        return `\`\`\`\n${body}\n\`\`\``;
    }

    return {
        getReportStatsColumns,
        renderReportMetricRow,
        renderReportMetricHeader,
        renderReportTopRow,
        renderReportStatsLegend,
        renderSessionMetricRow,
        renderEmbedCodeBlock
    };
}

module.exports = createReportRenderer;
