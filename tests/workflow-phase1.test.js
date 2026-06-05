'use strict';

const assert = require('assert');
const { createNoticePanelWorkflow } = require('../src/workflows/noticePanelWorkflow');
const { createOpsMonitoringWorkflow } = require('../src/workflows/opsMonitoringWorkflow');

(async () => {
    const panelInfo = {
        day: { cId: 'day', mId: null },
        night: { cId: 'night', mId: null }
    };
    const notice = createNoticePanelWorkflow({
        client: { channels: { fetch: async () => ({ send: async () => ({ id: 'm1' }), messages: { fetch: async () => null } }) } },
        CONFIG: { TIMEZONE: 'Asia/Manila', DAY_CHAN: 'day', NIGHT_CHAN: 'night' },
        moment: require('moment-timezone'),
        EmbedBuilder: class {},
        ActionRowBuilder: class { addComponents() { return this; } },
        ButtonBuilder: class { setCustomId() { return this; } setLabel() { return this; } setStyle() { return this; } },
        ButtonStyle: { Success: 1, Secondary: 2, Primary: 3, Danger: 4 },
        padWidth: (v, w) => String(v).padEnd(w),
        getPanelInfo: () => panelInfo,
        setPanelMessageId: (key, messageId) => {
            panelInfo[key].mId = messageId;
        },
        saveSystemAsync: async () => {}
    });

    assert.strictEqual(typeof notice.getNoticeEmbed, 'function');
    assert.strictEqual(typeof notice.syncAutoPanels, 'function');

    const alertState = {
        lastOperationalIssueSignature: null,
        lastOperationalIssueAlertAt: 0,
        lastOpsQueueAutoRetryAt: 0,
        lastOpsQueueStuckAlertAt: 0,
        lastOpsQueueAutoResultSignature: null,
        lastOpsQueueAutoResultAlertAt: 0
    };
    const ops = createOpsMonitoringWorkflow({
        client: { channels: { fetch: async () => null }, guilds: { cache: { get: () => null } } },
        CONFIG: { GUILD_ID: 'g1', LOG_CHANNEL: 'log' },
        moment: require('moment-timezone'),
        EmbedBuilder: class { setTitle() { return this; } setColor() { return this; } setDescription() { return this; } setTimestamp() { return this; } addFields() { return this; } },
        padWidth: (v, w) => String(v).padEnd(w),
        truncateWidth: v => String(v),
        renderEmbedCodeBlock: v => v,
        safeAddFields: () => {},
        getAttendanceData: () => ({}),
        getOvertimeUsers: () => [],
        getDayOffReservations: () => ({}),
        getDashboardName: u => u?.name || 'x',
        getActiveLiveException: () => null,
        getMemberShiftRole: () => 'day',
        getOperationalShift: () => 'day',
        opsQueueService: { list: async () => [], retryAll: async () => ({ total: 0, succeeded: 0, failed: 0 }) },
        purchaseSheetService: {},
        retryQueuedItem: async () => ({ ok: true }),
        alertState
    });

    const issues = ops.collectDataAuditIssues();
    assert.ok(Array.isArray(issues));

    console.log('workflow-phase1 tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
