'use strict';

function toDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    return Number.isNaN(date.valueOf()) ? new Date() : date;
}

function toIso(value) {
    return toDate(value).toISOString();
}

function normalizeFailureCode(source = {}) {
    const raw = source.code || source.lastCode || source.errorCode || source.lastError || source.dropReason || '';
    const text = String(raw || '').trim();
    if (!text) return 'pending';
    const lower = text.toLowerCase();
    if (
        lower.includes('timeout') ||
        lower.includes('econnreset') ||
        lower.includes('eai_again') ||
        lower.includes('quota') ||
        lower.includes('rate') ||
        lower.includes('429') ||
        lower.includes('500') ||
        lower.includes('502') ||
        lower.includes('503') ||
        lower.includes('504')
    ) {
        return 'sheet-api-error';
    }
    return lower;
}

const CATEGORY_BY_CODE = new Map([
    ['sheet-api-error', 'transient'],
    ['retry-exception', 'transient'],
    ['write-verify-failed', 'write-verify'],
    ['user-not-found', 'user-match'],
    ['summary-user-not-found', 'user-match'],
    ['day-not-found', 'sheet-layout'],
    ['section-not-found', 'sheet-layout'],
    ['summary-shift-not-found', 'sheet-layout'],
    ['ambiguous-shift', 'needs-manager'],
    ['missing-config', 'config'],
    ['missing-profile', 'config'],
    ['invalid-payload', 'config'],
    ['unknown-kind', 'config']
]);

const REVIEW_ONLY_CODES = new Set([
    // These failures require a person to fix an alias or the payroll sheet.
    // Retrying the same payload only creates repeated operational alerts.
    'user-not-found',
    'summary-user-not-found',
    'day-not-found',
    'section-not-found',
    'summary-shift-not-found',
    'ambiguous-shift',
    'missing-config',
    'missing-profile',
    'invalid-payload',
    'unknown-kind'
]);

const REPAIR_REVISION_BY_CODE = new Map([
    ['user-not-found', 'sheet-name-variants-v2'],
    ['summary-user-not-found', 'sheet-name-variants-v2']
]);

const MAX_AUTO_ATTEMPTS = {
    transient: 10,
    'write-verify': 5,
    'user-match': 6,
    'sheet-layout': 6,
    unknown: 4
};

const BASE_RETRY_DELAY_MS = {
    transient: 60 * 1000,
    'write-verify': 2 * 60 * 1000,
    'user-match': 5 * 60 * 1000,
    'sheet-layout': 5 * 60 * 1000,
    unknown: 5 * 60 * 1000
};

const MAX_RETRY_DELAY_MS = {
    transient: 15 * 60 * 1000,
    'write-verify': 20 * 60 * 1000,
    'user-match': 60 * 60 * 1000,
    'sheet-layout': 60 * 60 * 1000,
    unknown: 30 * 60 * 1000
};

function getRetryDelayMs(category, attempts) {
    const base = BASE_RETRY_DELAY_MS[category] || BASE_RETRY_DELAY_MS.unknown;
    const max = MAX_RETRY_DELAY_MS[category] || MAX_RETRY_DELAY_MS.unknown;
    const exponent = Math.max(0, Math.min(5, Number(attempts || 1) - 1));
    return Math.min(max, base * (2 ** exponent));
}

function classifyOpsQueueFailure(item = {}, result = null) {
    const source = result || item;
    const code = normalizeFailureCode(source);
    const category = CATEGORY_BY_CODE.get(code) || 'unknown';
    const attempts = Number(item.attempts || 0);
    const maxAutoAttempts = MAX_AUTO_ATTEMPTS[category] ?? MAX_AUTO_ATTEMPTS.unknown;
    const reviewOnly = REVIEW_ONLY_CODES.has(code) || category === 'config' || category === 'needs-manager';
    const repairRevision = REPAIR_REVISION_BY_CODE.get(code) || null;
    const repairUpgradeAvailable = Boolean(repairRevision && item.autoRepairRevision !== repairRevision);
    const autoRetry = repairUpgradeAvailable || (!reviewOnly && attempts < maxAutoAttempts);
    const retryDelayMs = autoRetry ? getRetryDelayMs(category, Math.max(1, attempts)) : null;

    return {
        code,
        category,
        attempts,
        maxAutoAttempts,
        autoRetry,
        action: repairUpgradeAvailable ? 'repair-and-retry' : (autoRetry ? 'retry' : 'needs-review'),
        repairRevision,
        repairUpgradeAvailable,
        retryDelayMs,
        severity: reviewOnly ? 'manager-check' : (autoRetry ? 'auto-retry' : 'retry-limit'),
        messageKo: getKoreanPolicyMessage({ code, category, autoRetry, attempts, maxAutoAttempts })
    };
}

function getKoreanPolicyMessage({ code, category, autoRetry, attempts, maxAutoAttempts }) {
    if (autoRetry) {
        if (category === 'transient') return '구글 시트/API 일시 오류로 자동 재시도합니다.';
        if (category === 'write-verify') return '시트 기록 후 검증 실패로 자동 재확인합니다.';
        if (category === 'user-match') return '선수명 후보와 별칭을 다시 적용해 자동 재시도합니다.';
        if (category === 'sheet-layout') return '시트 날짜/구역 탐색 문제로 자동 재시도합니다.';
        return '자동 복구 가능한 실패로 재시도합니다.';
    }
    if (code === 'user-not-found' || code === 'summary-user-not-found') {
        return '급여 시트에서 일치하는 이름을 찾지 못했습니다. 별칭 또는 시트 이름을 확인하세요.';
    }
    if (code === 'day-not-found') {
        return '급여 시트에서 해당 날짜 행을 찾지 못했습니다. 월간 시트 날짜를 확인하세요.';
    }
    if (code === 'section-not-found' || code === 'summary-shift-not-found') {
        return '급여 시트의 근무조 구역 또는 요약 표를 찾지 못했습니다. 시트 구조를 확인하세요.';
    }
    if (code === 'ambiguous-shift') return '근무조가 모호해서 매니저 확인이 필요합니다.';
    if (code === 'missing-config') return '설정 누락으로 매니저 확인이 필요합니다.';
    if (code === 'unknown-kind' || code === 'invalid-payload') return '알 수 없는 작업 형식이라 매니저 확인이 필요합니다.';
    if (attempts >= maxAutoAttempts) return `자동 재시도 ${maxAutoAttempts}회 초과로 매니저 확인이 필요합니다.`;
    return '매니저 확인이 필요합니다.';
}

