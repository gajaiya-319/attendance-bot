'use strict';

const assert = require('assert');
const {
    formatOperationalCertificationStatus,
    readOperationalCertificationStatus,
    summarizeOperationalCertification
} = require('../src/services/operationalCertificationStatusService');

(async () => {
    const healthy = summarizeOperationalCertification({
        consecutiveCertifiedDays: 3,
        qualified7Days: false,
        records: [{
            date: '2026-07-30',
            checkedAt: '2026-07-30T01:00:00.000Z',
            operationalScore: 100,
            certified: true,
            disasterRecoveryFresh: true
        }]
    }, { now: new Date('2026-07-30T02:00:00.000Z') });
    assert.strictEqual(healthy.attentionRequired, false);
    assert.strictEqual(healthy.score, 100);
    assert.strictEqual(healthy.dailyScore, 100);
    assert.strictEqual(healthy.consecutiveCertifiedDays, 3);
    assert.strictEqual(healthy.remainingDays, 4);
    assert(formatOperationalCertificationStatus(healthy).includes('3/7'));

    const degraded = summarizeOperationalCertification({
        consecutiveCertifiedDays: 0,
        records: [{
            date: '2026-07-30',
            checkedAt: '2026-07-30T01:00:00.000Z',
            operationalScore: 90,
            certified: false,
            disasterRecoveryFresh: true
        }]
    }, { now: new Date('2026-07-30T02:00:00.000Z') });
    assert.strictEqual(degraded.attentionRequired, true);
    assert(degraded.reasons.some(reason => reason.includes('90/100')));

    const recovered = summarizeOperationalCertification({
        consecutiveCertifiedDays: 0,
        records: [{
            date: '2026-07-30',
            checkedAt: '2026-07-30T01:00:00.000Z',
            lastCheckedAt: '2026-07-30T02:00:00.000Z',
            operationalScore: 80,
            healthy: false,
            certified: false,
            latestOperationalScore: 100,
            latestHealthy: true,
            latestCertified: true,
            disasterRecoveryFresh: true
        }]
    }, { now: new Date('2026-07-30T03:00:00.000Z') });
    assert.strictEqual(recovered.score, 100);
    assert.strictEqual(recovered.dailyScore, 80);
    assert.strictEqual(recovered.activeAttentionRequired, false);
    assert.strictEqual(recovered.attentionRequired, true);
    assert.strictEqual(recovered.recovered, true);
    assert(formatOperationalCertificationStatus(recovered).includes('Status: RECOVERED'));
    assert(formatOperationalCertificationStatus(recovered).includes('Current score: 100/100'));
    assert(formatOperationalCertificationStatus(recovered).includes("Today's certification floor: 80/100"));

    const stale = summarizeOperationalCertification({
        consecutiveCertifiedDays: 2,
        records: [{
            date: '2026-07-28',
            checkedAt: '2026-07-28T01:00:00.000Z',
            operationalScore: 100,
            certified: true
        }]
    }, { now: new Date('2026-07-30T12:00:00.000Z') });
    assert.strictEqual(stale.stale, true);
    assert.strictEqual(stale.attentionRequired, true);

    const missing = await readOperationalCertificationStatus({
        fs: {
            readFile: async () => {
                const error = new Error('missing');
                error.code = 'ENOENT';
                throw error;
            }
        }
    });
    assert.strictEqual(missing.available, false);
    assert.strictEqual(missing.code, 'missing-evidence');
    console.log('operational-certification-status-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
