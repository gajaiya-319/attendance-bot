'use strict';

const moment = require('moment-timezone');
const { SHIFT_SCHEDULE } = require('../config/constants');
const {
    getLastPayrollArchiveTimestamp,
    getThreeDayAutoArchiveDecision
} = require('../services/payrollScheduleHelpers');
const { notifyPayrollOwners } = require('../utils/payrollOwnerNotify');
const {
    readOperationalCertificationStatus
} = require('../services/operationalCertificationStatusService');

const AUTO_ARCHIVE_ENABLED = String(process.env.PAYROLL_AUTO_ARCHIVE_ENABLED || 'true').trim().toLowerCase() !== 'false';
const AUTO_ARCHIVE_GRACE_MINS = Number(process.env.PAYROLL_AUTO_ARCHIVE_GRACE_MINS || 60);
const AUTO_ARCHIVE_CRON = process.env.PAYROLL_AUTO_ARCHIVE_CRON || '*/15 * * * *';
const INTEGRITY_AUDIT_ENABLED = String(process.env.PAYROLL_INTEGRITY_AUDIT_ENABLED || 'true').trim().toLowerCase() !== 'false';
const INTEGRITY_AUDIT_CRON = process.env.PAYROLL_INTEGRITY_AUDIT_CRON || '20 15 * * *';
const CERTIFICATION_MONITOR_ENABLED = String(process.env.OPERATIONAL_CERTIFICATION_MONITOR_ENABLED || 'true').trim().toLowerCase() !== 'false';
const CERTIFICATION_MONITOR_CRON = process.env.OPERATIONAL_CERTIFICATION_MONITOR_CRON || '40 3 * * *';

