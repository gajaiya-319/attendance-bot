'use strict';

const fsDefault = require('fs').promises;

function summarizeOperationalCertification(data, {
    now = new Date(),
    staleAfterHours = 30,
    targetDays = 7
} = {}) {
    const records = Array.isArray(data?.records)
        ? data.records.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        : [];
    const latest = records.at(-1) || null;
    if (!latest) {
        return {
            available: false,
            code: 'missing-evidence',
            attentionRequired: true,
            targetDays,
            consecutiveCertifiedDays: 0,
            remainingDays: targetDays,
            reasons: ['No operational certification evidence is available.']
        };
    }

    const checkedAt = latest.lastCheckedAt || latest.checkedAt || data?.updatedAt || null;
    const nowMs = new Date(now).getTime();
    const checkedAtMs = new Date(checkedAt).getTime();
    const ageHours = Number.isFinite(nowMs) && Number.isFinite(checkedAtMs)
        ? Math.max(0, (nowMs - checkedAtMs) / (60 * 60 * 1000))
        : Number.POSITIVE_INFINITY;
    const stale = ageHours > Math.max(1, Number(staleAfterHours || 30));
    const score = Number.isFinite(Number(latest.operationalScore))
        ? Number(latest.operationalScore)
        : (latest.healthy === true ? 100 : 0);
    const certified = latest.certified === true;
    const consecutiveCertifiedDays = Math.max(0, Number(data?.consecutiveCertifiedDays || 0));
    const remainingDays = Math.max(0, targetDays - consecutiveCertifiedDays);
    const reasons = [];
    if (score < 100) reasons.push(`Operational score is ${score}/100.`);
    if (!certified) reasons.push('The latest daily record is not certified.');
    if (stale) reasons.push(`The latest evidence is ${Math.floor(ageHours)} hours old.`);

    return {
        available: true,
        code: reasons.length ? 'attention-required' : 'ok',
        attentionRequired: reasons.length > 0,
        score,
        certified,
        consecutiveCertifiedDays,
        remainingDays,
        targetDays,
        qualified7Days: data?.qualified7Days === true || consecutiveCertifiedDays >= 7,
        qualified30Days: data?.qualified30Days === true || consecutiveCertifiedDays >= 30,
        latestDate: latest.date || null,
        checkedAt,
        ageHours,
        stale,
        disasterRecoveryFresh: latest.disasterRecoveryFresh !== false,
        reasons,
        latest
    };
}

async function readOperationalCertificationStatus({
    filePath = 'logs/operational-evidence.json',
    fs = fsDefault,
    now = new Date(),
    staleAfterHours = 30,
    targetDays = 7
} = {}) {
    try {
        const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
        return summarizeOperationalCertification(data, { now, staleAfterHours, targetDays });
    } catch (error) {
        return {
            available: false,
            code: error?.code === 'ENOENT' ? 'missing-evidence' : 'invalid-evidence',
            attentionRequired: true,
            targetDays,
            consecutiveCertifiedDays: 0,
            remainingDays: targetDays,
            reasons: [error?.code === 'ENOENT'
                ? 'No operational certification evidence is available.'
                : `Operational certification evidence could not be read: ${error?.message || error}`]
        };
    }
}

function formatOperationalCertificationStatus(status = {}) {
    if (!status.available) {
        return [
            'Status: ATTENTION',
            'Score: unavailable',
            `7-day progress: 0/${status.targetDays || 7}`,
            `Reason: ${(status.reasons || [status.code || 'unknown']).join(' ')}`
        ].join('\n');
    }
    const state = status.attentionRequired
        ? 'ATTENTION'
        : (status.qualified7Days ? 'QUALIFIED' : 'BUILDING');
    return [
        `Status: ${state}`,
        `Score: ${status.score}/100`,
        `7-day progress: ${status.consecutiveCertifiedDays}/${status.targetDays} (${status.remainingDays} remaining)`,
        `Latest check: ${status.checkedAt || 'unknown'}`,
        `DR backup: ${status.disasterRecoveryFresh ? 'fresh' : 'stale'}`,
        status.reasons?.length ? `Reason: ${status.reasons.join(' ')}` : null
    ].filter(Boolean).join('\n');
}

module.exports = {
    formatOperationalCertificationStatus,
    readOperationalCertificationStatus,
    summarizeOperationalCertification
};
