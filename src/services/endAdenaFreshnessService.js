'use strict';

const fsDefault = require('fs').promises;
const pathDefault = require('path');

const JOBS = Object.freeze([
    { name: 'readiness', kind: 'end-adena-close-readiness', offsetMinutes: -20, weight: 10 },
    { name: 'reset', kind: 'end-adena-summary-reset', offsetMinutes: -10, weight: 25 },
    { name: 'reminder', kind: 'end-adena-approval-reminder', offsetMinutes: 45, weight: 15 },
    { name: 'reconciliation', kind: 'end-adena-reconciliation', offsetMinutes: 60, weight: 50 }
]);

function instantMs(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
}

function shiftWindowKey(shift, start, end) {
    return `${String(shift || '').toUpperCase()}:${start.toISOString()}:${end.toISOString()}`;
}

function collectShiftWindows(now, getShiftBounds, {
    lookbackHours = 48,
    resolveEndAdenaSettlementWindow = null
} = {}) {
    const windows = new Map();
    for (let hours = 0; hours <= lookbackHours; hours += 6) {
        const reference = now.clone().subtract(hours, 'hours');
        for (const shift of ['day', 'night']) {
            const bounds = getShiftBounds(shift, reference);
            if (!bounds?.start?.clone || !bounds?.end?.clone) continue;
            const key = shiftWindowKey(shift, bounds.start, bounds.end);
            windows.set(key, {
                key,
                shift: shift.toUpperCase(),
                bounds: { start: bounds.start.clone(), end: bounds.end.clone() },
                settlement: typeof resolveEndAdenaSettlementWindow === 'function'
                    ? resolveEndAdenaSettlementWindow({
                        shift: shift.toUpperCase(),
                        bounds,
                        at: now
                    })
                    : null
            });
        }
    }
    return [...windows.values()].sort((a, b) => a.bounds.end.valueOf() - b.bounds.end.valueOf());
}

function taskDueAt(window, definition) {
    if (['reminder', 'reconciliation'].includes(definition.name)) {
        if (window.settlement?.activeOvertime) return null;
        const deadlineMs = instantMs(window.settlement?.deadlineAt);
        const deadline = deadlineMs === null
            ? window.bounds.end.clone().add(60, 'minutes')
            : window.bounds.end.clone().add(deadlineMs - window.bounds.end.valueOf(), 'milliseconds');
        return definition.name === 'reminder' ? deadline.subtract(15, 'minutes') : deadline;
    }
    return window.bounds.end.clone().add(definition.offsetMinutes, 'minutes');
}

function operationMatchesWindow(operation, window, dueAt, toleranceMinutes = 20) {
    if (String(operation?.shift || operation?.payload?.shift || '').toUpperCase() !== window.shift) return false;
    const payloadStart = instantMs(operation?.payload?.shiftStartAt || operation?.shiftStartAt);
    const payloadEnd = instantMs(operation?.payload?.shiftEndAt || operation?.shiftEndAt);
    if (payloadStart !== null || payloadEnd !== null) {
        return payloadStart === window.bounds.start.valueOf() && payloadEnd === window.bounds.end.valueOf();
    }
    const createdAt = instantMs(operation?.createdAt);
    return createdAt !== null && Math.abs(createdAt - dueAt.valueOf()) <= toleranceMinutes * 60_000;
}

function reconciliationNeedsReview(operation) {
    const result = operation?.result || {};
    const explicit = Number(result.needsReview);
    if (Number.isFinite(explicit)) return Math.max(0, Math.trunc(explicit));
    const reviewLists = ['missing', 'unexpected', 'duplicates', 'unresolved'];
    if (!reviewLists.every(key => Array.isArray(result[key]))) return null;
    return reviewLists.reduce((sum, key) => sum + result[key].length, 0) +
        (Array.isArray(result.repair?.failures) ? result.repair.failures.length : 0);
}

function isBusinessComplete(operation, definition) {
    if (definition.name !== 'reconciliation') return true;
    if (typeof operation?.result?.businessComplete === 'boolean') {
        return operation.result.businessComplete;
    }
    const needsReview = reconciliationNeedsReview(operation);
    return operation?.result?.ok !== false && needsReview === 0;
}

