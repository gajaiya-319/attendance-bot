'use strict';

const assert = require('assert');
const { createReportingWorkflow } = require('../src/workflows/reportingWorkflow');

class FakeEmbedBuilder {
    constructor() {
        this.data = {};
    }
    setTitle(value) {
        this.data.title = value;
        return this;
    }
    setDescription(value) {
        this.data.description = value;
        return this;
    }
    setColor(value) {
        this.data.color = value;
        return this;
    }
    setFooter(value) {
        this.data.footer = value;
        return this;
    }
    setTimestamp() {
        this.data.timestamp = true;
        return this;
    }
}

function createMember(id, displayName, roleId) {
    return {
        id,
        displayName,
        user: { bot: false, username: displayName },
        roles: { cache: new Set([roleId]) }
    };
}

const CONFIG = {
    ROLES: { DAY: 'day-role', NIGHT: 'night-role' }
};
const attendanceData = {};
const members = new Map();

for (let i = 1; i <= 26; i++) {
    const id = `user-${i}`;
    const role = i <= 13 ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
    members.set(id, createMember(id, `Worker ${String(i).padStart(2, '0')}`, role));
    if (i <= 10) {
        attendanceData[id] = {
            id,
            name: `Worker ${String(i).padStart(2, '0')} - saved`,
            points: 100 - i,
            shift: role === CONFIG.ROLES.DAY ? 'day' : 'night'
        };
    }
}

const workflow = createReportingWorkflow({
    client: {},
    CONFIG,
    moment: () => {},
    EmbedBuilder: FakeEmbedBuilder,
    padWidth: (value, width) => String(value).padEnd(width),
    truncateWidth: value => String(value),
    formatExactWidth: value => String(value),
    renderEmbedCodeBlock: value => `\`\`\`\n${value}\n\`\`\``,
    safeAddFields: () => {},
    refreshGuildMembers: async () => {},
    getDashboardShift: () => 'day',
    getShiftBounds: () => ({}),
    getDayNightWorkerStats: () => [],
    getDayNightWorkerOvertimeUsers: () => [],
    getAttendanceData: () => attendanceData,
    getOvertimeUsers: () => [],
    renderPercentBar: () => '',
    renderReportTopRow: () => '',
    renderReportStatsLegend: () => '',
    renderReportMetricRow: () => '',
    renderReportMetricHeader: () => '',
    renderSessionMetricRow: () => '',
    formatDuration: value => String(value),
    isOwnerId: () => false,
    PermissionFlagsBits: { Administrator: 8 }
});

const embed = workflow.buildRankingEmbed({
    guild: { members: { cache: members } },
    shift: 'all'
});

const rankLines = embed.data.description
    .split('\n')
    .filter(line => /^\d{2}\./.test(line));

assert(embed.data.description.includes('Legend: [Normal/Late/Absent/Early/OT/Off]'), 'ranking explains stat order');
assert.strictEqual(rankLines.length, 26, 'combined ranking includes all day/night role members');
assert(rankLines.some(line => line.includes('Worker 26')), 'ranking includes zero-point members without saved attendance data');
assert.strictEqual(embed.data.footer.text, 'Members shown: 26. DAY/NIGHT role members are included, even at 0 pts.');

console.log('reporting-ranking tests passed');