function initPayrollCronSchedulers({
    cron,
    CONFIG,
    client = null,
    payrollArchiveService,
    payrollOperationLogService,
    payrollLiveSummarySyncService = null,
    payrollIntegrityAuditService = null,
    backgroundJobQueueService = null,
    readCertificationStatus = readOperationalCertificationStatus,
    notifyOwners = notifyPayrollOwners,
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

    function scheduleBackgroundJob(key, task, { priority, timeoutMs }) {
        if (!backgroundJobQueueService?.enqueue) {
            return Promise.resolve().then(task).catch(error => {
                logger.error?.(`[PAYROLL BACKGROUND ERROR] ${key}`, error?.message || error);
            });
        }
        return backgroundJobQueueService.enqueue({ key, task, priority, timeoutMs });
    }

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
            savedBy: '시스템 자동저장',
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
                    `✅ **자동 급여 기록 완료** (${close.periodLabel})`,
                    `야간 종료: ${close.nightEndAt.format('YYYY-MM-DD HH:mm')} / 마감 실행 기준: ${close.dueAt.format('YYYY-MM-DD HH:mm')}`,
                    `저장 위치: ${result.periodLabel} · row ${result.row} · ${result.source || 'great-tabs'}`,
                    `서버 기록 ${result.count || 0}건이 Raw_Data에 저장되었습니다.`
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
                content: `⚠️ **자동 급여 기록 실패** (${result.code || 'unknown'})
${result.errorMessage || ''}`.trim()
            });
        }

        return result;
    }

    async function runOperationalCertificationMonitor(trigger = 'daily-cron') {
        const status = await readCertificationStatus();
        const notificationKey = status.attentionRequired
            ? `attention:${status.latestDate || 'missing'}:current-${status.score ?? 'missing'}:daily-${status.dailyScore ?? 'missing'}:${status.code || 'unknown'}`
            : (status.qualified30Days
                ? 'milestone:30-days'
                : (status.qualified7Days ? 'milestone:7-days' : null));
        let alreadyNotified = false;
        if (notificationKey && typeof payrollOperationLogService?.listRecent === 'function') {
            const entries = await payrollOperationLogService.listRecent({ limit: 5000 }).catch(() => []);
            alreadyNotified = entries.some(entry => (
                entry?.kind === 'operational-certification-monitor' &&
                entry?.payload?.notificationKey === notificationKey &&
                entry?.result?.notificationDelivered === true
            ));
        }

        let notification = { sent: 0, failed: 0, fallbackSent: 0 };
        if (notificationKey && !alreadyNotified) {
            const headline = status.attentionRequired
                ? (status.recovered
                    ? 'Operational health recovered; daily certification remains incomplete'
                    : 'Operational certification needs attention')
                : `${status.qualified30Days ? '30-day' : '7-day'} operational certification achieved`;
            notification = await notifyOwners({
                client,
                CONFIG,
                logger,
                content: [
                    `**${headline}**`,
                    `Current score: ${status.score ?? 'unavailable'}/100`,
                    `Daily certification floor: ${status.dailyScore ?? status.score ?? 'unavailable'}/100`,
                    `Certified streak: ${status.consecutiveCertifiedDays || 0}/${status.targetDays || 7}`,
                    `Latest check: ${status.checkedAt || 'unavailable'}`,
                    ...(status.reasons || []).map(reason => `- ${reason}`)
                ].join('\n')
            });
        }

        const notificationDelivered = Number(notification.sent || 0) > 0 || Number(notification.fallbackSent || 0) > 0;
        await payrollOperationLogService?.record?.({
            kind: 'operational-certification-monitor',
            action: 'inspect',
            status: status.activeAttentionRequired ? 'failed' : (status.attentionRequired ? 'warning' : 'success'),
            payload: { trigger, notificationKey },
            result: {
                ...status,
                alreadyNotified,
                notificationDelivered
            },
            source: 'scheduler'
        }).catch(error => logger.warn?.('[CERTIFICATION MONITOR LOG SKIP]', error?.message || error));

        logger.log?.('[CERTIFICATION MONITOR]', {
            score: status.score ?? null,
            dailyScore: status.dailyScore ?? null,
            certifiedDays: status.consecutiveCertifiedDays || 0,
            qualified7Days: Boolean(status.qualified7Days),
            attentionRequired: Boolean(status.attentionRequired),
            notificationDelivered
        });
        return { ...status, alreadyNotified, notificationDelivered };
    }

    const tasks = [
        cron.schedule(AUTO_ARCHIVE_CRON, () => {
            scheduleBackgroundJob('payroll-auto-archive', () => runAutoArchiveIfDue('three-day-night-close'), {
                priority: 98,
                timeoutMs: 180_000
            });
        }, { timezone })
    ];

    if (INTEGRITY_AUDIT_ENABLED && payrollIntegrityAuditService?.runDailyAudit) {
        tasks.push(cron.schedule(INTEGRITY_AUDIT_CRON, () => {
            scheduleBackgroundJob('payroll-integrity-audit', () => payrollIntegrityAuditService.runDailyAudit('daily-cron'), {
                priority: 45,
                timeoutMs: 300_000
            });
        }, { timezone }));
    }

    if (CERTIFICATION_MONITOR_ENABLED && client) {
        tasks.push(cron.schedule(CERTIFICATION_MONITOR_CRON, () => {
            scheduleBackgroundJob('operational-certification-monitor', () => runOperationalCertificationMonitor('daily-cron'), {
                priority: 50,
                timeoutMs: 60_000
            });
        }, { timezone }));
    }

    return {
        runAutoArchiveIfDue,
        AUTO_ARCHIVE_GRACE_MINS,
        AUTO_ARCHIVE_CRON,
        INTEGRITY_AUDIT_CRON,
        CERTIFICATION_MONITOR_CRON,
        runOperationalCertificationMonitor,
        runDailyIntegrityAudit: trigger => payrollIntegrityAuditService?.runDailyAudit?.(trigger || 'manual'),
        stop: () => {
            for (const task of tasks) {
                if (task && typeof task.stop === 'function') task.stop();
            }
        }
    };
}

module.exports = { initPayrollCronSchedulers };
