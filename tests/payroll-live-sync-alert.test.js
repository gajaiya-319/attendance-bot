const assert = require('assert');
const { createPayrollLiveSummarySyncService } = require('../src/services/payrollLiveSummarySyncService');

(async () => {
    const dms = [];
    const service = createPayrollLiveSummarySyncService({
        failureAlertThreshold: 2,
        alertCooldownMs: 0,
        CONFIG: { OWNER_IDS: ['owner1'] },
        client: {
            users: {
                fetch: async id => ({
                    send: async payload => {
                        dms.push({ id, content: payload.content });
                    }
                })
            }
        },
        syncFn: async () => ({ ok: false, code: 'test-fail' }),
        logger: { log: () => {}, warn: () => {}, error: () => {} }
    });

    await service.sync();
    assert.strictEqual(dms.length, 0);
    await service.sync();
    assert.strictEqual(dms.length, 1);
    assert(dms[0].content.includes('연속 2회'));

    const okService = createPayrollLiveSummarySyncService({
        failureAlertThreshold: 2,
        syncFn: async () => ({ ok: true }),
        logger: { log: () => {}, warn: () => {}, error: () => {} }
    });
    await okService.sync();
    await okService.sync();

    console.log('payroll-live-sync-alert tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
