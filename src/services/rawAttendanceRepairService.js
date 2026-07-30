'use strict';

const {
    canonicalName,
    normalizeStatus,
    normalizeText
} = require('./rawAttendanceSheetService');

const KO = {
    date: '날짜',
    server: '서버',
    shift: '근무조',
    name: '이름',
    status: '상태',
    inTime: '출근시간',
    outTime: '퇴근시간',
    note: '비고',
    key: '키',
    normal: '정출',
    absent: '결석',
    late: '지각'
};

const STRICT_AUTO_REPAIR_MIN_CONFIDENCE = 90;
const SCORE_BY_STATUS = {
    [KO.normal]: 10,
    [KO.late]: -5,
    [KO.absent]: -25
};

function getCell(row, keys, fallback = '') {
    for (const key of keys) {
        const value = row?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return fallback;
}

function normalizeShift(value) {
    const text = normalizeText(value, '').toUpperCase();
    if (text.includes('NIGHT') || text.includes('야간')) return 'NIGHT';
    if (text.includes('DAY') || text.includes('주간')) return 'DAY';
    return text || '-';
}

function normalizeServer(value) {
    const text = normalizeText(value, '');
    const upper = text.toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS' || text === '하이네' || text === '발라카스') {
        return '발라카스';
    }
    if (upper === 'PAAGRIO' || text === '파아그리오') return '파아그리오';
    return text || '-';
}

function isBlankTime(value) {
    const text = normalizeText(value, '-');
    return !text || text === '-';
}

