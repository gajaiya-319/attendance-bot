'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const { createReportingWorkflow } = require('../src/workflows/reportingWorkflow');

class FakeEmbedBuilder {
    constructor() {
        this.data = { fields: [] };
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
    setTimestamp() {
        this.data.timestamp = true;
        return this;
    }
}

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', 'Asia/Manila');
}

function makeUser(id, name, data) {
    return {
        id,
        name,
        dayOff: false,
        checkedIn: false,
        isFinished: false,
        sessions: [],
        ...data
    };
}

(async () => {
    const sent = [];
    const users = [
        makeUser('late', 'Late Guy - V Day Time', {
            checkedIn: true,
            checkInRaw: at('2026-06-30 09:21').toISOString(),
            sessions: [{ clockInAt: at('2026-06-30 09:21').toISOString(), clockOutAt: null }]
        }),
        makeUser('two-late', 'Two Late - V Day Time', {
            checkedIn: true,
            excessiveLateThisShift: true,
            checkInRaw: at('2026-06-30 11:30').toISOString(),
            sessions: [{ clockInAt: at('2026-06-30 11:30').toISOString(), clockOutAt: null }]
        }),
        makeUser('early', 'Early Guy - V Day Time', {
            isFinished: true,
            checkInRaw: at('2026-06-30 09:00').toISOString(),
            checkOutRaw: at('2026-06-30 15:27').toISOString(),
            sessions: [{
                clockInAt: at('2026-06-30 09:00').toISOString(),
                clockOutAt: at('2026-06-30 15:27').toISOString()
            }]
        })
    ];

    const workflow = createReportingWorkflow({
        client: {
            channels: {
                fetch: async () => ({
                    guild: { id: 'guild' },
                    send: async payload => {
                        sent.push(payload);
                        return payload;
                    }
                })
            }
        },
        CONFIG: {
            LOG_CHANNEL: 'log',
            TIMEZONE: 'Asia/Manila',
            CLOCK_OUT_GRACE_MINS: 5
        },
        moment,
        EmbedBuilder: FakeEmbedBuilder,
        padWidth: (value, width) => String(value).padEnd(width),
        truncateWidth: value => String(value),
        formatExactWidth: value => String(value),
        renderEmbedCodeBlock: value => value,
        safeAddFields: (embed, ...fields) => {
            embed.data.fields.push(...fields);
        },
        refreshGuildMembers: async () => {},
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: at('2026-06-30 09:00'), end: at('2026-06-30 19:00') }),
        getDayNightWorkerStats: () => users,
        getDayNightWorkerOvertimeUsers: () => [],
        getAttendanceData: () => ({}),
        getOvertimeUsers: () => [],
        renderPercentBar: () => '',
        renderReportTopRow: () => '',
        renderReportStatsLegend: () => '',
        renderReportMetricRow: () => '',
        renderReportMetricHeader: () => '',
        renderSessionMetricRow: () => '',
        formatDuration: mins => `${mins}m`,
        isOwnerId: () => false,
        PermissionFlagsBits: { Administrator: 8 },
        logger: { error: () => {} }
    });

    await workflow.sendDailyCloseReport('day', at('2026-06-30 19:25'));

    assert.strictEqual(sent.length, 1);
    const fieldsText = sent[0].embeds[0].data.fields
        .map(field => `${field.name}\n${field.value}`)
        .join('\n');
    assert(fieldsText.includes('Late (1)'), 'ordinary late section is shown');
    assert(fieldsText.includes('Late Guy') && fieldsText.includes('IN 09:21') && fieldsText.includes('21m late'));
    assert(fieldsText.includes('2H+ Late (1)'), '2h+ late section is shown');
    assert(fieldsText.includes('Two Late') && fieldsText.includes('IN 11:30') && fieldsText.includes('150m late'));
    assert(fieldsText.includes('Early Out (1)'), 'early out section is shown');
    assert(fieldsText.includes('Early Guy') && fieldsText.includes('OUT 15:27') && fieldsText.includes('213m early'));

    console.log('reporting-daily-close tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
