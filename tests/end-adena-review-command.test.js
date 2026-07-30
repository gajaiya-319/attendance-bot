'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const {
    settlementPhase,
    selectCurrentSettlementWindow,
    selectEndAdenaReview,
    buildCustomId,
    parseCustomId,
    renderReviewPayload,
    createEndAdenaReviewCommand
} = require('../src/commands/admin/endAdenaReviewCommand');

const TIMEZONE = 'Asia/Manila';
const START = moment.tz('2026-07-29 09:00', 'YYYY-MM-DD HH:mm', TIMEZONE);
const END = moment.tz('2026-07-29 21:00', 'YYYY-MM-DD HH:mm', TIMEZONE);

function windowPayload() {
    return {
        shiftStartAt: START.toISOString(),
        shiftEndAt: END.toISOString()
    };
}

function reconciliation(createdAt, result) {
    return {
        kind: 'end-adena-reconciliation',
        action: 'reconcile',
        shift: 'DAY',
        status: 'success',
        createdAt,
        payload: windowPayload(),
        result
    };
}

const pendingOne = {
    messageId: 'message-1',
    userName: 'Alice',
    url: 'https://discord.com/channels/guild/channel/message-1'
};
const pendingTwo = {
    messageId: 'message-2',
    userName: 'Bob',
    url: 'https://discord.com/channels/guild/channel/message-2'
};
const logs = [
    {
        kind: 'end-adena-approval-reminder',
        shift: 'DAY',
        status: 'success',
        createdAt: START.clone().add(12, 'hours').add(45, 'minutes').toISOString(),
        payload: windowPayload(),
        result: { pending: [pendingOne, pendingTwo] }
    },
    {
        kind: 'end-adena',
        action: 'approve',
        shift: 'DAY',
        status: 'success',
        createdAt: START.clone().add(12, 'hours').add(50, 'minutes').toISOString(),
        messageId: pendingOne.messageId,
        payload: { audit: windowPayload() },
        shiftStartAt: START.toISOString(),
        shiftEndAt: END.toISOString()
    },
    reconciliation(START.clone().add(13, 'hours').toISOString(), {
        ok: true,
        businessComplete: false,
        needsReview: 5,
        pending: [pendingTwo],
        awaitingApproval: [{ userName: 'Bob', pending: [pendingTwo] }],
        invalidSubmissions: [{ userName: 'Invalid User', issueCodes: ['invalid-format'], url: 'https://discord.com/channels/guild/channel/invalid' }],
        missing: [{ userName: 'Missing User' }],
        unexpected: [{ userName: 'Unexpected User' }],
        unexpectedPending: [{ userName: 'Unexpected Pending', url: 'https://discord.com/channels/guild/channel/unexpected' }],
        duplicates: [{ userName: 'Duplicate User' }],
        pendingDuplicates: [{ userName: 'Pending Duplicate' }],
        unresolved: [{ userName: 'Unresolved User', code: 'user-not-found' }],
        sheetMismatches: [{ userName: 'Sheet User', sheetValue: 10, approvedValue: 20, recovered: true }],
        sheetRecordedCount: 2,
        repair: { failures: [{ userName: 'Repair User', error: 'write-failed' }] }
    })
];

const snapshot = selectEndAdenaReview(logs);
assert.strictEqual(snapshot.found, true);
assert.strictEqual(snapshot.businessComplete, false);
assert.strictEqual(snapshot.needsReview, 5);
assert.deepStrictEqual(snapshot.pending.map(item => item.messageId), ['message-2']);
assert.strictEqual(snapshot.invalidSubmissions.length, 1);
assert.strictEqual(snapshot.missing.length, 1);
assert.strictEqual(snapshot.unexpected.length, 1);
assert.strictEqual(snapshot.unexpectedPending.length, 1);
assert.strictEqual(snapshot.duplicates.length, 1);
assert.strictEqual(snapshot.pendingDuplicates.length, 1);
assert.strictEqual(snapshot.unresolved.length, 1);
assert.strictEqual(snapshot.sheetMismatches.length, 1);
assert.strictEqual(snapshot.repairFailures.length, 1);

