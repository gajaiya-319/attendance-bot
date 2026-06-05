'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { auditStateInvariants } = require('./audit-state-invariants');
const { auditBackups } = require('./audit-backups');
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
        json: false
    };

    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
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
        !checks.commandRegistration.ok && pm2.available
    ].some(Boolean);
    const warning = [
        !pm2.available,
        checks.backups.warningCount > 0,
        !checks.errorLog.ok
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
            runtimeHealthFile: settings.runtimeHealthFile
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
    readLogLines,
    runOpsHealthCheck,
    formatHealthSummary
};
