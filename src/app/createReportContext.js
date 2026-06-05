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
    const { workflowApi, botState, CONFIG, moment, getShiftBounds } = ctx;

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
        getAttendanceUser: id => botState.attendanceData[id]
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
