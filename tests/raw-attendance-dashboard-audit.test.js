const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

function loadAppsScriptContext() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'raw-attendance-apps-script.js'), 'utf8');
    const context = {
        console,
        Utilities: { formatDate: () => '' },
        Session: { getScriptTimeZone: () => 'Asia/Seoul' },
        ContentService: {
            MimeType: { JSON: 'application/json' },
            createTextOutput: () => ({ setMimeType() { return this; } })
        }
    };
    vm.createContext(context);
    vm.runInContext(code, context, { filename: 'raw-attendance-apps-script.js' });
    return context;
}

{
    const context = loadAppsScriptContext();
    const item = { jung: 0, ji: 0, h2late: 0, gyul: 0, jo: 0, yeon: 0, hyu: 0 };
    const dayFlags = {};
    const row = {
        [C.date]: '2026-07-01',
        [C.server]: '\uBC1C\uB77C\uCE74\uC2A4',
        [C.shift]: 'DAY',
        [C.name]: 'Day Worker',
        [C.status]: '\uC870\uD1F4',
        '\uCD9C\uADFC\uC2DC\uAC04': '09:20',
        '\uD1F4\uADFC\uC2DC\uAC04': '15:30',
        '\uBE44\uACE0': '\uC9C0\uAC01 \uCD9C\uADFC 09:20 / \uC870\uAE30 \uD1F4\uADFC 15:30',
        [C.key]: '2026-07-01|\uBC1C\uB77C\uCE74\uC2A4|DAY|day worker'
    };
    context.addBonusRankingStatus_(item, dayFlags, row, '\uC870\uD1F4', 'DAY');
    assert.deepStrictEqual(
        {
            jung: item.jung,
            ji: item.ji,
            h2late: item.h2late,
            gyul: item.gyul,
            jo: item.jo,
            yeon: item.yeon,
            hyu: item.hyu,
            score: context.calculateBonusRankingScore_(item)
        },
        { jung: 0, ji: 1, h2late: 0, gyul: 0, jo: 1, yeon: 0, hyu: 0, score: -15 },
        'day worker late plus final early-out counts both penalties'
    );
}

{
    const context = loadAppsScriptContext();
    const item = { jung: 0, ji: 0, h2late: 0, gyul: 0, jo: 0, yeon: 0, hyu: 0 };
    const row = {
        [C.date]: '2026-07-01',
        [C.server]: 'PAAGRIO',
        [C.shift]: 'DAY',
        [C.name]: 'Serious Late Day Worker',
        [C.status]: '\uC870\uD1F4',
        '\uCD9C\uADFC\uC2DC\uAC04': '11:15',
        '\uD1F4\uADFC\uC2DC\uAC04': '17:00',
        '\uBE44\uACE0': '2\uC2DC\uAC04 \uC774\uC0C1 \uC9C0\uAC01 \uCD9C\uADFC 11:15 / \uC870\uAE30 \uD1F4\uADFC 17:00',
        [C.key]: '2026-07-01|PAAGRIO|DAY|serious late day worker'
    };
    context.addBonusRankingStatus_(item, {}, row, '\uC870\uD1F4', 'DAY');
    assert.strictEqual(item.ji, 1, '2H+ day early-out still counts the base late penalty');
    assert.strictEqual(item.h2late, 1, '2H+ day early-out keeps the excessive late penalty');
    assert.strictEqual(item.jo, 1, '2H+ day early-out keeps the final early-out penalty');
    assert.strictEqual(context.calculateBonusRankingScore_(item), -25, '2H+ day late plus early-out scores -25');
}

{
    const context = loadAppsScriptContext();
    const item = { jung: 0, ji: 0, h2late: 0, gyul: 0, jo: 0, yeon: 0, hyu: 0 };
    const row = {
        [C.date]: '2026-07-01',
        [C.server]: '\uBC1C\uB77C\uCE74\uC2A4',
        [C.shift]: 'DAY',
        [C.name]: 'Normal Timeout Worker',
        [C.status]: '\uC870\uD1F4',
        '\uCD9C\uADFC\uC2DC\uAC04': '09:00',
        '\uD1F4\uADFC\uC2DC\uAC04': '20:31',
        '\uBE44\uACE0': '\uC790\uB3D9 \uCD9C\uADFC 09:00 / DC \uC720\uC608 \uC2DC\uAC04 \uCD08\uACFC (\uC815\uC0C1 \uD1F4\uADFC)',
        [C.key]: '2026-07-01|\uBC1C\uB77C\uCE74\uC2A4|DAY|normal timeout worker'
    };
    context.addBonusRankingStatus_(item, {}, row, '\uC870\uD1F4', 'DAY');
    assert.strictEqual(item.jung, 1, 'normal clock-out note keeps the on-time credit even if stale status says early-out');
    assert.strictEqual(item.jo, 0, 'normal clock-out note suppresses stale early-out status');
    assert.strictEqual(context.calculateBonusRankingScore_(item), 10, 'normal timeout worker scores +10');
}

{
    const context = loadAppsScriptContext();
    const item = { jung: 0, ji: 0, h2late: 0, gyul: 0, jo: 0, yeon: 0, hyu: 0 };
    const row = {
        [C.date]: '2026-07-01',
        [C.server]: 'PAAGRIO',
        [C.shift]: 'DAY',
        [C.name]: 'On Time Early Worker',
        [C.status]: '\uC870\uD1F4',
        '\uCD9C\uADFC\uC2DC\uAC04': '09:00',
        '\uD1F4\uADFC\uC2DC\uAC04': '19:26',
        '\uBE44\uACE0': '\uC790\uB3D9 \uCD9C\uADFC 09:00 / \uC870\uAE30\uD1F4\uADFC 19:26 (1\uC2DC\uAC04 33\uBD84 \uB0A8\uC74C)',
        [C.key]: '2026-07-01|PAAGRIO|DAY|on time early worker'
    };
    context.addBonusRankingStatus_(item, {}, row, '\uC870\uD1F4', 'DAY');
    assert.strictEqual(item.jung, 1, 'on-time early-out keeps the on-time credit');
    assert.strictEqual(item.jo, 1, 'on-time early-out also counts the early-out penalty');
    assert.strictEqual(context.calculateBonusRankingScore_(item), 0, 'on-time early-out scores +10 -10');
}

console.log('raw-attendance-dashboard-audit tests passed');
