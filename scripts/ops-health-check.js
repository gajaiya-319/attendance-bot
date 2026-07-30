'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { auditStateInvariants } = require('./audit-state-invariants');
const { auditBackups } = require('./audit-backups');
const { autoReviewBackupWarnings } = require('./auto-review-backup-warnings');
const { auditEmbedFields } = require('./audit-embed-fields');
const { auditStateWrites } = require('./audit-state-writes');
const { buildCommandDefinitions, hiddenCommandAliases } = require('../src/commands/definitions');

function parseArgs(argv = []) {
    const options = {
        processName: 'attendance-bot',
        dataFile: 'attendanceData.json',
        maxErrorLogAgeMinutes: 5,
        backupLimit: 20,
        expectedCommandCount: null,
        runtimeHealthFile: 'logs/runtime-health.json',
        pendingAttendanceFile: 'logs/raw-attendance-pending.json',
        payrollIntegrityFile: 'logs/payroll-integrity-audit-state.json',
        endAdenaFreshnessFile: 'logs/end-adena-freshness.json',
        externalSmokeFile: 'logs/external-dependency-smoke.json',
        recoveryDrillFile: 'logs/recovery-drill.json',
        securityAuditFile: 'logs/security-posture-audit.json',
        allowEndAdenaDegraded: false,
        json: false
    };

    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
        } else if (arg === '--allow-end-adena-degraded') {
            options.allowEndAdenaDegraded = true;
        } else if (arg.startsWith('--process=')) {
            options.processName = arg.slice('--process='.length);
        } else if (arg.startsWith('--data=')) {
            options.dataFile = arg.slice('--data='.length);
        } else if (arg.startsWith('--error-log-age-min=')) {
            options.maxErrorLogAgeMinutes = Number(arg.slice('--error-log-age-min='.length));
        } else if (arg.startsWith('--backup-limit=')) {
            options.backupLimit = Number(arg.slice('--backup-limit='.length));
        } else if (arg.startsWith('--expected-command-count=')) {
            options.expectedCommandCount = Number(arg.slice('--expected-command-count='.length));
        } else if (arg.startsWith('--runtime-health-file=')) {
            options.runtimeHealthFile = arg.slice('--runtime-health-file='.length);
        } else if (arg.startsWith('--end-adena-freshness-file=')) {
            options.endAdenaFreshnessFile = arg.slice('--end-adena-freshness-file='.length);
        } else if (arg.startsWith('--external-smoke-file=')) {
            options.externalSmokeFile = arg.slice('--external-smoke-file='.length);
        } else if (arg.startsWith('--recovery-drill-file=')) {
            options.recoveryDrillFile = arg.slice('--recovery-drill-file='.length);
        } else if (arg.startsWith('--security-audit-file=')) {
            options.securityAuditFile = arg.slice('--security-audit-file='.length);
        }
    }

    return options;
}

function quoteWinShellArg(value) {
    return `"${String(value).replace(/"/g, '\\"')}"`;
}

function runCapture(command, args) {
    try {
        const commandLine = [command, ...args].map(quoteWinShellArg).join(' ');
        return {
            ok: true,
            stdout: process.platform === 'win32'
                ? execFileSync(commandLine, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true })
                : execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message,
            stdout: error.stdout ? String(error.stdout) : '',
            stderr: error.stderr ? String(error.stderr) : ''
        };
    }
}

function getPm2ProcessStatus(processName) {
    const pm2Command = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
    const result = runCapture(pm2Command, ['jlist']);
    if (!result.ok) {
        return { available: false, ok: false, status: 'unavailable', error: result.error };
    }

    try {
        const processes = JSON.parse(result.stdout || '[]');
        const process = processes.find(entry => entry.name === processName);
        if (!process) return { available: true, ok: false, status: 'missing', error: `${processName} not found` };
        const status = process.pm2_env?.status || 'unknown';
        return {
            available: true,
            ok: status === 'online',
            status,
            pid: process.pid || null,
            restarts: process.pm2_env?.restart_time ?? null,
            uptimeMs: process.pm2_env?.pm_uptime ? Date.now() - process.pm2_env.pm_uptime : null
        };
    } catch (error) {
        return { available: true, ok: false, status: 'parse-error', error: error.message };
    }
}

