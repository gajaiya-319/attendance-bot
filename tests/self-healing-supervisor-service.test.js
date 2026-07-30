'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {
    classifyRecoveryError,
    createSelfHealingSupervisorService
} = require('../src/services/selfHealingSupervisorService');

(async () => {
    assert.strictEqual(classifyRecoveryError(new Error('request timeout')).category, 'transient');
    assert.strictEqual(classifyRecoveryError(new Error('invalid_grant')).retryable, false);
    assert.strictEqual(classifyRecoveryError({ status: 403, message: 'access denied' }).category, 'blocked');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'self-healing-'));
    let clock = Date.parse('2026-07-27T00:00:00.000Z');
    const filePath = path.join(dir, 'state.json');
    const auditFilePath = path.join(dir, 'audit.jsonl');
    const service = createSelfHealingSupervisorService({
        filePath,
        auditFilePath,
        now: () => clock,
        baseRetryDelayMs: 1000,
        logger: { log() {}, warn() {}, error() {} }
    });

    let attempts = 0;
    const task = {
        name: 'transient-sheet-task',
        repairRevision: 'v1',
        repair: async () => {
            attempts += 1;
            if (attempts === 1) {
                const error = new Error('Google API 503');
                error.code = 503;
                throw error;
            }
            return { changed: true };
        },
        verify: result => result.changed
    };

    const first = await service.runCycle([task], { reason: 'test' });
    assert.strictEqual(first.ok, false);
    assert.strictEqual(first.results[0].retryable, true);

    const backoff = await service.runCycle([task], { reason: 'test' });
    assert.strictEqual(backoff.results[0].skipped, true);
    assert.strictEqual(attempts, 1);

    clock += 1000;
    const recovered = await service.runCycle([task], { reason: 'test' });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.recovered, 1);
    assert.strictEqual(attempts, 2);

    const quarantinedService = createSelfHealingSupervisorService({
        filePath: path.join(dir, 'quarantined.json'),
        auditFilePath: path.join(dir, 'quarantined-audit.jsonl'),
        now: () => clock,
        maxConsecutiveFailures: 1,
        logger: { log() {}, warn() {}, error() {} }
    });
    const failedTask = {
        name: 'revision-task',
        repairRevision: 'v1',
        repair: async () => { throw new Error('unknown failure'); }
    };
    const quarantined = await quarantinedService.runCycle([failedTask]);
    assert.strictEqual(quarantined.results[0].retryable, false);
    assert.strictEqual((await quarantinedService.getSnapshot()).tasks['revision-task'].status, 'needs-review');
    const stillQuarantined = await quarantinedService.runCycle([failedTask]);
    assert.strictEqual(stillQuarantined.results[0].skipped, true);
    assert.strictEqual(stillQuarantined.results[0].reason, 'needs-review');

    const revised = await quarantinedService.runCycle([{
        name: 'revision-task',
        repairRevision: 'v2',
        repair: async () => ({ repaired: ['item-1'] }),
        verify: () => ({ ok: true })
    }]);
    assert.strictEqual(revised.ok, true, 'a new repair revision reopens a quarantined task');
    const revisedState = (await quarantinedService.getSnapshot()).tasks['revision-task'];
    assert.strictEqual(revisedState.status, 'healthy');
    assert.strictEqual(revisedState.repairRevision, 'v2');

    const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.strictEqual(saved.tasks['transient-sheet-task'].status, 'healthy');
    const auditLines = (await fs.readFile(auditFilePath, 'utf8')).trim().split(/\r?\n/);
    assert.strictEqual(auditLines.length, 2);

    await fs.rm(dir, { recursive: true, force: true });
    console.log('self-healing-supervisor-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
