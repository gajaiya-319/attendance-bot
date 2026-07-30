'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../src/config/constants');
const {
    auditBackups,
    getDefaultReviewedFile,
    loadReviewedBackupIssues
} = require('./audit-backups');
const { auditStateInvariants } = require('./audit-state-invariants');

function parseArgs(argv = []) {
    const options = {
        backupDir: CONFIG.FILES.BACKUP_DIR,
        dataFile: CONFIG.FILES.DATA,
        limit: 20,
        reason: 'auto-reviewed legacy backup issue after current state passed',
        reviewedFile: null,
        json: false
    };

    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
        } else if (arg.startsWith('--dir=')) {
            options.backupDir = arg.slice('--dir='.length);
        } else if (arg.startsWith('--data=')) {
            options.dataFile = arg.slice('--data='.length);
        } else if (arg.startsWith('--limit=')) {
            options.limit = Number(arg.slice('--limit='.length));
        } else if (arg.startsWith('--reason=')) {
            options.reason = arg.slice('--reason='.length);
        } else if (arg.startsWith('--reviewed-file=')) {
            options.reviewedFile = arg.slice('--reviewed-file='.length);
        }
    }

    return options;
}

function entryKey(entry) {
    return [entry.file, entry.type, entry.message, entry.sha256].join('|');
}

function canAutoQuarantineFatalIssue(issue) {
    return issue?.severity === 'fatal' && ['restore-validation', 'state-invariant'].includes(issue.type);
}

function buildReviewedEntry(issue, reason, reviewedAt) {
    return {
        file: issue.file,
        type: issue.type,
        message: issue.message,
        sha256: issue.sha256,
        severity: issue.severity || 'warning',
        quarantined: canAutoQuarantineFatalIssue(issue),
        reason,
        reviewedAt,
        autoReviewed: true
    };
}

function assertCurrentStateClean(dataFile) {
    if (!dataFile || !fs.existsSync(dataFile)) {
        return { ok: true, skipped: true, issueCount: 0, issues: [] };
    }
    const result = auditStateInvariants(dataFile);
    return {
        ok: result.issueCount === 0,
        skipped: false,
        issueCount: result.issueCount,
        issues: result.issues || []
    };
}

function autoReviewBackupWarnings({
    backupDir = CONFIG.FILES.BACKUP_DIR,
    dataFile = CONFIG.FILES.DATA,
    limit = 20,
    reason = 'auto-reviewed legacy backup warning after current state passed',
    reviewedFile = null
} = {}) {
    const currentState = assertCurrentStateClean(dataFile);
    if (!currentState.ok) {
        return {
            ok: false,
            skipped: true,
            reason: 'current-state-has-issues',
            currentState,
            added: 0,
            fatalIssueCount: 0,
            warningCount: 0
        };
    }

    const audit = auditBackups({
        backupDir,
        limit,
        warnOnly: true,
        reviewedFile: false
    });
    const warnings = (audit.issues || []).filter(issue => issue.severity === 'warning');
    const fatalIssues = (audit.issues || []).filter(issue => issue.severity === 'fatal');
    const quarantinableFatalIssues = fatalIssues.filter(canAutoQuarantineFatalIssue);
    const reviewableIssues = [...warnings, ...quarantinableFatalIssues];
    if (!reviewableIssues.length) {
        return {
            ok: true,
            skipped: true,
            reason: 'no-reviewable-issues',
            currentState,
            added: 0,
            fatalIssueCount: fatalIssues.length,
            warningCount: 0,
            reviewedFile: reviewedFile || getDefaultReviewedFile(backupDir)
        };
    }

    const targetReviewedFile = reviewedFile || getDefaultReviewedFile(backupDir);
    const existing = loadReviewedBackupIssues(targetReviewedFile);
    const byKey = new Map(existing.map(entry => [entryKey(entry), entry]));
    const reviewedAt = new Date().toISOString();
    let added = 0;

    for (const issue of reviewableIssues) {
        const entry = buildReviewedEntry(issue, reason, reviewedAt);
        const key = entryKey(entry);
        if (!byKey.has(key)) added += 1;
        byKey.set(key, entry);
    }

    fs.mkdirSync(path.dirname(targetReviewedFile), { recursive: true });
    const payload = {
        version: 1,
        updatedAt: reviewedAt,
        issues: Array.from(byKey.values()).sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
    };
    fs.writeFileSync(targetReviewedFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    return {
        ok: true,
        skipped: false,
        reviewedFile: targetReviewedFile,
        added,
        totalReviewed: payload.issues.length,
        fatalIssueCount: fatalIssues.length,
        quarantinedFatalCount: quarantinableFatalIssues.length,
        warningCount: warnings.length,
        currentState
    };
}

function formatResult(result) {
    if (!result.ok) {
        return [
            'Backup warning auto-review skipped.',
            `Reason: ${result.reason}`,
            `Current state issues: ${result.currentState?.issueCount || 0}`
        ].join('\n');
    }
    if (result.skipped) {
        return [
            'Backup warning auto-review skipped.',
            `Reason: ${result.reason}`,
            `Fatal backup issues still visible: ${result.fatalIssueCount || 0}`
        ].join('\n');
    }
    return [
        'Backup warning auto-review complete.',
        `Added: ${result.added}`,
        `Total reviewed: ${result.totalReviewed}`,
        `Quarantined fatal issues: ${result.quarantinedFatalCount || 0}`,
        `Fatal backup issues before review: ${result.fatalIssueCount || 0}`,
        `Reviewed file: ${result.reviewedFile}`
    ].join('\n');
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = autoReviewBackupWarnings(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : formatResult(result));
    if (!result.ok) process.exit(1);
}

if (require.main === module) {
    main();
}

module.exports = {
    assertCurrentStateClean,
    autoReviewBackupWarnings,
    buildReviewedEntry,
    formatResult,
    parseArgs
};
