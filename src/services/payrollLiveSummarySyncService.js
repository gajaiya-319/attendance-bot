'use strict';

const { syncLiveThreeDaySummaryValues } = require('../../scripts/lib/payroll-live-summary-sync');
const { notifyPayrollOwners } = require('../utils/payrollOwnerNotify');

const SCHEDULE_DEBOUNCE_MS = 4000;
const DEFAULT_ALERT_THRESHOLD = Number(process.env.PAYROLL_LIVE_SYNC_ALERT_THRESHOLD || 3);
const ALERT_COOLDOWN_MS = Number(process.env.PAYROLL_LIVE_SYNC_ALERT_COOLDOWN_MS || 30 * 60 * 1000);

function createPayrollLiveSummarySyncService({
    client = null,
    CONFIG = null,
    failureAlertThreshold = DEFAULT_ALERT_THRESHOLD,
    alertCooldownMs = ALERT_COOLDOWN_MS,
    syncFn = syncLiveThreeDaySummaryValues,
    logger = console
} = {}) {
    let running = false;
    let debounceTimer = null;
    let consecutiveFailures = 0;
    let lastAlertAt = 0;

    async function maybeAlertFailure(result) {
        if (!client || !CONFIG || consecutiveFailures < failureAlertThreshold) return;
        const now = Date.now();
        if (now - lastAlertAt < alertCooldownMs) return;
        lastAlertAt = now;
        const detail = result?.code || result?.message || 'unknown';
        await notifyPayrollOwners({
            client,
            CONFIG,
            logger,
            content: [
                `⚠️ **최근_3일_요약 동기화** 연속 ${consecutiveFailures}회 실패`,
                `원인: \`${detail}\``,
                `조치: Great 탭 확인 → \`npm run ops:sync-live-3day\` 또는 \`npm run ops:google-check\``
            ].join('\n')
        });
    }

    function recordSuccess() {
        consecutiveFailures = 0;
    }

    function recordFailure(result) {
        consecutiveFailures += 1;
        return maybeAlertFailure(result);
    }

    async function sync() {
        if (running) {
            logger.warn?.('[PAYROLL LIVE SYNC] Skip — previous run still active.');
            return { ok: false, code: 'busy' };
        }
        running = true;
        try {
            const result = await syncFn();
            if (!result.ok) {
                logger.warn?.('[PAYROLL LIVE SYNC]', result);
                await recordFailure(result);
            } else {
                recordSuccess();
            }
            return result;
        } catch (error) {
            logger.warn?.('[PAYROLL LIVE SYNC ERROR]', error?.message || error);
            const result = { ok: false, code: 'error', message: error?.message };
            await recordFailure(result);
            return result;
        } finally {
            running = false;
        }
    }

    function scheduleSync() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            sync().catch(error => {
                logger.warn?.('[PAYROLL LIVE SYNC DEBOUNCE]', error?.message || error);
            });
        }, SCHEDULE_DEBOUNCE_MS);
    }

    return { sync, scheduleSync };
}

module.exports = {
    createPayrollLiveSummarySyncService
};
