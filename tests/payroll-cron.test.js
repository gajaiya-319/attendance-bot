const assert = require('assert');
const { initPayrollCronSchedulers } = require('../src/scheduler/payrollCron');

(async () => {
    const schedules = [];
    const cron = {
        schedule: (rule, fn, options) => {
            schedules.push({ rule, options });
            return { rule };
        }
    };

    const scheduler = initPayrollCronSchedulers({
        cron,
        CONFIG: { TIMEZONE: 'Asia/Seoul' },
        payrollArchiveService: {
            saveCurrent: async () => ({ ok: true }),
            getWorklistPayrollReferenceDate: async () => new Date('2026-06-03T00:00:00Z'),
            getOrCreatePayrollPeriodState: async () => ({
                periodKey: '2026-06-01_2026-06-03',
                periodStart: '2026-06-01',
                periodEnd: '2026-06-03',
                status: 'OPEN',
                rowNumber: 2
            })
        },
        payrollOperationLogService: { listRecent: async () => [] },
        logger: { log: () => {}, warn: () => {}, error: () => {} }
    });

    const rules = schedules.map(s => s.rule);
    assert(rules.includes('*/15 * * * *'));
    assert(!rules.includes('0 12 1 * *'));
    assert.strictEqual(schedules.length, 1);
    assert.strictEqual(scheduler.AUTO_ARCHIVE_GRACE_MINS, 60);

    {
        const integritySchedules = [];
        let integrityRuns = 0;
        const integrityScheduler = initPayrollCronSchedulers({
            cron: {
                schedule: (rule, fn, options) => {
                    integritySchedules.push({ rule, fn, options });
                    return { stop: () => {} };
                }
            },
            CONFIG: { TIMEZONE: 'Asia/Seoul' },
            payrollArchiveService: {
                saveCurrent: async () => ({ ok: true })
            },
            payrollIntegrityAuditService: {
                runDailyAudit: async () => {
                    integrityRuns += 1;
                    return { ok: true };
                }
            },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });
        assert.strictEqual(integritySchedules.length, 2);
        assert(integritySchedules.some(item => item.rule === '20 15 * * *'));
        await integritySchedules.find(item => item.rule === '20 15 * * *').fn();
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(integrityRuns, 1);
        assert.strictEqual(integrityScheduler.INTEGRITY_AUDIT_CRON, '20 15 * * *');
    }

    {
        const monitorSchedules = [];
        const notifications = [];
        const operationEntries = [];
        const monitorScheduler = initPayrollCronSchedulers({
            cron: {
                schedule: (rule, fn, options) => {
                    monitorSchedules.push({ rule, fn, options });
                    return { stop: () => {} };
                }
            },
            CONFIG: { TIMEZONE: 'Asia/Seoul', OWNER_IDS: ['owner'] },
            client: {},
            payrollArchiveService: { saveCurrent: async () => ({ ok: true }) },
            payrollOperationLogService: {
                listRecent: async () => operationEntries,
                record: async entry => operationEntries.push(entry)
            },
            readCertificationStatus: async () => ({
                available: true,
                code: 'attention-required',
                attentionRequired: true,
                score: 90,
                dailyScore: 80,
                activeAttentionRequired: true,
                certified: false,
                consecutiveCertifiedDays: 0,
                targetDays: 7,
                latestDate: '2026-07-30',
                checkedAt: '2026-07-30T01:00:00.000Z',
                reasons: ['Operational score is 90/100.']
            }),
            notifyOwners: async ({ content }) => {
                notifications.push(content);
                return { sent: 1, failed: 0, fallbackSent: 0 };
            },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });
        assert(monitorSchedules.some(item => item.rule === '40 3 * * *'));
        assert.strictEqual(monitorScheduler.CERTIFICATION_MONITOR_CRON, '40 3 * * *');
        const first = await monitorScheduler.runOperationalCertificationMonitor('test');
        const duplicate = await monitorScheduler.runOperationalCertificationMonitor('test');
        assert.strictEqual(first.notificationDelivered, true);
        assert.strictEqual(duplicate.alreadyNotified, true);
        assert.strictEqual(notifications.length, 1);
        assert(notifications[0].includes('90/100'));
        assert(notifications[0].includes('80/100'));
    }

    {
        const queuedJobs = [];
        let archiveRuns = 0;
        const queuedSchedules = [];
        initPayrollCronSchedulers({
            cron: {
                schedule: (rule, fn) => {
                    queuedSchedules.push({ rule, fn });
                    return { stop: () => {} };
                }
            },
            CONFIG: { TIMEZONE: 'Asia/Seoul' },
            payrollArchiveService: {
                saveCurrent: async () => {
                    archiveRuns += 1;
                    return { ok: true };
                }
            },
            backgroundJobQueueService: {
                enqueue: job => {
                    queuedJobs.push(job);
                    return { accepted: true, key: job.key };
                }
            },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });
        await queuedSchedules.find(item => item.rule === '*/15 * * * *').fn();
        assert.strictEqual(archiveRuns, 0);
        assert.strictEqual(queuedJobs[0].key, 'payroll-auto-archive');
        assert.strictEqual(queuedJobs[0].priority, 98);
    }

    {
        let saveCalled = false;
        const missingReferenceScheduler = initPayrollCronSchedulers({
            cron: { schedule: () => ({}) },
            CONFIG: { TIMEZONE: 'Asia/Seoul' },
            payrollArchiveService: {
                saveCurrent: async () => {
                    saveCalled = true;
                    return { ok: true };
                },
                getWorklistPayrollReferenceDate: async () => null
            },
            payrollOperationLogService: { listRecent: async () => [] },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });
        const result = await missingReferenceScheduler.runAutoArchiveIfDue('test');
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, 'missing-worklist-reference-date');
        assert.strictEqual(saveCalled, false);
    }

    {
        let saveCalled = false;
        const closedScheduler = initPayrollCronSchedulers({
            cron: { schedule: () => ({}) },
            CONFIG: { TIMEZONE: 'Asia/Seoul' },
            payrollArchiveService: {
                saveCurrent: async () => {
                    saveCalled = true;
                    return { ok: true };
                },
                getWorklistPayrollReferenceDate: async () => new Date('2026-06-03T00:00:00Z'),
                getOrCreatePayrollPeriodState: async () => ({
                    periodKey: '2026-06-01_2026-06-03',
                    periodStart: '2026-06-01',
                    periodEnd: '2026-06-03',
                    status: 'CLOSED',
                    rowNumber: 2
                })
            },
            payrollOperationLogService: { listRecent: async () => [] },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });
        const result = await closedScheduler.runAutoArchiveIfDue('test');
        assert.strictEqual(result.skipped, true);
        assert.strictEqual(result.reason, 'period-already-closed');
        assert.strictEqual(saveCalled, false);
    }

    console.log('payroll-cron tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
