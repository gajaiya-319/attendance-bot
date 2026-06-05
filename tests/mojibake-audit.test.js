const assert = require('assert');
const {
    findMojibakeInText,
    formatFindings
} = require('../scripts/audit-mojibake');

assert.strictEqual(findMojibakeInText('\uc815\uc0c1 \ud55c\uae00\uc785\ub2c8\ub2e4.\nconst x = 1;', 'ok.js').length, 0);
assert.strictEqual(findMojibakeInText('\\uC815\\uC0C1 escape', 'ok.js').length, 0);

const broken = findMojibakeInText('new SlashCommandBuilder().setName("?\ubb52\uc5c5?\u0080\u6e72?")', 'bad.js');
assert.strictEqual(broken.length, 1);
assert.strictEqual(broken[0].line, 1);

const replacement = findMojibakeInText('const text = "\\uFFFD";'.replace('\\uFFFD', '\uFFFD'), 'bad.js');
assert.strictEqual(replacement.length, 1);

assert(formatFindings({ checked: 1, findings: [] }).includes('passed'));
assert(formatFindings({ checked: 1, findings: broken }).includes('bad.js:1'));

console.log('mojibake-audit tests passed');
