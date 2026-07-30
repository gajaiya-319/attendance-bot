'use strict';

const fs = require('fs');
const path = require('path');

function dateKey(value, timeZone = 'UTC') {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid operational evidence date');
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function countConsecutiveHealthyDays(records = []) {
    const sorted = records.slice().sort((a, b) => a.date.localeCompare(b.date));
    let count = 0;
    let expected = null;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const record = sorted[index];
        const current = new Date(`${record.date}T00:00:00.000Z`);
        if (expected && current.getTime() !== expected.getTime()) break;
        if (!record.healthy) break;
        count += 1;
        expected = new Date(current.getTime() - 24 * 60 * 60 * 1000);
    }
    return count;
}

function countConsecutiveCertifiedDays(records = []) {
    const sorted = records.slice().sort((a, b) => a.date.localeCompare(b.date));
    let count = 0;
    let expected = null;
    for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const record = sorted[index];
        const current = new Date(`${record.date}T00:00:00.000Z`);
        if (expected && current.getTime() !== expected.getTime()) break;
        if (!record.certified) break;
        count += 1;
        expected = new Date(current.getTime() - 24 * 60 * 60 * 1000);
    }
    return count;
}

function isDisasterRecoveryFresh(disasterRecovery, at = new Date(), maxAgeHours = 2) {
    if (disasterRecovery?.ok !== true || !disasterRecovery?.createdAt) return false;
    const checkedAtMs = new Date(at).getTime();
    const createdAtMs = new Date(disasterRecovery.createdAt).getTime();
    if (!Number.isFinite(checkedAtMs) || !Number.isFinite(createdAtMs)) return false;
    const ageMs = checkedAtMs - createdAtMs;
    return ageMs >= 0 && ageMs <= Math.max(1, Number(maxAgeHours || 2)) * 60 * 60 * 1000;
}

function mergeDailyEvidenceRecord(previous, current) {
    if (!previous) {
        return {
            ...current,
            firstCheckedAt: current.checkedAt,
            lastCheckedAt: current.checkedAt,
            checkCount: 1,
            latestOperationalScore: current.operationalScore,
            latestHealthy: current.healthy,
            latestCertified: current.certified
        };
    }

    const previousScore = Number.isFinite(Number(previous.operationalScore))
        ? Number(previous.operationalScore)
        : (previous.healthy === true ? 100 : 0);
    const currentScore = Number(current.operationalScore || 0);
    const previousHasCertification = typeof previous.certified === 'boolean';
    const previousCertified = previousHasCertification ? previous.certified : current.certified;
    const representative = previousScore < currentScore || (
        previousScore === currentScore && previousCertified === false && current.certified === true
    ) ? previous : current;

    return {
        ...representative,
        date: current.date,
        checkedAt: current.checkedAt,
        timeZone: current.timeZone || previous.timeZone || 'UTC',
        firstCheckedAt: previous.firstCheckedAt || previous.checkedAt || current.checkedAt,
        lastCheckedAt: current.checkedAt,
        checkCount: Math.max(1, Number(previous.checkCount || 1)) + 1,
        healthy: previous.healthy !== false && current.healthy === true,
        certified: previousCertified === true && current.certified === true,
        operationalScore: Math.min(previousScore, currentScore),
        latestOperationalScore: currentScore,
        latestHealthy: current.healthy,
        latestCertified: current.certified
    };
}

function calculateOperationalScore({
    health,
    disasterRecovery,
    pendingAttendanceCount = 0,
    at = new Date(),
    disasterRecoveryMaxAgeHours = 2
} = {}) {
    const healthStatus = health?.status || 'missing';
    const runtime = healthStatus === 'ok' ? 40 : (healthStatus === 'warn' ? 20 : 0);
    const disasterRecoveryFresh = isDisasterRecoveryFresh(disasterRecovery, at, disasterRecoveryMaxAgeHours);
    const disasterRecoveryScore = disasterRecoveryFresh ? 20 : 0;
    const attendance = Number(pendingAttendanceCount || 0) === 0 ? 10 : 0;
    const freshness = health?.checks?.endAdenaFreshness || null;
    const freshnessReady = Boolean(freshness?.ready);
    const freshnessRatio = !freshnessReady
        ? 1
        : Math.max(0, Math.min(100, Number(freshness?.score || 0))) / 100;
    const endAdena = freshnessRatio * 30;
    const total = Math.round(runtime + disasterRecoveryScore + attendance + endAdena);
    return {
        total,
        components: {
            runtime,
            disasterRecovery: disasterRecoveryScore,
            attendance,
            endAdena: Math.round(endAdena)
        },
        endAdenaProvisional: !freshnessReady,
        disasterRecoveryFresh
    };
}

