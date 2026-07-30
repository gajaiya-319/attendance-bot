'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const createDayOffService = require('../src/services/dayoffService');
const { createDayOffWorkflow } = require('../src/workflows/dayOffWorkflow');

(async () => {
    const futureLeaveDate = moment().tz('Asia/Manila').add(1, 'day').format('YYYY-MM-DD');
    const pastLeaveDate = '2026-07-03';
    const buildRequestDescription = leaveDate => [
        'Applicant: <@123456789>',
        'Name   : Kirem - H Night Time',
        'Shift  : Night Time',
        `Date   : ${leaveDate}`,
        'Reason : Family event'
    ].join('\n');
    const reservations = {};
    const saves = [];
    const audits = [];
    const approvalReaction = {
        emoji: { name: '\u2705' },
        count: 1,
        me: true,
        remove: async () => {},
        users: { fetch: async () => new Map() }
    };
    const message = {
        id: 'request-1',
        channelId: 'dayoff-channel',
        guildId: 'guild',
        guild: { ownerId: 'owner' },
        author: { id: 'bot', bot: true },
        embeds: [{
            title: 'Day Off Request',
            description: buildRequestDescription(futureLeaveDate)
        }],
        reactions: { cache: [approvalReaction] },
        fetch: async () => message,
        react: async () => {},
        channel: { messages: { fetch: async () => null } }
    };
    const fetchLimits = [];
    const channel = {
        messages: {
            fetch: async options => {
                fetchLimits.push(options.limit);
                return new Map([[message.id, message]]);
            }
        }
    };
    const client = {
        user: { id: 'bot' },
        channels: {
            fetch: async id => id === 'dayoff-channel' ? channel : null
        },
        users: {
            fetch: async () => ({ send: async () => {} })
        }
    };
    const CONFIG = {
        GUILD_ID: 'guild',
        DAYOFF_CHANNEL: 'dayoff-channel',
        DAYOFF_REVIEWER_ID: 'owner',
        LOG_CHANNEL: 'log',
        TIMEZONE: 'Asia/Manila',
        FILES: { DAYOFF_LOG: 'dayoff.jsonl' },
        ROLES: { DAY: 'day-role', NIGHT: 'night-role' }
    };
    const dayOffService = createDayOffService({
        CONFIG,
        moment,
        EmbedBuilder: class {},
        padWidth: value => value,
        truncateWidth: value => value,
        getReservations: () => reservations
    });
    const workflow = createDayOffWorkflow({
        client,
        CONFIG,
        moment,
        EmbedBuilder: class {},
        dayOffService,
        roleService: {},
        getDayOffReservations: () => reservations,
        getAttendanceData: () => ({}),
        removeOvertimeUser: () => {},
        saveSystemAsync: async () => saves.push('save'),
        ensureUserData: () => null,
        applyDayOffState: () => {},
        clearDayOffReservationState: () => {},
        appendAttendanceEvent: () => {},
        updateWorkingRole: async () => {},
        queueDashboardRender: () => {},
        getDayOffLogicalDateForShift: () => '2026-07-03',
        buildShiftBoundsForBusinessDate: () => null,
        getShiftBounds: () => ({ end: moment.tz('2026-07-04', CONFIG.TIMEZONE) }),
        getDayOffPanelPayload: () => ({}),
        DAY_OFF_REQUEST_CUSTOM_IDS: { openModal: 'open' },
        reactionCleanupLocks: new Set(),
        fs: {
            mkdir: async () => {},
            appendFile: async (path, line) => audits.push(JSON.parse(line))
        },
        logger: console
    });

    const result = await workflow.reconcileRecentDayOffMessages();
    assert.deepStrictEqual(result, { scanned: 1, recovered: 1, approved: 1 });
    assert.strictEqual(reservations['request-1'].userId, '123456789');
    assert.strictEqual(reservations['request-1'].status, 'approved');
    assert.strictEqual(reservations['request-1'].reason, 'Family event');
    assert.strictEqual(audits.some(entry => entry.event === 'RECOVERED_REQUEST'), true);
    assert.strictEqual(audits.find(entry => entry.event === 'APPROVED').userId, '123456789');
    assert.ok(saves.length >= 2);
    await workflow.reconcileRecentDayOffMessages();
    assert.deepStrictEqual(fetchLimits, [100, 30], 'scheduled reconciliation uses a small incremental scan after the full scan');

    {
        let remoteApprovalFetches = 0;
        const staleMessages = new Map();
        for (let index = 0; index < 20; index += 1) {
            const staleApproval = {
                emoji: { name: '\u2705' },
                count: 1,
                me: false,
                users: {
                    fetch: async () => {
                        remoteApprovalFetches += 1;
                        return new Map([['owner', { id: 'owner' }]]);
                    }
                }
            };
            staleMessages.set(`stale-${index}`, {
                ...message,
                id: `stale-${index}`,
                embeds: [{
                    ...message.embeds[0],
                    description: buildRequestDescription(pastLeaveDate)
                }],
                reactions: { cache: [staleApproval] }
            });
        }
        const staleClient = {
            ...client,
            channels: {
                fetch: async () => ({
                    messages: { fetch: async () => staleMessages }
                })
            }
        };
        const staleWorkflow = createDayOffWorkflow({
            client: staleClient,
            CONFIG,
            moment,
            EmbedBuilder: class {},
            dayOffService,
            roleService: {},
            getDayOffReservations: () => ({}),
            getAttendanceData: () => ({}),
            removeOvertimeUser: () => {},
            saveSystemAsync: async () => {},
            ensureUserData: () => null,
            applyDayOffState: () => {},
            clearDayOffReservationState: () => {},
            appendAttendanceEvent: () => {},
            updateWorkingRole: async () => {},
            queueDashboardRender: () => {},
            getDayOffLogicalDateForShift: () => '2026-07-03',
            buildShiftBoundsForBusinessDate: () => null,
            getShiftBounds: () => ({ end: moment.tz('2026-07-04', CONFIG.TIMEZONE) }),
            getDayOffPanelPayload: () => ({}),
            DAY_OFF_REQUEST_CUSTOM_IDS: { openModal: 'open' },
            reactionCleanupLocks: new Set(),
            fs: { mkdir: async () => {}, appendFile: async () => {} },
            logger: console
        });
        const staleResult = await staleWorkflow.reconcileRecentDayOffMessages();
        assert.strictEqual(staleResult.scanned, 20);
        assert.strictEqual(staleResult.recovered, 0);
        assert.strictEqual(remoteApprovalFetches, 0, 'past requests do not trigger remote reaction-user scans');
    }

    const directReservations = {};
    const directAudits = [];
    const directWorkflow = createDayOffWorkflow({
        client,
        CONFIG,
        moment,
        EmbedBuilder: class {},
        dayOffService,
        roleService: {},
        getDayOffReservations: () => directReservations,
        getAttendanceData: () => ({}),
        removeOvertimeUser: () => {},
        saveSystemAsync: async () => {},
        ensureUserData: () => null,
        applyDayOffState: () => {},
        clearDayOffReservationState: () => {},
        appendAttendanceEvent: () => {},
        updateWorkingRole: async () => {},
        queueDashboardRender: () => {},
        getDayOffLogicalDateForShift: () => '2026-07-03',
        buildShiftBoundsForBusinessDate: () => null,
        getShiftBounds: () => ({ end: moment.tz('2026-07-04', CONFIG.TIMEZONE) }),
        getDayOffPanelPayload: () => ({}),
        DAY_OFF_REQUEST_CUSTOM_IDS: { openModal: 'open' },
        reactionCleanupLocks: new Set(),
        fs: {
            mkdir: async () => {},
            appendFile: async (path, line) => directAudits.push(JSON.parse(line))
        },
        logger: console
    });
    const directMessage = {
        ...message,
        id: 'request-direct',
        embeds: [{
            ...message.embeds[0],
            description: buildRequestDescription(pastLeaveDate)
        }]
    };
    await directWorkflow.approveDayOffMessage(directMessage, { id: 'owner', displayName: 'Owner' }, null, true);
    assert.strictEqual(directReservations['request-direct'].userId, '123456789');
    assert.strictEqual(directReservations['request-direct'].status, 'approved');
    assert.strictEqual(directAudits.find(entry => entry.event === 'APPROVED_PAST_RECONCILED_SILENTLY').userId, '123456789');

    console.log('dayoff-reconcile tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