function evaluateEndAdenaFreshness({
    now,
    monitoringStartedAt,
    windows,
    operations,
    graceMinutes = 5,
    reviewReminderMinutes = 30
}) {
    const startedMs = instantMs(monitoringStartedAt);
    const tasks = [];
    const cycles = [];
    for (const window of windows || []) {
        const cycleTasks = [];
        for (const definition of JOBS) {
            const dueAt = taskDueAt(window, definition);
            if (!dueAt) continue;
            const graceAt = dueAt.clone().add(graceMinutes, 'minutes');
            if (startedMs !== null && dueAt.valueOf() < startedMs) continue;
            if (now.isBefore(graceAt)) continue;
            const successfulExecutions = (operations || [])
                .filter(operation => operation?.kind === definition.kind && operation?.status === 'success')
                .filter(operation => operationMatchesWindow(operation, window, dueAt))
                .sort((a, b) => (instantMs(a.createdAt) || 0) - (instantMs(b.createdAt) || 0));
            const certifiableExecutions = successfulExecutions.filter(operation => isBusinessComplete(operation, definition));
            const success = certifiableExecutions[0] || null;
            const incomplete = !success && successfulExecutions.length
                ? successfulExecutions[successfulExecutions.length - 1]
                : null;
            const completion = success || incomplete;
            const completedAtMs = instantMs(completion?.createdAt);
            const status = incomplete
                ? 'needs-review'
                : (!success ? 'missing' : (completedAtMs <= graceAt.valueOf() ? 'on-time' : 'recovered'));
            const task = {
                key: `${window.key}:${definition.name}`,
                windowKey: window.key,
                shift: window.shift,
                name: definition.name,
                kind: definition.kind,
                weight: definition.weight,
                dueAt: dueAt.toISOString(),
                graceAt: graceAt.toISOString(),
                status,
                completedAt: completion?.createdAt || null,
                businessComplete: status !== 'needs-review' && Boolean(success),
                needsReview: incomplete ? (reconciliationNeedsReview(incomplete) ?? 1) : 0,
                bounds: window.bounds
            };
            tasks.push(task);
            cycleTasks.push(task);
        }
        const reconciliationDefinition = JOBS.find(job => job.name === 'reconciliation');
        const reconciliationDue = taskDueAt(window, reconciliationDefinition);
        const finalDue = reconciliationDue?.clone().add(graceMinutes, 'minutes') || null;
        if (finalDue && startedMs !== null && finalDue.valueOf() >= startedMs && now.isSameOrAfter(finalDue)) {
            cycles.push({
                key: window.key,
                shift: window.shift,
                shiftStartAt: window.bounds.start.toISOString(),
                shiftEndAt: window.bounds.end.toISOString(),
                workEndAt: window.settlement?.workEndAt || window.bounds.end.toISOString(),
                settlementDeadlineAt: reconciliationDue.toISOString(),
                overtimeExtensionMinutes: Number(window.settlement?.extensionMinutes || 0),
                certified: cycleTasks.length === JOBS.length && cycleTasks.every(task => task.status === 'on-time'),
                tasks: cycleTasks.map(task => ({ name: task.name, status: task.status, dueAt: task.dueAt, completedAt: task.completedAt }))
            });
        }
    }

    const earned = tasks.reduce((sum, task) => {
        if (task.status === 'on-time') return sum + task.weight;
        if (task.status === 'recovered') return sum + task.weight * 0.75;
        return sum;
    }, 0);
    const possible = tasks.reduce((sum, task) => sum + task.weight, 0);
    return {
        score: possible > 0 ? Math.round((earned / possible) * 100) : 100,
        ready: cycles.length > 0,
        issueCount: tasks.filter(task => task.status === 'missing' || task.status === 'needs-review').length,
        recoveredCount: tasks.filter(task => task.status === 'recovered').length,
        dueTaskCount: tasks.length,
        certifiedCycles: cycles.filter(cycle => cycle.certified).length,
        completedCycles: cycles.length,
        tasks,
        cycles
    };
}

