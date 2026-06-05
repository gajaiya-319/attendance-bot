const assert = require('assert');
const {
    parseArgs,
    waitForOpsHealth
} = require('../scripts/wait-ops-health');

const options = parseArgs([
    '--timeout=12',
    '--interval=3',
    '--process=bot',
    '--data=data.json',
    '--runtime-health-file=health.json',
    '--expected-command-count=38'
]);
assert.strictEqual(options.timeoutSeconds, 12);
assert.strictEqual(options.intervalSeconds, 3);
assert.deepStrictEqual(options.healthOptions, {
    processName: 'bot',
    dataFile: 'data.json',
    runtimeHealthFile: 'health.json',
    expectedCommandCount: 38
});

(async () => {
    let calls = 0;
    const success = await waitForOpsHealth({
        timeoutSeconds: 10,
        intervalSeconds: 1,
        healthCheck: () => {
            calls++;
            return { status: calls >= 3 ? 'ok' : 'warn' };
        },
        now: (() => {
            let t = 0;
            return () => {
                t += 1000;
                return t;
            };
        })(),
        sleepFn: async () => {}
    });
    assert.strictEqual(success.ok, true);
    assert.strictEqual(success.attempt, 3);

    const failure = await waitForOpsHealth({
        timeoutSeconds: 2,
        intervalSeconds: 1,
        healthCheck: () => ({ status: 'fail' }),
        now: (() => {
            let t = 0;
            return () => {
                t += 1000;
                return t;
            };
        })(),
        sleepFn: async () => {}
    });
    assert.strictEqual(failure.ok, false);
    assert(failure.attempt >= 1);

    console.log('wait-ops-health tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
