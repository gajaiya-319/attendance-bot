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
    const dailyScore = Number.isFinite(Number(latest.operationalScore))
        ? Number(latest.operationalScore)
        : (latest.healthy === true ? 100 : 0);
    const score = Number.isFinite(Number(latest.latestOperationalScore))
        ? Number(latest.latestOperationalScore)
        : dailyScore;
    const dailyHealthy = typeof latest.healthy === 'boolean'
        ? latest.healthy
        : dailyScore === 100;
    const currentHealthy = typeof latest.latestHealthy === 'boolean'
        ? latest.latestHealthy
        : dailyHealthy;
    const certified = latest.certified === true;
    const currentCertified = typeof latest.latestCertified === 'boolean'
        ? latest.latestCertified
        : certified;
    const consecutiveCertifiedDays = Math.max(0, Number(data?.consecutiveCertifiedDays || 0));
    const remainingDays = Math.max(0, targetDays - consecutiveCertifiedDays);
    const reasons = [];
    if (score < 100 || !currentHealthy) reasons.push(`Current operational score is ${score}/100.`);
    if (!certified) reasons.push(`Today's certification floor is ${dailyScore}/100 and is not certified.`);
    if (stale) reasons.push(`The latest evidence is ${Math.floor(ageHours)} hours old.`);
    const activeAttentionRequired = score < 100 || !currentHealthy || stale;
    const recovered = !activeAttentionRequired && !certified;

    return {
        available: true,
        code: reasons.length ? 'attention-required' : 'ok',
        attentionRequired: reasons.length > 0,
        activeAttentionRequired,
        recovered,
        score,
        dailyScore,
        currentHealthy,
        dailyHealthy,
        certified,
        currentCertified,
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
    const state = status.activeAttentionRequired
        ? 'ATTENTION'
        : (status.recovered
            ? 'RECOVERED'
            : (status.qualified7Days ? 'QUALIFIED' : 'BUILDING'));
    return [
        `Status: ${state}`,
        `Current score: ${status.score}/100`,
        `Today's certification floor: ${status.dailyScore ?? status.score}/100 (${status.certified ? 'certified' : 'not certified'})`,
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