function buildFreshnessAlert(report) {
    const missing = report.tasks.filter(task => task.status === 'missing');
    const needsReview = report.tasks.filter(task => task.status === 'needs-review');
    const recovered = report.tasks.filter(task => task.status === 'recovered');
    const actionLines = (report.recoveryActions || []).map(action => (
        `- Recovery ${action.shift} ${action.name}: ${action.ok ? 'SUCCESS' : 'FAILED'}`
    ));
    return [
        'End Adena scheduled-job audit',
        `PH TIME: ${report.checkedAtLabel}`,
        `Score ${report.score}/100 / missing ${missing.length} / needs review ${needsReview.length} / recovered late ${recovered.length}`,
        ...missing.slice(0, 10).map(task => `- Missing ${task.shift} ${task.name} (${task.dueAt})`),
        ...needsReview.slice(0, 10).map(task => `- Needs review ${task.shift} ${task.name}: ${task.needsReview} item(s)`),
        ...recovered.slice(0, 10).map(task => `- Late ${task.shift} ${task.name} (${task.completedAt})`),
        ...actionLines,
        missing.some(task => task.name === 'reset')
            ? 'A missed reset is never replayed late; final reconciliation compensates safely.'
            : null
    ].filter(Boolean).join('\n').slice(0, 1950);
}

