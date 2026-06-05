const assert = require('assert');
const {
    deployCheck,
    parseArgs,
    buildPm2RestartCall
} = require('../scripts/deploy-check');

const options = parseArgs([
    '--process=bot',
    '--timeout=12',
    '--interval=3',
    '--runtime-health-file=health.json',
    '--expected-command-count=38',
    '--skip-predeploy'
]);

assert.strictEqual(options.processName, 'bot');
assert.strictEqual(options.timeoutSeconds, 12);
assert.strictEqual(options.intervalSeconds, 3);
assert.strictEqual(options.skipPredeploy, true);
assert.strictEqual(options.skipRestart, false);
assert.deepStrictEqual(options.healthOptions, {
    processName: 'bot',
    runtimeHealthFile: 'health.json',
    expectedCommandCount: 38
});

(async () => {
    const calls = [];
    const result = await deployCheck({
        processName: 'bot',
        skipPredeploy: false,
        skipRestart: false,
        quiet: true,
        runner: (command, args) => calls.push([command, args]),
        wait: async options => ({
            ok: true,
            attempt: 2,
            result: {
                status: 'ok',
                checkedAt: 'now',
                checks: {
                    pm2: { status: 'online', pid: 1 },
                    state: { skipped: false, issueCount: 0 },
                    stateWrites: { findingCount: 0 },
                    backups: { checked: 1, fatalIssueCount: 0, warningCount: 0, reviewedIssueCount: 0 },
                    embeds: { findingCount: 0 },
                    commandRegistration: { registeredCount: 38, expectedCount: 38, source: 'runtime-health' },
                    errorLog: { exists: true, ageMinutes: 10, recentLines: [] }
                }
            }
        })
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length, 2);
    const restartCall = buildPm2RestartCall('bot');
    assert.deepStrictEqual(calls[1], [restartCall.command, restartCall.args]);

    await assert.rejects(
        () => deployCheck({
            skipPredeploy: true,
            skipRestart: true,
            quiet: true,
            runner: () => {},
            wait: async () => ({
                ok: false,
                attempt: 1,
                result: {
                    status: 'fail',
                    checkedAt: 'now',
                    checks: {
                        pm2: { status: 'online' },
                        state: { skipped: false, issueCount: 1 },
                        stateWrites: { findingCount: 0 },
                        backups: { checked: 0, fatalIssueCount: 0, warningCount: 0, reviewedIssueCount: 0 },
                        embeds: { findingCount: 0 },
                        commandRegistration: { registeredCount: null, expectedCount: 38, source: 'runtime-health' },
                        errorLog: { exists: false, recentLines: [] }
                    }
                }
            })
        }),
        /Ops health did not become OK/
    );

    console.log('deploy-check tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