const currentBounds = shift => ({
    start: shift === 'day' ? START.clone() : END.clone(),
    end: shift === 'day' ? END.clone() : END.clone().add(12, 'hours')
});
const activeWindow = selectCurrentSettlementWindow(
    END.clone().add(55, 'minutes'),
    currentBounds,
    ({ shift, bounds }) => shift === 'DAY'
        ? {
            activeOvertime: true,
            activeOvertimeCount: 1,
            activeOvertimeWorkers: [{ userName: 'Overtime User' }],
            deadlineAt: null
        }
        : {
            activeOvertime: false,
            workEndAt: bounds.end.toISOString(),
            deadlineAt: bounds.end.clone().add(60, 'minutes').toISOString()
        }
);
assert.strictEqual(activeWindow.shift, 'DAY');
assert.strictEqual(activeWindow.phase, 'active-overtime');
assert.strictEqual(settlementPhase(END.clone().add(100, 'minutes'), { start: START, end: END }, {
    activeOvertime: false,
    deadlineAt: END.clone().add(123, 'minutes').toISOString()
}), 'approval-window');

const customId = buildCustomId('reconcile', snapshot);
assert.deepStrictEqual(parseCustomId(customId), {
    action: 'reconcile',
    shift: 'DAY',
    startMs: START.valueOf(),
    endMs: END.valueOf()
});
assert.strictEqual(parseCustomId('end-adena-review:approve:DAY:1:2'), null);

const rendered = renderReviewPayload(snapshot, { ActionRowBuilder, ButtonBuilder, ButtonStyle });
assert.match(rendered.content, /\uc5d4\ub4dc\uc544\ub370\ub098 \uad00\ub9ac\uc790 \ud655\uc778\uc13c\ud130/);
assert.match(rendered.content, /\uc0c1\ud0dc: \ud655\uc778 \ud544\uc694 5\uac74/);
assert.match(rendered.content, /\uc218\uc815 \ud544\uc694 \uac8c\uc2dc\ubb3c/);
assert.match(rendered.content, /\uc2dc\ud2b8 \uae08\uc561 \ubd88\uc77c\uce58/);
assert.match(rendered.content, /\uccb4\ud06c \uc2b9\uc778\uc740 \uc790\ub3d9\uc73c\ub85c \ucc98\ub9ac\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4/);
assert.strictEqual(rendered.components.length, 1);
assert.strictEqual(rendered.components[0].components.length, 3);

const overtimeRendered = renderReviewPayload({
    ...snapshot,
    hasReconciliation: true,
    settlementPhase: 'approval-window',
    workEndAt: END.clone().add(63, 'minutes').toISOString(),
    settlementDeadlineAt: END.clone().add(123, 'minutes').toISOString(),
    overtimeExtensionMinutes: 63,
    reconcileEnabled: false
}, { ActionRowBuilder, ButtonBuilder, ButtonStyle });
assert.match(overtimeRendered.content, /\uc2e4\uc81c \ub9c8\uc9c0\ub9c9 \ud1f4\uadfc/);
assert.match(overtimeRendered.content, /\uc2b9\uc778 \ub9c8\uac10/);
assert.match(overtimeRendered.content, /\uc624\ubc84\ud0c0\uc784 \uc5f0\uc7a5: 63\ubd84/);
assert.strictEqual(overtimeRendered.components[0].components[1].data.disabled, true);

const workingRendered = renderReviewPayload({
    ...snapshot,
    hasReconciliation: false,
    businessComplete: true,
    settlementPhase: 'working',
    workEndAt: null,
    settlementDeadlineAt: null,
    reconcileEnabled: false
}, { ActionRowBuilder, ButtonBuilder, ButtonStyle });
assert.match(workingRendered.content, /\uadfc\ubb34 \uc9c4\ud589 \uc911/);
assert.match(workingRendered.content, /\uc2e4\uc81c \ud1f4\uadfc\uc774 \ud655\uc815\ub418\uba74/);
assert.doesNotMatch(workingRendered.content, /\uc2e4\uc81c \ub9c8\uc9c0\ub9c9 \ud1f4\uadfc/);
assert.doesNotMatch(workingRendered.content, /\uc2b9\uc778 \ub9c8\uac10:/);

function createInteraction() {
    const payloads = [];
    const interaction = {
        member: { id: 'admin' },
        guild: { id: 'guild' },
        deferred: false,
        replied: false,
        payloads,
        deferReply: async () => {
            interaction.deferred = true;
        },
        deferUpdate: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            payloads.push(payload);
            return payload;
        },
        reply: async payload => {
            interaction.replied = true;
            payloads.push(payload);
            return payload;
        }
    };
    return interaction;
}

