const assert = require('assert');
const {
    canonicalName,
    buildTodayAudit,
    renderAudit
} = require('../src/commands/admin/opsSafetyCommands');

const KO = {
    date: '\ub0a0\uc9dc',
    server: '\uc11c\ubc84',
    shift: '\uadfc\ubb34\uc870',
    name: '\uc774\ub984',
    status: '\uc0c1\ud0dc',
    key: '\ud0a4',
    normal: '\uc815\ucd9c',
    late: '\uc9c0\uac01'
};

assert.strictEqual(canonicalName('Ding-dong - H Night Time'), 'Ding dong');
assert.strictEqual(canonicalName('Ding'), 'Ding dong');
assert.strictEqual(canonicalName('Mitzu shin - Traine H Night Time'), 'Mitzu shin');
assert.strictEqual(canonicalName('Daba - P Night time(Ryuji)'), 'Daba');

const rows = [
    { [KO.date]: '-', [KO.server]: 'HEINE', [KO.shift]: 'NIGHT', [KO.name]: 'Kush', [KO.status]: '-', [KO.key]: '-|HEINE|NIGHT|kush' },
    { [KO.date]: '-', [KO.server]: 'HEINE', [KO.shift]: 'NIGHT', [KO.name]: 'Ding', [KO.status]: '-', [KO.key]: '-|HEINE|NIGHT|ding' },
    { [KO.date]: '2026-06-02', [KO.server]: 'HEINE', [KO.shift]: 'NIGHT', [KO.name]: 'Kush', [KO.status]: KO.normal, [KO.key]: '2026-06-02|HEINE|NIGHT|kush' },
    { [KO.date]: '2026-06-03', [KO.server]: 'HEINE', [KO.shift]: 'NIGHT', [KO.name]: 'Ding-dong - H Night Time', [KO.status]: KO.late, [KO.key]: '2026-06-03|HEINE|NIGHT|ding-dong -h night time' },
    { [KO.date]: '-', [KO.server]: 'PAAGRIO', [KO.shift]: 'NIGHT', [KO.name]: 'magic69', [KO.status]: '-', [KO.key]: '-|PAAGRIO|NIGHT|magic69' }
];

const audit = buildTodayAudit({ rows, today: '2026-06-03', nightDate: '2026-06-02' });
assert.strictEqual(audit.profiles, 3);
assert.strictEqual(audit.active, 2);
assert.deepStrictEqual(audit.zeroRows.map(row => row.name), ['magic69']);
assert.strictEqual(audit.duplicateNames[0].name, 'Ding dong');
assert(renderAudit(audit).includes('\uc624\ub298 \uae30\ub85d 0: 1\uba85'));
assert(renderAudit(audit).includes('\uc57c\uac04 2026-06-02'));

console.log('ops-safety-commands tests passed');
