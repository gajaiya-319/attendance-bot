const assert = require('assert');
const path = require('path');
const os = require('os');
const fsSync = require('fs');
const fs = require('fs').promises;
const moment = require('moment-timezone');
const {
    createRuntimeHealthService,
    evaluate
} = require('../src/services/runtimeHealthService');

(async () => {
    assert.deepStrictEqual(evaluate({
        stage: 'client-ready-complete',
        pid: 123,
        at: 'now',
        commandRegister: { count: 38, error: null }
    }, 38, 123), {
        ok: true,
        stage: 'client-ready-complete',
        pid: 123,
        pidMatches: true,
        at: 'now',
        commandCount: 38,
        commandCountMatches: true,
        commandError: 'none',
        expectedCommandCount: 38
    });

    const stale = evaluate({
        stage: 'client-ready-complete',
        pid: 123,
        commandRegister: { count: 38, error: null }
    }, 38, 456);
    assert.strictEqual(stale.ok, false);
    assert.strictEqual(stale.pidMatches, false);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-health-service-'));
    try {
        const filePath = path.join(dir, 'runtime-health.json');
        const service = createRuntimeHealthService({
            fs,
            moment,
            timezone: 'Asia/Manila',
            filePath,
            pid: () => 777
        });

        const payload = await service.write('client-ready-complete', {
            commandRegister: { lastOk: 'ok', count: 38, error: null },
            memberFetch: { lastOk: 1, retryAfter: null, error: null }
        });
        assert.strictEqual(payload.pid, 777);
        assert.strictEqual(fsSync.existsSync(filePath), true);

        const result = await service.read(38);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.pid, 777);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }

    console.log('runtime-health-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
