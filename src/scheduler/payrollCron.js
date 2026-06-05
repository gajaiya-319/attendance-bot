'use strict';

const moment = require('moment-timezone');
const { SHIFT_SCHEDULE } = require('../config/constants');
const {
    getLastPayrollArchiveTimestamp,
    getThreeDayAutoArchiveDecision
} = require('../services/payrollScheduleHelpers');
const { notifyPayrollOwners } = require('../utils/payrollOwnerNotify');

const AUTO_ARCHIVE_ENABLED = String(process.env.PAYROLL_AUTO_ARCHIVE_ENABLED || 'true').trim().toLowerCase() !== 'false';
const AUTO_ARCHIVE_GRACE_MINS = Number(process.env.PAYROLL_AUTO_ARCHIVE_GRACE_MINS || 60);
const AUTO_ARCHIVE_CRON = process.env.PAYROLL_AUTO_ARCHIVE_CRON || '*/15 * * * *';

function initPayrollCronSchedulers({
    cron,
    CONFIG,
    client = null,
    payrollArchiveService,
    payrollOperationLogService,
    payrollLiveSummarySyncService = null,
    shiftSchedule = SHIFT_SCHEDULE,
    logger = console
}) {
    if (!cron || typeof cron.schedule !== 'function') {
        throw new TypeError('cron.schedule must be a function');
    }
    if (!payrollArchiveService || typeof payrollArchiveService.saveCurrent !== 'function') {
        throw new TypeError('payrollArchiveService.saveCurrent must be a function');
    }

    const timezone = CONFIG?.TIMEZONE || 'Asia/Seoul';

    async function runAutoArchiveIfDue(trigger) {
        if (!AUTO_ARCHIVE_ENABLED) return { skipped: true, reason: 'disabled' };

        const lastMs = await getLastPayrollArchiveTimestamp({
            operationLog: payrollOperationLogService,
            payrollArchiveService
        });
        const now = moment().tz(timezone);
        const worklistReferenceDate = typeof payrollArchiveService.getWorklistPayrollReferenceDate === 'function'
            ? await payrollArchiveService.getWorklistPayrollReferenceDate(now.toDate())
            : null;

        if (!worklistReferenceDate) {
            logger.warn?.(`[PAYROLL CRON] ${trigger}: skipped (missing-worklist-reference-date)`);
            return { skipped: true, reason: 'missing-worklist-reference-date' };
        }
        const periodState = typeof payrollArchiveService.getOrCreatePayrollPeriodState === 'function'
            ? await payrollArchiveService.getOrCreatePayrollPeriodState({
                referenceDate: worklistReferenceDate,
                now: now.toDate(),
                source: 'auto-cron'
            })
            : null;
        if (!periodState?.periodEnd) {
            logger.warn?.(`[PAYROLL CRON] ${trigger}: skipped (missing-period-state)`);
            return { skipped: true, reason: 'missing-period-state' };
        }
        if (String(periodState.status || '').toUpperCase() === 'CLOSED') {
            logger.log?.(`[PAYROLL CRON] ${trigger}: skipped (period-already-closed) ${periodState.periodKey}`);
            return { skipped: true, reason: 'period-already-closed', periodState };
        }

        const decision = getThreeDayAutoArchiveDecision({
            now,
            referenceDate: periodState.periodEnd,
            lastArchiveMs: lastMs,
            moment,
            timezone,
            shiftSchedule,
            graceMinutes: AUTO_ARCHIVE_GRACE_MINS
        });

        if (!decision.due) {
            const close = decision.latestClose;
            const closeText = close ? close.dueAt.format('YYYY-MM-DD HH:mm') : 'not-ready';
            logger.log?.(`[PAYROLL CRON] ${trigger}: skipped (${decision.reason}) close=${closeText}`);
            return { skipped: true, reason: decision.reason, latestClose: close || null };
        }

        const close = decision.latestClose;
        logger.log?.(`[PAYROLL CRON] ${trigger}: ${close.periodLabel} auto payroll archive start`);
        const result = await payrollArchiveService.saveCurrent({
            periodLabel: close.periodLabel,
            savedBy: `cron-${trigger}`,
            savedAt: new Date(),
            trigger,
            periodState
        });

        if (result.ok) {
            logger.log?.(`[PAYROLL CRON] auto payroll archive complete (${result.count || 0}, ${result.source || 'unknown'})`);
            if (payrollLiveSummarySyncService && typeof payrollLiveSummarySyncService.scheduleSync === 'function') {
                payrollLiveSummarySyncService.scheduleSync();
            }
            await notifyPayrollOwners({
                client,
                CONFIG,
                logger,
                content: [
                    `✅ **자동 /급여기록** (${close.periodLabel})`,
                    `야간 종료: ${close.nightEndAt.format('YYYY-MM-DD HH:mm')} / 마감 실행 기준: ${close.dueAt.format('YYYY-MM-DD HH:mm')}`,
                    `회차: ${result.periodLabel} · row ${result.row} · ${result.source || 'great-tabs'}`,
                    `서버 ${result.count || 0}건 Raw_Data 저장됨.`
                ].join('\n')
            });
        } else if (result.code === 'archive-in-progress') {
            logger.warn?.('[PAYROLL CRON] auto payroll archive skipped because another archive is running');
        } else {
            logger.warn?.('[PAYROLL CRON] auto payroll archive failed', result);
            await notifyPayrollOwners({
                client,
                CONFIG,
                logger,
                content: `⚠️ **자동 /급여기록 실패** (${result.code || 'unknown'})\n${result.errorMessage || ''}`.trim()
            });
        }

        return result;
    }

    const tasks = [
        cron.schedule(AUTO_ARCHIVE_CRON, () => {
            runAutoArchiveIfDue('three-day-night-close').catch(error => {
                logger.error?.('[PAYROLL CRON ERROR] three-day-night-close', error?.message || error);
            });
        }, { timezone })
    ];

    return {
        runAutoArchiveIfDue,
        AUTO_ARCHIVE_GRACE_MINS,
        AUTO_ARCHIVE_CRON,
        stop: () => {
            for (const task of tasks) {
                if (task && typeof task.stop === 'function') task.stop();
            }
        }
    };
}

module.exports = { initPayrollCronSchedulers };
