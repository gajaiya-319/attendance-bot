'use strict';

const assert = require('assert');
const { createBackgroundJobQueueService } = require('../src/services/backgroundJobQueueService');

(async () => {
    const order = [];
    const snapshots = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const queue = createBackgroundJobQueueService({
        logger: { log() {}, warn() {}, error() {} },
        onStats: async stats => snapshots.push(stats)
    });
    const first = queue.enqueue({
        key: 'first',
        priority: 1,
        task: async () => {
            order.push('first-start');
            await firstGate;
            order.push('first-end');
        }
    });
    await new Promise(resolve => setImmediate(resolve));
    const low = queue.enqueue({ key: 'low', priority: 1, task: async () => order.push('low') });
    const high = queue.enqueue({ key: 'high', priority: 100, task: async () => order.push('high') });
    const duplicate = queue.enqueue({ key: 'high', priority: 100, task: async () => order.push('duplicate') });
    assert.strictEqual(duplicate.accepted, false, 'same background job is deduplicated');
    releaseFirst();
    await Promise.all([first.completion, low.completion, high.completion]);
    assert.deepStrictEqual(order, ['first-start', 'first-end', 'high', 'low'], 'queued jobs run by priority');
    assert.strictEqual(queue.getStats().completed, 3);
    assert.strictEqual(queue.getStats().deduplicated, 1);
    assert.strictEqual(queue.getStats().pending, 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(snapshots.at(-1).pending, 0, 'persisted queue stats reflect the drained queue');
    assert.strictEqual(snapshots.at(-1).completed, 3);
    console.log('background-job-queue-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
