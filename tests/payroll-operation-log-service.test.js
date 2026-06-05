const assert = require('assert');
const { createPayrollOperationLogService } = require('../src/services/payrollOperationLogService');

function createMemoryFs() {
    const files = new Map();
    return {
        files,
        mkdir: async () => {},
        appendFile: async (file, text) => {
            files.set(file, (files.get(file) || '') + text);
        },
        readFile: async file => {
            if (!files.has(file)) {
                const error = new Error('missing');
                error.code = 'ENOENT';
                throw error;
            }
            return files.get(file);
        }
    };
}

(async () => {
    const fs = createMemoryFs();
    const service = createPayrollOperationLogService({
        dir: 'logs',
        fs,
        path: { join: (...parts) => parts.join('/') },
        logger: { error() {}, warn() {} }
    });

    await service.record({
        kind: 'end-adena',
        action: 'approve',
        messageId: 'msg1',
        server: 'HEINE',
        shift: 'NIGHT',
        userName: 'Ding dong',
        payload: { amount: 130000 },
        createdAt: '2026-06-03T00:00:00.000Z'
    });

    const rows = await service.listRecent({ limit: 10 });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'end-adena');
    assert.strictEqual(rows[0].payload.amount, 130000);
    console.log('payroll-operation-log-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
