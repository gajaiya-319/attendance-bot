'use strict';

const fsDefault = require('fs').promises;
const pathDefault = require('path');

const TRANSIENT_ERROR_PATTERNS = [
    'timeout',
    'timed out',
    'econnreset',
    'econnrefused',
    'enotfound',
    'eai_again',
    'socket hang up',
    'rate limit',
    'quota',
    '429',
    '500',
    '502',
    '503',
    '504'
];

const BLOCKED_ERROR_PATTERNS = [
    'invalid_grant',
    'invalid token',
    'unauthorized',
    'forbidden',
    '401',
    '403',
    'permission denied',
    'missing-config',
    'missing config',
    'invalid-payload'
];

function safeJson(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return String(value);
    }
}

function normalizeError(error) {
    const code = String(error?.code || error?.status || error?.name || 'unknown').trim().toLowerCase();
    const message = String(error?.message || error || 'unknown error').trim();
    return { code, message, searchText: `${code} ${message}`.toLowerCase() };
}

function classifyRecoveryError(error) {
    const normalized = normalizeError(error);
    if (BLOCKED_ERROR_PATTERNS.some(pattern => normalized.searchText.includes(pattern))) {
        return { ...normalized, category: 'blocked', retryable: false };
    }
    if (TRANSIENT_ERROR_PATTERNS.some(pattern => normalized.searchText.includes(pattern))) {
        return { ...normalized, category: 'transient', retryable: true };
    }
    if (normalized.code === 'verification-failed') {
        return { ...normalized, category: 'verification', retryable: true };
    }
    return { ...normalized, category: 'unknown', retryable: true };
}

function normalizeVerification(value) {
    if (value === undefined || value === null || value === true) return { ok: true };
    if (value === false) return { ok: false, reason: 'verification returned false' };
    if (typeof value === 'object') return { ...value, ok: value.ok !== false };
    return { ok: Boolean(value), reason: String(value) };
}

