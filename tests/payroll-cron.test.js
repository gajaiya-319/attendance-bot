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
