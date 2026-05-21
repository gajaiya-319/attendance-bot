const assert = require('assert');
const {
    getStrWidth,
    padWidth,
    truncateWidth,
    formatDuration,
    formatExactWidth
} = require('../src/utils/textFormat');

assert.strictEqual(getStrWidth('abc'), 3);
assert.strictEqual(getStrWidth('\uAC00a'), 3);
assert.strictEqual(padWidth('\uAC00', 4), '\uAC00  ');
assert.strictEqual(truncateWidth('\uAC00\uB098\uB2E4', 4), '\uAC00\uB098');
assert.strictEqual(truncateWidth('ab\uAC00cd', 5), 'ab\uAC00c');
assert.strictEqual(formatDuration(125), '2\uC2DC\uAC04 5\uBD84');
assert.strictEqual(formatExactWidth('\uAC00\uB098\uB2E4', 5), '\uAC00\uB098 ');

console.log('text-format tests passed');