function recordOperationalEvidence({
    filePath = 'logs/operational-evidence.json',
    health,
    disasterRecovery,
    pendingAttendanceCount = 0,
    at = new Date(),
    retentionDays = 35,
    timeZone = 'UTC'
} = {}) {
    const checkedAt = new Date(at).toISOString();
    const date = dateKey(checkedAt, timeZone);
    const operationalScore = calculateOperationalScore({ health, disasterRecovery, pendingAttendanceCount, at: checkedAt });
    const healthy = operationalScore.total === 100;
    const freshness = health?.checks?.endAdenaFreshness || null;
    const certified = healthy && freshness?.status === 'certified' && freshness?.score === 100 && freshness?.ready === true;
    let previous = { records: [] };
    try {
        previous = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }

    const record = {
        date,
        checkedAt,
        timeZone,
        healthy,
        certified,
        operationalScore: operationalScore.total,
        scoreComponents: operationalScore.components,
        healthStatus: health?.status || 'missing',
        pm2Status: health?.checks?.pm2?.status || 'missing',
        stateIssues: Number(health?.checks?.state?.issueCount || 0),
        backupFatalIssues: Number(health?.checks?.backups?.fatalIssueCount || 0),
        commandCount: health?.checks?.commandRegistration?.registeredCount ?? null,
        expectedCommandCount: health?.checks?.commandRegistration?.expectedCount ?? null,
        disasterRecoveryOk: disasterRecovery?.ok === true,
        disasterRecoveryFresh: operationalScore.disasterRecoveryFresh,
        disasterRecoveryCreatedAt: disasterRecovery?.createdAt || null,
        pendingAttendanceCount: Number(pendingAttendanceCount || 0),
        endAdenaFreshnessStatus: health?.checks?.endAdenaFreshness?.status || 'monitoring',
        endAdenaFreshnessScore: health?.checks?.endAdenaFreshness?.score ?? null,
        endAdenaFreshnessReady: Boolean(health?.checks?.endAdenaFreshness?.ready),
        endAdenaProvisional: operationalScore.endAdenaProvisional,
        endAdenaCertifiedCycles: Number(health?.checks?.endAdenaFreshness?.certifiedCycles || 0),
        endAdenaCompletedCycles: Number(health?.checks?.endAdenaFreshness?.completedCycles || 0)
    };
    const previousRecords = Array.isArray(previous.records) ? previous.records : [];
    const previousRecord = previousRecords.find(item => item.date === date) || null;
    const dailyRecord = mergeDailyEvidenceRecord(previousRecord, record);
    const records = [...previousRecords.filter(item => item.date !== date), dailyRecord]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-Math.max(1, retentionDays));
    const consecutiveHealthyDays = countConsecutiveHealthyDays(records);
    const consecutiveCertifiedDays = countConsecutiveCertifiedDays(records);
    const result = {
        updatedAt: checkedAt,
        consecutiveHealthyDays,
        consecutiveCertifiedDays,
        qualified7Days: consecutiveCertifiedDays >= 7,
        qualified30Days: consecutiveCertifiedDays >= 30,
        records
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, filePath);
    return { ...result, current: dailyRecord, latest: record };
}

module.exports = {
    calculateOperationalScore,
    countConsecutiveCertifiedDays,
    countConsecutiveHealthyDays,
    dateKey,
    isDisasterRecoveryFresh,
    mergeDailyEvidenceRecord,
    recordOperationalEvidence
};
