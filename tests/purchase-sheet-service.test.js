const assert = require('assert');
const {
    resolvePurchaseCell,
    resolveAdenaCell,
    resolveAdenaSummaryCell,
    findSectionHeader,
    findUserColumnInHeader,
    findDayRow,
    getColumnLetter,
    parseNumber,
    normalizeAliasMap,
    resolveSheetName,
    resolveSheetNameCandidates,
    getSectionCandidates
} = require('../src/services/purchaseSheetService');

const rows = [
    ['Great Team (Day Time)'],
    [],
    ['Day', '', 'Ryuji', 'BONUS', 'D&C', 'Gab', 'BONUS', 'D&C'],
    ['31', 'Day Time', '', '', '1000', '', '', ''],
    ['1', 'Day Time', '', '', '', '', '', '2000'],
    ['Great Team (Night Time)'],
    ['Night', '', 'Daba', 'BONUS', 'D&C', 'Gab', 'BONUS', 'D&C'],
    ['31', 'Night Time', '', '', '', '', '', '3000'],
    ['1', 'Night Time', '', '', '4000', '', '', ''],
    [],
    [],
    ['', 'Day Time', '', '', '', 'Night Time', '', '', 'Player', 'P', '', 'Adena', '', 'Gain Adena', '', '', 'Player', 'P', '', 'Adena', '', 'Gain Adena'],
    ['', '', '', '', '', '', '', '', 'Ryuji', '', '', '250000', '', '=N59', '', '', 'Daba', '', '', '230000', '', '=V59'],
    ['', '', '', '', '', '', '', '', 'Gab', '', '', '140884', '', '=N60', '', '', 'Gab', '', '', '261000', '', '=V60'],
    ['', '', '', '', '', '', '', '', 'Total', '0', '', '=SUM(L59:L60)', '', '=SUM(N59:N60)', '', '', 'Total', '0', '', '=SUM(T59:T60)', '', '=SUM(V59:V60)']
];

assert.strictEqual(findSectionHeader(rows, 'Day'), 2);
assert.strictEqual(findSectionHeader(rows, 'Night'), 6);
assert.strictEqual(findUserColumnInHeader(rows[2], 'gab'), 5);
assert.strictEqual(findUserColumnInHeader(['Day', '', 'Lance'], 'Lance *'), 2);
assert.strictEqual(findUserColumnInHeader(['Day', '', 'Shijiro'], 'Shijiro OVER TIME'), 2);
assert.strictEqual(findUserColumnInHeader(['Day', '', 'Shijiro'], 'Shijiro OT'), 2);
assert.strictEqual(findUserColumnInHeader(['Night', '', 'Shijiro'], 'Shijiro (OT)', { shijiro: 'shiijiro' }), 2);
assert.strictEqual(findUserColumnInHeader(['Night', '', 'Shiijiro'], 'Shijiro (OT)', { shijiro: 'shiijiro' }), 2);
assert.strictEqual(findDayRow(rows, 31, 3, 5), 3);
assert.deepStrictEqual(getSectionCandidates(rows, { sectionLabels: { DAY: 'Day', NIGHT: 'Night' }, userName: 'Daba OT' }).map(item => item.shift), ['NIGHT']);
assert.strictEqual(getColumnLetter(0), 'A');
assert.strictEqual(getColumnLetter(27), 'AB');
assert.strictEqual(parseNumber('1,234'), 1234);
assert.strictEqual(parseNumber(''), 0);
assert.deepStrictEqual(normalizeAliasMap({ kramthespark: 'kram' }), { kramthespark: 'kram' });
assert.strictEqual(resolveSheetName('KramTheSpark', { kramthespark: 'kram' }), 'kram');
assert.strictEqual(resolveSheetName('Shijiro (OT)', { shijiro: 'shiijiro' }), 'shiijiro');
assert.deepStrictEqual(resolveSheetNameCandidates('Shijiro (OT)', { shijiro: 'shiijiro' }), ['shijiro', 'shiijiro']);
assert.strictEqual(findUserColumnInHeader(rows[6], 'Daba (OT)'), 2);

assert.deepStrictEqual(
    resolvePurchaseCell(rows, {
        sectionLabel: 'Day',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'Gab',
        dayOfMonth: 1
    }),
    { ok: true, rowIndex: 4, colIndex: 7, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolveAdenaCell(rows, {
        sectionLabel: 'Day',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'gabriel',
        aliases: { gabriel: 'gab' },
        dayOfMonth: 1
    }),
    { ok: true, rowIndex: 4, colIndex: 5, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolvePurchaseCell(rows, {
        sectionLabel: 'Night',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'Daba',
        dayOfMonth: 1
    }),
    { ok: true, rowIndex: 8, colIndex: 4, inferredShift: 'NIGHT' }
);

assert.strictEqual(
    resolvePurchaseCell(rows, {
        sectionLabel: 'Night',
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        userName: 'Missing',
        dayOfMonth: 1
    }).code,
    'user-not-found'
);

assert.deepStrictEqual(
    resolveAdenaSummaryCell(rows, {
        shift: 'DAY',
        userName: 'gabriel',
        aliases: { gabriel: 'gab' }
    }),
    { ok: true, rowIndex: 13, colIndex: 11, inferredShift: 'DAY' }
);

assert.deepStrictEqual(
    resolveAdenaSummaryCell(rows, {
        shift: 'NIGHT',
        userName: 'Daba'
    }),
    { ok: true, rowIndex: 12, colIndex: 19, inferredShift: 'NIGHT' }
);

assert.strictEqual(
    resolveAdenaSummaryCell(rows, {
        shift: 'NIGHT',
        userName: 'Missing'
    }).code,
    'summary-user-not-found'
);

console.log('purchase-sheet-service tests passed');








