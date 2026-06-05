const assert = require('assert');
const { auditEmbedFields } = require('../scripts/audit-embed-fields');

const cleanFindings = auditEmbedFields([
    'index.js',
    'src/services/dayoffService.js'
]);
assert.deepStrictEqual(cleanFindings, [], 'reviewed direct addFields calls are allowed');

const findings = auditEmbedFields([
    'tests/fixtures/not-real.js',
    __filename
]);
assert.strictEqual(findings.length, 0, 'audit ignores files without direct addFields calls');

console.log('embed-field-audit tests passed');