(async () => {
    const mutableLogs = logs.slice();
    const audits = [];
    let reconciliationRuns = 0;
    const command = createEndAdenaReviewCommand({
        MessageFlags: { Ephemeral: 64 },
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        moment,
        timezone: TIMEZONE,
        payrollOperationLogService: {
            listRecent: async () => mutableLogs.slice()
        },
        endAdenaReconciliationService: {
            getSettlementWindow: ({ bounds }) => ({
                activeOvertime: false,
                workEndAt: bounds.end.clone().add(63, 'minutes').toISOString(),
                extensionMinutes: 63,
                deadlineAt: bounds.end.clone().add(123, 'minutes').toISOString()
            }),
            run: async ({ shift, bounds, source }) => {
                reconciliationRuns += 1;
                assert.strictEqual(shift, 'DAY');
                assert.strictEqual(bounds.start.valueOf(), START.valueOf());
                assert.strictEqual(bounds.end.valueOf(), END.valueOf());
                assert.strictEqual(source, 'admin-review');
                const result = {
                    ok: true,
                    businessComplete: true,
                    needsReview: 0,
                    missing: [],
                    unexpected: [],
                    duplicates: [],
                    unresolved: [],
                    repair: { failures: [] }
                };
                mutableLogs.push(reconciliation(END.clone().add(130, 'minutes').toISOString(), result));
                return result;
            }
        },
        getNow: () => END.clone().add(130, 'minutes'),
        getShiftBounds: currentBounds,
        canRun: () => true,
        writeAdminActionLog: async action => {
            audits.push(action);
        }
    });

    const openInteraction = createInteraction();
    await command.execute(openInteraction);
    assert.strictEqual(openInteraction.payloads.length, 1);
    assert.match(openInteraction.payloads[0].content, /\uc0c1\ud0dc: \ud655\uc778 \ud544\uc694 5\uac74/);
    assert.match(openInteraction.payloads[0].content, /7\uc77c \ud488\uc9c8: 50\uc810/);
    assert.deepStrictEqual(audits, ['END_ADENA_REVIEW_OPEN']);

    const reconcileId = openInteraction.payloads[0].components[0].components[1].data.custom_id;
    assert.strictEqual(command.isButton(reconcileId), true);
    const buttonInteraction = createInteraction();
    buttonInteraction.customId = reconcileId;
    const handled = await command.handleButton(buttonInteraction);
    assert(handled);
    assert.strictEqual(reconciliationRuns, 1);
    assert.match(buttonInteraction.payloads[0].content, /\uc0c1\ud0dc: \uc815\uc0c1 \uc644\ub8cc/);
    assert.match(buttonInteraction.payloads[0].content, /7\uc77c \ud488\uc9c8: 100\uc810/);
    assert.deepStrictEqual(audits, ['END_ADENA_REVIEW_OPEN', 'END_ADENA_REVIEW_RECONCILE']);

    const latestIncomplete = selectEndAdenaReview(mutableLogs);
    assert.strictEqual(latestIncomplete.found, false, 'completed windows must leave the default review queue');
    const completedWindow = selectEndAdenaReview(mutableLogs, {
        shift: 'DAY',
        startMs: START.valueOf(),
        endMs: END.valueOf()
    });
    assert.strictEqual(completedWindow.found, true);
    assert.strictEqual(completedWindow.businessComplete, true);

    const activeCommand = createEndAdenaReviewCommand({
        MessageFlags: { Ephemeral: 64 },
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        moment,
        timezone: TIMEZONE,
        getNow: () => END.clone().add(55, 'minutes'),
        getShiftBounds: currentBounds,
        payrollOperationLogService: { listRecent: async () => [] },
        endAdenaReconciliationService: {
            getSettlementWindow: ({ shift, bounds }) => shift === 'DAY'
                ? {
                    activeOvertime: true,
                    activeOvertimeCount: 1,
                    activeOvertimeWorkers: [{ userName: 'Overtime User' }],
                    deadlineAt: null
                }
                : {
                    activeOvertime: false,
                    workEndAt: bounds.end.toISOString(),
                    deadlineAt: bounds.end.clone().add(60, 'minutes').toISOString()
                },
            run: async () => {
                throw new Error('active overtime must not reconcile');
            }
        },
        canRun: () => true
    });
    const activeInteraction = createInteraction();
    await activeCommand.execute(activeInteraction);
    assert.match(activeInteraction.payloads[0].content, /\uc624\ubc84\ud0c0\uc784 \uc9c4\ud589 \uc911 \(1\uba85\)/);
    assert.match(activeInteraction.payloads[0].content, /Overtime User/);
    assert.strictEqual(activeInteraction.payloads[0].components[0].components[1].data.disabled, true);

    console.log('end-adena-review-command tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
