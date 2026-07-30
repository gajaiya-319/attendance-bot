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
        lastOpsQueueAutoResultAlertAt: 0,
        lastRawAttendanceSelfRepairAt: 0,
        lastRawAttendanceSelfRepairSignature: null,
        lastRawAttendanceSelfRepairAlertAt: 0
    };
    const rawWrites = [];
    const ops = createOpsMonitoringWorkflow({
        client: { channels: { fetch: async () => null }, guilds: { cache: { get: () => null } } },
        CONFIG: { GUILD_ID: 'g1', LOG_CHANNEL: 'log', TIMEZONE: 'Asia/Manila' },
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
        rawAttendanceSheetService: {
            readRows: async () => [{
                '날짜': '2026-06-29',
                '서버': '발라카스',
                '근무조': 'NIGHT',
                '이름': 'Timmyboy - V Night Time🐲',
                '상태': '결석',
                '출근시간': '06:42',
                '퇴근시간': '-',
                '비고': '무단결근 유예시간 초과 후 출근'
            }],
            sendAttendanceRow: async row => {
                rawWrites.push(row);
                return { ok: true };
            }
        },
        retryQueuedItem: async () => ({ ok: true }),
        alertState
    });

    const issues = ops.collectDataAuditIssues();
    assert.ok(Array.isArray(issues));
    assert.strictEqual(typeof ops.runAutoAuditRepair, 'function');
    const autoSummary = await ops.runAutoAuditRepair(null);
    assert.strictEqual(autoSummary.rawAttendance.repaired.length, 1);
    assert.strictEqual(rawWrites[0].name, 'Timmyboy');
    assert.strictEqual(rawWrites[0].status, '지각');

    console.log('workflow-phase1 tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
