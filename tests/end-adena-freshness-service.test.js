'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const moment = require('moment-timezone');
const {
    JOBS,
    evaluateEndAdenaFreshness,
    createEndAdenaFreshnessService
} = require('../src/services/endAdenaFreshnessService');

assert.deepStrictEqual(JOBS.map(job => job.name), ['readiness', 'reset', 'reminder', 'reconciliation']);
assert.strictEqual(JOBS.reduce((sum, job) => sum + job.weight, 0), 100);

const TIMEZONE = 'Asia/Manila';

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', TIMEZONE);
}

function dayBounds() {
    return {
        start: at('2026-07-29 09:00'),
        end: at('2026-07-29 21:00')
    };
}

function getTestShiftBounds(shift, reference = at('2026-07-29 22:06')) {
    const now = moment(reference).tz(TIMEZONE);
    if (String(shift).toLowerCase() === 'day') {
        return {
            start: now.clone().startOf('day').hour(9),
            end: now.clone().startOf('day').hour(21)
        };
    }
    const businessDate = now.hour() < 9
        ? now.clone().subtract(1, 'day').startOf('day')
        : now.clone().startOf('day');
    return {
        start: businessDate.clone().hour(21),
        end: businessDate.clone().add(1, 'day').hour(9)
    };
}

function windowForDay() {
    const bounds = dayBounds();
    return {
        key: `DAY:${bounds.start.toISOString()}:${bounds.end.toISOString()}`,
        shift: 'DAY',
        bounds
    };
}

function operation(kind, createdAt, overrides = {}) {
    const bounds = dayBounds();
    const base = {
        kind,
        status: 'success',
        shift: 'DAY',
        createdAt: at(createdAt).toISOString(),
        payload: {
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString()
        }
    };
    if (kind === 'end-adena-reconciliation') {
        base.result = { ok: true, businessComplete: true, needsReview: 0 };
    }
    return { ...base, ...overrides };
}

function evaluate(operations, { now = at('2026-07-29 22:06'), windows = [windowForDay()] } = {}) {
    return evaluateEndAdenaFreshness({
        now,
        monitoringStartedAt: at('2026-07-29 17:00').toISOString(),
        windows,
        operations
    });
}

const perfect = evaluate([
    operation('end-adena-close-readiness', '2026-07-29 20:40'),
    operation('end-adena-summary-reset', '2026-07-29 20:50'),
    operation('end-adena-approval-reminder', '2026-07-29 21:45'),
    operation('end-adena-reconciliation', '2026-07-29 22:00')
]);
assert.strictEqual(perfect.score, 100);
assert.strictEqual(perfect.ready, true);
assert.strictEqual(perfect.issueCount, 0);
assert.strictEqual(perfect.recoveredCount, 0);
assert.strictEqual(perfect.certifiedCycles, 1);

const overtimeWindow = {
    ...windowForDay(),
    settlement: {
        activeOvertime: false,
        workEndAt: at('2026-07-29 22:03').toISOString(),
        extensionMinutes: 63,
        deadlineAt: at('2026-07-29 23:03').toISOString()
    }
};
const overtimePerfect = evaluate([
    operation('end-adena-close-readiness', '2026-07-29 20:40'),
    operation('end-adena-summary-reset', '2026-07-29 20:50'),
    operation('end-adena-approval-reminder', '2026-07-29 22:48'),
    operation('end-adena-reconciliation', '2026-07-29 23:05')
], {
    now: at('2026-07-29 23:09'),
    windows: [overtimeWindow]
});
assert.strictEqual(overtimePerfect.score, 100);
assert.strictEqual(overtimePerfect.certifiedCycles, 1);
assert.strictEqual(overtimePerfect.recoveredCount, 0);
assert.strictEqual(overtimePerfect.cycles[0].overtimeExtensionMinutes, 63);
assert.strictEqual(overtimePerfect.cycles[0].settlementDeadlineAt, at('2026-07-29 23:03').toISOString());

const activeOvertime = evaluate([
    operation('end-adena-close-readiness', '2026-07-29 20:40'),
    operation('end-adena-summary-reset', '2026-07-29 20:50')
], {
    now: at('2026-07-29 22:06'),
    windows: [{
        ...windowForDay(),
        settlement: { activeOvertime: true, deadlineAt: null }
    }]
});
assert.deepStrictEqual(activeOvertime.tasks.map(task => task.name), ['readiness', 'reset']);
assert.strictEqual(activeOvertime.ready, false);
assert.strictEqual(activeOvertime.issueCount, 0);

const incompleteReconciliation = evaluate([
    operation('end-adena-close-readiness', '2026-07-29 20:40'),
    operation('end-adena-summary-reset', '2026-07-29 20:50'),
    operation('end-adena-approval-reminder', '2026-07-29 21:45'),
    operation('end-adena-reconciliation', '2026-07-29 22:00', {
        result: { ok: true, businessComplete: false, needsReview: 2 }
    })
]);
assert.strictEqual(incompleteReconciliation.score, 50);
assert.strictEqual(incompleteReconciliation.issueCount, 1);
assert.strictEqual(incompleteReconciliation.certifiedCycles, 0);
assert.strictEqual(incompleteReconciliation.tasks.find(task => task.name === 'reconciliation').status, 'needs-review');

