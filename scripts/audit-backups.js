'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG } = require('../src/config/constants');
const { createDataStore } = require('../src/services/dataStore');
const { auditStateInvariants } = require('./audit-state-invariants');

function parseArgs(argv = []) {
    const options = {
        backupDir: CONFIG.FILES.BACKUP_DIR,
        limit: 20,
        warnOnly: false,
        strictInvariants: false,
        reviewedFile: null
    };

    for (const arg of argv) {
        if (arg === '--all') {
            options.limit = Infinity;
        } else if (arg === '--warn-only') {
            options.warnOnly = true;
        } else if (arg === '--strict-invariants') {
            options.strictInvariants = true;
        } else if (arg === '--no-reviewed') {
            options.reviewedFile = false;
        } else if (arg.startsWith('--dir=')) {
            options.backupDir = arg.slice('--dir='.length);
        } else if (arg.startsWith('--reviewed-file=')) {
            options.reviewedFile = arg.slice('--reviewed-file='.length);
        } else if (/^\d+$/.test(arg)) {
            options.limit = Number(arg);
        }
    }

    return options;
}

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function readBackupJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return { value: JSON.parse(raw), sha256: sha256(raw) };
    } catch (error) {
        return { error };
    }
}

function getDefaultReviewedFile(backupDir) {
    return path.join(backupDir, 'backup-audit-reviewed.json');
}

function loadReviewedBackupIssues(reviewedFile) {
    if (!reviewedFile || !fs.existsSync(reviewedFile)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(reviewedFile, 'utf8'));
        return Array.isArray(parsed?.issues) ? parsed.issues : [];
    } catch (error) {
        return [];
    }
}

function isReviewedIssue(issue, reviewedIssues) {
    if (issue.severity !== 'warning') return false;
    return reviewedIssues.some(reviewed => (
        reviewed
        && reviewed.file === issue.file
        && reviewed.type === issue.type
        && reviewed.message === issue.message
        && reviewed.sha256 === issue.sha256
    ));
}

function splitReviewedIssues(issues, reviewedIssues) {
    const active = [];
    const reviewed = [];
    for (const issue of issues) {
        if (isReviewedIssue(issue, reviewedIssues)) {
            reviewed.push({ ...issue, reviewed: true });
        } else {
            active.push(issue);
        }
    }
    return { active, reviewed };
}

function listBackupFiles(backupDir) {
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
        .filter(name => name.startsWith('attendanceData-') && name.endsWith('.json'))
        .sort()
        .reverse();
}

function auditBackups({
    backupDir = CONFIG.FILES.BACKUP_DIR,
    limit = 20,
    warnOnly = false,
    strictInvariants = false,
    reviewedFile,
    config = CONFIG,
    store = createDataStore({ config })
} = {}) {
    const files = listBackupFiles(backupDir);
    const selected = Number.isFinite(limit) ? files.slice(0, limit) : files;
    const allIssues = [];
    const reviewedIssues = reviewedFile === false
        ? []
        : loadReviewedBackupIssues(reviewedFile || getDefaultReviewedFile(backupDir));

    for (const file of selected) {
        if (!store.isSafeBackupFileName(file)) {
            allIssues.push({ file, severity: 'fatal', type: 'unsafe-name', message: 'backup file name is not restorable' });
            continue;
        }

        const filePath = path.join(backupDir, file);
        const parsed = readBackupJson(filePath);
        if (parsed.error) {
            allIssues.push({ file, severity: 'fatal', type: 'invalid-json', message: parsed.error.message });
            continue;
        }

        const restoreIssues = store.validateRestorableState(parsed.value);
        for (const message of restoreIssues) {
            allIssues.push({ file, sha256: parsed.sha256, severity: 'fatal', type: 'restore-validation', message });
        }
        if (restoreIssues.length) continue;

        const invariantResult = auditStateInvariants(parsed.value);
        for (const issue of invariantResult.issues) {
            allIssues.push({ file, sha256: parsed.sha256, severity: strictInvariants ? 'fatal' : 'warning', type: 'state-invariant', message: issue.type, detail: issue });
        }
    }

    const split = splitReviewedIssues(allIssues, reviewedIssues);
    const issues = split.active;
    const fatalIssueCount = issues.filter(issue => issue.severity === 'fatal').length;
    const warningCount = issues.filter(issue => issue.severity === 'warning').length;

    return {
        backupDir,
        checked: selected.length,
        totalBackups: files.length,
        limit: Number.isFinite(limit) ? limit : 'all',
        warnOnly,
        strictInvariants,
        issueCount: issues.length,
        fatalIssueCount,
        warningCount,
        reviewedIssueCount: split.reviewed.length,
        reviewedIssues: split.reviewed,
        issues
    };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = auditBackups(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.fatalIssueCount > 0 && !options.warnOnly) process.exit(1);
}

if (require.main === module) {
    main();
}

module.exports = {
    auditBackups,
    getDefaultReviewedFile,
    isReviewedIssue,
    loadReviewedBackupIssues,
    parseArgs,
    sha256,
    splitReviewedIssues
};
