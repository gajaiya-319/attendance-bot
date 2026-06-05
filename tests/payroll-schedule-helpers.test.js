const assert = require('assert');
const moment = require('moment-timezone');
const { SHIFT_SCHEDULE } = require('../src/config/constants');
const {
    getLastPayrollArchiveTimestamp,
    hoursSince,
    shouldAutoArchiveAfterHours,
    getThreeDayAutoArchiveDecision
} = require('../src/services/payrollScheduleHelpers');

(async () => {
    {
        const t0 = Date.now() - 80 * 60 * 60 * 1000;
        const last = await getLastPayrollArchiveTimestamp({
            operationLog: {
                listRecent: async () => ([
                    { kind: 'other', action: 'x', createdAt: new Date().toISOString() },
                    {
                        kind: 'payroll-archive',
                        action: 'save',
                        createdAt: new Date(t0).toISOString(),
                        payload: { savedAt: new Date(t0).toISOString() }
                    }
                ])
            },
            payrollArchiveService: {
                getLastRawDataTimestamp: async () => t0 - 1000
            }
        });
        assert.strictEqual(last, t0);
        assert(shouldAutoArchiveAfterHours(last, 75));
        assert(!shouldAutoArchiveAfterHours(last, 90));
    }

    {
        const last = await getLastPayrollArchiveTimestamp({
            operationLog: { listRecent: async () => [] },
            payrollArchiveService: {
                getLastRawDataTimestamp: async () => Date.now() - 10 * 60 * 60 * 1000
            }
        });
        assert(!shouldAutoArchiveAfterHours(last, 75));
    }

    {
        assert.strictEqual(hoursSince(0), Infinity);
        assert(hoursSince(Date.now() - 2 * 60 * 60 * 1000) < 2.1);
    }

    {
        const decision = getThreeDayAutoArchiveDecision({
            now: moment.tz('2026-06-04 09:09:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Manila'),
            lastArchiveMs: 0,
            moment,
            timezone: 'Asia/Manila',
            shiftSchedule: SHIFT_SCHEDULE,
            graceMinutes: 10
        });
        assert.strictEqual(decision.due, false);
        assert.strictEqual(decision.reason, 'before-three-day-night-close');
    }

    {
        const decision = getThreeDayAutoArchiveDecision({
            now: moment.tz('2026-06-04 09:10:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Manila'),
            referenceDate: moment.tz('2026-06-03', 'YYYY-MM-DD', 'Asia/Manila'),
            lastArchiveMs: 0,
            moment,
            timezone: 'Asia/Manila',
            shiftSchedule: SHIFT_SCHEDULE,
            graceMinutes: 10
        });
        assert.strictEqual(decision.due, true);
        assert.strictEqual(decision.latestClose.periodLabel, '1~3일 야간마감');
        assert.strictEqual(decision.latestClose.nightEndAt.format('YYYY-MM-DD HH:mm'), '2026-06-04 09:00');
        assert.strictEqual(decision.latestClose.dueAt.format('YYYY-MM-DD HH:mm'), '2026-06-04 09:10');
    }

    {
        const manualSavedDuringPeriod = moment.tz('2026-06-02 12:00:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Manila').valueOf();
        const decision = getThreeDayAutoArchiveDecision({
            now: moment.tz('2026-06-04 09:15:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Manila'),
            referenceDate: moment.tz('2026-06-03', 'YYYY-MM-DD', 'Asia/Manila'),
            lastArchiveMs: manualSavedDuringPeriod,
            moment,
            timezone: 'Asia/Manila',
            shiftSchedule: SHIFT_SCHEDULE,
            graceMinutes: 10
        });
        assert.strictEqual(decision.due, false);
        assert.strictEqual(decision.reason, 'already-archived');
    }

    {
        const decision = getThreeDayAutoArchiveDecision({
            now: moment.tz('2026-06-06 10:00:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Manila'),
            referenceDate: moment.tz('2026-06-05', 'YYYY-MM-DD', 'Asia/Manila'),
            lastArchiveMs: 0,
            moment,
            timezone: 'Asia/Manila',
            shiftSchedule: SHIFT_SCHEDULE,
            graceMinutes: 60
        });
        assert.strictEqual(decision.due, true);
        assert.strictEqual(decision.latestClose.periodLabel, '3~5일 야간마감');
        assert.strictEqual(decision.latestClose.nightEndAt.format('YYYY-MM-DD HH:mm'), '2026-06-06 09:00');
        assert.strictEqual(decision.latestClose.dueAt.format('YYYY-MM-DD HH:mm'), '2026-06-06 10:00');
    }

    {
        const decision = getThreeDayAutoArchiveDecision({
            now: moment.tz('2026-06-10 04:10:00', 'YYYY-MM-DD HH:mm:ss', 'Asia/Manila'),
            referenceDate: moment.tz('2026-06-09', 'YYYY-MM-DD', 'Asia/Manila'),
            lastArchiveMs: 0,
            moment,
            timezone: 'Asia/Manila',
            shiftSchedule: SHIFT_SCHEDULE,
            graceMinutes: 10
        });
        assert.strictEqual(decision.due, true);
        assert.strictEqual(decision.latestClose.periodLabel, '7~9일 야간마감');
        assert.strictEqual(decision.latestClose.nightEndAt.format('YYYY-MM-DD HH:mm'), '2026-06-10 04:00');
    }

    console.log('payroll-schedule-helpers tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