function isOpsQueueItemDueForAutoRetry(item = {}, now = new Date()) {
    const policy = classifyOpsQueueFailure(item);
    if (!policy.autoRetry) return false;
    if (item.status === 'needs-review' && !policy.repairUpgradeAvailable) return false;
    if (!item.nextAttemptAt) return true;
    const nextAt = new Date(item.nextAttemptAt);
    if (Number.isNaN(nextAt.valueOf())) return true;
    return nextAt.valueOf() <= toDate(now).valueOf();
}

function buildFailureKeptItem(item, result, policy, now) {
    const nowDate = toDate(now);
    const nextAttemptAt = policy.autoRetry
        ? new Date(nowDate.valueOf() + policy.retryDelayMs).toISOString()
        : null;
    return {
        ...item,
        status: policy.autoRetry ? 'pending' : 'needs-review',
        updatedAt: nowDate.toISOString(),
        lastError: result?.errorMessage || result?.lastError || result?.code || policy.code,
        lastCode: policy.code,
        issueCategory: policy.category,
        autoRepairAction: policy.action,
        autoRepairMessage: policy.messageKo,
        nextAttemptAt
    };
}

async function runOpsQueueAutoRecovery({
    opsQueueService,
    retryItem,
    now = new Date(),
    force = false,
    logger = console
}) {
    if (!opsQueueService?.list || !opsQueueService?.writeItems) {
        throw new TypeError('opsQueueService.list/writeItems must be provided');
    }
    if (typeof retryItem !== 'function') {
        throw new TypeError('retryItem must be a function');
    }

    const nowDate = toDate(now);
    const nowIso = toIso(nowDate);
    const items = await opsQueueService.list();
    const kept = [];
    const results = [];
    let retried = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let dropped = 0;
    let needsReview = 0;

    for (const item of items) {
        const currentPolicy = classifyOpsQueueFailure(item);
        if (!force && !isOpsQueueItemDueForAutoRetry(item, nowDate)) {
            skipped += 1;
            if (item.status === 'needs-review' || !currentPolicy.autoRetry) needsReview += 1;
            kept.push({
                ...item,
                status: currentPolicy.autoRetry ? (item.status || 'pending') : 'needs-review',
                issueCategory: item.issueCategory || currentPolicy.category,
                autoRepairAction: item.autoRepairAction || currentPolicy.action,
                autoRepairMessage: item.autoRepairMessage || currentPolicy.messageKo
            });
            results.push({
                id: item.id,
                ok: false,
                skipped: true,
                code: currentPolicy.code,
                action: currentPolicy.action
            });
            continue;
        }

        retried += 1;
        const nextItem = {
            ...item,
            attempts: Number(item.attempts || 0) + 1,
            lastTriedAt: nowIso,
            autoRecoveryLastTriedAt: nowIso,
            autoRepairRevision: currentPolicy.repairRevision || item.autoRepairRevision || null,
            status: 'pending',
            updatedAt: nowIso
        };

        const result = await retryItem(nextItem).catch(error => ({
            ok: false,
            code: 'retry-exception',
            errorMessage: error?.message || String(error)
        }));

        if (result?.ok) {
            succeeded += 1;
            results.push({
                id: item.id,
                ok: true,
                range: result.range,
                summaryRange: result.summaryRange
            });
            continue;
        }

        if (result?.drop) {
            dropped += 1;
            results.push({
                id: item.id,
                ok: false,
                dropped: true,
                code: result?.code || result?.dropReason || 'dropped'
            });
            continue;
        }

        const policy = classifyOpsQueueFailure(nextItem, result);
        if (!policy.autoRetry) needsReview += 1;
        failed += 1;
        kept.push(buildFailureKeptItem(nextItem, result, policy, nowDate));
        results.push({
            id: item.id,
            ok: false,
            code: policy.code,
            category: policy.category,
            action: policy.action,
            nextAttemptAt: policy.autoRetry
                ? new Date(nowDate.valueOf() + policy.retryDelayMs).toISOString()
                : null
        });
    }

    await opsQueueService.writeItems(kept);
    await opsQueueService.appendAudit?.({
        type: 'auto-recovery-run',
        total: items.length,
        retried,
        succeeded,
        failed,
        skipped,
        dropped,
        needsReview,
        results
    });
    logger.log?.('[OPS QUEUE AUTO RECOVERY]', {
        total: items.length,
        retried,
        succeeded,
        failed,
        skipped,
        dropped,
        needsReview
    });

    return {
        ok: true,
        total: items.length,
        retried,
        succeeded,
        failed,
        skipped,
        dropped,
        needsReview,
        kept,
        results
    };
}

module.exports = {
    classifyOpsQueueFailure,
    isOpsQueueItemDueForAutoRetry,
    runOpsQueueAutoRecovery,
    normalizeFailureCode
};