function createSelfHealingSupervisorService({
    filePath = './logs/self-healing-state.json',
    auditFilePath = './logs/self-healing-audit.jsonl',
    fs = fsDefault,
    path = pathDefault,
    now = () => Date.now(),
    logger = console,
    baseRetryDelayMs = 60_000,
    maxRetryDelayMs = 15 * 60_000,
    maxConsecutiveFailures = 8
} = {}) {
    let loaded = false;
    let cycleRunning = false;
    let state = { version: 1, updatedAt: null, tasks: {} };

    function nowIso() {
        return new Date(now()).toISOString();
    }

    async function ensureDir(targetPath) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
    }

    async function load() {
        if (loaded) return state;
        loaded = true;
        try {
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                state = {
                    version: 1,
                    updatedAt: parsed.updatedAt || null,
                    tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {}
                };
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                logger.warn?.('[SELF HEALING STATE READ WARN]', error?.message || error);
            }
        }
        return state;
    }

    async function persist() {
        await ensureDir(filePath);
        state.updatedAt = nowIso();
        const temporaryPath = `${filePath}.tmp`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await fs.rename(temporaryPath, filePath);
    }

    async function appendAudit(record) {
        await ensureDir(auditFilePath);
        const line = JSON.stringify({ at: nowIso(), ...safeJson(record) });
        await fs.appendFile(auditFilePath, `${line}\n`, 'utf8').catch(error => {
            logger.warn?.('[SELF HEALING AUDIT WARN]', error?.message || error);
        });
    }

    function getTaskState(name) {
        if (!state.tasks[name]) {
            state.tasks[name] = {
                status: 'new',
                consecutiveFailures: 0,
                totalRuns: 0,
                totalRecovered: 0,
                nextAttemptAt: null,
                lastStartedAt: null,
                lastCompletedAt: null,
                lastSuccessAt: null,
                lastFailureAt: null,
                lastError: null,
                repairRevision: null
            };
        }
        return state.tasks[name];
    }

    function calculateRetryDelay(failures, task) {
        const base = Number(task.retryDelayMs || baseRetryDelayMs);
        const cap = Number(task.maxRetryDelayMs || maxRetryDelayMs);
        const exponent = Math.max(0, Math.min(6, failures - 1));
        return Math.min(cap, base * (2 ** exponent));
    }

    async function runTask(task, context = {}) {
        if (!task?.name || typeof task.repair !== 'function') {
            throw new TypeError('Self-healing tasks require a name and repair function');
        }
        await load();
        const taskState = getTaskState(task.name);
        const repairRevision = task.repairRevision || null;
        let repairRevisionChanged = false;

        if (repairRevision && taskState.repairRevision !== repairRevision) {
            repairRevisionChanged = true;
            taskState.status = 'new-repair-available';
            taskState.consecutiveFailures = 0;
            taskState.nextAttemptAt = null;
            taskState.lastError = null;
            taskState.repairRevision = repairRevision;
        }

        if (taskState.status === 'needs-review' && !repairRevisionChanged) {
            return {
                name: task.name,
                ok: false,
                skipped: true,
                reason: 'needs-review',
                error: taskState.lastError
            };
        }

        const currentTime = now();
        const nextAttempt = taskState.nextAttemptAt ? new Date(taskState.nextAttemptAt).valueOf() : 0;
        if (Number.isFinite(nextAttempt) && nextAttempt > currentTime) {
            return {
                name: task.name,
                ok: false,
                skipped: true,
                reason: 'backoff',
                nextAttemptAt: taskState.nextAttemptAt
            };
        }

        taskState.status = 'running';
        taskState.lastStartedAt = nowIso();
        taskState.totalRuns = Number(taskState.totalRuns || 0) + 1;
        await persist();

        try {
            const result = await task.repair(context);
            const verification = normalizeVerification(
                typeof task.verify === 'function' ? await task.verify(result, context) : true
            );
            if (!verification.ok) {
                const error = new Error(verification.reason || 'repair verification failed');
                error.code = 'verification-failed';
                error.verification = verification;
                throw error;
            }

            taskState.status = 'healthy';
            taskState.consecutiveFailures = 0;
            taskState.nextAttemptAt = null;
            taskState.lastCompletedAt = nowIso();
            taskState.lastSuccessAt = taskState.lastCompletedAt;
            taskState.lastError = null;
            if (result?.changed || result?.repaired?.length || result?.succeeded) {
                taskState.totalRecovered = Number(taskState.totalRecovered || 0) + 1;
            }
            taskState.lastResult = safeJson(result);
            await persist();
            await appendAudit({
                type: 'repair-success',
                task: task.name,
                reason: context.reason || null,
                repairRevision,
                verification,
                result
            });
            return { name: task.name, ok: true, result, verification };
        } catch (error) {
            const failure = classifyRecoveryError(error);
            const failures = Number(taskState.consecutiveFailures || 0) + 1;
            const limit = Number(task.maxConsecutiveFailures || maxConsecutiveFailures);
            const retryable = failure.retryable && failures < limit;
            const retryDelayMs = retryable ? calculateRetryDelay(failures, task) : null;

            taskState.status = retryable ? 'retrying' : 'needs-review';
            taskState.consecutiveFailures = failures;
            taskState.lastCompletedAt = nowIso();
            taskState.lastFailureAt = taskState.lastCompletedAt;
            taskState.lastError = {
                code: failure.code,
                message: failure.message,
                category: failure.category
            };
            taskState.nextAttemptAt = retryable
                ? new Date(now() + retryDelayMs).toISOString()
                : null;
            await persist();
            await appendAudit({
                type: 'repair-failure',
                task: task.name,
                reason: context.reason || null,
                repairRevision,
                failure,
                retryable,
                failures,
                nextAttemptAt: taskState.nextAttemptAt
            });
            logger.warn?.('[SELF HEALING TASK FAILED]', {
                task: task.name,
                category: failure.category,
                message: failure.message,
                retryable,
                nextAttemptAt: taskState.nextAttemptAt
            });
            return {
                name: task.name,
                ok: false,
                error: failure,
                retryable,
                nextAttemptAt: taskState.nextAttemptAt
            };
        }
    }

    async function runCycle(tasks = [], context = {}) {
        if (cycleRunning) return { ok: false, skipped: true, reason: 'already-running', results: [] };
        cycleRunning = true;
        try {
            const results = [];
            for (const task of tasks) {
                results.push(await runTask(task, context));
            }
            const failed = results.filter(result => !result.ok && !result.skipped).length;
            const needsReview = results.filter(result => (
                result.reason === 'needs-review' ||
                (!result.ok && !result.skipped && result.retryable === false)
            )).length;
            return {
                ok: failed === 0 && needsReview === 0,
                at: nowIso(),
                failed,
                needsReview,
                recovered: results.filter(result => result.ok).length,
                skipped: results.filter(result => result.skipped).length,
                results
            };
        } finally {
            cycleRunning = false;
        }
    }

    async function getSnapshot() {
        await load();
        return safeJson({ ...state, cycleRunning });
    }

    return {
        classifyRecoveryError,
        getSnapshot,
        runCycle,
        runTask
    };
}

module.exports = {
    classifyRecoveryError,
    createSelfHealingSupervisorService
};