function parseClockMinutes(value) {
    const text = normalizeText(value, '');
    const match = text.match(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const suffix = match[3] ? match[3].toUpperCase() : '';
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    if (suffix === 'PM' && hour < 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) return null;
    return hour * 60 + minute;
}

function formatClockMinutes(minutes) {
    if (!Number.isFinite(minutes)) return '-';
    const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function isTuesday(dateValue) {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay() === 2;
}

function shiftStartMinutes(shift, dateValue) {
    const normalized = normalizeShift(shift);
    if (normalized === 'NIGHT') return isTuesday(dateValue) ? 19 * 60 : 21 * 60;
    return 9 * 60;
}

function normalizeShiftClockMinutes(clockMinutes, shift, startMinutes) {
    if (clockMinutes == null) return null;
    let value = clockMinutes;
    if (normalizeShift(shift) === 'NIGHT' && value < startMinutes - 180) value += 24 * 60;
    return value;
}

function isWithinClockInGrace(clockMinutes, shift, dateValue, graceMins = 10) {
    const start = shiftStartMinutes(shift, dateValue);
    const normalized = normalizeShiftClockMinutes(clockMinutes, shift, start);
    return normalized != null && normalized >= start && normalized <= start + graceMins;
}

function extractClockAfter(pattern, note) {
    const match = String(note || '').match(pattern);
    return match ? match[1] : null;
}

function extractLateClockInFromNote(note) {
    const text = String(note || '');
    if (!text.includes('무단결근') || !text.includes('출근')) return null;
    const match = text.match(/출근\s*(\d{1,2}:\d{2})/);
    return match ? match[1] : null;
}

function extractRecognizedClockInFromNote(note) {
    return extractClockAfter(/인정\s*출근\s*(\d{1,2}:\d{2})/i, note);
}

function extractDetectedClockInFromNote(note) {
    return extractClockAfter(/(?:실제\s*(?:LIVE\s*ON|감지)|자동\s*출근|clock\s*in)\s*(\d{1,2}:\d{2})/i, note);
}

function hasPreShiftEvidence(note) {
    const text = String(note || '');
    return /(?:사전\s*(?:음성|LIVE|라이브|대기)|점검\s*음성\s*대기|pre[-_\s]*shift|출근\s*후\s*LIVE\s*복귀\s*유예\s*인정)/i.test(text);
}

function appendRepairNote(originalNote, repairText) {
    const original = normalizeText(originalNote, '-');
    if (!original || original === '-') return repairText;
    if (original.includes(repairText)) return original;
    return `${original} / ${repairText}`;
}

function estimateScoreDelta(previousStatus, nextStatus) {
    const before = SCORE_BY_STATUS[previousStatus];
    const after = SCORE_BY_STATUS[nextStatus];
    if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
    return after - before;
}

function buildStrictOnTimeEvidence(item) {
    const recognizedText = extractRecognizedClockInFromNote(item.note);
    const detectedText = extractDetectedClockInFromNote(item.note) || item.inTime;
    const recognizedMinutes = parseClockMinutes(recognizedText);
    const detectedMinutes = parseClockMinutes(detectedText);
    const inMinutes = parseClockMinutes(item.inTime);
    const recognizedOnTime = isWithinClockInGrace(recognizedMinutes, item.shift, item.date, 0);
    const detectedWithinGrace = detectedMinutes == null
        ? isWithinClockInGrace(inMinutes, item.shift, item.date, 10)
        : isWithinClockInGrace(detectedMinutes, item.shift, item.date, 10);

    if (!hasPreShiftEvidence(item.note) || !recognizedOnTime || !detectedWithinGrace) {
        return null;
    }

    return {
        kind: 'pre-shift-grace-on-time',
        confidence: 98,
        recognizedTime: formatClockMinutes(recognizedMinutes),
        detectedTime: detectedMinutes == null ? '-' : formatClockMinutes(detectedMinutes),
        checks: [
            'pre-shift-evidence-present',
            'recognized-at-shift-start',
            'live-on-within-10-minutes'
        ]
    };
}

function buildAbsentClockInEvidence(item) {
    const noteClockIn = extractLateClockInFromNote(item.note);
    const hasClockIn = !isBlankTime(item.inTime) || Boolean(noteClockIn);
    if (!hasClockIn) return null;
    const inTime = !isBlankTime(item.inTime) ? item.inTime : noteClockIn;
    return {
        kind: 'absent-row-has-clock-in',
        confidence: !isBlankTime(item.inTime) && noteClockIn ? 98 : 94,
        inTime,
        checks: [
            'row-status-absent',
            'clock-in-evidence-present'
        ]
    };
}

function isProfilePlaceholder(row) {
    const date = getCell(row, [KO.date, 'date', 'Date']);
    const status = normalizeStatus(getCell(row, [KO.status, 'status', 'Status']));
    return (!date || date === '-') && (!status || status === '-');
}

function getRowIdentity(row) {
    return {
        date: getCell(row, [KO.date, 'date', 'Date']),
        server: normalizeServer(getCell(row, [KO.server, 'server', 'Server'])),
        shift: normalizeShift(getCell(row, [KO.shift, 'shift', 'Shift'])),
        name: canonicalName(getCell(row, [KO.name, 'name', 'Name'], 'Unknown')),
        status: normalizeStatus(getCell(row, [KO.status, 'status', 'Status'])),
        inTime: getCell(row, [KO.inTime, 'inTime', 'clockIn', 'Clock In'], '-'),
        outTime: getCell(row, [KO.outTime, 'outTime', 'clockOut', 'Clock Out'], '-'),
        note: getCell(row, [KO.note, 'note', 'Note'], '-')
    };
}

function buildRepairAction(row, options = {}) {
    if (!row || isProfilePlaceholder(row)) return null;
    const minConfidence = Number(options.minConfidence || STRICT_AUTO_REPAIR_MIN_CONFIDENCE);
    const item = getRowIdentity(row);
    if (!item.date || item.date === '-' || !item.name || item.name === 'Unknown') return null;

    if (item.status === KO.late || item.status === KO.absent) {
        const onTimeEvidence = buildStrictOnTimeEvidence(item);
        if (onTimeEvidence && onTimeEvidence.confidence >= minConfidence) {
            return {
                type: item.status === KO.absent ? 'absent-to-normal-strict' : 'late-to-normal-strict',
                grade: 'C',
                confidence: onTimeEvidence.confidence,
                evidence: onTimeEvidence,
                name: item.name,
                date: item.date,
                server: item.server,
                shift: item.shift,
                previousStatus: item.status,
                nextStatus: KO.normal,
                scoreDeltaEstimate: estimateScoreDelta(item.status, KO.normal),
                row: {
                    date: item.date,
                    server: item.server,
                    shift: item.shift,
                    name: item.name,
                    status: KO.normal,
                    inTime: onTimeEvidence.recognizedTime,
                    outTime: item.outTime,
                    note: appendRepairNote(item.note, '자동복구(C등급-엄격검증): 사전 대기 및 10분 내 LIVE ON 확인, 정출 전환'),
                    forceStatus: true
                }
            };
        }
    }

    if (item.status === KO.absent) {
        const absentEvidence = buildAbsentClockInEvidence(item);
        if (!absentEvidence || absentEvidence.confidence < minConfidence) return null;
        return {
            type: 'absent-to-late',
            grade: 'C',
            confidence: absentEvidence.confidence,
            evidence: absentEvidence,
            name: item.name,
            date: item.date,
            server: item.server,
            shift: item.shift,
            previousStatus: item.status,
            nextStatus: KO.late,
            scoreDeltaEstimate: estimateScoreDelta(item.status, KO.late),
            row: {
                date: item.date,
                server: item.server,
                shift: item.shift,
                name: item.name,
                status: KO.late,
                inTime: absentEvidence.inTime,
                outTime: item.outTime,
                note: appendRepairNote(item.note, '자동복구(C등급-엄격검증): 결석 상태였지만 출근 증거 확인, 지각 전환'),
                forceStatus: true
            }
        };
    }

    return null;
}

function planRawAttendanceRepairs(rows = [], options = {}) {
    const actions = [];
    for (const row of rows || []) {
        const action = buildRepairAction(row, options);
        if (action) actions.push(action);
    }
    return actions;
}

async function repairRawAttendanceRows({
    rows = [],
    rawAttendanceSheetService,
    maxRepairs = 20,
    minConfidence = STRICT_AUTO_REPAIR_MIN_CONFIDENCE,
    logger = console
} = {}) {
    const actions = planRawAttendanceRepairs(rows, { minConfidence }).slice(0, maxRepairs);
    const repaired = [];
    const failed = [];

    if (!rawAttendanceSheetService?.sendAttendanceRow) {
        return {
            checked: Array.isArray(rows) ? rows.length : 0,
            planned: actions.length,
            repaired,
            failed,
            skipped: true,
            reason: 'raw-attendance-writer-not-ready'
        };
    }

    for (const action of actions) {
        try {
            const result = await rawAttendanceSheetService.sendAttendanceRow(action.row);
            if (result?.ok) {
                repaired.push(action);
            } else {
                failed.push({ action, error: result?.reason || result?.status || result?.body || 'write-failed' });
            }
        } catch (error) {
            failed.push({ action, error: error?.message || String(error) });
            logger.warn?.('[RAW ATTENDANCE SELF REPAIR FAIL]', {
                name: action.name,
                date: action.date,
                error: error?.message || error
            });
        }
    }

    return {
        checked: Array.isArray(rows) ? rows.length : 0,
        planned: actions.length,
        repaired,
        failed,
        minConfidence
    };
}

function buildRawAttendanceRepairSignature(summary = {}) {
    return [
        summary.checked || 0,
        ...(summary.repaired || []).map(item => `ok:${item.type}:${item.date}:${item.server}:${item.shift}:${item.name}:${item.nextStatus}`),
        ...(summary.failed || []).map(item => `fail:${item.action?.date}:${item.action?.name}:${item.error}`)
    ].sort().join('|');
}

function formatRawAttendanceRepairSummary(summary = {}, limit = 8) {
    const lines = [
        `검사 행: ${summary.checked || 0}개`,
        `자동복구: ${(summary.repaired || []).length}개`,
        `실패: ${(summary.failed || []).length}개`
    ];

    if (summary.repaired?.length) {
        lines.push('', '[자동복구]');
        for (const item of summary.repaired.slice(0, limit)) {
            const confidence = item.confidence ? ` / 신뢰도 ${item.confidence}` : '';
            const delta = Number.isFinite(item.scoreDeltaEstimate) ? ` / 예상점수 ${item.scoreDeltaEstimate >= 0 ? '+' : ''}${item.scoreDeltaEstimate}` : '';
            lines.push(`- ${item.name} / ${item.date} / ${item.server} ${item.shift}: ${item.previousStatus} -> ${item.nextStatus} (${item.grade || 'A'}${confidence}${delta})`);
        }
    }

    if (summary.failed?.length) {
        lines.push('', '[복구 실패]');
        for (const item of summary.failed.slice(0, limit)) {
            lines.push(`- ${item.action?.name || 'Unknown'} / ${item.action?.date || '-'}: ${item.error}`);
        }
    }

    return lines.join('\n');
}

module.exports = {
    getCell,
    getRowIdentity,
    parseClockMinutes,
    shiftStartMinutes,
    buildStrictOnTimeEvidence,
    buildRepairAction,
    planRawAttendanceRepairs,
    repairRawAttendanceRows,
    buildRawAttendanceRepairSignature,
    formatRawAttendanceRepairSummary
};