function createEndAdenaFreshnessService({
    CONFIG,
    moment,
    getShiftBounds,
    payrollOperationLogService,
    endAdenaReconciliationService,
    client = null,
    stateFilePath = './logs/end-adena-freshness.json',
    fs = fsDefault,
    path = pathDefault,
    logger = console,
    graceMinutes = 5,
    reviewReminderMinutes = 30
}) {
    if (!CONFIG?.TIMEZONE) throw new TypeError('CONFIG.TIMEZONE must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (typeof getShiftBounds !== 'function') throw new TypeError('getShiftBounds must be a function');
    if (typeof payrollOperationLogService?.listRecent !== 'function') throw new TypeError('payrollOperationLogService.listRecent must be a function');
    if (typeof endAdenaReconciliationService?.run !== 'function') throw new TypeError('endAdenaReconciliationService.run must be a function');

    async function readState() {
        try {
            return JSON.parse(await fs.readFile(stateFilePath, 'utf8'));
        } catch (error) {
            if (error?.code !== 'ENOENT') logger.warn?.('[END ADENA FRESHNESS STATE READ WARN]', error?.message || error);
            return null;
        }
    }

    async function writeState(state) {
        await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
        const temporary = `${stateFilePath}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8');
        await fs.rename(temporary, stateFilePath);
    }

    async function recoverMissingTasks(evaluation, now, guild) {
        const actions = [];
        for (const task of evaluation.tasks.filter(item => item.status === 'missing')) {
            if (task.name === 'readiness') {
                const resetAt = task.bounds.end.clone().subtract(10, 'minutes');
                if (now.isBefore(resetAt) && typeof endAdenaReconciliationService.reportCloseReadiness === 'function') {
                    const result = await endAdenaReconciliationService.reportCloseReadiness({
                        shift: task.shift,
                        bounds: task.bounds,
                        at: now,
                        guild
                    }).catch(error => ({ ok: false, error: error?.message || String(error) }));
                    actions.push({ shift: task.shift, name: task.name, ok: Boolean(result?.ok), result });
                }
            } else if (task.name === 'reminder') {
                const finalAt = moment(task.dueAt).tz(CONFIG.TIMEZONE).add(15, 'minutes');
                if (now.isBefore(finalAt) && typeof endAdenaReconciliationService.remindPendingApprovals === 'function') {
                    const result = await endAdenaReconciliationService.remindPendingApprovals({
                        shift: task.shift,
                        bounds: task.bounds,
                        at: now,
                        guild
                    }).catch(error => ({ ok: false, error: error?.message || String(error) }));
                    actions.push({ shift: task.shift, name: task.name, ok: Boolean(result?.ok), result });
                }
            } else if (task.name === 'reconciliation') {
                const result = await endAdenaReconciliationService.run({
                    shift: task.shift,
                    bounds: task.bounds,
                    at: now,
                    guild,
                    source: 'freshness-recovery'
                }).catch(error => ({ ok: false, error: error?.message || String(error) }));
                actions.push({ shift: task.shift, name: task.name, ok: Boolean(result?.ok), result });
            }
        }
        return actions;
    }

    async function audit({ at = moment().tz(CONFIG.TIMEZONE), guild = null, repair = true } = {}) {
        const now = moment(at).tz(CONFIG.TIMEZONE);
        const previous = await readState();
        const monitoringStartedAt = previous?.monitoringStartedAt || now.toISOString();
        const windows = collectShiftWindows(now, getShiftBounds, {
            resolveEndAdenaSettlementWindow: typeof endAdenaReconciliationService?.getSettlementWindow === 'function'
                ? options => endAdenaReconciliationService.getSettlementWindow(options)
                : null
        });
        let operations = await payrollOperationLogService.listRecent({ limit: 10_000, date: now.toDate() });
        let evaluation = evaluateEndAdenaFreshness({
            now,
            monitoringStartedAt,
            windows,
            operations,
            graceMinutes
        });
        const targetGuild = guild || client?.guilds?.cache?.get?.(CONFIG.GUILD_ID) || null;
        const recoveryActions = repair ? await recoverMissingTasks(evaluation, now, targetGuild) : [];
        if (recoveryActions.length) {
            operations = await payrollOperationLogService.listRecent({ limit: 10_000, date: now.toDate() });
            evaluation = evaluateEndAdenaFreshness({
                now,
                monitoringStartedAt,
                windows,
                operations,
                graceMinutes
            });
        }

        const taskSignature = evaluation.tasks.map(task => `${task.key}:${task.status}`).join('|');
        const anomalySignature = evaluation.tasks
            .filter(task => task.status !== 'on-time')
            .map(task => `${task.key}:${task.status}`)
            .join('|');
        const alertSignature = evaluation.issueCount || evaluation.recoveredCount || recoveryActions.length
            ? anomalySignature
            : null;
        const hasReviewRequired = evaluation.tasks.some(task => task.status === 'needs-review');
        const previousAlertAtMs = instantMs(previous?.lastAlertAt);
        const repeatReviewDue = hasReviewRequired && (
            previousAlertAtMs === null || now.valueOf() - previousAlertAtMs >= reviewReminderMinutes * 60_000
        );
        const shouldAlert = Boolean(alertSignature && (
            alertSignature !== previous?.lastAlertSignature || repeatReviewDue
        ));
        const report = {
            version: 2,
            checkedAt: now.toISOString(),
            checkedAtLabel: now.format('YYYY-MM-DD HH:mm:ss'),
            monitoringStartedAt,
            ...evaluation,
            recoveryActions: recoveryActions.map(action => ({ shift: action.shift, name: action.name, ok: action.ok })),
            lastAlertSignature: alertSignature || previous?.lastAlertSignature || null,
            lastAlertAt: previous?.lastAlertAt || null,
            taskSignature
        };

        if (shouldAlert && CONFIG.LOG_CHANNEL && client?.channels?.fetch) {
            const channel = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
            const sent = await channel?.send?.(buildFreshnessAlert(report))
                .then(() => true)
                .catch(error => {
                    logger.warn?.('[END ADENA FRESHNESS ALERT WARN]', error?.message || error);
                    return false;
                });
            if (sent) report.lastAlertAt = now.toISOString();
        }
        await writeState(report);
        if (taskSignature !== previous?.taskSignature || recoveryActions.length) {
            await payrollOperationLogService.record?.({
                kind: 'end-adena-freshness-audit',
                action: 'audit',
                status: evaluation.issueCount === 0 ? 'success' : 'failed',
                payload: { monitoringStartedAt, checkedAt: now.toISOString() },
                result: {
                    score: report.score,
                    ready: report.ready,
                    issueCount: report.issueCount,
                    recoveredCount: report.recoveredCount,
                    certifiedCycles: report.certifiedCycles,
                    completedCycles: report.completedCycles,
                    recoveryActions: report.recoveryActions
                },
                source: 'freshness-monitor'
            });
        }
        return report;
    }

    return { audit, readState };
}

module.exports = {
    JOBS,
    collectShiftWindows,
    operationMatchesWindow,
    evaluateEndAdenaFreshness,
    buildFreshnessAlert,
    createEndAdenaFreshnessService
};
