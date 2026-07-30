const assert = require('assert');
const {
    buildRepairAction,
    planRawAttendanceRepairs,
    repairRawAttendanceRows,
    formatRawAttendanceRepairSummary
} = require('../src/services/rawAttendanceRepairService');

const KO = {
    date: '날짜',
    server: '서버',
    shift: '근무조',
    name: '이름',
    status: '상태',
    inTime: '출근시간',
    outTime: '퇴근시간',
    note: '비고'
};

const absentLateRow = {
    [KO.date]: '2026-06-29',
    [KO.server]: '파아그리오',
    [KO.shift]: 'NIGHT',
    [KO.name]: 'Daba - P Night Time🔥',
    [KO.status]: '결석',
    [KO.inTime]: '00:27',
    [KO.outTime]: '-',
    [KO.note]: '무단결근 유예시간 초과 후 출근'
};

const noteOnlyClockInRow = {
    [KO.date]: '2026-06-29',
    [KO.server]: '발라카스',
    [KO.shift]: 'NIGHT',
    [KO.name]: 'Timmyboy - V Night Time🐲',
    [KO.status]: '결석',
    [KO.inTime]: '-',
    [KO.outTime]: '-',
    [KO.note]: '무단결근 유예시간 초과 후 출근 06:42'
};

const preShiftVoiceLateRow = {
    [KO.date]: '2026-07-01',
    [KO.server]: '발라카스',
    [KO.shift]: 'DAY',
    [KO.name]: 'BitShelby - V Day Time🐲',
    [KO.status]: '지각',
    [KO.inTime]: '09:08',
    [KO.outTime]: '-',
    [KO.note]: '사전 음성 대기 08:50 / 인정 출근 09:00 / 실제 LIVE ON 09:08'
};

const unsupportedLateRow = {
    [KO.date]: '2026-07-01',
    [KO.server]: '발라카스',
    [KO.shift]: 'DAY',
    [KO.name]: 'Erzie - V Day Time🐲',
    [KO.status]: '지각',
    [KO.inTime]: '09:08',
    [KO.outTime]: '-',
    [KO.note]: '자동 출근 09:08'
};

const placeholderRow = {
    [KO.date]: '-',
    [KO.server]: '발라카스',
    [KO.shift]: 'DAY',
    [KO.name]: 'ACE - V Day Time🐲',
    [KO.status]: '-',
    [KO.inTime]: '-',
    [KO.outTime]: '-',
    [KO.note]: '-'
};

const action = buildRepairAction(absentLateRow);
assert.strictEqual(action.type, 'absent-to-late');
assert.strictEqual(action.name, 'Daba');
assert.strictEqual(action.row.status, '지각');
assert.strictEqual(action.row.inTime, '00:27');
assert.strictEqual(action.row.forceStatus, true);

const noteAction = buildRepairAction(noteOnlyClockInRow);
assert.strictEqual(noteAction.name, 'Timmyboy');
assert.strictEqual(noteAction.row.inTime, '06:42');
assert.strictEqual(noteAction.grade, 'C');
assert.strictEqual(noteAction.confidence >= 90, true);
assert.strictEqual(noteAction.scoreDeltaEstimate, 20);

const preShiftAction = buildRepairAction(preShiftVoiceLateRow);
assert.strictEqual(preShiftAction.type, 'late-to-normal-strict');
assert.strictEqual(preShiftAction.row.status, '정출');
assert.strictEqual(preShiftAction.row.inTime, '09:00');
assert.strictEqual(preShiftAction.scoreDeltaEstimate, 15);
assert(preShiftAction.evidence.checks.includes('live-on-within-10-minutes'));

assert.strictEqual(buildRepairAction(unsupportedLateRow), null, '09:08 late without pre-shift evidence is not auto-repaired');

assert.strictEqual(buildRepairAction(placeholderRow), null);
assert.strictEqual(planRawAttendanceRepairs([absentLateRow, placeholderRow, noteOnlyClockInRow]).length, 2);
assert.strictEqual(planRawAttendanceRepairs([preShiftVoiceLateRow, unsupportedLateRow]).length, 1);

(async () => {
    const writes = [];
    const summary = await repairRawAttendanceRows({
        rows: [absentLateRow, noteOnlyClockInRow],
        rawAttendanceSheetService: {
            sendAttendanceRow: async row => {
                writes.push(row);
                return { ok: true };
            }
        }
    });

    assert.strictEqual(summary.checked, 2);
    assert.strictEqual(summary.planned, 2);
    assert.strictEqual(summary.repaired.length, 2);
    assert.deepStrictEqual(writes.map(row => row.name), ['Daba', 'Timmyboy']);
    assert(formatRawAttendanceRepairSummary(summary).includes('결석 -> 지각'));
    console.log('raw-attendance-repair-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
