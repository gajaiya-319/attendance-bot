'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runRecoveryDrill } = require('../src/services/recoveryDrillService');

(async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-drill-test-'));
    try {
        const result = await runRecoveryDrill({
            checkedAt: new Date('2026-07-30T01:00:00.000Z'),
            tempRoot
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.checkedAt, '2026-07-30T01:00:00.000Z');
        assert.strictEqual(result.isolated, true);
        assert.strictEqual(result.scenarioCount, 4);
        assert.strictEqual(result.failureCount, 0);
        assert(result.scenarios.every(item => item.ok));
        assert.strictEqual(
            result.scenarios.find(item => item.name === 'transient-queue-idempotency').detail.duplicateWrites,
            0
        );
        assert.strictEqual(
            result.scenarios.find(item => item.name === 'manual-review-boundary').detail.autoExecuted,
            false
        );
        assert.deepStrictEqual(fs.readdirSync(tempRoot), [], 'isolated drill files are removed');
        console.log('recovery-drill-service tests passed');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
