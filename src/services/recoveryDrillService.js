'use strict';

const fsSync = require('fs');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const moment = require('moment-timezone');
const { createDataStore } = require('./dataStore');
const { createOpsQueueService } = require('./opsQueueService');
const { runOpsQueueAutoRecovery } = require('./opsQueueAutoRecoveryService');
const { createSelfHealingSupervisorService } = require('./selfHealingSupervisorService');

function requireResult(condition, message) {
    if (!condition) throw new Error(message);
}

function createDrillConfig(dir) {
    return {
        TIMEZONE: 'Asia/Manila',
        DAY_CHAN: 'recovery-drill-day',
        NIGHT_CHAN: 'recovery-drill-night',
        FILES: {
            DATA: path.join(dir, 'attendanceData.json'),
            BACKUP: path.join(dir, 'attendanceData.json.bak'),
            BACKUP_DIR: path.join(dir, 'backups'),
            MAX_BACKUPS: 2
        }
    };
}

async function runStateBackupFallback(rootDir) {
    const dir = path.join(rootDir, 'state-fallback');
    const config = createDrillConfig(dir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(config.FILES.DATA, '{corrupt-primary', 'utf8');
    await fs.writeFile(config.FILES.BACKUP, JSON.stringify({
        attendanceData: { 'recovery-drill-user': { id: 'recovery-drill-user', checkedIn: true } },
        overtimeUsers: [],
        dayOffReservations: {},
        liveExceptions: {},
        attendanceEventLog: []
    }), 'utf8');

    const store = createDataStore({ config, fsSync, fs, moment });
    const expectedErrors = [];
    const originalError = console.error;
    console.error = (...args) => expectedErrors.push(args.map(String).join(' '));
    try {
        store.loadSystem();
    } finally {
        console.error = originalError;
    }

    requireResult(store.meta.lastLoadSource === 'backup', 'corrupt primary did not fall back to backup');
    requireResult(store.db.attendanceData['recovery-drill-user']?.checkedIn === true, 'backup state was not restored');
    requireResult(expectedErrors.some(line => line.includes('[LOAD RECOVERY]')), 'backup recovery was not reported');
    return { source: store.meta.lastLoadSource, recovered: true };
}

async function runTransientQueueRecovery(rootDir) {
    const queue = createOpsQueueService({
        filePath: path.join(rootDir, 'queue-retry', 'ops-pending.json'),
        logger: { log() {}, warn() {}, error() {} }
    });
    await queue.enqueue({
        kind: 'end-adena',
        action: 'write',
        messageId: 'recovery-drill-message',
        server: 'PAAGRIO',
        userName: 'Recovery Drill',
        code: 'sheet-api-error',
        payload: { amount: 60000 }
    });

    let writeCalls = 0;
    const retryItem = async () => {
        writeCalls += 1;
        return { ok: true, range: 'DRILL!A1' };
    };
    const first = await runOpsQueueAutoRecovery({
        opsQueueService: queue,
        retryItem,
        now: new Date('2026-01-01T00:00:00.000Z'),
        force: true,
        logger: { log() {}, warn() {}, error() {} }
    });
    const second = await runOpsQueueAutoRecovery({
        opsQueueService: queue,
        retryItem,
        now: new Date('2026-01-01T00:01:00.000Z'),
        force: true,
        logger: { log() {}, warn() {}, error() {} }
    });

    requireResult(first.succeeded === 1, 'transient queue item was not recovered');
    requireResult((await queue.list()).length === 0, 'recovered queue item was not removed');
    requireResult(second.total === 0 && writeCalls === 1, 'recovery retry was not idempotent');
    return { recovered: first.succeeded, duplicateWrites: writeCalls - 1 };
}

async function runManualReviewBoundary(rootDir) {
    const queue = createOpsQueueService({
        filePath: path.join(rootDir, 'manual-boundary', 'ops-pending.json'),
        logger: { log() {}, warn() {}, error() {} }
    });
    await queue.enqueue({
        kind: 'end-adena',
        action: 'write',
        messageId: 'recovery-drill-review',
        server: 'PAAGRIO',
        userName: 'Recovery Drill',
        code: 'invalid-payload',
        payload: {}
    });

    let writeCalls = 0;
    const result = await runOpsQueueAutoRecovery({
        opsQueueService: queue,
        retryItem: async () => {
            writeCalls += 1;
            return { ok: true };
        },
        now: new Date('2026-01-01T00:00:00.000Z'),
        logger: { log() {}, warn() {}, error() {} }
    });
    const kept = await queue.list();

    requireResult(writeCalls === 0, 'manager-review item was automatically executed');
    requireResult(result.needsReview === 1, 'manager-review item was not classified for review');
    requireResult(kept.length === 1 && kept[0].status === 'needs-review', 'manager-review item was not preserved');
    return { autoExecuted: false, needsReview: result.needsReview };
}

async function runSelfHealingBackoff(rootDir, checkedAt) {
    let currentMs = new Date(checkedAt).getTime();
    let repairCalls = 0;
    const supervisor = createSelfHealingSupervisorService({
        filePath: path.join(rootDir, 'self-healing', 'state.json'),
        auditFilePath: path.join(rootDir, 'self-healing', 'audit.jsonl'),
        now: () => currentMs,
        baseRetryDelayMs: 1000,
        maxRetryDelayMs: 1000,
        logger: { log() {}, warn() {}, error() {} }
    });
    const task = {
        name: 'recovery-drill-transient-task',
        repair: async () => {
            repairCalls += 1;
            if (repairCalls === 1) {
                const error = new Error('simulated ECONNRESET');
                error.code = 'ECONNRESET';
                throw error;
            }
            return { changed: true };
        },
        verify: result => ({ ok: result?.changed === true })
    };

    const failed = await supervisor.runTask(task, { reason: 'isolated-recovery-drill' });
    requireResult(failed.ok === false && failed.retryable === true, 'transient failure did not enter retry state');
    currentMs += 1100;
    const recovered = await supervisor.runTask(task, { reason: 'isolated-recovery-drill' });
    const snapshot = await supervisor.getSnapshot();
    const taskState = snapshot.tasks[task.name];

    requireResult(recovered.ok === true, 'self-healing retry did not recover');
    requireResult(taskState?.status === 'healthy', 'self-healing task did not return to healthy');
    requireResult(taskState?.totalRuns === 2 && repairCalls === 2, 'self-healing retry count is incorrect');
    return { recovered: true, attempts: repairCalls, finalStatus: taskState.status };
}

async function runRecoveryDrill({
    checkedAt = new Date(),
    tempRoot = os.tmpdir()
} = {}) {
    const checkedAtIso = new Date(checkedAt).toISOString();
    const rootDir = await fs.mkdtemp(path.join(tempRoot, 'attendance-recovery-drill-'));
    const scenarios = [];
    const definitions = [
        ['state-backup-fallback', () => runStateBackupFallback(rootDir)],
        ['transient-queue-idempotency', () => runTransientQueueRecovery(rootDir)],
        ['manual-review-boundary', () => runManualReviewBoundary(rootDir)],
        ['self-healing-backoff', () => runSelfHealingBackoff(rootDir, checkedAtIso)]
    ];

    try {
        for (const [name, execute] of definitions) {
            const startedAt = Date.now();
            try {
                const detail = await execute();
                scenarios.push({ name, ok: true, durationMs: Date.now() - startedAt, detail });
            } catch (error) {
                scenarios.push({
                    name,
                    ok: false,
                    durationMs: Date.now() - startedAt,
                    error: error?.message || String(error)
                });
            }
        }
    } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
    }

    const failures = scenarios.filter(item => !item.ok).map(item => ({ name: item.name, error: item.error }));
    return {
        ok: failures.length === 0,
        checkedAt: checkedAtIso,
        isolated: true,
        scenarioCount: scenarios.length,
        failureCount: failures.length,
        scenarios,
        failures
    };
}

module.exports = {
    runRecoveryDrill
};