const lateReminder = evaluate([
    operation('end-adena-close-readiness', '2026-07-29 20:40'),
    operation('end-adena-summary-reset', '2026-07-29 20:50'),
    operation('end-adena-approval-reminder', '2026-07-29 21:53'),
    operation('end-adena-reconciliation', '2026-07-29 22:00')
]);
assert.strictEqual(lateReminder.score, 96);
assert.strictEqual(lateReminder.issueCount, 0);
assert.strictEqual(lateReminder.recoveredCount, 1);
assert.strictEqual(lateReminder.certifiedCycles, 0);

const wrongWindow = operation('end-adena-reconciliation', '2026-07-29 22:00');
wrongWindow.payload.shiftStartAt = at('2026-07-28 09:00').toISOString();
wrongWindow.payload.shiftEndAt = at('2026-07-28 21:00').toISOString();
const mismatched = evaluate([
    operation('end-adena-close-readiness', '2026-07-29 20:40'),
    operation('end-adena-summary-reset', '2026-07-29 20:50'),
    operation('end-adena-approval-reminder', '2026-07-29 21:45'),
    wrongWindow
]);
assert.strictEqual(mismatched.issueCount, 1);
assert.strictEqual(mismatched.tasks.find(task => task.name === 'reconciliation').status, 'missing');

