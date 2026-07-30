'use strict';

function createBackgroundJobQueueService({
    logger = console,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    lagIntervalMs = 10_000,
    lagWarnMs = 750,
    onStats = null
} = {}) {
    const pending = [];
    const activeKeys = new Set();
    let running = false;
    let scheduled = false;
    let lagTimer = null;
    let statsPublish = Promise.resolve();
    const stats = {
        enqueued: 0,
        completed: 0,
        failed: 0,
        deduplicated: 0,
        timeoutWarnings: 0,
        maxQueueDepth: 0,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastFailedAt: null,
        lastFailure: null,
        lastEventLoopLagMs: 0,
        maxEventLoopLagMs: 0,
        eventLoopLagWarnings: 0
    };

    function snapshot() {
        return {
            ...stats,
            running,
            runningKeys: [...activeKeys],
            pending: pending.length,
            pendingKeys: pending.map(job => job.key)
        };
    }

    function publishStats() {
        if (typeof onStats !== 'function') return;
        const value = snapshot();
        statsPublish = statsPublish
            .then(() => onStats(value))
            .catch(error => logger.warn?.('[BACKGROUND QUEUE STATS ERROR]', error?.message || error));
    }

    function scheduleDrain() {
        if (scheduled || running) return;
        scheduled = true;
        Promise.resolve().then(() => {
            scheduled = false;
            return drain();
        }).catch(error => {
            logger.error?.('[BACKGROUND QUEUE DRAIN ERROR]', error?.message || error);
        });
    }

    async function runJob(job) {
        running = true;
        activeKeys.add(job.key);
        stats.lastStartedAt = new Date(now()).toISOString();
        const startedAt = now();
        let timeoutTimer = null;
        if (job.timeoutMs > 0) {
            timeoutTimer = setTimeoutFn(() => {
                stats.timeoutWarnings += 1;
                logger.log?.('[BACKGROUND JOB SLOW]', {
                    key: job.key,
                    timeoutMs: job.timeoutMs,
                    pending: pending.length
                });
            }, job.timeoutMs);
            timeoutTimer?.unref?.();
        }
        try {
            const result = await job.task();
            stats.completed += 1;
            stats.lastCompletedAt = new Date(now()).toISOString();
            logger.log?.('[BACKGROUND JOB OK]', {
                key: job.key,
                durationMs: Math.max(0, now() - startedAt),
                pending: pending.length
            });
            job.resolve?.({ ok: true, key: job.key, result });
        } catch (error) {
            stats.failed += 1;
            stats.lastFailedAt = new Date(now()).toISOString();
            stats.lastFailure = { key: job.key, message: error?.message || String(error) };
            logger.warn?.('[BACKGROUND JOB ERROR]', stats.lastFailure);
            job.resolve?.({ ok: false, key: job.key, error });
        } finally {
            if (timeoutTimer) clearTimeoutFn(timeoutTimer);
            activeKeys.delete(job.key);
            running = false;
            publishStats();
            scheduleDrain();
        }
    }

    async function drain() {
        if (running || !pending.length) return;
        pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        const job = pending.shift();
        await runJob(job);
    }

    function enqueue({ key, task, priority = 0, timeoutMs = 60_000 } = {}) {
        if (!key || typeof task !== 'function') {
            throw new TypeError('Background jobs require a key and task function');
        }
        if (activeKeys.has(key) || pending.some(job => job.key === key)) {
            stats.deduplicated += 1;
            return { accepted: false, deduplicated: true, key };
        }
        stats.enqueued += 1;
        let resolveCompletion;
        const completion = new Promise(resolve => { resolveCompletion = resolve; });
        pending.push({
            key,
            task,
            priority: Number(priority || 0),
            timeoutMs: Number(timeoutMs || 0),
            sequence: stats.enqueued,
            resolve: resolveCompletion
        });
        stats.maxQueueDepth = Math.max(stats.maxQueueDepth, pending.length);
        scheduleDrain();
        return { accepted: true, deduplicated: false, key, completion };
    }

    function startEventLoopLagMonitor() {
        if (lagTimer) return () => stopEventLoopLagMonitor();
        let expectedAt = now() + lagIntervalMs;
        lagTimer = setIntervalFn(() => {
            const measuredAt = now();
            const lagMs = Math.max(0, measuredAt - expectedAt);
            expectedAt = measuredAt + lagIntervalMs;
            stats.lastEventLoopLagMs = lagMs;
            stats.maxEventLoopLagMs = Math.max(stats.maxEventLoopLagMs, lagMs);
            if (lagMs >= lagWarnMs) {
                stats.eventLoopLagWarnings += 1;
                logger.log?.('[EVENT LOOP LAG]', { lagMs, thresholdMs: lagWarnMs });
            }
        }, lagIntervalMs);
        lagTimer?.unref?.();
        return () => stopEventLoopLagMonitor();
    }

    function stopEventLoopLagMonitor() {
        if (!lagTimer) return;
        clearIntervalFn(lagTimer);
        lagTimer = null;
    }

    return {
        enqueue,
        getStats: snapshot,
        startEventLoopLagMonitor,
        stopEventLoopLagMonitor
    };
}

module.exports = { createBackgroundJobQueueService };
