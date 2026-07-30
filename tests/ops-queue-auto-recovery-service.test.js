const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createOpsQueueService } = require('../src/services/opsQueueService');
const {
    classifyOpsQueueFailure,
    isOpsQueueItemDueForAutoRetry,
    runOpsQueueAutoRecovery
} = require('../src/services/opsQueueAutoRecoveryService');

(async () => {
    {
        const policy = classifyOpsQueueFailure({ code: 'user-not-found', attempts: 0 });
        assert.strictEqual(policy.category, 'user-match');
        assert.strictEqual(policy.autoRetry, true);
        assert.strictEqual(policy.action, 'repair-and-retry');
        assert.strictEqual(policy.repairRevision, 'sheet-name-variants-v2');
        assert(policy.messageKo.includes('별칭'));

        const exhausted = classifyOpsQueueFailure({
            code: 'user-not-found',
            attempts: 6,
            autoRepairRevision: 'sheet-name-variants-v2'
        });
        assert.strictEqual(exhausted.autoRetry, false);
        assert.strictEqual(exhausted.action, 'needs-review');

        const missingDay = classifyOpsQueueFailure({ code: 'day-not-found', attempts: 0 });
        assert.strictEqual(missingDay.autoRetry, false);
        assert(missingDay.messageKo.includes('날짜'));
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-auto-recovery-'));
    const service = createOpsQueueService({
        filePath: path.join(dir, 'ops-pending.json'),
        logger: { warn: () => {}, log: () => {}, error: () => {} }
    });

    await service.enqueue({
        kind: 'end-adena',
        action: 'approve',
        messageId: 'msg1',
        server: 'VALAKAS',
        shift: 'DAY',
        userName: 'BitShelby',
        code: 'sheet-api-error',
        payload: {
            server: 'VALAKAS',
            shift: 'DAY',
            userName: 'BitShelby',
            amount: 180000,
            dayOfMonth: 30
        }
    });

    let calls = 0;
    const first = await runOpsQueueAutoRecovery({
        opsQueueService: service,
        now: new Date('2026-07-01T00:00:00.000Z'),
        logger: { log: () => {} },
        retryItem: async () => {
            calls += 1;
            return { ok: false, code: 'sheet-api-error', errorMessage: 'temporary' };
        }
    });

    assert.strictEqual(first.retried, 1);
    assert.strictEqual(first.failed, 1);
    assert.strictEqual(calls, 1);

    let items = await service.list();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].attempts, 1);
    assert.strictEqual(items[0].status, 'pending');
    assert.strictEqual(items[0].lastCode, 'sheet-api-error');
    assert(items[0].nextAttemptAt, 'failed retry gets nextAttemptAt');
    assert.strictEqual(isOpsQueueItemDueForAutoRetry(items[0], new Date('2026-07-01T00:00:10.000Z')), false);

    const second = await runOpsQueueAutoRecovery({
        opsQueueService: service,
        now: new Date('2026-07-01T00:00:10.000Z'),
        logger: { log: () => {} },
        retryItem: async () => {
            calls += 1;
            return { ok: true };
        }
    });
    assert.strictEqual(second.skipped, 1);
    assert.strictEqual(calls, 1, 'future nextAttemptAt prevents immediate retry');

    const forced = await runOpsQueueAutoRecovery({
        opsQueueService: service,
        force: true,
        now: new Date('2026-07-01T00:00:20.000Z'),
        logger: { log: () => {} },
        retryItem: async () => {
            calls += 1;
            return { ok: true, range: 'Valakas Great!F5' };
        }
    });
    assert.strictEqual(forced.succeeded, 1);
    assert.deepStrictEqual(await service.list(), []);

    await service.writeItems([{
        id: 'end-adena:approve:msg-upgrade:VALAKAS:Gab Great',
        kind: 'end-adena',
        action: 'approve',
        server: 'VALAKAS',
        shift: 'DAY',
        userName: 'Gab Great',
        code: 'user-not-found',
        status: 'needs-review',
        attempts: 6,
        payload: { userName: 'Gab Great' }
    }]);
    const upgraded = await runOpsQueueAutoRecovery({
        opsQueueService: service,
        now: new Date('2026-07-01T00:00:30.000Z'),
        logger: { log: () => {} },
        retryItem: async item => {
            assert.strictEqual(item.autoRepairRevision, 'sheet-name-variants-v2');
            return { ok: true };
        }
    });
    assert.strictEqual(upgraded.retried, 1, 'new repair revision reopens a review item once');
    assert.strictEqual(upgraded.succeeded, 1);
    assert.deepStrictEqual(await service.list(), []);

    await service.writeItems([{
        id: 'end-adena:approve:msg2:VALAKAS:Missing',
        kind: 'end-adena',
        action: 'approve',
        server: 'VALAKAS',
        shift: 'DAY',
        userName: 'Missing',
        code: 'user-not-found',
        attempts: 6,
        autoRepairRevision: 'sheet-name-variants-v2',
        payload: { userName: 'Missing' }
    }]);

    const review = await runOpsQueueAutoRecovery({
        opsQueueService: service,
        now: new Date('2026-07-01T00:01:00.000Z'),
        logger: { log: () => {} },
        retryItem: async () => {
            throw new Error('should not retry');
        }
    });
    assert.strictEqual(review.skipped, 1);
    assert.strictEqual(review.needsReview, 1);
    items = await service.list();
    assert.strictEqual(items[0].status, 'needs-review');
    assert.strictEqual(items[0].autoRepairAction, 'needs-review');

    console.log('ops-queue-auto-recovery-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
