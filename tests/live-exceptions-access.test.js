const assert = require('assert');
const { getLiveExceptionsMap } = require('../src/utils/liveExceptionsAccess');

const calls = [];
const logger = {
    warn: message => calls.push(message)
};

assert.deepStrictEqual(getLiveExceptionsMap(() => ({ u1: { status: 'active' } })), { u1: { status: 'active' } });
assert.deepStrictEqual(getLiveExceptionsMap(null, logger), {});
assert.match(calls.pop(), /not a function/);
assert.deepStrictEqual(getLiveExceptionsMap(() => null, logger), {});
assert.match(calls.pop(), /not an object/);

console.log('live-exceptions-access tests passed');
