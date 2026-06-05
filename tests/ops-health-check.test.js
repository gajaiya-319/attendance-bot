const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    getCommandRegistrationStatus,
    parseArgs,
    getLogFreshness,
    formatHealthSummary
} = require('../scripts/ops-health-check');

const options = parseArgs([
    '--process=bot',
    '--data=data.json',
    '--error-log-age-min=10',
    '--backup-limit=7',
    '--expected-command-count=38',
    '--json'
]);
assert.strictEqual(options.processName, 'bot');
assert.strictEqual(options.dataFile, 'data.json');
assert.strictEqual(options.maxErrorLogAgeMinutes, 10);
assert.strictEqual(options.backupLimit, 7);
assert.strictEqual(options.expectedCommandCount, 38);
assert.strictEqual(options.json, true);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-health-'));
try {
    const logPath = path.join(dir, 'error.log');
    fs.writeFileSync(logPath, 'old error\n');
    const old = new Date(Date.now() - 10 * 60000);
    fs.utimesSync(logPath, old, old);
    const freshness = getLogFreshness(logPath, 5);
    assert.strictEqual(freshness.exists, true);
    assert.strictEqual(freshness.ok, true, 'old error log is not considered fresh');

    const fresh = getLogFreshness(logPath, 15);
    assert.strictEqual(fresh.ok, false, 'recent error log is warned');

    const missing = getLogFreshness(path.join(dir, 'missing.log'), 5);
    assert.strictEqual(missing.exists, false);
    assert.strictEqual(missing.ok, true);

    const emptyLog = path.join(dir, 'empty-error.log');
    fs.writeFileSync(emptyLog, '');
    const emptyFreshness = getLogFreshness(emptyLog, 5);
    assert.strictEqual(emptyFreshness.exists, true);
    assert.strictEqual(emptyFreshness.empty, true);
    assert.strictEqual(emptyFreshness.ok, true, 'empty error log is not considered a recent error');

    const outLog = path.join(dir, 'out.log');
    fs.writeFileSync(outLog, [
        'ATTENDANCE BOT ONLINE',
        'Started : 2026-05-28 20:00:00',
        '[COMMAND REGISTER] Registered 37 guild commands.',
        'ATTENDANCE BOT ONLINE',
        'Started : 2026-05-28 20:10:00',
        '[COMMAND REGISTER] Registered 38 guild commands.'
    ].join('\n'));
    const commandStatus = getCommandRegistrationStatus(outLog, 38);
    assert.strictEqual(commandStatus.ok, true);
    assert.strictEqual(commandStatus.registeredCount, 38);
    assert.strictEqual(commandStatus.source, 'out-log');

    fs.writeFileSync(outLog, [
        'ATTENDANCE BOT ONLINE',
        'Started : 2026-05-28 20:20:00',
        'waiting...'
    ].join('\n'));
    const missingCommandStatus = getCommandRegistrationStatus(outLog, 38);
    assert.strictEqual(missingCommandStatus.ok, false);
    assert.strictEqual(missingCommandStatus.registeredCount, null);

    const runtimeHealthPath = path.join(dir, 'runtime-health.json');
    fs.writeFileSync(runtimeHealthPath, JSON.stringify({
        stage: 'client-ready-complete',
        pid: 123,
        at: '2026-05-28T00:00:00.000Z',
        commandRegister: { count: 38, error: null }
    }));
    const runtimeCommandStatus = getCommandRegistrationStatus(outLog, 38, {
        runtimeHealthFile: runtimeHealthPath,
        pm2Pid: 123
    });
    assert.strictEqual(runtimeCommandStatus.ok, true);
    assert.strictEqual(runtimeCommandStatus.source, 'runtime-health');

    const staleRuntimeCommandStatus = getCommandRegistrationStatus(outLog, 38, {
        runtimeHealthFile: runtimeHealthPath,
        pm2Pid: 456
    });
    assert.strictEqual(staleRuntimeCommandStatus.ok, false);
    assert(staleRuntimeCommandStatus.error.includes('does not match'));
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}

const summary = formatHealthSummary({
    status: 'warn',
    checkedAt: '2026-05-28T00:00:00.000Z',
    checks: {
        pm2: { status: 'online', pid: 1 },
        state: { skipped: false, issueCount: 0 },
        stateWrites: { findingCount: 0 },
        backups: { checked: 5, fatalIssueCount: 0, warningCount: 1, reviewedIssueCount: 2 },
        embeds: { findingCount: 0 },
        commandRegistration: { expectedCount: 38, registeredCount: 38, source: 'runtime-health' },
        errorLog: { exists: true, ageMinutes: 3, recentLines: [] }
    }
});
assert(summary.includes('Ops health: WARN'));
assert(summary.includes('Backups: 5 checked'));
assert(summary.includes('2 reviewed'));
assert(summary.includes('Commands: 38 / 38'));

console.log('ops-health-check tests passed');
