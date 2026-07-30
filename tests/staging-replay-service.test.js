'use strict';

const assert = require('assert');
const fs = require('fs');
const {
    anonymizeAttendanceEvents,
    runStagingReplaySuite,
    summarizeRuntimeReplay
} = require('../src/services/stagingReplayService');
const { createReplayDependencies } = require('../scripts/run-staging-replay');

(async () => {
    const fixture = JSON.parse(fs.readFileSync('fixtures/staging-replay-critical.json', 'utf8'));
    const dependencies = createReplayDependencies(fixture.timezone);
    const suite = await runStagingReplaySuite(fixture, dependencies);

    assert.strictEqual(suite.ok, true, suite.failures.join('\n'));
    assert.strictEqual(suite.scenarioCount, 7);
    assert.strictEqual(suite.passedCount, 7);
    assert.strictEqual(suite.failedCount, 0);

    const brokenFixture = JSON.parse(JSON.stringify(fixture));
    brokenFixture.payrollScenarios[0].expected.cells.H5 = 999999;
    const brokenSuite = await runStagingReplaySuite(brokenFixture, dependencies);
    assert.strictEqual(brokenSuite.ok, false, 'a payroll regression must fail the deployment gate');
    assert(
        brokenSuite.failures.some(failure => failure.includes('cell-mismatch:H5')),
        'the failed gate identifies the mismatched sheet cell'
    );

    const sensitiveEvents = [{
        id: 'discord-message-123',
        at: '2026-07-27T09:00:00+08:00',
        type: 'clock_in_confirmed',
        source: 'button',
        userId: 'real-discord-user-id',
        userName: 'Real Worker Name',
        shift: 'day',
        sessionId: 'real-session-id',
        meta: {
            sessionId: 'real-session-id',
            transitionId: 'real-transition-id',
            attendanceStatus: { from: 'PRE_SHIFT', to: 'WORKING' },
            messageId: 'must-not-survive'
        }
    }];
    const first = anonymizeAttendanceEvents(sensitiveEvents, { salt: 'test-salt' });
    const second = anonymizeAttendanceEvents(sensitiveEvents, { salt: 'test-salt' });
    const serialized = JSON.stringify(first);

    assert.deepStrictEqual(first, second, 'anonymization must be deterministic for replay comparison');
    assert.strictEqual(serialized.includes('real-discord-user-id'), false);
    assert.strictEqual(serialized.includes('Real Worker Name'), false);
    assert.strictEqual(serialized.includes('real-session-id'), false);
    assert.strictEqual(serialized.includes('must-not-survive'), false);

    const runtime = summarizeRuntimeReplay(sensitiveEvents, {
        ...dependencies,
        salt: 'test-salt'
    });
    assert.strictEqual(runtime.ok, true);
    assert.strictEqual(runtime.anonymized, true);
    assert.strictEqual(runtime.eventCount, 1);
    assert.strictEqual(runtime.recordCount, 1);
    assert.strictEqual(JSON.stringify(runtime).includes('Real Worker Name'), false);

    console.log('staging-replay-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
