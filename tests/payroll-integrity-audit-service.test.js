'use strict';

const assert = require('assert');
const {
    createPayrollIntegrityAuditService,
    findDuplicateMessageOperations,
    collectSheetAuditIssues
} = require('../src/services/payrollIntegrityAuditService');

(async () => {
    const now = new Date('2026-07-25T06:20:00.000Z');
    const duplicates = findDuplicateMessageOperations([
        {
            createdAt: '2026-07-25T05:00:00.000Z',
            kind: 'death-penalty',
            action: 'approve',
            messageId: 'msg-1',
            server: 'PAAGRIO',
            status: 'success'
        },
        {
            createdAt: '2026-07-25T05:01:00.000Z',
            kind: 'death-penalty',
            action: 'approve',
            messageId: 'msg-1',
            server: 'PAAGRIO',
            result: { ok: true }
        },
        {
            createdAt: '2026-07-25T05:01:30.000Z',
            kind: 'death-penalty',
            action: 'approve',
            messageId: 'msg-1',
            server: 'PAAGRIO',
            result: { ok: true, duplicate: true, skipped: true }
        },
        {
            createdAt: '2026-07-25T05:02:00.000Z',
            kind: 'end-adena-prevalidation',
            action: 'validate',
            messageId: 'validation-only',
            server: 'PAAGRIO',
            status: 'success'
        },
        {
            createdAt: '2026-07-25T05:03:00.000Z',
            kind: 'end-adena-prevalidation',
            action: 'validate',
            messageId: 'validation-only',
            server: 'PAAGRIO',
            status: 'success'
        },
        {
            createdAt: '2026-07-23T05:01:00.000Z',
            kind: 'death-penalty',
            action: 'approve',
            messageId: 'old-message',
            server: 'PAAGRIO',
            status: 'success'
        }
    ], { now });
    assert.strictEqual(duplicates.length, 1);
    assert.strictEqual(duplicates[0].messageId, 'msg-1');
    assert.strictEqual(duplicates[0].count, 2);
    assert.strictEqual(duplicates.some(item => item.messageId === 'validation-only'), false);

    const sheetIssues = collectSheetAuditIssues({
        audited: [
            {
                ok: true,
                changed: true,
                serverKey: 'PAAGRIO',
                periodLabel: '22~24',
                evidence: { totalAdenaDelta: 1000 }
            },
            { ok: false, code: 'period-mismatch', serverKey: 'VALAKAS' },
            { ok: false, code: 'great-tab-no-current-payroll-totals', serverKey: 'PAAGRIO' },
            { ok: false, code: 'great-tab-no-payroll-totals', serverKey: 'VALAKAS' },
            { ok: false, code: 'great-tab-read-failed', serverKey: 'VALAKAS', errorMessage: 'quota' }
        ]
    });
    assert.deepStrictEqual(sheetIssues.map(issue => issue.code), [
        'payroll-value-mismatch',
        'great-tab-read-failed'
    ]);

    let stateRaw = '';
    const notifications = [];
    const service = createPayrollIntegrityAuditService({
        payrollOperationLogService: {
            listRecent: async () => [
                {
                    createdAt: '2026-07-25T05:00:00.000Z',
                    kind: 'purchase',
                    action: 'approve',
                    messageId: 'msg-2',
                    server: 'VALAKAS',
                    userName: 'Gab',
                    status: 'success'
                },
                {
                    createdAt: '2026-07-25T05:01:00.000Z',
                    kind: 'purchase',
                    action: 'approve',
                    messageId: 'msg-2',
                    server: 'VALAKAS',
                    userName: 'Gab',
                    result: { ok: true }
                }
            ]
        },
        auditRunner: async () => ({
            generatedAt: now.toISOString(),
            audited: [{
                ok: true,
                changed: true,
                serverKey: 'PAAGRIO',
                periodLabel: '22~24',
                evidence: { totalAdenaDelta: 3000 }
            }]
        }),
        notifyPayrollOwners: async ({ content }) => {
            notifications.push(content);
            return { sent: 1, failed: 0 };
        },
        fs: {
            readFile: async () => {
                if (!stateRaw) {
                    const error = new Error('missing');
                    error.code = 'ENOENT';
                    throw error;
                }
                return stateRaw;
            },
            mkdir: async () => {},
            writeFile: async (_file, value) => {
                stateRaw = value;
            }
        },
        path: { dirname: () => 'logs' },
        logger: { log: () => {}, warn: () => {} }
    });

    const first = await service.runDailyAudit('test', now);
    assert.strictEqual(first.issues.length, 2);
    assert.strictEqual(first.notification.sent, 1);
    assert.strictEqual(notifications.length, 1);
    assert(notifications[0].includes('자동 수정은 실행하지 않았습니다'));

    const repeated = await service.runDailyAudit('test', new Date(now.valueOf() + 60 * 60 * 1000));
    assert.strictEqual(repeated.repeatedAlertSuppressed, true);
    assert.strictEqual(notifications.length, 1, 'same issue is not sent again within 24 hours');

    {
        const failureNotifications = [];
        const failedAuditService = createPayrollIntegrityAuditService({
            auditRunner: async () => {
                throw new Error('quota exceeded');
            },
            notifyPayrollOwners: async ({ content }) => {
                failureNotifications.push(content);
                return { sent: 1, failed: 0 };
            },
            fs: {
                readFile: async () => {
                    const error = new Error('missing');
                    error.code = 'ENOENT';
                    throw error;
                },
                mkdir: async () => {},
                writeFile: async () => {}
            },
            path: { dirname: () => 'logs' },
            logger: { log: () => {}, warn: () => {} }
        });
        const failure = await failedAuditService.runDailyAudit('test-failure', now);
        assert.strictEqual(failure.issues[0].code, 'audit-run-failed');
        assert(failureNotifications[0].includes('quota exceeded'));
    }

    console.log('payroll-integrity-audit-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
