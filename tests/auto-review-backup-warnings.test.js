const assert = require('assert');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const {
    autoReviewBackupWarnings,
    parseArgs
} = require('../scripts/auto-review-backup-warnings');
const { auditBackups } = require('../scripts/audit-backups');

async function withTempDir(fn) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'auto-review-backups-'));
    try {
        await fn(dir);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

function createConfig(root) {
    return {
        FILES: {
            BACKUP_DIR: path.join(root, 'backups')
        }
    };
}

(async () => {
    const options = parseArgs(['--dir=tmp-backups', '--data=state.json', '--limit=7', '--json']);
    assert.strictEqual(options.backupDir, 'tmp-backups');
    assert.strictEqual(options.dataFile, 'state.json');
    assert.strictEqual(options.limit, 7);
    assert.strictEqual(options.json, true);

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        const dataFile = path.join(dir, 'attendanceData.json');
        await fsp.mkdir(backupDir, { recursive: true });
        await fsp.writeFile(dataFile, JSON.stringify({ attendanceData: {}, overtimeUsers: [] }));
        await fsp.writeFile(path.join(backupDir, 'attendanceData-2026-06-01-00-00-00-old.json'), JSON.stringify({
            attendanceData: {
                userA: {
                    id: 'userA',
                    name: 'User A',
                    checkedIn: true,
                    dayOff: true,
                    sessions: [{ clockInAt: '2026-06-01T00:00:00.000Z' }]
                }
            },
            overtimeUsers: []
        }));

        const before = auditBackups({
            backupDir,
            config: createConfig(dir),
            reviewedFile: false
        });
        assert.strictEqual(before.warningCount, 2);

        const result = autoReviewBackupWarnings({
            backupDir,
            dataFile,
            reviewedFile: path.join(backupDir, 'backup-audit-reviewed.json')
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.skipped, false);
        assert.strictEqual(result.added, 2);

        const after = auditBackups({
            backupDir,
            config: createConfig(dir)
        });
        assert.strictEqual(after.warningCount, 0);
        assert.strictEqual(after.reviewedIssueCount, 2);
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        const dataFile = path.join(dir, 'attendanceData.json');
        await fsp.mkdir(backupDir, { recursive: true });
        await fsp.writeFile(dataFile, JSON.stringify({ attendanceData: {}, overtimeUsers: [] }));
        await fsp.writeFile(path.join(backupDir, 'attendanceData-2026-06-01-00-00-00-broken.json'), JSON.stringify({
            attendanceData: { userA: { id: 'other-id', sessions: {} } },
            overtimeUsers: {}
        }));

        const before = auditBackups({
            backupDir,
            config: createConfig(dir),
            reviewedFile: false
        });
        assert.strictEqual(before.fatalIssueCount, 3);

        const result = autoReviewBackupWarnings({
            backupDir,
            dataFile,
            reviewedFile: path.join(backupDir, 'backup-audit-reviewed.json')
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.skipped, false);
        assert.strictEqual(result.added, 3);
        assert.strictEqual(result.quarantinedFatalCount, 3);

        const reviewedPayload = JSON.parse(fs.readFileSync(path.join(backupDir, 'backup-audit-reviewed.json'), 'utf8'));
        assert.strictEqual(reviewedPayload.issues.every(issue => issue.quarantined === true), true, 'fatal entries are quarantined');

        const after = auditBackups({
            backupDir,
            config: createConfig(dir)
        });
        assert.strictEqual(after.fatalIssueCount, 0);
        assert.strictEqual(after.reviewedIssueCount, 3);
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        const dataFile = path.join(dir, 'attendanceData.json');
        await fsp.mkdir(backupDir, { recursive: true });
        await fsp.writeFile(dataFile, JSON.stringify({
            attendanceData: {
                userB: {
                    id: 'userB',
                    name: 'User B',
                    checkedIn: true,
                    dayOff: true,
                    sessions: [{ clockInAt: '2026-06-01T00:00:00.000Z' }]
                }
            },
            overtimeUsers: []
        }));
        await fsp.writeFile(path.join(backupDir, 'attendanceData-2026-06-01-00-00-00-old.json'), JSON.stringify({
            attendanceData: {
                userA: {
                    id: 'userA',
                    name: 'User A',
                    checkedIn: true,
                    dayOff: true,
                    sessions: [{ clockInAt: '2026-06-01T00:00:00.000Z' }]
                }
            },
            overtimeUsers: []
        }));

        const result = autoReviewBackupWarnings({
            backupDir,
            dataFile,
            reviewedFile: path.join(backupDir, 'backup-audit-reviewed.json')
        });
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.reason, 'current-state-has-issues');
        assert.strictEqual(fs.existsSync(path.join(backupDir, 'backup-audit-reviewed.json')), false);
    });

    console.log('auto-review-backup-warnings tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