function defaultPm2LogPath(processName, stream) {
    return path.join(os.homedir(), '.pm2', 'logs', `${processName}-${stream}.log`);
}

function getLogFreshness(filePath, maxAgeMinutes, nowMs = Date.now()) {
    if (!fs.existsSync(filePath)) {
        return { exists: false, ok: true, path: filePath, ageMinutes: null, mtime: null };
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
        return {
            exists: true,
            empty: true,
            ok: true,
            path: filePath,
            ageMinutes: null,
            mtime: stat.mtime.toISOString()
        };
    }
    const ageMinutes = Math.max(0, Math.round((nowMs - stat.mtimeMs) / 60000));
    return {
        exists: true,
        empty: false,
        ok: ageMinutes > maxAgeMinutes,
        path: filePath,
        ageMinutes,
        mtime: stat.mtime.toISOString()
    };
}

function readRecentErrorLines(filePath, maxLines = 8) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-maxLines);
}

function readLogLines(filePath, maxLines = 300) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-maxLines);
}

function getExpectedGuildCommandCount() {
    return buildCommandDefinitions()
        .filter(command => !hiddenCommandAliases.has(command.name || command.toJSON?.().name))
        .length;
}

function readRuntimeHealthFile(runtimeHealthFile) {
    if (!runtimeHealthFile || !fs.existsSync(runtimeHealthFile)) return null;
    try {
        return JSON.parse(fs.readFileSync(runtimeHealthFile, 'utf8'));
    } catch (error) {
        return { parseError: error.message };
    }
}

function readJsonFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return { parseError: error.message };
    }
}

