const assert = require('assert');
const createReportRenderer = require('../src/services/reportRenderer');
const {
    truncateWidth,
    formatExactWidth
} = require('../src/utils/textFormat');

const renderer = createReportRenderer({
    truncateWidth,
    formatExactWidth,
    getUserLatestSessionSummary: () => ({
        session: { clockOutAt: null },
        creditedMinutes: 482,
        grossMinutes: 499,
        liveOffMinutes: 17,
        dcMinutes: 0
    })
});

const user = {
    name: 'BitShelby - H Day Time',
    points: 25,
    totalNormal: 5,
    totalAbsent: 2,
    totalLate: 1,
    totalEarly: 1,
    totalOT: 2,
    offCount: 0,
    dcCount: 3
};

assert.strictEqual(renderer.renderReportMetricHeader(), '점수|이름       |정 결 지 조 연 휴|DC');
assert.strictEqual(renderer.renderReportMetricRow(user), '  25|BitShelby  | 5  2  1  1  2  0| 3');
assert.strictEqual(renderer.renderReportStatsLegend(), '순위|이름      |점수|정 결 지 조 연 휴');
assert.strictEqual(renderer.renderReportTopRow(user, 1), '02|BitShelby | 25| 5  2  1  1  2  0');
assert.strictEqual(renderer.renderSessionMetricRow(user), 'BitShelby   |근무|08:02|08:19|00:17|00:00');
assert(renderer.renderEmbedCodeBlock('x'.repeat(2000)).length <= 1020);
assert(renderer.renderEmbedCodeBlock('시간'.repeat(800)).length <= 1024);

console.log('report-renderer tests passed');
