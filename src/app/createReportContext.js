'use strict';

const {
    createReportRenderer,
    createDashboardRenderHelpers,
    truncateWidth,
    formatExactWidth,
    padWidth,
    formatDuration
} = require('./appDependencies');

function createReportContext(ctx) {
    const { workflowApi, botState, CONFIG, moment, getShiftBounds, attendanceService } = ctx;

    const reportRenderer = createReportRenderer({
        truncateWidth,
        formatExactWidth,
        getUserLatestSessionSummary: (...args) => workflowApi.getUserLatestSessionSummary(...args)
    });

    const {
        renderReportMetricRow,
        renderReportMetricHeader,
        renderReportTopRow,
        renderReportStatsLegend,
        renderSessionMetricRow,
        renderEmbedCodeBlock,
        renderEmbedFieldValue,
        normalizeEmbedField
    } = reportRenderer;

    const dashboardRenderHelpers = createDashboardRenderHelpers({
        moment,
        timezone: CONFIG.TIMEZONE,
        padWidth,
        truncateWidth,
        formatDuration,
        getShiftBounds,
        getLiveException: id => botState.liveExceptions[id],
        getAttendanceUser: id => botState.attendanceData[id],
        getLiveOffSummary: (user, now) => {
            const session = attendanceService?.getOpenSession?.(user);
            const liveOffAt = user?.liveOffStartedAt || user?.voiceJoinedAt || null;
            const pendingClockOutAt = user?.pendingClockOut?.source === 'live_off' && user.pendingClockOut.expiresAt
                ? moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE)
                : (liveOffAt ? moment(liveOffAt).tz(CONFIG.TIMEZONE).add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes') : null);

            return {
                trackedMinutes: session
                    ? attendanceService.sumCreditedLiveOffPeriods(session.liveOffPeriods, now)
                    : 0,
                clockOutInMinutes: pendingClockOutAt
                    ? Math.max(0, pendingClockOutAt.diff(now, 'minutes'))
                    : null
            };
        }
    });

    return {
        reportRenderer,
        renderReportMetricRow,
        renderReportMetricHeader,
        renderReportTopRow,
        renderReportStatsLegend,
        renderSessionMetricRow,
        renderEmbedCodeBlock,
        renderEmbedFieldValue,
        normalizeEmbedField,
        ...dashboardRenderHelpers
    };
}

module.exports = { createReportContext };