async function createHarness({ initialOperations = [], monitoringStartedAt = null, runResult = true } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'end-adena-freshness-'));
    const stateFilePath = path.join(dir, 'freshness.json');
    const operations = initialOperations.slice();
    const calls = [];
    const sent = [];
    let current = at('2026-07-29 22:06');
    if (monitoringStartedAt) {
        fs.writeFileSync(stateFilePath, JSON.stringify({ monitoringStartedAt }), 'utf8');
    }
    const payrollOperationLogService = {
        listRecent: async () => operations.slice(),
        record: async entry => {
            calls.push(`record:${entry.kind}:${entry.status}`);
            operations.push({ ...entry, createdAt: entry.createdAt || current.toISOString() });
            return entry;
        }
    };
    const service = createEndAdenaFreshnessService({
        CONFIG: { TIMEZONE, GUILD_ID: 'guild', LOG_CHANNEL: 'log' },
        moment,
        getShiftBounds: getTestShiftBounds,
        payrollOperationLogService,
        endAdenaReconciliationService: {
            reportCloseReadiness: async ({ shift, bounds }) => {
                calls.push('readiness');
                operations.push(operation('end-adena-close-readiness', current.format('YYYY-MM-DD HH:mm'), {
                    shift,
                    payload: {
                        shiftStartAt: bounds.start.toISOString(),
                        shiftEndAt: bounds.end.toISOString()
                    }
                }));
                return { ok: true };
            },
            remindPendingApprovals: async ({ shift, bounds }) => {
                calls.push('reminder');
                operations.push(operation('end-adena-approval-reminder', current.format('YYYY-MM-DD HH:mm'), {
                    shift,
                    payload: {
                        shiftStartAt: bounds.start.toISOString(),
                        shiftEndAt: bounds.end.toISOString()
                    }
                }));
                return { ok: true, pending: [] };
            },
            run: async ({ shift, bounds }) => {
                calls.push('reconciliation');
                if (runResult) {
                    operations.push(operation('end-adena-reconciliation', current.format('YYYY-MM-DD HH:mm'), {
                        shift,
                        payload: {
                            shiftStartAt: bounds.start.toISOString(),
                            shiftEndAt: bounds.end.toISOString()
                        }
                    }));
                }
                return { ok: runResult };
            }
        },
        client: {
            channels: {
                fetch: async () => ({ send: async message => sent.push(message) })
            }
        },
        stateFilePath,
        logger: { warn: () => {} }
    });
    return {
        service,
        calls,
        sent,
        operations,
        stateFilePath,
        setCurrent(value) {
            current = at(value);
        },
        cleanup() {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

(async () => {
    const firstActivation = await createHarness();
    try {
        const report = await firstActivation.service.audit({ at: at('2026-07-29 22:06') });
        assert.strictEqual(report.ready, false);
        assert.strictEqual(report.dueTaskCount, 0);
        assert.strictEqual(report.issueCount, 0);
        assert.strictEqual(firstActivation.calls.includes('reconciliation'), false);
    } finally {
        firstActivation.cleanup();
    }

    const reminderRecovery = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString(),
        initialOperations: [
            operation('end-adena-close-readiness', '2026-07-29 20:40'),
            operation('end-adena-summary-reset', '2026-07-29 20:50')
        ]
    });
    try {
        reminderRecovery.setCurrent('2026-07-29 21:51');
        const report = await reminderRecovery.service.audit({ at: at('2026-07-29 21:51') });
        assert.strictEqual(reminderRecovery.calls.includes('reminder'), true);
        assert.strictEqual(report.issueCount, 0);
        assert.strictEqual(report.recoveredCount, 1);
        assert.strictEqual(report.recoveryActions[0].ok, true);
    } finally {
        reminderRecovery.cleanup();
    }

    const reconciliationRecovery = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString(),
        initialOperations: [
            operation('end-adena-close-readiness', '2026-07-29 20:40'),
            operation('end-adena-summary-reset', '2026-07-29 20:50'),
            operation('end-adena-approval-reminder', '2026-07-29 21:45')
        ]
    });
    try {
        const report = await reconciliationRecovery.service.audit({ at: at('2026-07-29 22:06') });
        assert.strictEqual(reconciliationRecovery.calls.includes('reconciliation'), true);
        assert.strictEqual(report.issueCount, 0);
        assert.strictEqual(report.recoveredCount, 1);
        assert.strictEqual(report.ready, true);
        assert.strictEqual(report.score, 88);
    } finally {
        reconciliationRecovery.cleanup();
    }

    const failedRecovery = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString(),
        runResult: false,
        initialOperations: [
            operation('end-adena-close-readiness', '2026-07-29 20:40'),
            operation('end-adena-summary-reset', '2026-07-29 20:50'),
            operation('end-adena-approval-reminder', '2026-07-29 21:45')
        ]
    });
    try {
        const report = await failedRecovery.service.audit({ at: at('2026-07-29 22:06') });
        assert.strictEqual(report.issueCount, 1);
        assert.strictEqual(report.recoveryActions[0].ok, false);
    } finally {
        failedRecovery.cleanup();
    }

    const reviewRequired = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString(),
        initialOperations: [
            operation('end-adena-close-readiness', '2026-07-29 20:40'),
            operation('end-adena-summary-reset', '2026-07-29 20:50'),
            operation('end-adena-approval-reminder', '2026-07-29 21:45'),
            operation('end-adena-reconciliation', '2026-07-29 22:00', {
                result: { ok: true, businessComplete: false, needsReview: 1 }
            })
        ]
    });
    try {
        const report = await reviewRequired.service.audit({ at: at('2026-07-29 22:06') });
        assert.strictEqual(report.issueCount, 1);
        assert.strictEqual(report.score, 50);
        assert.strictEqual(reviewRequired.calls.includes('reconciliation'), false, 'review-required reconciliation is not replayed automatically');
        assert.strictEqual(reviewRequired.sent.length, 1);

        reviewRequired.setCurrent('2026-07-29 22:35');
        await reviewRequired.service.audit({ at: at('2026-07-29 22:35') });
        assert.strictEqual(reviewRequired.sent.length, 1, 'review reminder must wait for the configured interval');

        reviewRequired.setCurrent('2026-07-29 22:36');
        await reviewRequired.service.audit({ at: at('2026-07-29 22:36') });
        assert.strictEqual(reviewRequired.sent.length, 2, 'unresolved review work must be reminded every 30 minutes');
        assert.strictEqual(reviewRequired.calls.includes('reconciliation'), false, 'review reminders must not approve or replay reconciliation');
    } finally {
        reviewRequired.cleanup();
    }

    const missedReset = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString(),
        initialOperations: [
            operation('end-adena-close-readiness', '2026-07-29 20:40'),
            operation('end-adena-approval-reminder', '2026-07-29 21:45'),
            operation('end-adena-reconciliation', '2026-07-29 22:00')
        ]
    });
    try {
        const first = await missedReset.service.audit({ at: at('2026-07-29 22:06') });
        const second = await missedReset.service.audit({ at: at('2026-07-29 22:06') });
        assert.strictEqual(first.issueCount, 1);
        assert.strictEqual(first.tasks.find(task => task.name === 'reset').status, 'missing');
        assert.strictEqual(missedReset.calls.includes('reminder'), false);
        assert.strictEqual(missedReset.calls.includes('reconciliation'), false);
        assert.strictEqual(missedReset.sent.length, 1, 'the same reset alert must not be sent twice');
        assert.strictEqual(second.issueCount, 1);
    } finally {
        missedReset.cleanup();
    }

    const readinessRecovery = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString()
    });
    try {
        readinessRecovery.setCurrent('2026-07-29 20:46');
        const report = await readinessRecovery.service.audit({ at: at('2026-07-29 20:46') });
        assert.strictEqual(readinessRecovery.calls.includes('readiness'), true);
        assert.strictEqual(report.issueCount, 0);
        assert.strictEqual(report.recoveredCount, 1);
        assert.strictEqual(report.tasks.find(task => task.name === 'readiness').status, 'recovered');
    } finally {
        readinessRecovery.cleanup();
    }

    const expiredReadiness = await createHarness({
        monitoringStartedAt: at('2026-07-29 17:00').toISOString()
    });
    try {
        expiredReadiness.setCurrent('2026-07-29 20:51');
        const report = await expiredReadiness.service.audit({ at: at('2026-07-29 20:51') });
        assert.strictEqual(expiredReadiness.calls.includes('readiness'), false);
        assert.strictEqual(report.issueCount, 1);
        assert.strictEqual(report.tasks.find(task => task.name === 'readiness').status, 'missing');
    } finally {
        expiredReadiness.cleanup();
    }

    console.log('end-adena-freshness-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
