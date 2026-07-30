const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    getCommandRegistrationStatus,
    parseArgs,
    getLogFreshness,
    getDataConsistencyStatus,
    getEndAdenaFreshnessStatus,
    getExternalDependencySmokeStatus,
    getRecoveryDrillStatus,
    getSecurityPostureStatus,
    formatHealthSummary
} = require('../scripts/ops-health-check');

const options = parseArgs([
    '--process=bot',
    '--data=data.json',
    '--error-log-age-min=10',
    '--backup-limit=7',
    '--expected-command-count=38',
    '--end-adena-freshness-file=end-adena.json',
    '--external-smoke-file=external-smoke.json',
    '--recovery-drill-file=recovery-drill.json',
    '--security-audit-file=security-audit.json',
    '--allow-end-adena-degraded',
    '--json'
]);
assert.strictEqual(options.processName, 'bot');
assert.strictEqual(options.dataFile, 'data.json');
assert.strictEqual(options.maxErrorLogAgeMinutes, 10);
assert.strictEqual(options.backupLimit, 7);
assert.strictEqual(options.expectedCommandCount, 38);
assert.strictEqual(options.endAdenaFreshnessFile, 'end-adena.json');
assert.strictEqual(options.externalSmokeFile, 'external-smoke.json');
assert.strictEqual(options.recoveryDrillFile, 'recovery-drill.json');
assert.strictEqual(options.securityAuditFile, 'security-audit.json');
assert.strictEqual(options.allowEndAdenaDegraded, true);
assert.strictEqual(options.json, true);
assert.strictEqual(parseArgs([]).allowEndAdenaDegraded, false, 'strict health remains the default');

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

    const pendingPath = path.join(dir, 'pending.json');
    const payrollPath = path.join(dir, 'payroll-integrity.json');
    fs.writeFileSync(pendingPath, JSON.stringify({ items: [
        { row: { name: 'A' }, reviewNotifiedAt: null },
        { row: { name: 'B' }, reviewNotifiedAt: '2026-05-28T00:00:00.000Z' }
    ] }));
    fs.writeFileSync(payrollPath, JSON.stringify({
        lastRunAt: '2026-05-28T00:00:00.000Z',
        issueCount: 2
    }));
    const consistency = getDataConsistencyStatus({
        pendingAttendanceFile: pendingPath,
        payrollIntegrityFile: payrollPath,
        runtimeHealthFile: runtimeHealthPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(consistency.rawAttendancePending, 2);
    assert.strictEqual(consistency.rawAttendanceNeedsReview, 1);
    assert.strictEqual(consistency.payrollAuditIssues, 2);
    assert.strictEqual(consistency.payrollAuditStale, true);

    const freshnessPath = path.join(dir, 'end-adena-freshness.json');
    fs.writeFileSync(freshnessPath, JSON.stringify({
        checkedAt: '2026-05-29T12:55:00.000Z',
        ready: false,
        score: 100,
        issueCount: 0,
        recoveredCount: 0,
        certifiedCycles: 0,
        completedCycles: 0
    }));
    const monitoring = getEndAdenaFreshnessStatus({
        filePath: freshnessPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(monitoring.ok, true);
    assert.strictEqual(monitoring.status, 'monitoring');

    fs.writeFileSync(freshnessPath, JSON.stringify({
        checkedAt: '2026-05-29T12:55:00.000Z',
        ready: true,
        score: 100,
        issueCount: 0,
        recoveredCount: 0,
        certifiedCycles: 1,
        completedCycles: 1
    }));
    const certified = getEndAdenaFreshnessStatus({
        filePath: freshnessPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(certified.ok, true);
    assert.strictEqual(certified.status, 'certified');

    fs.writeFileSync(freshnessPath, JSON.stringify({
        checkedAt: '2026-05-29T12:55:00.000Z',
        ready: true,
        score: 95,
        issueCount: 0,
        recoveredCount: 1,
        certifiedCycles: 0,
        completedCycles: 1
    }));
    const degraded = getEndAdenaFreshnessStatus({
        filePath: freshnessPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(degraded.ok, false);
    assert.strictEqual(degraded.status, 'degraded');

    fs.writeFileSync(freshnessPath, JSON.stringify({
        checkedAt: '2026-05-29T12:55:00.000Z',
        ready: true,
        score: 50,
        issueCount: 1,
        recoveredCount: 0,
        certifiedCycles: 0,
        completedCycles: 1,
        tasks: [{ name: 'reconciliation', status: 'needs-review', needsReview: 2 }]
    }));
    const needsReview = getEndAdenaFreshnessStatus({
        filePath: freshnessPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(needsReview.ok, false);
    assert.strictEqual(needsReview.status, 'needs-review');
    assert.strictEqual(needsReview.missingCount, 0);
    assert.strictEqual(needsReview.reviewRequiredCount, 1);

    const stale = getEndAdenaFreshnessStatus({
        filePath: freshnessPath,
        nowMs: new Date('2026-05-29T14:00:00.000Z').valueOf()
    });
    assert.strictEqual(stale.ok, false);
    assert.strictEqual(stale.status, 'stale');

    const externalSmokePath = path.join(dir, 'external-smoke.json');
    fs.writeFileSync(externalSmokePath, JSON.stringify({
        ok: true,
        checkedAt: '2026-05-29T12:55:00.000Z',
        checkCount: 12,
        failureCount: 0,
        recoveredCount: 1,
        failures: []
    }));
    const externalHealthy = getExternalDependencySmokeStatus({
        filePath: externalSmokePath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(externalHealthy.ok, true);
    assert.strictEqual(externalHealthy.status, 'ok');
    assert.strictEqual(externalHealthy.checkCount, 12);
    assert.strictEqual(externalHealthy.recoveredCount, 1);

    fs.writeFileSync(externalSmokePath, JSON.stringify({
        ok: false,
        checkedAt: '2026-05-29T12:55:00.000Z',
        checkCount: 12,
        failureCount: 1,
        failures: [{ name: 'discord-channel:status', error: 'Missing Access' }]
    }));
    const externalFailed = getExternalDependencySmokeStatus({
        filePath: externalSmokePath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(externalFailed.ok, false);
    assert.strictEqual(externalFailed.status, 'failed');

    const recoveryDrillPath = path.join(dir, 'recovery-drill.json');
    fs.writeFileSync(recoveryDrillPath, JSON.stringify({
        ok: true,
        checkedAt: '2026-05-29T12:55:00.000Z',
        isolated: true,
        scenarioCount: 4,
        failureCount: 0,
        failures: []
    }));
    const recoveryHealthy = getRecoveryDrillStatus({
        filePath: recoveryDrillPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(recoveryHealthy.ok, true);
    assert.strictEqual(recoveryHealthy.status, 'ok');
    assert.strictEqual(recoveryHealthy.scenarioCount, 4);

    fs.writeFileSync(recoveryDrillPath, JSON.stringify({
        ok: false,
        checkedAt: '2026-05-29T12:55:00.000Z',
        isolated: true,
        scenarioCount: 4,
        failureCount: 1,
        failures: [{ name: 'state-backup-fallback', error: 'not recovered' }]
    }));
    const recoveryFailed = getRecoveryDrillStatus({
        filePath: recoveryDrillPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(recoveryFailed.ok, false);
    assert.strictEqual(recoveryFailed.status, 'failed');

    const securityAuditPath = path.join(dir, 'security-audit.json');
    fs.writeFileSync(securityAuditPath, JSON.stringify({
        ok: true,
        checkedAt: '2026-05-29T12:55:00.000Z',
        checkCount: 12,
        criticalCount: 0,
        advisoryCount: 2,
        failures: [],
        advisories: [{ name: 'discord-elevated-permissions' }]
    }));
    const securityAdvisory = getSecurityPostureStatus({
        filePath: securityAuditPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(securityAdvisory.ok, true);
    assert.strictEqual(securityAdvisory.status, 'advisory');
    assert.strictEqual(securityAdvisory.advisoryCount, 2);

    fs.writeFileSync(securityAuditPath, JSON.stringify({
        ok: false,
        checkedAt: '2026-05-29T12:55:00.000Z',
        checkCount: 12,
        criticalCount: 1,
        advisoryCount: 0,
        failures: [{ name: 'secret-file:.env', error: 'permissions too broad' }],
        advisories: []
    }));
    const securityFailed = getSecurityPostureStatus({
        filePath: securityAuditPath,
        nowMs: new Date('2026-05-29T13:00:00.000Z').valueOf()
    });
    assert.strictEqual(securityFailed.ok, false);
    assert.strictEqual(securityFailed.status, 'failed');
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
        externalDependencies: { status: 'ok', checkCount: 12, failureCount: 0, recoveredCount: 1 },
        recoveryDrill: { status: 'ok', scenarioCount: 4, failureCount: 0 },
        securityPosture: { status: 'advisory', checkCount: 12, criticalCount: 0, advisoryCount: 2 },
        endAdenaFreshness: { status: 'certified', score: 100, certifiedCycles: 1, completedCycles: 1, issueCount: 0 },
        errorLog: { exists: true, ageMinutes: 3, recentLines: [] }
    }
});
assert(summary.includes('Ops health: WARN'));
assert(summary.includes('Backups: 5 checked'));
assert(summary.includes('2 reviewed'));
assert(summary.includes('Commands: 38 / 38'));
assert(summary.includes('External: ok, checks=12, failures=0, recovered=1'));
assert(summary.includes('Recovery drill: ok, scenarios=4, failures=0'));
assert(summary.includes('Security: advisory, checks=12, critical=0, advisory=2'));
assert(summary.includes('End Adena: certified, score=100'));

console.log('ops-health-check tests passed');
