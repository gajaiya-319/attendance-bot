const assert = require('assert');
const { auditRows, parseArgs } = require('../scripts/audit-raw-attendance-dashboard');

const C = {
    date: '\uB0A0\uC9DC',
    server: '\uC11C\uBC84',
    shift: '\uADFC\uBB34\uC870',
    name: '\uC774\uB984',
    status: '\uC0C1\uD0DC',
    key: '\uD0A4'
};

{
    const issues = auditRows([
        {
            [C.date]: '2026-06-03',
            [C.server]: 'PAAGRIO',
            [C.shift]: 'NIGHT',
            [C.name]: 'Daba',
            [C.status]: '\uC815\uCD9C',
            [C.key]: '2026-06-03|PAAGRIO|NIGHT|daba'
        },
        {
            [C.date]: '-',
            [C.server]: 'PAAGRIO',
            [C.shift]: 'NIGHT',
            [C.name]: 'Daba',
            [C.status]: '-',
            [C.key]: '-|PAAGRIO|NIGHT|daba'
        }
    ]);
    assert.deepStrictEqual(issues, [], 'valid attendance row and profile placeholder pass audit');
}

{
    const issues = auditRows([
        {
            [C.date]: '',
            [C.server]: '',
            [C.shift]: '',
            [C.name]: 'Unknown',
            [C.status]: '',
            [C.key]: ''
        },
        {
            [C.date]: '2026-06-03',
            [C.server]: '',
            [C.shift]: 'NIGHT',
            [C.name]: 'Robin',
            [C.status]: '\uC815\uCD9C',
            [C.key]: 'bad'
        },
        {
            [C.date]: '2026-06-03',
            [C.server]: 'PAAGRIO',
            [C.shift]: 'NIGHT',
            [C.name]: 'Robin',
            [C.status]: 'MYSTERY',
            [C.key]: 'bad-status'
        }
    ]);
    assert(issues.some(issue => issue.code === 'UNKNOWN_NAME'), 'audit catches Unknown rows');
    assert(issues.some(issue => issue.code === 'EMPTY_ROW_EXPOSED'), 'audit catches exposed empty rows');
    assert(issues.some(issue => issue.code === 'BAD_SERVER'), 'audit catches missing server');
    assert(issues.some(issue => issue.code === 'BAD_STATUS'), 'audit catches unknown status');
}

{
    const duplicateRows = [
        {
            [C.date]: '2026-06-03',
            [C.server]: 'HEINE',
            [C.shift]: 'DAY',
            [C.name]: 'Mark',
            [C.status]: '\uC815\uCD9C',
            [C.key]: 'a'
        },
        {
            [C.date]: '2026-06-03',
            [C.server]: 'HEINE',
            [C.shift]: 'DAY',
            [C.name]: 'Mark',
            [C.status]: '\uC9C0\uAC01',
            [C.key]: 'b'
        }
    ];
    assert(
        auditRows(duplicateRows).some(issue => issue.code === 'DUPLICATE_ATTENDANCE_DAY'),
        'audit catches duplicate day/person rows'
    );
}

{
    const options = parseArgs(['--live', '--url=https://example.test/raw', '--max-rows=3']);
    assert.strictEqual(options.live, true);
    assert.strictEqual(options.url, 'https://example.test/raw');
    assert.strictEqual(options.maxRows, 3);
}

console.log('raw-attendance-dashboard-audit tests passed');