function getExternalDependencySmokeStatus({
    filePath = 'logs/external-dependency-smoke.json',
    maxAgeHours = 26,
    nowMs = Date.now()
} = {}) {
    const state = readJsonFile(filePath);
    if (!state) {
        return { available: false, ok: true, status: 'monitoring', checkedAt: null, checkCount: 0, failureCount: 0, recoveredCount: 0 };
    }
    if (state.parseError) {
        return { available: true, ok: false, status: 'invalid', checkedAt: null, checkCount: 0, failureCount: 1, recoveredCount: 0, error: state.parseError };
    }
    const checkedAtMs = new Date(state.checkedAt || 0).getTime();
    const ageHours = Number.isFinite(checkedAtMs) && checkedAtMs > 0
        ? Math.max(0, (nowMs - checkedAtMs) / (60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
    const stale = ageHours > Math.max(1, Number(maxAgeHours || 26));
    const failureCount = Number(state.failureCount || 0);
    const ok = state.ok === true && failureCount === 0 && !stale;
    return {
        available: true,
        ok,
        status: stale ? 'stale' : (ok ? 'ok' : 'failed'),
        checkedAt: state.checkedAt || null,
        ageHours,
        checkCount: Number(state.checkCount || 0),
        failureCount,
        recoveredCount: Number(state.recoveredCount || 0),
        failures: Array.isArray(state.failures) ? state.failures.slice(0, 10) : []
    };
}

function getRecoveryDrillStatus({
    filePath = 'logs/recovery-drill.json',
    maxAgeHours = 26,
    nowMs = Date.now()
} = {}) {
    const state = readJsonFile(filePath);
    if (!state) {
        return { available: false, ok: true, status: 'monitoring', checkedAt: null, scenarioCount: 0, failureCount: 0 };
    }
    if (state.parseError) {
        return { available: true, ok: false, status: 'invalid', checkedAt: null, scenarioCount: 0, failureCount: 1, error: state.parseError };
    }
    const checkedAtMs = new Date(state.checkedAt || 0).getTime();
    const ageHours = Number.isFinite(checkedAtMs) && checkedAtMs > 0
        ? Math.max(0, (nowMs - checkedAtMs) / (60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
    const stale = ageHours > Math.max(1, Number(maxAgeHours || 26));
    const failureCount = Number(state.failureCount || 0);
    const isolated = state.isolated === true;
    const ok = state.ok === true && isolated && failureCount === 0 && !stale;
    return {
        available: true,
        ok,
        status: stale ? 'stale' : (ok ? 'ok' : 'failed'),
        checkedAt: state.checkedAt || null,
        ageHours,
        isolated,
        scenarioCount: Number(state.scenarioCount || 0),
        failureCount,
        failures: Array.isArray(state.failures) ? state.failures.slice(0, 10) : []
    };
}

function getSecurityPostureStatus({
    filePath = 'logs/security-posture-audit.json',
    maxAgeHours = 26,
    nowMs = Date.now()
} = {}) {
    const state = readJsonFile(filePath);
    if (!state) {
        return { available: false, ok: true, status: 'monitoring', checkedAt: null, checkCount: 0, criticalCount: 0, advisoryCount: 0 };
    }
    if (state.parseError) {
        return { available: true, ok: false, status: 'invalid', checkedAt: null, checkCount: 0, criticalCount: 1, advisoryCount: 0, error: state.parseError };
    }
    const checkedAtMs = new Date(state.checkedAt || 0).getTime();
    const ageHours = Number.isFinite(checkedAtMs) && checkedAtMs > 0
        ? Math.max(0, (nowMs - checkedAtMs) / (60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
    const stale = ageHours > Math.max(1, Number(maxAgeHours || 26));
    const criticalCount = Number(state.criticalCount || 0);
    const advisoryCount = Number(state.advisoryCount || 0);
    const ok = state.ok === true && criticalCount === 0 && !stale;
    return {
        available: true,
        ok,
        status: stale ? 'stale' : (ok ? (advisoryCount ? 'advisory' : 'ok') : 'failed'),
        checkedAt: state.checkedAt || null,
        ageHours,
        checkCount: Number(state.checkCount || 0),
        criticalCount,
        advisoryCount,
        failures: Array.isArray(state.failures) ? state.failures.slice(0, 10) : [],
        advisories: Array.isArray(state.advisories) ? state.advisories.slice(0, 10) : []
    };
}

function getDataConsistencyStatus({
    pendingAttendanceFile = 'logs/raw-attendance-pending.json',
    payrollIntegrityFile = 'logs/payroll-integrity-audit-state.json',
    runtimeHealthFile = 'logs/runtime-health.json',
    nowMs = Date.now()
} = {}) {
    const pending = readJsonFile(pendingAttendanceFile);
    const pendingItems = Array.isArray(pending) ? pending : (Array.isArray(pending?.items) ? pending.items : []);
    const payroll = readJsonFile(payrollIntegrityFile);
    const runtime = readRuntimeHealthFile(runtimeHealthFile);
    const payrollLastRunMs = new Date(payroll?.lastRunAt || 0).valueOf();
    const payrollAgeHours = Number.isFinite(payrollLastRunMs) && payrollLastRunMs > 0
        ? Math.max(0, Math.round((nowMs - payrollLastRunMs) / 3_600_000))
        : null;
    return {
        rawAttendancePending: pendingItems.length,
        rawAttendanceNeedsReview: pendingItems.filter(item => item?.reviewNotifiedAt).length,
        payrollAuditAvailable: Boolean(payroll && !payroll.parseError),
        payrollAuditIssues: Number(payroll?.issueCount || 0),
        payrollAuditAgeHours: payrollAgeHours,
        payrollAuditStale: payrollAgeHours !== null && payrollAgeHours > 36,
        queueAvailable: Boolean(runtime?.backgroundQueue),
        queuePending: Number(runtime?.backgroundQueue?.pending || 0),
        queueFailed: Number(runtime?.backgroundQueue?.failed || 0),
        maxEventLoopLagMs: Number(runtime?.backgroundQueue?.maxEventLoopLagMs || 0)
    };
}

function getEndAdenaFreshnessStatus({
    filePath = 'logs/end-adena-freshness.json',
    nowMs = Date.now(),
    maxAgeMinutes = 15
} = {}) {
    const state = readJsonFile(filePath);
    if (!state) {
        return {
            available: false,
            ok: true,
            ready: false,
            status: 'monitoring',
            score: null,
            ageMinutes: null,
            issueCount: 0,
            recoveredCount: 0,
            certifiedCycles: 0,
            completedCycles: 0
        };
    }
    if (state.parseError) {
        return {
            available: true,
            ok: false,
            ready: true,
            status: 'invalid',
            score: null,
            ageMinutes: null,
            issueCount: 1,
            recoveredCount: 0,
            certifiedCycles: 0,
            completedCycles: 0,
            error: state.parseError
        };
    }

    const checkedAtMs = new Date(state.checkedAt || 0).valueOf();
    const ageMinutes = Number.isFinite(checkedAtMs) && checkedAtMs > 0
        ? Math.max(0, Math.round((nowMs - checkedAtMs) / 60_000))
        : null;
    const stale = ageMinutes === null || ageMinutes > maxAgeMinutes;
    const ready = Boolean(state.ready);
    const score = Number.isFinite(Number(state.score)) ? Number(state.score) : null;
    const issueCount = Number(state.issueCount || 0);
    const recoveredCount = Number(state.recoveredCount || 0);
    const reviewRequiredCount = Array.isArray(state.tasks)
        ? state.tasks.filter(task => task?.status === 'needs-review').length
        : 0;
    const missingCount = Array.isArray(state.tasks)
        ? state.tasks.filter(task => task?.status === 'missing').length
        : Math.max(0, issueCount - reviewRequiredCount);
    const certifiedCycles = Number(state.certifiedCycles || 0);
    const completedCycles = Number(state.completedCycles || 0);
    const certified = ready && score === 100 && issueCount === 0 && recoveredCount === 0;
    const ok = !stale && (!ready || certified);
    let status = 'monitoring';
    if (stale) status = 'stale';
    else if (certified) status = 'certified';
    else if (ready && reviewRequiredCount > 0 && missingCount === 0) status = 'needs-review';
    else if (ready && issueCount > 0) status = 'failed';
    else if (ready) status = 'degraded';

    return {
        available: true,
        ok,
        ready,
        status,
        score,
        checkedAt: state.checkedAt || null,
        monitoringStartedAt: state.monitoringStartedAt || null,
        ageMinutes,
        issueCount,
        missingCount,
        reviewRequiredCount,
        recoveredCount,
        certifiedCycles,
        completedCycles
    };
}

function getCommandRegistrationStatus(outLogPath, expectedCount = getExpectedGuildCommandCount(), {
    runtimeHealthFile = null,
    pm2Pid = null
} = {}) {
    const runtimeHealth = readRuntimeHealthFile(runtimeHealthFile);
    if (runtimeHealth) {
        const registeredCount = runtimeHealth.commandRegister?.count ?? null;
        const runtimePid = runtimeHealth.pid ?? null;
        const stale = Boolean(pm2Pid && runtimePid && Number(runtimePid) !== Number(pm2Pid));
        const error = runtimeHealth.parseError
            || (stale ? `runtime health pid ${runtimePid} does not match pm2 pid ${pm2Pid}` : null)
            || runtimeHealth.commandRegister?.error
            || null;
        return {
            exists: true,
            source: 'runtime-health',
            ok: !error && registeredCount === expectedCount,
            expectedCount,
            registeredCount,
            runtimePid,
            stage: runtimeHealth.stage || null,
            at: runtimeHealth.at || null,
            line: null,
            error
        };
    }

    if (!fs.existsSync(outLogPath)) {
        return { exists: false, source: 'out-log', ok: false, expectedCount, registeredCount: null, error: 'out log not found' };
    }

    const lines = readLogLines(outLogPath);
    const lastStartIndex = Math.max(
        lines.findLastIndex?.(line => line.includes('ATTENDANCE BOT ONLINE')) ?? -1,
        lines.findLastIndex?.(line => line.includes('Started :')) ?? -1
    );
    const searchStart = lastStartIndex >= 0 ? lastStartIndex : 0;
    const recent = lines.slice(searchStart);
    const registerLine = [...recent].reverse().find(line => line.includes('[COMMAND REGISTER]'));
    const match = registerLine ? registerLine.match(/Registered\s+(\d+)\s+guild commands/i) : null;
    const registeredCount = match ? Number(match[1]) : null;

    return {
        exists: true,
        source: 'out-log',
        ok: registeredCount === expectedCount,
        expectedCount,
        registeredCount,
        line: registerLine || null,
        error: registerLine ? null : 'command register log not found after latest startup'
    };
}

function buildStatus(ok, warning = false) {
    if (!ok) return 'fail';
    if (warning) return 'warn';
    return 'ok';
}

function runOpsHealthCheck(options = {}) {
    const settings = { ...parseArgs([]), ...options };
    const stateAudit = fs.existsSync(settings.dataFile)
        ? auditStateInvariants(settings.dataFile)
        : { skipped: true, issueCount: 0, issues: [] };
    const stateWriteFindings = auditStateWrites();
    let backupAutoReview = null;
    try {
        backupAutoReview = autoReviewBackupWarnings({
            dataFile: settings.dataFile,
            limit: settings.backupLimit
        });
    } catch (error) {
        backupAutoReview = {
            ok: false,
            skipped: true,
            reason: 'auto-review-error',
            error: error?.message || String(error)
        };
    }
    const backupAudit = auditBackups({ limit: settings.backupLimit, warnOnly: true });
    const embedFindings = auditEmbedFields();
    const pm2 = getPm2ProcessStatus(settings.processName);
    const errorLogPath = settings.errorLogPath || defaultPm2LogPath(settings.processName, 'error');
    const outLogPath = settings.outLogPath || defaultPm2LogPath(settings.processName, 'out');
    const errorLog = getLogFreshness(errorLogPath, settings.maxErrorLogAgeMinutes);
    const commandRegistration = getCommandRegistrationStatus(
        outLogPath,
        settings.expectedCommandCount || getExpectedGuildCommandCount(),
        { runtimeHealthFile: settings.runtimeHealthFile, pm2Pid: pm2.pid }
    );
    const consistency = getDataConsistencyStatus({
        pendingAttendanceFile: settings.pendingAttendanceFile,
        payrollIntegrityFile: settings.payrollIntegrityFile,
        runtimeHealthFile: settings.runtimeHealthFile
    });
    const endAdenaFreshness = getEndAdenaFreshnessStatus({
        filePath: settings.endAdenaFreshnessFile
    });
    const externalDependencies = getExternalDependencySmokeStatus({
        filePath: settings.externalSmokeFile
    });
    const recoveryDrill = getRecoveryDrillStatus({
        filePath: settings.recoveryDrillFile
    });
    const securityPosture = getSecurityPostureStatus({
        filePath: settings.securityAuditFile
    });

    const checks = {
        pm2,
        state: {
            ok: stateAudit.issueCount === 0,
            skipped: Boolean(stateAudit.skipped),
            issueCount: stateAudit.issueCount,
            issues: stateAudit.issues
        },
        stateWrites: {
            ok: stateWriteFindings.length === 0,
            findingCount: stateWriteFindings.length,
            findings: stateWriteFindings
        },
        backups: {
            ok: backupAudit.fatalIssueCount === 0,
            autoReview: backupAutoReview,
            warningCount: backupAudit.warningCount,
            fatalIssueCount: backupAudit.fatalIssueCount,
            reviewedIssueCount: backupAudit.reviewedIssueCount || 0,
            checked: backupAudit.checked,
            issues: backupAudit.issues
        },
        embeds: {
            ok: embedFindings.length === 0,
            findingCount: embedFindings.length,
            findings: embedFindings
        },
        commandRegistration,
        consistency,
        endAdenaFreshness,
        externalDependencies,
        recoveryDrill,
        securityPosture,
        errorLog: {
            ...errorLog,
            recentLines: errorLog.ok ? [] : readRecentErrorLines(errorLogPath)
        }
    };

    const failed = [
        !pm2.ok && pm2.available,
        !checks.state.ok,
        !checks.stateWrites.ok,
        !checks.backups.ok,
        !checks.embeds.ok,
        !checks.commandRegistration.ok && pm2.available,
        checks.externalDependencies.available && !checks.externalDependencies.ok,
        checks.recoveryDrill.available && !checks.recoveryDrill.ok,
        checks.securityPosture.available && !checks.securityPosture.ok,
        ['invalid', 'stale', 'failed'].includes(checks.endAdenaFreshness.status),
        checks.endAdenaFreshness.status === 'degraded' && !settings.allowEndAdenaDegraded
    ].some(Boolean);
    const warning = [
        !pm2.available,
        !checks.externalDependencies.available,
        !checks.recoveryDrill.available,
        !checks.securityPosture.available,
        checks.backups.warningCount > 0,
        !checks.errorLog.ok,
        checks.endAdenaFreshness.status === 'degraded' && settings.allowEndAdenaDegraded
    ].some(Boolean);

    return {
        status: buildStatus(!failed, warning),
        checkedAt: new Date().toISOString(),
        settings: {
            processName: settings.processName,
            dataFile: settings.dataFile,
            backupLimit: settings.backupLimit,
            maxErrorLogAgeMinutes: settings.maxErrorLogAgeMinutes,
            expectedCommandCount: settings.expectedCommandCount || getExpectedGuildCommandCount(),
            runtimeHealthFile: settings.runtimeHealthFile,
            endAdenaFreshnessFile: settings.endAdenaFreshnessFile,
            externalSmokeFile: settings.externalSmokeFile,
            recoveryDrillFile: settings.recoveryDrillFile,
            securityAuditFile: settings.securityAuditFile,
            allowEndAdenaDegraded: settings.allowEndAdenaDegraded
        },
        checks
    };
}

function formatHealthSummary(result) {
    const lines = [
        `Ops health: ${result.status.toUpperCase()}`,
        `Checked at: ${result.checkedAt}`,
        `PM2: ${result.checks.pm2.status}${result.checks.pm2.pid ? ` pid=${result.checks.pm2.pid}` : ''}`,
        `State: ${result.checks.state.skipped ? 'skipped' : `${result.checks.state.issueCount} issue(s)`}`,
        `State writes: ${result.checks.stateWrites.findingCount} finding(s)`,
        `Backups: ${result.checks.backups.checked} checked, ${result.checks.backups.fatalIssueCount} fatal, ${result.checks.backups.warningCount} warning(s), ${result.checks.backups.reviewedIssueCount || 0} reviewed`,
        `Embeds: ${result.checks.embeds.findingCount} finding(s)`,
        `Commands: ${result.checks.commandRegistration.registeredCount ?? 'missing'} / ${result.checks.commandRegistration.expectedCount} (${result.checks.commandRegistration.source})`,
        `Consistency: attendance pending=${result.checks.consistency?.rawAttendancePending || 0}, payroll issues=${result.checks.consistency?.payrollAuditIssues || 0}, background pending=${result.checks.consistency?.queuePending || 0}, max lag=${result.checks.consistency?.maxEventLoopLagMs || 0}ms`,
        `External: ${result.checks.externalDependencies?.status || 'missing'}, checks=${result.checks.externalDependencies?.checkCount || 0}, failures=${result.checks.externalDependencies?.failureCount || 0}, recovered=${result.checks.externalDependencies?.recoveredCount || 0}`,
        `Recovery drill: ${result.checks.recoveryDrill?.status || 'missing'}, scenarios=${result.checks.recoveryDrill?.scenarioCount || 0}, failures=${result.checks.recoveryDrill?.failureCount || 0}`,
        `Security: ${result.checks.securityPosture?.status || 'missing'}, checks=${result.checks.securityPosture?.checkCount || 0}, critical=${result.checks.securityPosture?.criticalCount || 0}, advisory=${result.checks.securityPosture?.advisoryCount || 0}`,
        `End Adena: ${result.checks.endAdenaFreshness?.status || 'missing'}, score=${result.checks.endAdenaFreshness?.score ?? 'monitoring'}, cycles=${result.checks.endAdenaFreshness?.certifiedCycles || 0}/${result.checks.endAdenaFreshness?.completedCycles || 0}, missing=${result.checks.endAdenaFreshness?.missingCount || 0}, review=${result.checks.endAdenaFreshness?.reviewRequiredCount || 0}`,
        `Error log: ${result.checks.errorLog.exists ? (result.checks.errorLog.empty ? 'empty' : `${result.checks.errorLog.ageMinutes} min old`) : 'missing'}`
    ];

    if (result.checks.errorLog.recentLines.length) {
        lines.push('Recent error log lines:');
        lines.push(...result.checks.errorLog.recentLines.map(line => `  ${line}`));
    }

    return lines.join('\n');
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = runOpsHealthCheck(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : formatHealthSummary(result));
    if (result.status === 'fail') process.exit(1);
}

if (require.main === module) {
    main();
}

module.exports = {
    parseArgs,
    getCommandRegistrationStatus,
    getExpectedGuildCommandCount,
    getLogFreshness,
    readRuntimeHealthFile,
    getDataConsistencyStatus,
    getEndAdenaFreshnessStatus,
    getExternalDependencySmokeStatus,
    getRecoveryDrillStatus,
    getSecurityPostureStatus,
    readLogLines,
    runOpsHealthCheck,
    formatHealthSummary
};
