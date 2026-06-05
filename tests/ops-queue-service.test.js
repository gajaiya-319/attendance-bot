const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createOpsQueueService } = require('../src/services/opsQueueService');

(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-queue-'));
    const filePath = path.join(dir, 'ops-pending.json');
    const service = createOpsQueueService({
        filePath,
        logger: { warn: () => {}, log: () => {}, error: () => {} }
    });

    await service.enqueue({
        kind: 'end-adena',
        action: 'approve',
        messageId: 'msg1',
        channelId: 'chan1',
        server: 'HEINE',
        shift: 'NIGHT',
        userName: 'Ding dong',
        code: 'user-not-found',
        payload: {
            server: 'HEINE',
            shift: 'NIGHT',
            userName: 'Ding dong',
            amount: 130000,
            dayOfMonth: 1
        }
    });

    let items = await service.list();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, 'end-adena:approve:msg1:HEINE:Ding dong');
    assert.strictEqual(items[0].payload.amount, 130000);

    await service.enqueue({
        kind: 'end-adena',
        action: 'approve',
        messageId: 'msg1',
        channelId: 'chan1',
        server: 'HEINE',
        shift: 'NIGHT',
        userName: 'Ding dong',
        code: 'sheet-api-error',
        payload: {
            server: 'HEINE',
            shift: 'NIGHT',
            userName: 'Ding dong',
            amount: 130000,
            dayOfMonth: 1
        }
    });

    items = await service.list();
    assert.strictEqual(items.length, 1, 'same message retry should update existing queue item');
    assert.strictEqual(items[0].code, 'sheet-api-error');

    const retry = await service.retryAll(async item => {
        assert.strictEqual(item.userName, 'Ding dong');
        assert.strictEqual(item.attempts, 1);
        return { ok: true, range: 'Heine Great!C9' };
    });
    assert.deepStrictEqual(
        { total: retry.total, succeeded: retry.succeeded, failed: retry.failed },
        { total: 1, succeeded: 1, failed: 0 }
    );
    assert.deepStrictEqual(await service.list(), []);

    console.log('ops-queue-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
