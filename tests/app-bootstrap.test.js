'use strict';

const assert = require('assert');
const { createAttendanceBotApp } = require('../src/app/createAttendanceBotApp');
const { createWorkflowApi } = require('../src/app/workflowApi');

(async () => {
    const { api, wire, getRuntime } = createWorkflowApi();
    assert.strictEqual(typeof wire, 'function');
    assert.strictEqual(getRuntime(), null);

    assert.throws(
        () => createAttendanceBotApp({ token: '' }),
        /Missing TOKEN/
    );

    const prevToken = process.env.TOKEN;
    process.env.TOKEN = prevToken || 'test-token-placeholder';

    const app = createAttendanceBotApp();
    try {
        assert.ok(app.client);
        assert.strictEqual(typeof app.login, 'function');
        assert.strictEqual(typeof app.shutdown, 'function');
        assert.strictEqual(typeof app.saveSystemAsync, 'function');
        assert.strictEqual(typeof app.getWorkflowRuntime, 'function');
        assert.strictEqual(typeof app.workflowApi, 'object');
        assert.ok(app.getWorkflowRuntime());
    } finally {
        await app.shutdown();
        process.env.TOKEN = prevToken;
    }

    console.log('app-bootstrap tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
