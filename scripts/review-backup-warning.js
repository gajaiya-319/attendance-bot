'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../src/config/constants');
const {
    auditBackups,
    getDefaultReviewedFile,
    loadReviewedBackupIssues
} = require('./audit-backups');

function parseArgs(argv = []) {
    const options = {
        backupDir: CONFIG.FILES.BACKUP_DIR,
        file: null,
        reason: 'reviewed legacy backup warning',
        limit: 20,
        reviewedFile: null
    };

    for (const arg of argv) {
        if (arg.startsWith('--dir=')) {
            options.backupDir = arg.slice('--dir='.length);
        } else if (arg.startsWith('--file=')) {
            options.file = arg.slice('--file='.length);
        } else if (arg.startsWith('--reason=')) {
            options.reason = arg.slice('--reason='.length);
        } else if (arg.startsWith('--limit=')) {
            options.limit = Number(arg.slice('--limit='.length));
        } else if (arg.startsWith('--reviewed-file=')) {
            options.reviewedFile = arg.slice('--reviewed-file='.length);
        }
    }

    return options;
}

function entryKey(entry) {
    return [entry.file, entry.type, entry.message, entry.sha256].join('|');
}

function reviewBackupWarning({
    backupDir = CONFIG.FILES.BACKUP_DIR,
    file,
    reason = 'reviewed legacy backup warning',
    limit = 20,
    reviewedFile
} = {}) {
    if (!file) throw new Error('Missing --file=<backup-file>');
    const targetReviewedFile = reviewedFile || getDefaultReviewedFile(backupDir);

    const result = auditBackups({
        backupDir,
        limit,
        warnOnly: true,
        reviewedFile: false
    });
    const targetWarnings = result.issues.filter(issue => issue.severity === 'warning' && issue.file === file);
    if (!targetWarnings.length) {
        throw new Error(`No active warning found for ${file}`);
    }

    const existing = loadReviewedBackupIssues(targetReviewedFile);
    const byKey = new Map(existing.map(entry => [entryKey(entry), entry]));
    const reviewedAt = new Date().toISOString();
    for (const issue of targetWarnings) {
        const entry = {
            file: issue.file,
            type: issue.type,
            message: issue.message,
            sha256: issue.sha256,
            reason,
            reviewedAt
        };
        byKey.set(entryKey(entry), entry);
    }

    fs.mkdirSync(path.dirname(targetReviewedFile), { recursive: true });
    const payload = {
        version: 1,
        issues: Array.from(byKey.values()).sort((a, b) => entryKey(a).localeCompare(entryKey(b)))
    };
    fs.writeFileSync(targetReviewedFile, `${JSON.stringify(payload, null, 2)}\n`);

    return {
        reviewedFile: targetReviewedFile,
        added: targetWarnings.length,
        totalReviewed: payload.issues.length,
        warnings: targetWarnings
    };
}

function main() {
    try {
        const result = reviewBackupWarning(parseArgs(process.argv.slice(2)));
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    parseArgs,
    reviewBackupWarning
};
