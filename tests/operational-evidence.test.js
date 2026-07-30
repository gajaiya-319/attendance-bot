'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    calculateOperationalScore,
    countConsecutiveCertifiedDays,
    countConsecutiveHealthyDays,
    isDisasterRecoveryFresh,
    recordOperationalEvidence
} = require('../scripts/lib/operational-evidence');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operational-evidence-'));
const filePath = path.join(dir, 'evidence.json');

try {
    const health = {
        status: 'ok',
        checks: {
            pm2: { status: 'online' },
            state: { issueCount: 0 },
            backups: { fatalIssueCount: 0 },
            commandRegistration: { registeredCount: 46, expectedCount: 46 },
            endAdenaFreshness: {
                ready: true,
                status: 'certified',
                score: 100,
                certifiedCycles: 1,
                completedCycles: 1
            }
        }
    };
    for (let day = 1; day <= 7; day += 1) {
        recordOperationalEvidence({
            filePath,
            health,
            disasterRecovery: { ok: true, createdAt: `2026-07-0${day}T00:00:00.000Z` },
            pendingAttendanceCount: 0,
            at: new Date(`2026-07-0${day}T01:00:00.000Z`)
        });
    }
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.strictEqual(saved.consecutiveHealthyDays, 7);
    assert.strictEqual(saved.consecutiveCertifiedDays, 7);
    assert.strictEqual(saved.qualified7Days, true);
    assert.strictEqual(saved.qualified30Days, false);
    assert(saved.records.every(record => record.operationalScore === 100));
    assert(saved.records.every(record => record.certified === true));
    assert(saved.records.every(record => record.endAdenaProvisional === false));

    const degradedScore = calculateOperationalScore({
        health: {
            status: 'ok',
            checks: { endAdenaFreshness: { ready: true, score: 95 } }
        },
        disasterRecovery: { ok: true, createdAt: '2026-07-08T00:00:00.000Z' },
        pendingAttendanceCount: 0,
        at: new Date('2026-07-08T01:00:00.000Z')
    });
    assert.strictEqual(degradedScore.total, 99);
    assert.strictEqual(degradedScore.components.endAdena, 29);

    const provisionalScore = calculateOperationalScore({
        health: { status: 'ok', checks: {} },
        disasterRecovery: { ok: true, createdAt: '2026-07-08T00:00:00.000Z' },
        pendingAttendanceCount: 0,
        at: new Date('2026-07-08T01:00:00.000Z')
    });
    assert.strictEqual(provisionalScore.total, 100);
    assert.strictEqual(provisionalScore.endAdenaProvisional, true);
    assert.strictEqual(isDisasterRecoveryFresh(
        { ok: true, createdAt: '2026-07-06T00:00:00.000Z' },
        new Date('2026-07-08T01:00:00.000Z')
    ), false);

    const dailyFilePath = path.join(dir, 'daily-evidence.json');
    recordOperationalEvidence({
        filePath: dailyFilePath,
        health,
        disasterRecovery: { ok: true, createdAt: '2026-07-09T00:30:00.000Z' },
        pendingAttendanceCount: 0,
        at: new Date('2026-07-09T01:00:00.000Z')
    });
    recordOperationalEvidence({
        filePath: dailyFilePath,
        health,
        disasterRecovery: { ok: true, createdAt: '2026-07-09T01:30:00.000Z' },
        pendingAttendanceCount: 1,
        at: new Date('2026-07-09T02:00:00.000Z')
    });
    const recoveredSameDay = recordOperationalEvidence({
        filePath: dailyFilePath,
        health,
        disasterRecovery: { ok: true, createdAt: '2026-07-09T02:30:00.000Z' },
        pendingAttendanceCount: 0,
        at: new Date('2026-07-09T03:00:00.000Z')
    });
    assert.strictEqual(recoveredSameDay.current.operationalScore, 90);
    assert.strictEqual(recoveredSameDay.current.healthy, false);
    assert.strictEqual(recoveredSameDay.current.certified, false);
    assert.strictEqual(recoveredSameDay.current.latestOperationalScore, 100);
    assert.strictEqual(recoveredSameDay.current.checkCount, 3);
    assert.strictEqual(recoveredSameDay.consecutiveCertifiedDays, 0);

    const broken = recordOperationalEvidence({
        filePath,
        health,
        disasterRecovery: { ok: true, createdAt: '2026-07-08T00:00:00.000Z' },
        pendingAttendanceCount: 1,
        at: new Date('2026-07-08T01:00:00.000Z')
    });
    assert.strictEqual(broken.current.healthy, false);
    assert.strictEqual(broken.current.certified, false);
    assert.strictEqual(broken.current.operationalScore, 90);
    assert.strictEqual(broken.consecutiveHealthyDays, 0);
    assert.strictEqual(broken.consecutiveCertifiedDays, 0);
    assert.strictEqual(countConsecutiveHealthyDays(saved.records), 7);
    assert.strictEqual(countConsecutiveCertifiedDays(saved.records), 7);
    console.log('operational-evidence tests passed');
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
}
