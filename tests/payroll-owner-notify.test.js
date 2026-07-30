'use strict';

const assert = require('assert');
const { notifyPayrollOwners } = require('../src/utils/payrollOwnerNotify');

(async () => {
    const channelMessages = [];
    const failed = await notifyPayrollOwners({
        client: {
            users: {
                fetch: async () => ({
                    send: async () => { throw new Error('DM blocked'); }
                })
            },
            channels: {
                cache: new Map([['log', { send: async payload => channelMessages.push(payload) }]])
            }
        },
        CONFIG: { OWNER_IDS: ['owner'], LOG_CHANNEL: 'log' },
        content: 'attendance warning',
        logger: { warn() {}, error() {} }
    });
    assert.strictEqual(failed.sent, 0);
    assert.strictEqual(failed.failed, 1);
    assert.strictEqual(failed.fallbackSent, 1, 'failed owner DM falls back to the operations channel');
    assert(channelMessages[0].content.includes('attendance warning'));

    const successfulMessages = [];
    const successful = await notifyPayrollOwners({
        client: {
            users: { fetch: async () => ({ send: async () => {} }) },
            channels: {
                cache: new Map([['log', { send: async payload => successfulMessages.push(payload) }]])
            }
        },
        CONFIG: { OWNER_IDS: ['owner'], LOG_CHANNEL: 'log' },
        content: 'normal warning',
        logger: { warn() {}, error() {} }
    });
    assert.strictEqual(successful.sent, 1);
    assert.strictEqual(successful.fallbackSent, 0);
    assert.strictEqual(successfulMessages.length, 0, 'successful DM does not duplicate into the channel');

    console.log('payroll-owner-notify tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
