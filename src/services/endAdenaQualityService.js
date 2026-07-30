'use strict';

const DEFAULT_DAYS = 7;
const ISSUE_LABELS = {
    'invalid-format': '형식 오류',
    'shift-not-found': '근무조 확인 실패',
    'name-not-found': '이름 확인 실패',
    'server-mismatch': '서버 불일치',
    'server-unverified': '서버 역할 미확인',
    'sheet-unavailable': '시트 연결 실패',
    'summary-user-not-found': '시트 이름 없음',
    'attendance-not-found': '출근 기록 없음',
    'duplicate-submission': '중복 제출',
    'requested-name-mismatch': '본문 이름 불일치'
};

function instantMs(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
}

function count(value) {
    if (Array.isArray(value)) return value.length;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function percent(part, total, emptyValue = 100) {
    if (!total) return emptyValue;
    return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function operationWindow(operation) {
    const payload = operation?.payload || {};
    const shift = String(operation?.shift || payload.shift || '').toUpperCase();
    const startAt = payload.shiftStartAt || operation?.shiftStartAt || null;
    const endAt = payload.shiftEndAt || operation?.shiftEndAt || null;
    const startMs = instantMs(startAt);
    const endMs = instantMs(endAt);
    if (!shift || startMs === null || endMs === null) return null;
    return { shift, startAt, endAt, startMs, endMs, key: `${shift}:${startMs}:${endMs}` };
}

function syntheticIntegrityOperation(report) {
    if (!report?.shiftStartAt || !report?.shiftEndAt) return null;
    return {
        kind: 'end-adena-close-integrity',
        status: report.technicalOk === false ? 'failed' : 'success',
        shift: report.shift,
        createdAt: report.checkedAt || new Date().toISOString(),
        payload: {
            shift: report.shift,
            shiftStartAt: report.shiftStartAt,
            shiftEndAt: report.shiftEndAt
        },
        result: {
            ok: report.technicalOk !== false,
            businessComplete: Boolean(report.businessComplete),
            needsReview: count(report.needsReview),
            expectedWorkers: count(report.expectedWorkers),
            submitted: count(report.submitted),
            approvedPostCount: count(report.approvedPostCount),
            pending: report.pending || [],
            awaitingApproval: report.awaitingApproval || [],
            invalidSubmissions: report.invalidSubmissions || [],
            missing: report.missing || [],
            unexpected: report.unexpected || [],
            unexpectedPending: report.unexpectedPending || [],
            duplicates: report.duplicates || [],
            pendingDuplicates: report.pendingDuplicates || [],
            unresolved: report.unresolved || [],
            sheetMismatches: report.sheetMismatches || [],
            repairFailures: report.repair?.failures || []
        }
    };
}

function selectLatestCloseAudits(operations, { fromMs, nowMs }) {
    const latestByWindow = new Map();
    for (const operation of operations || []) {
        if (!['end-adena-reconciliation', 'end-adena-close-integrity'].includes(operation?.kind)) continue;
        const window = operationWindow(operation);
        if (!window || window.endMs < fromMs || window.endMs > nowMs) continue;
        const createdAtMs = instantMs(operation.createdAt) || window.endMs;
        if (createdAtMs > nowMs) continue;
        const priority = operation.kind === 'end-adena-close-integrity' ? 2 : 1;
        const previous = latestByWindow.get(window.key);
        if (!previous || createdAtMs > previous.createdAtMs || (
            createdAtMs === previous.createdAtMs && priority > previous.priority
        )) {
            latestByWindow.set(window.key, { operation, window, createdAtMs, priority });
        }
    }
    return [...latestByWindow.values()]
        .sort((left, right) => left.window.endMs - right.window.endMs)
        .map(item => item.operation);
}

function summarizeValidations(operations, { fromMs, nowMs }) {
    const histories = new Map();
    for (const operation of operations || []) {
        if (operation?.kind !== 'end-adena-prevalidation' || !operation?.messageId) continue;
        const createdAtMs = instantMs(operation.createdAt);
        const shiftEndMs = instantMs(operation?.payload?.shiftEndAt || operation?.shiftEndAt);
        const qualityWindowMs = shiftEndMs ?? createdAtMs;
        if (createdAtMs === null || createdAtMs > nowMs || qualityWindowMs === null || qualityWindowMs < fromMs || qualityWindowMs > nowMs) continue;
        const messageId = String(operation.messageId);
        const history = histories.get(messageId) || [];
        history.push({ operation, createdAtMs });
        histories.set(messageId, history);
    }

    let firstPass = 0;
    let corrected = 0;
    let unresolved = 0;
    let correctionMs = 0;
    const issueCounts = new Map();
    for (const history of histories.values()) {
        history.sort((left, right) => left.createdAtMs - right.createdAtMs);
        const first = history[0];
        const latest = history[history.length - 1];
        if (first.operation.status === 'success') {
            firstPass += 1;
        } else if (latest.operation.status === 'success') {
            const recovered = history.find(item => item.createdAtMs >= first.createdAtMs && item.operation.status === 'success');
            if (recovered) {
                corrected += 1;
                correctionMs += recovered.createdAtMs - first.createdAtMs;
            }
        }
        if (latest.operation.status !== 'success') unresolved += 1;
        const issueCodes = new Set(history.flatMap(item => item.operation?.result?.issueCodes || []));
        for (const code of issueCodes) issueCounts.set(code, (issueCounts.get(code) || 0) + 1);
    }

    const total = histories.size;
    const initiallyFailed = total - firstPass;
    return {
        total,
        firstPass,
        corrected,
        unresolved,
        firstPassRate: percent(firstPass, total),
        resolutionRate: percent(total - unresolved, total),
        correctionRate: percent(corrected, initiallyFailed),
        averageCorrectionMinutes: corrected ? Math.max(0, Math.round(correctionMs / corrected / 60_000)) : 0,
        topIssues: [...issueCounts.entries()]
            .map(([code, occurrences]) => ({ code, occurrences }))
            .sort((left, right) => right.occurrences - left.occurrences || left.code.localeCompare(right.code))
            .slice(0, 5)
    };
}

function summarizeEndAdenaQuality(operations = [], {
    now = new Date(),
    days = DEFAULT_DAYS,
    currentReport = null
} = {}) {
    const nowMs = typeof now?.valueOf === 'function' ? now.valueOf() : instantMs(now);
    if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid date');
    const windowDays = Math.max(1, Math.trunc(Number(days) || DEFAULT_DAYS));
    const fromMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
    const rows = [...(operations || [])];
    const synthetic = syntheticIntegrityOperation(currentReport);
    if (synthetic) rows.push(synthetic);
    const audits = selectLatestCloseAudits(rows, { fromMs, nowMs });

    const close = {
        cycles: audits.length,
        completedCycles: 0,
        reviewCycles: 0,
        technicalFailures: 0,
        expectedWorkers: 0,
        submitted: 0,
        approvedPosts: 0,
        awaitingApproval: 0,
        invalidSubmissions: 0,
        missing: 0,
        unexpected: 0,
        unexpectedPending: 0,
        duplicates: 0,
        pendingDuplicates: 0,
        unresolved: 0,
        sheetMismatches: 0,
        sheetRecovered: 0,
        repairFailures: 0
    };
    for (const audit of audits) {
        const result = audit.result || {};
        const needsReview = count(result.needsReview);
        const technicalOk = audit.status !== 'failed' && result.ok !== false && result.technicalOk !== false;
        const businessComplete = typeof result.businessComplete === 'boolean'
            ? result.businessComplete
            : technicalOk && needsReview === 0;
        if (businessComplete) close.completedCycles += 1;
        if (needsReview > 0) close.reviewCycles += 1;
        if (!technicalOk) close.technicalFailures += 1;
        close.expectedWorkers += count(result.expectedWorkers);
        close.submitted += count(result.submitted);
        close.approvedPosts += count(result.approvedPostCount || result.submitted);
        close.awaitingApproval += count(result.awaitingApproval || result.pending);
        close.invalidSubmissions += count(result.invalidSubmissions);
        close.missing += count(result.missing);
        close.unexpected += count(result.unexpected);
        close.unexpectedPending += count(result.unexpectedPending);
        close.duplicates += count(result.duplicates);
        close.pendingDuplicates += count(result.pendingDuplicates);
        close.unresolved += count(result.unresolved);
        close.sheetMismatches += count(result.sheetMismatches || result.repair?.corrections);
        close.sheetRecovered += (result.sheetMismatches || result.repair?.corrections || [])
            .filter(item => item?.recovered !== false).length;
        close.repairFailures += count(result.repairFailures || result.repair?.failures);
    }
    close.completeRate = percent(close.completedCycles, close.cycles);
    close.sheetRecoveryRate = percent(close.sheetRecovered, close.sheetMismatches);

    const validation = summarizeValidations(rows, { fromMs, nowMs });
    const hasData = close.cycles > 0;
    const score = hasData
        ? Math.round(close.completeRate * 0.5 + validation.resolutionRate * 0.3 + close.sheetRecoveryRate * 0.2)
        : null;
    let status = 'collecting';
    if (hasData) {
        if (close.technicalFailures > 0 || close.repairFailures > 0 || score < 80) status = 'needs-attention';
        else if (close.reviewCycles > 0 || validation.unresolved > 0 || score < 95) status = 'watch';
        else status = 'stable';
    }

    return {
        days: windowDays,
        fromAt: new Date(fromMs).toISOString(),
        toAt: new Date(nowMs).toISOString(),
        hasData,
        score,
        status,
        close,
        validation
    };
}

function formatEndAdenaQualityLine(summary) {
    if (!summary?.hasData) return `${summary?.days || DEFAULT_DAYS}일 품질: 데이터 수집 중`;
    return [
        `${summary.days}일 품질: ${summary.score}점`,
        `정상 마감 ${summary.close.completedCycles}/${summary.close.cycles}`,
        `첫 제출 통과 ${summary.validation.firstPassRate}%`,
        `수정 완료 ${summary.validation.corrected}건`,
        `미해결 ${summary.validation.unresolved}건`,
        `시트 복구 ${summary.close.sheetRecoveryRate}%`
    ].join(' / ');
}

function formatEndAdenaQualityIssues(summary) {
    const issues = summary?.validation?.topIssues || [];
    if (!issues.length) return null;
    return `반복 오류: ${issues.map(item => `${ISSUE_LABELS[item.code] || item.code} ${item.occurrences}건`).join(' / ')}`;
}

module.exports = {
    DEFAULT_DAYS,
    ISSUE_LABELS,
    operationWindow,
    selectLatestCloseAudits,
    summarizeValidations,
    summarizeEndAdenaQuality,
    formatEndAdenaQualityLine,
    formatEndAdenaQualityIssues
};
