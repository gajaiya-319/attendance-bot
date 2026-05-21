const assert = require('assert');
const {
    okText,
    failText,
    pendingText,
    commandStatusText,
    withCommandStatusPayload
} = require('../src/utils/commandStatus');

assert.strictEqual(okText('Done'), '✅ Done');
assert.strictEqual(okText('✅ Done'), '✅ Done');
assert.strictEqual(failText('No role'), '❌ No role');
assert.strictEqual(pendingText('Working'), '⏳ Working');

assert.strictEqual(commandStatusText('backup failed'), '❌ backup failed');
assert.strictEqual(commandStatusText('Refresh complete'), '✅ Refresh complete');
assert.strictEqual(commandStatusText(''), '');

const payload = withCommandStatusPayload({ content: 'not found', flags: 64 });
assert.deepStrictEqual(payload, { content: '❌ not found', flags: 64 });
assert.strictEqual(withCommandStatusPayload('Completed'), '✅ Completed');
assert.deepStrictEqual(withCommandStatusPayload({ embeds: [] }), { embeds: [] });

console.log('command-status tests passed');
