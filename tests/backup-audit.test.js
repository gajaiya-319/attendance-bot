const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const fsSync = require('fs');
const { auditBackups, parseArgs } = require('../scripts/audit-backups');
const { reviewBackupWarning } = require('../scripts/review-backup-warning');

async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attendance-backup-audit-'));
    try {
        await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

function createConfig(dir) {
    return {
        TIMEZONE: 'Asia/Manila',
        DAY_CHAN: 'day-channel',
        NIGHT_CHAN: 'night-channel',
        FILES: {
            DATA: path.join(dir, 'attendanceData.json'),
            BACKUP: path.join(dir, 'attendanceData.json.bak'),
            BACKUP_DIR: path.join(dir, 'backups'),
            MAX_BACKUPS: 10
        }
    };
}

(async () => {
    assert.deepStrictEqual(parseArgs(['--dir=/tmp/backups', '--all', '--warn-only']), {
        backupDir: '/tmp/backups',
        limit: Infinity,
        warnOnly: true,
        strictInvariants: false,
        reviewedFile: null
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(path.join(backupDir, 'attendanceData-2026-05-21-22-00-00-valid.json'), JSON.stringify({
            attendanceData: { userA: { id: 'userA', name: 'User A', checkedIn: false, sessions: [] } },
            overtimeUsers: [],
            dayOffReservations: {},
            liveExceptions: {}
        }));

        const result = auditBackups({
            backupDir,
            config: createConfig(dir)
        });

        assert.strictEqual(result.checked, 1, 'valid backup is checked');
        assert.strictEqual(result.issueCount, 0, 'valid backup has no issues');
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(path.join(backupDir, 'attendanceData-2026-05-21-22-00-00-invalid-json.json'), '{');
        await fs.writeFile(path.join(backupDir, 'attendanceData-2026-05-21-22-00-01-invalid-state.json'), JSON.stringify({
            attendanceData: { userA: { id: 'other-id', sessions: {} } },
            overtimeUsers: {}
        }));
        await fs.writeFile(path.join(backupDir, 'attendanceData-2026-05-21-22-00-02-invariant.json'), JSON.stringify({
            attendanceData: { userB: { id: 'userB', name: 'User B', checkedIn: true, dayOff: true, sessions: [{ clockInAt: 'x' }] } },
            overtimeUsers: []
        }));

        const result = auditBackups({
            backupDir,
            limit: Infinity,
            config: createConfig(dir)
        });
        const types = result.issues.map(issue => issue.type);

        assert.strictEqual(result.checked, 3, 'all backups are checked');
        assert.strictEqual(result.fatalIssueCount, 4, 'invalid JSON and restore validation issues are fatal');
        assert.strictEqual(result.warningCount, 2, 'state invariant issues are warnings by default');
        assert(types.includes('invalid-json'), 'invalid JSON is reported');
        assert(types.includes('restore-validation'), 'restore validation issue is reported');
        assert(types.includes('state-invariant'), 'state invariant issue is reported');
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.writeFile(path.join(backupDir, 'attendanceData-2026-05-21-22-00-00-invariant.json'), JSON.stringify({
            attendanceData: { userB: { id: 'userB', name: 'User B', checkedIn: true, dayOff: true, sessions: [{ clockInAt: 'x' }] } },
            overtimeUsers: []
        }));

        const result = auditBackups({
            backupDir,
            strictInvariants: true,
            config: createConfig(dir)
        });

        assert.strictEqual(result.fatalIssueCount, 2, 'strict invariant mode treats state invariant issues as fatal');
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        const file = 'attendanceData-2026-05-21-22-00-00-reviewed.json';
        const payload = JSON.stringify({
            attendanceData: { userB: { id: 'userB', name: 'User B', checkedIn: true, dayOff: true, sessions: [{ clockInAt: 'x' }] } },
            overtimeUsers: []
        });
        await fs.writeFile(path.join(backupDir, file), payload);
        const first = auditBackups({
            backupDir,
            config: createConfig(dir)
        });
        assert.strictEqual(first.warningCount, 2, 'unreviewed invariant warnings are counted');

        const reviewedFile = path.join(backupDir, 'backup-audit-reviewed.json');
        await fs.writeFile(reviewedFile, JSON.stringify({
            issues: first.issues.map(issue => ({
                file: issue.file,
                type: issue.type,
                message: issue.message,
                sha256: issue.sha256,
                reason: 'known pre-repair backup'
            }))
        }, null, 2));

        const reviewed = auditBackups({
            backupDir,
            config: createConfig(dir)
        });
        assert.strictEqual(reviewed.warningCount, 0, 'reviewed warnings are excluded from active warning count');
        assert.strictEqual(reviewed.reviewedIssueCount, 2, 'reviewed warnings are still reported separately');
    });

    await withTempDir(async dir => {
        const backupDir = path.join(dir, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        const file = 'attendanceData-2026-05-21-22-00-00-review-script.json';
        await fs.writeFile(path.join(backupDir, file), JSON.stringify({
            attendanceData: { userB: { id: 'userB', name: 'User B', checkedIn: true, dayOff: true, sessions: [{ clockInAt: 'x' }] } },
            overtimeUsers: []
        }));

        const review = reviewBackupWarning({
            backupDir,
            file,
            reason: 'test review',
            config: createConfig(dir)
        });
        assert.strictEqual(review.added, 2, 'review helper records matching warnings');

        const reviewed = auditBackups({
            backupDir,
            config: createConfig(dir)
        });
        assert.strictEqual(reviewed.warningCount, 0, 'review helper suppresses active warnings');
        assert.strictEqual(reviewed.reviewedIssueCount, 2, 'review helper keeps reviewed warnings visible');
    });

    await withTempDir(async dir => {
        const missingDir = path.join(dir, 'missing-backups');
        const result = auditBackups({
            backupDir: missingDir,
            config: createConfig(dir)
        });

        assert.strictEqual(fsSync.existsSync(missingDir), false, 'test starts without backup dir');
        assert.strictEqual(result.checked, 0, 'missing backup dir is not an error');
        assert.strictEqual(result.issueCount, 0, 'missing backup dir has no issues');
    });

    console.log('backup-audit tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
