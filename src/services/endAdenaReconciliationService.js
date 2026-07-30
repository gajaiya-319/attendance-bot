'use strict';

const {
    normalizeAliasMap,
    normalizePayrollServer,
    resolveSheetNameCandidates
} = require('./purchaseSheetService');
const {
    summarizeEndAdenaQuality,
    formatEndAdenaQualityLine,
    formatEndAdenaQualityIssues
} = require('./endAdenaQualityService');
const { parseEndAdenaMessage } = require('../utils/endAdenaMessage');
const {
    normalizeEndAdenaName: normalizeName,
    operationCreatedAt,
    auditForOperation,
    operationMatchesShiftWindow,
    selectEndAdenaOperations,
    reduceEndAdenaOperations,
    hasSuccessfulSummaryReset
} = require('../utils/endAdenaOperations');

function findSummaryCell(cells, server, userName, aliases = {}) {
    const normalizedServer = normalizePayrollServer(server);
    const candidates = new Set(resolveSheetNameCandidates(userName, aliases));
    return (cells || []).find(cell => (
        normalizePayrollServer(cell.server) === normalizedServer &&
        candidates.has(normalizeName(cell.userName))
    )) || null;
}

function sameInstant(left, right) {
    const leftMs = Date.parse(left || '');
    const rightMs = Date.parse(right || '');
    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function reminderMatchesWindow(operation, shift, bounds) {
    return String(operation?.shift || operation?.payload?.shift || '').toUpperCase() === shift &&
        sameInstant(operation?.payload?.shiftStartAt || operation?.shiftStartAt, bounds.start.toISOString()) &&
        sameInstant(operation?.payload?.shiftEndAt || operation?.shiftEndAt, bounds.end.toISOString());
}

function buildMessageUrl(guildId, channelId, messageId) {
    if (!guildId || !channelId || !messageId) return null;
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function collectSheetMismatches(repair = {}) {
    const failedRanges = new Set((repair.failures || []).flatMap(item => item.ranges || []));
    return (repair.corrections || []).map(item => ({
        server: normalizePayrollServer(item.server),
        userName: item.userName,
        range: item.range,
        sheetValue: Number(item.previousValue || 0),
        approvedValue: Number(item.expectedValue || 0),
        recovered: !failedRanges.has(item.range)
    }));
}

function collectPendingDuplicates(pending = []) {
    const byCell = new Map();
    for (const item of pending) {
        if (!item.cellKey) continue;
        const list = byCell.get(item.cellKey) || [];
        list.push(item);
        byCell.set(item.cellKey, list);
    }
    return [...byCell.values()]
        .filter(items => items.length > 1)
        .map(items => ({
            server: items[0].server,
            userName: items[0].sheetUserName || items[0].userName,
            messageIds: items.map(item => item.messageId),
            urls: items.map(item => item.url).filter(Boolean)
        }));
}

function integrityFingerprint(report = {}) {
    function itemKey(item) {
        return [
            normalizePayrollServer(item?.server),
            normalizeName(item?.sheetUserName || item?.userName),
            item?.messageId || '',
            item?.code || ''
        ].join(':');
    }
    function keys(items) {
        return (items || []).map(itemKey).sort();
    }
    return JSON.stringify({
        shift: report.shift,
        shiftStartAt: report.shiftStartAt,
        shiftEndAt: report.shiftEndAt,
        awaitingApproval: keys(report.awaitingApproval),
        missing: keys(report.missing),
        unexpected: keys(report.unexpected),
        unexpectedPending: keys(report.unexpectedPending),
        invalidSubmissions: keys(report.invalidSubmissions),
        duplicates: keys(report.duplicates),
        pendingDuplicates: keys(report.pendingDuplicates),
        unresolved: keys(report.unresolved),
        repairFailures: (report.repair?.failures || []).map(item => `${item.server}:${item.code}`).sort()
    });
}

function sessionOverlapsBounds(session, bounds, shift) {
    if (!session?.clockInAt || !bounds?.start || !bounds?.end) return false;
    const sessionShift = String(session.shift || session.sessionKey || '').toLowerCase();
    if (shift && !sessionShift.includes(String(shift).toLowerCase())) return false;
    const startMs = Date.parse(session.clockInAt);
    const endMs = Date.parse(session.clockOutAt || bounds.end.toISOString());
    return Number.isFinite(startMs) && Number.isFinite(endMs) &&
        startMs <= bounds.end.valueOf() && endMs >= bounds.start.valueOf();
}

function sessionBelongsToShiftWindow(session, bounds, shift) {
    if (!session?.clockInAt || !bounds?.start || !bounds?.end) return false;
    const normalizedShift = String(shift || '').toLowerCase();
    const sessionShift = String(session.shift || session.sessionKey || '').toLowerCase();
    if (normalizedShift && !sessionShift.includes(normalizedShift)) return false;

    const scheduledEndMs = Date.parse(session.scheduledEndAt || '');
    if (!Number.isFinite(scheduledEndMs) || scheduledEndMs !== bounds.end.valueOf()) return false;
    const scheduledStartMs = Date.parse(session.scheduledStartAt || '');
    const clockInMs = Date.parse(session.clockInAt || '');
    return scheduledStartMs === bounds.start.valueOf() ||
        Boolean(session.otType || session.otStartedAt) ||
        (Number.isFinite(clockInMs) && clockInMs >= bounds.end.valueOf() - 5 * 60_000);
}

function resolveEndAdenaSettlementWindow({
    attendanceData = {},
    bounds,
    shift,
    at = new Date(),
    overtimeThresholdMinutes = 5,
    approvalMinutes = 60,
    maxOvertimeMinutes = 360
} = {}) {
    if (!bounds?.start || !bounds?.end) return null;
    const baseEndMs = bounds.end.valueOf();
    const nowMs = typeof at?.valueOf === 'function' ? at.valueOf() : Date.parse(at || '');
    const thresholdMs = baseEndMs + Math.max(0, overtimeThresholdMinutes) * 60_000;
    const overtimeCapMs = baseEndMs + Math.max(0, maxOvertimeMinutes) * 60_000;
    let latestWorkEndMs = baseEndMs;
    const activeOvertimeWorkers = [];

    for (const [userId, user] of Object.entries(attendanceData || {})) {
        for (const session of user?.sessions || []) {
            if (!sessionBelongsToShiftWindow(session, bounds, shift)) continue;
            const clockOutMs = Date.parse(session.clockOutAt || '');
            if (Number.isFinite(clockOutMs)) {
                if (clockOutMs > thresholdMs) latestWorkEndMs = Math.max(latestWorkEndMs, Math.min(clockOutMs, overtimeCapMs));
                continue;
            }
            if (Number.isFinite(nowMs) && nowMs > thresholdMs && nowMs < overtimeCapMs) {
                activeOvertimeWorkers.push({
                    userId,
                    userName: user?.name || userId,
                    sessionId: session.id || null
                });
            } else if (Number.isFinite(nowMs) && nowMs >= overtimeCapMs) {
                latestWorkEndMs = Math.max(latestWorkEndMs, overtimeCapMs);
            }
        }
    }

    const activeOvertime = activeOvertimeWorkers.length > 0;
    const deadlineMs = activeOvertime ? null : latestWorkEndMs + Math.max(0, approvalMinutes) * 60_000;
    return {
        shift: String(shift || '').toUpperCase(),
        activeOvertime,
        activeOvertimeWorkers,
        activeOvertimeCount: activeOvertimeWorkers.length,
        baseShiftEndAt: new Date(baseEndMs).toISOString(),
        workEndAt: new Date(latestWorkEndMs).toISOString(),
        extensionMinutes: Math.max(0, Math.round((latestWorkEndMs - baseEndMs) / 60_000)),
        deadlineAt: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
        reminderAt: deadlineMs === null ? null : new Date(deadlineMs - 15 * 60_000).toISOString(),
        urgentAt: deadlineMs === null ? null : new Date(deadlineMs - 5 * 60_000).toISOString()
    };
}

function getMemberServer(member, roles = {}) {
    if (member?.roles?.cache?.has?.(roles.HEINE)) return 'VALAKAS';
    if (member?.roles?.cache?.has?.(roles.PAAGRIO)) return 'PAAGRIO';
    return null;
}

function getMemberSheetName(member, user) {
    const raw = String(member?.displayName || member?.user?.username || user?.name || '').trim();
    return raw.split('-')[0].trim() || null;
}

function collectExpectedWorkers({ attendanceData, guild, bounds, shift, roles, cells, aliases }) {
    const workers = [];
    const unresolved = [];
    for (const [userId, user] of Object.entries(attendanceData || {})) {
        const worked = (user?.sessions || []).some(session => sessionOverlapsBounds(session, bounds, shift));
        if (!worked) continue;
        const member = guild?.members?.cache?.get?.(userId) || null;
        const server = getMemberServer(member, roles);
        const userName = getMemberSheetName(member, user);
        if (!server || !userName) {
            unresolved.push({ userId, userName: userName || user?.name || userId, code: !server ? 'server-role-not-found' : 'sheet-name-not-found' });
            continue;
        }
        const cell = findSummaryCell(cells, server, userName, aliases);
        if (!cell) {
            unresolved.push({ userId, server, userName, code: 'summary-user-not-found' });
            continue;
        }
        workers.push({
            userId,
            server,
            userName,
            sheetUserName: cell.userName,
            cellKey: `${server}:${normalizeName(cell.userName)}`
        });
    }
    return { workers, unresolved };
}

function collectionValues(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (typeof collection.values === 'function') return [...collection.values()];
    return Object.values(collection);
}

function getMemberShift(member, roles = {}) {
    if (member?.roles?.cache?.has?.(roles.DAY)) return 'DAY';
    if (member?.roles?.cache?.has?.(roles.NIGHT)) return 'NIGHT';
    const profileName = String(member?.displayName || member?.user?.username || '').toLowerCase();
    if (/\bday\s*time\b/.test(profileName)) return 'DAY';
    if (/\bnight\s*time\b/.test(profileName)) return 'NIGHT';
    return null;
}

function buildPendingApprovalMessage(report) {
    const lines = report.pending.slice(0, 20).map(item => (
        `- ${item.server} / ${item.userName} / ${Number(item.rawAmount || 0).toLocaleString('en-US')} / ${item.url}`
    ));
    const invalidLines = (report.invalidSubmissions || []).slice(0, 10).map(item => (
        `- 수정 필요: ${item.server} / ${item.userName} / ${item.url}`
    ));
    if (report.pending.length > lines.length) lines.push(`- 외 ${report.pending.length - lines.length}건`);
    return [
        `엔드아데나 미승인 확인 - ${report.shift}`,
        `PH TIME: ${report.checkedAtLabel}`,
        `결산 15분 전 미승인 게시물 ${report.pending.length}건`,
        ...lines,
        ...invalidLines,
        '체크 승인이 필요한 게시물만 표시했습니다.'
    ].join('\n').slice(0, 1950);
}

function buildUrgentApprovalMessage(report) {
    const lines = report.pending.slice(0, 20).map(item => (
        `- ${item.server} / ${item.userName} / ${Number(item.rawAmount || 0).toLocaleString('en-US')} / ${item.url}`
    ));
    const invalidLines = (report.invalidSubmissions || []).slice(0, 10).map(item => (
        `- \uc218\uc815 \ud544\uc694: ${item.server} / ${item.userName} / ${item.url}`
    ));
    if (report.pending.length > lines.length) lines.push(`- \uc678 ${report.pending.length - lines.length}\uac74`);
    return [
        `**\uc5d4\ub4dc\uc544\ub370\ub098 \ucd5c\uc885 \uc2b9\uc778 \ub9c8\uac10 \uacbd\ubcf4 - ${report.shift}**`,
        `PH TIME: ${report.checkedAtLabel}`,
        `\ucd5c\uc885 \uacb0\uc0b0 \ub9c8\uac10: ${report.deadlineAtLabel} (${report.minutesRemaining}\ubd84 \uc804)`,
        `\uc2b9\uc778 \ub300\uae30 \uac8c\uc2dc\ubb3c: ${report.pending.length}\uac74`,
        ...lines,
        ...invalidLines,
        '\uc790\ub3d9 \uc2b9\uc778\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. \uc6d0\ubb38\uc744 \ud655\uc778\ud55c \ud6c4 \uc218\ub3d9\uc73c\ub85c \uccb4\ud06c \uc2b9\uc778\ud558\uc138\uc694.'
    ].join('\n').slice(0, 1950);
}

function lateWindowKey(shift, shiftStartAt, shiftEndAt) {
    return `${String(shift || '').toUpperCase()}:${shiftStartAt || ''}:${shiftEndAt || ''}`;
}

function collectPendingLateApprovalWindows(operations, { now = new Date(), lookbackMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    const nowMs = new Date(now).getTime();
    const oldestMs = nowMs - lookbackMs;
    const windows = new Map();
    for (const operation of operations || []) {
        if (operation?.kind !== 'end-adena' || operation?.status !== 'success') continue;
        const audit = auditForOperation(operation);
        const createdAtMs = operationCreatedAt(operation);
        const shiftStartMs = Date.parse(audit.shiftStartAt || '');
        const shiftEndMs = Date.parse(audit.shiftEndAt || '');
        if (!Number.isFinite(createdAtMs) || !Number.isFinite(shiftStartMs) || !Number.isFinite(shiftEndMs)) continue;
        if (createdAtMs < shiftEndMs + 60 * 60 * 1000 || createdAtMs < oldestMs || createdAtMs > nowMs) continue;
        const shift = String(operation.shift || operation.payload?.shift || '').toUpperCase();
        const key = lateWindowKey(shift, audit.shiftStartAt, audit.shiftEndAt);
        const existing = windows.get(key);
        if (!existing || createdAtMs > existing.latestApprovalAtMs) {
            windows.set(key, {
                key,
                shift,
                shiftStartAt: audit.shiftStartAt,
                shiftEndAt: audit.shiftEndAt,
                latestApprovalAt: operation.createdAt,
                latestApprovalAtMs: createdAtMs,
                triggerMessageId: operation.messageId || null
            });
        }
    }

    for (const operation of operations || []) {
        if (operation?.kind !== 'end-adena-reconciliation' || operation?.status !== 'success') continue;
        const key = lateWindowKey(operation.shift, operation.payload?.shiftStartAt, operation.payload?.shiftEndAt);
        const window = windows.get(key);
        if (window && operationCreatedAt(operation) >= window.latestApprovalAtMs) windows.delete(key);
    }
    return [...windows.values()].sort((a, b) => a.latestApprovalAtMs - b.latestApprovalAtMs);
}

function formatNames(items, selector = item => item.userName || item.sheetUserName || item) {
    if (!items.length) return '없음';
    const names = items.slice(0, 16).map(selector);
    if (items.length > names.length) names.push(`외 ${items.length - names.length}명`);
    return names.join(', ');
}

function summaryCellKey(server, userName) {
    return `${normalizePayrollServer(server)}:${normalizeName(userName)}`;
}

function classifyCloseReadiness({ expectedWorkers = [], submitted = [], pending = [], cells = [] } = {}) {
    const expectedKeys = new Set(expectedWorkers.map(worker => worker.cellKey));
    const submittedByKey = new Map(submitted.map(item => [summaryCellKey(item.server, item.sheetUserName), item]));
    const pendingByKey = new Map();
    for (const item of pending) {
        if (!item.cellKey) continue;
        const list = pendingByKey.get(item.cellKey) || [];
        list.push(item);
        pendingByKey.set(item.cellKey, list);
    }

    const approved = [];
    const awaitingApproval = [];
    const missing = [];
    for (const worker of expectedWorkers) {
        const pendingPosts = pendingByKey.get(worker.cellKey) || [];
        if (pendingPosts.length) {
            awaitingApproval.push({ ...worker, pending: pendingPosts });
            continue;
        }
        const approvedOperation = submittedByKey.get(worker.cellKey);
        if (approvedOperation) {
            approved.push({ ...worker, operation: approvedOperation });
            continue;
        }
        missing.push(worker);
    }

    const notWorkingByKey = new Map();
    function addNotWorking(key, item, reason) {
        if (!key || expectedKeys.has(key)) return;
        const existing = notWorkingByKey.get(key) || {
            server: item.server,
            userName: item.sheetUserName || item.userName,
            sheetUserName: item.sheetUserName || item.userName,
            summaryValue: 0,
            reasons: []
        };
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        notWorkingByKey.set(key, existing);
    }

    for (const cell of cells) {
        const value = Number(cell.value || 0);
        if (!value) continue;
        const key = summaryCellKey(cell.server, cell.userName);
        addNotWorking(key, { server: cell.server, sheetUserName: cell.userName }, 'summary-value');
        const item = notWorkingByKey.get(key);
        if (item) item.summaryValue = value;
    }
    for (const item of submitted) {
        addNotWorking(summaryCellKey(item.server, item.sheetUserName), item, 'approved-submission');
    }
    for (const item of pending) {
        addNotWorking(item.cellKey, item, 'pending-submission');
    }

    return {
        approved,
        awaitingApproval,
        missing,
        notWorking: [...notWorkingByKey.values()],
        unexpectedApprovals: submitted.filter(item => !expectedKeys.has(summaryCellKey(item.server, item.sheetUserName))),
        unexpectedPending: pending.filter(item => item.cellKey && !expectedKeys.has(item.cellKey))
    };
}

function buildCloseReadinessMessage(report) {
    const reasonLabels = {
        'summary-value': '요약값',
        'approved-submission': '승인완료',
        'pending-submission': '승인대기'
    };
    return [
        `엔드아데나 결산 준비 현황 - ${report.shift}`,
        `PH TIME: ${report.checkedAtLabel}`,
        `근무 종료 ${report.minutesBeforeEnd}분 전 / ${report.shiftStartLabel} ~ ${report.shiftEndLabel}`,
        `실출근 ${report.expectedWorkers.length}명 / 승인 완료 ${report.approved.length}명 / 승인 대기 ${report.awaitingApproval.length}명 / 수정 필요 ${report.invalidSubmissions.length}명 / 미제출 ${report.missing.length}명`,
        `비근무 데이터 ${report.notWorking.length}명 / 예외 ${report.unresolved.length}건`,
        `승인 완료: ${formatNames(report.approved, item => item.sheetUserName)}`,
        `승인 대기: ${formatNames(report.awaitingApproval, item => item.sheetUserName)}`,
        `수정 필요: ${formatNames(report.invalidSubmissions, item => item.url ? `[${item.sheetUserName || item.userName}](${item.url})` : item.sheetUserName || item.userName)}`,
        `미제출: ${formatNames(report.missing, item => item.sheetUserName)}`,
        `비근무 데이터: ${formatNames(report.notWorking, item => `${item.sheetUserName}(${item.reasons.map(reason => reasonLabels[reason] || reason).join('+')}${item.summaryValue ? ` ${Number(item.summaryValue).toLocaleString('en-US')}` : ''})`)}`,
        `예외: ${formatNames(report.unresolved, item => `${item.userName || 'Unknown'}(${item.code})`)}`,
        '승인은 자동 처리하지 않습니다. 승인 대기 게시물은 관리자가 직접 확인합니다.'
    ].join('\n').slice(0, 1950);
}

function appendItems(lines, label, items, formatter = item => item?.sheetUserName || item?.userName || 'Unknown') {
    if (!items?.length) return;
    lines.push('', `${label} (${items.length})`);
    for (const item of items.slice(0, 10)) lines.push(`- ${formatter(item)}`);
    if (items.length > 10) lines.push(`- +${items.length - 10}`);
}

function buildReportMessage(report) {
    const totals = Object.entries(report.totalsByServer)
        .map(([server, value]) => `${server} ${Number(value || 0).toLocaleString('en-US')}`)
        .join(' / ') || '0';
    const status = !report.technicalOk
        ? '기술 오류'
        : report.needsReview > 0
            ? `관리자 확인 필요 ${report.needsReview}건`
            : report.sheetMismatches.length > 0
                ? `자동 복구 완료 ${report.sheetMismatches.filter(item => item.recovered).length}건`
                : '정상 완료';
    const qualityIssues = formatEndAdenaQualityIssues(report.quality7d);
    const lines = [
        `**엔드아데나 마감 무결성 검사 - ${report.shift}**`,
        `상태: ${status}`,
        `PH TIME: ${report.checkedAtLabel}`,
        `근무: ${report.shiftStartLabel} ~ ${report.shiftEndLabel}`,
        `실출근 ${report.expectedWorkers.length}명 / 제출 ${report.submitted.length}명 / 미제출 ${report.missing.length}명`,
        `게시물: 전체 ${report.postCount}건 / 승인 ${report.approvedPostCount}건 / 승인 대기 ${report.pending.length}건 / 수정 필요 ${report.invalidSubmissions.length}건 / 시트 검증 ${report.sheetRecordedCount}명`,
        `총합: ${totals}`,
        formatEndAdenaQualityLine(report.quality7d),
        ...(qualityIssues ? [qualityIssues] : []),
        `자동 수정 ${report.repair.corrected || 0}건 / 중복 ${report.duplicates.length + report.pendingDuplicates.length}건 / 확인 필요 ${report.needsReview}건`
    ];
    appendItems(lines, '승인 대기', report.awaitingApproval, item => {
        const pending = item.pending?.[0];
        const name = item.sheetUserName || item.userName;
        return pending?.url ? `[${name}](${pending.url})` : name;
    });
    appendItems(lines, '미제출', report.missing);
    appendItems(lines, '비근무 승인', report.unexpected, item => {
        const name = item.sheetUserName || item.userName;
        return item.url ? `[${name}](${item.url})` : name;
    });
    appendItems(lines, '비근무 승인 대기', report.unexpectedPending, item => {
        const name = item.sheetUserName || item.userName;
        return item.url ? `[${name}](${item.url})` : name;
    });
    appendItems(lines, '수정 필요 게시물', report.invalidSubmissions, item => {
        const name = item.sheetUserName || item.userName;
        const detail = `${name} (${(item.issueCodes || ['invalid-format']).join(', ')})`;
        return item.url ? `[${detail}](${item.url})` : detail;
    });
    appendItems(lines, '중복 승인', report.duplicates, item => {
        const name = item.sheetUserName || item.userName;
        return item.urls?.[0] ? `[${name}](${item.urls[0]})` : name;
    });
    appendItems(lines, '중복 승인 대기', report.pendingDuplicates, item => {
        const name = item.sheetUserName || item.userName;
        return item.urls?.[0] ? `[${name}](${item.urls[0]})` : name;
    });
    appendItems(lines, '시트 금액 불일치', report.sheetMismatches, item => (
        `${item.server} / ${item.userName}: ${item.sheetValue.toLocaleString('en-US')} -> ${item.approvedValue.toLocaleString('en-US')} (${item.recovered ? '복구 완료' : '복구 실패'})`
    ));
    appendItems(lines, '예외', report.unresolved, item => `${item.userName || 'Unknown'} (${item.code || 'unknown'})`);
    appendItems(lines, '자동 복구 실패', report.repair.failures, item => `${item.server || 'Unknown'} (${item.code || 'failed'})`);
    lines.push('', '체크 승인은 자동으로 처리하지 않습니다. 승인 대기 원문을 관리자가 직접 확인해야 합니다.');
    return lines.join('\n').slice(0, 1950);
}

function createEndAdenaReconciliationService({
    CONFIG,
    moment,
    client,
    getAttendanceData,
    payrollOperationLogService,
    purchaseSheetService,
    refreshGuildMembers = null,
    logger = console
}) {
    if (!CONFIG?.TIMEZONE || !CONFIG?.ROLES) throw new TypeError('CONFIG with TIMEZONE and ROLES must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (typeof getAttendanceData !== 'function') throw new TypeError('getAttendanceData must be a function');
    if (typeof payrollOperationLogService?.listRecent !== 'function') throw new TypeError('payrollOperationLogService.listRecent must be a function');
    if (typeof purchaseSheetService?.readAdenaSummary !== 'function') throw new TypeError('purchaseSheetService.readAdenaSummary must be a function');
    if (typeof purchaseSheetService?.repairAdenaSummary !== 'function') throw new TypeError('purchaseSheetService.repairAdenaSummary must be a function');

    const aliases = normalizeAliasMap(CONFIG.SHEET_NAME_ALIASES || {});

    function getSettlementWindow({ shift, bounds, at = moment().tz(CONFIG.TIMEZONE) } = {}) {
        return resolveEndAdenaSettlementWindow({
            attendanceData: getAttendanceData(),
            bounds,
            shift,
            at,
            overtimeThresholdMinutes: Number(CONFIG.END_ADENA_OVERTIME_THRESHOLD_MINS || 5),
            approvalMinutes: Number(CONFIG.END_ADENA_APPROVAL_WINDOW_MINS || 60),
            maxOvertimeMinutes: Number(CONFIG.END_ADENA_MAX_OVERTIME_MINS || 360)
        });
    }

    async function run({
        shift,
        bounds,
        at = moment().tz(CONFIG.TIMEZONE),
        guild = null,
        source = 'scheduler',
        triggerMessageId = null,
        settlement = null
    } = {}) {
        const normalizedShift = String(shift || '').trim().toUpperCase();
        if (!['DAY', 'NIGHT'].includes(normalizedShift) || !bounds?.start || !bounds?.end) {
            return { ok: false, code: 'invalid-reconciliation-window', shift: normalizedShift || null };
        }
        const now = moment(at).tz(CONFIG.TIMEZONE);
        const settlementWindow = settlement || getSettlementWindow({ shift: normalizedShift, bounds, at: now });
        const settlementDeadlineMs = Date.parse(settlementWindow?.deadlineAt || '');
        const automaticRun = source !== 'admin-review';
        if (settlementWindow?.activeOvertime || (
            automaticRun && Number.isFinite(settlementDeadlineMs) && now.valueOf() < settlementDeadlineMs
        )) {
            return {
                ok: true,
                deferred: true,
                reason: settlementWindow?.activeOvertime ? 'active-overtime' : 'settlement-window-open',
                shift: normalizedShift,
                activeOvertimeCount: settlementWindow?.activeOvertimeCount || 0,
                settlementDeadlineAt: settlementWindow?.deadlineAt || null
            };
        }
        const targetGuild = guild || client?.guilds?.cache?.get?.(CONFIG.GUILD_ID) || null;
        if (targetGuild && typeof refreshGuildMembers === 'function') {
            await refreshGuildMembers(targetGuild, {
                force: false,
                minIntervalMs: 10 * 60 * 1000
            });
        } else if (targetGuild && !targetGuild.members?.cache?.size) {
            await targetGuild.members?.fetch?.().catch(error => {
                logger.log?.('[END ADENA RECONCILIATION MEMBER FETCH SKIP]', error?.message || error);
            });
        }

        const sheet = await purchaseSheetService.readAdenaSummary({ shift: normalizedShift });
        if (!sheet.ok) {
            const failed = {
                ok: false,
                code: 'summary-read-failed',
                shift: normalizedShift,
                sheetResults: sheet.results || []
            };
            await payrollOperationLogService.record({
                kind: 'end-adena-reconciliation',
                action: 'reconcile',
                shift: normalizedShift,
                status: 'failed',
                result: failed,
                source
            });
            return failed;
        }

        const from = bounds.start.clone();
        const recentOperations = await payrollOperationLogService.listRecent({ limit: 10_000, date: bounds.end.toDate() });
        const operations = selectEndAdenaOperations(
            recentOperations,
            {
                shift: normalizedShift,
                from: from.toISOString(),
                to: now.toISOString(),
                shiftStartAt: bounds.start.toISOString(),
                shiftEndAt: bounds.end.toISOString()
            }
        );
        const summaryWasReset = hasSuccessfulSummaryReset(recentOperations, {
            shift: normalizedShift,
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString()
        });
        const operationsByCell = new Map();
        const unresolvedOperations = [];
        for (const operation of operations) {
            const server = normalizePayrollServer(operation.server || operation.payload?.server);
            const userName = operation.userName || operation.payload?.userName;
            const cell = findSummaryCell(sheet.cells, server, userName, aliases);
            if (!cell) {
                unresolvedOperations.push({ server, userName, code: 'operation-summary-user-not-found' });
                continue;
            }
            const key = `${server}:${normalizeName(cell.userName)}`;
            const list = operationsByCell.get(key) || [];
            list.push(operation);
            operationsByCell.set(key, list);
        }

        const expectedValues = [];
        const submitted = [];
        const duplicates = [];
        const totalsByServer = {};
        for (const cell of sheet.cells) {
            const server = normalizePayrollServer(cell.server);
            const key = `${server}:${normalizeName(cell.userName)}`;
            const cellOperations = operationsByCell.get(key) || [];
            const reduced = reduceEndAdenaOperations(cellOperations, { fromZero: summaryWasReset });
            const urls = reduced.approvedMessageIds.map(messageId => {
                const operation = cellOperations.find(item => String(item.messageId || item.payload?.messageId || '') === String(messageId));
                const channelId = operation?.channelId || operation?.payload?.channelId || CONFIG.END_ADENA_CHANNEL_IDS?.[server];
                return buildMessageUrl(CONFIG.GUILD_ID, channelId, messageId);
            }).filter(Boolean);
            expectedValues.push({ server, userName: cell.userName, value: reduced.expectedValue });
            totalsByServer[server] = (totalsByServer[server] || 0) + reduced.expectedValue;
            if (reduced.submitted) submitted.push({ server, sheetUserName: cell.userName, range: cell.range, urls, url: urls[0] || null, ...reduced });
            if (reduced.duplicate) duplicates.push({ server, sheetUserName: cell.userName, range: cell.range, urls, ...reduced });
        }

        const expected = collectExpectedWorkers({
            attendanceData: getAttendanceData(),
            guild: targetGuild,
            bounds,
            shift: normalizedShift.toLowerCase(),
            roles: CONFIG.ROLES,
            cells: sheet.cells,
            aliases
        });
        const submissionScan = await scanPendingApprovals({
            normalizedShift,
            bounds,
            now,
            targetGuild,
            operations: recentOperations
        });
        const rawPending = submissionScan.pending;
        const unresolvedPending = [];
        const pending = rawPending.map(item => {
            const cell = findSummaryCell(sheet.cells, item.server, item.userName, aliases);
            if (!cell) {
                unresolvedPending.push({ server: item.server, userName: item.userName, messageId: item.messageId, code: 'pending-summary-user-not-found' });
                return { ...item, cellKey: null, sheetUserName: item.userName };
            }
            return {
                ...item,
                cellKey: summaryCellKey(item.server, cell.userName),
                sheetUserName: cell.userName
            };
        });
        const invalidSubmissions = submissionScan.invalidSubmissions.map(item => {
            const cell = findSummaryCell(sheet.cells, item.server, item.userName, aliases);
            return cell
                ? { ...item, cellKey: summaryCellKey(item.server, cell.userName), sheetUserName: cell.userName }
                : { ...item, cellKey: null, sheetUserName: item.userName };
        });
        const classification = classifyCloseReadiness({
            expectedWorkers: expected.workers,
            submitted,
            pending,
            cells: sheet.cells
        });
        const awaitingApproval = classification.awaitingApproval.map(item => ({
            ...item,
            url: item.pending?.[0]?.url || null
        }));
        const invalidExpectedKeys = new Set(invalidSubmissions.map(item => item.cellKey).filter(Boolean));
        const missing = classification.missing.filter(item => !invalidExpectedKeys.has(item.cellKey));
        const unexpected = classification.unexpectedApprovals;
        const unexpectedPending = classification.unexpectedPending;
        const pendingDuplicates = collectPendingDuplicates(pending);
        const repair = await purchaseSheetService.repairAdenaSummary({
            shift: normalizedShift,
            expectedValues
        });
        const unresolved = [...expected.unresolved, ...unresolvedOperations, ...unresolvedPending, ...(repair.unresolved || [])];
        const sheetMismatches = collectSheetMismatches(repair);
        const failedRanges = new Set((repair.failures || []).flatMap(item => item.ranges || []));
        const sheetRecordedCount = submitted.filter(item => !failedRanges.has(item.range)).length;
        const approvedPostCount = submitted.reduce((sum, item) => sum + item.approvedMessageIds.length, 0);
        const postCount = approvedPostCount + pending.length + invalidSubmissions.length;
        const needsReview = awaitingApproval.length + missing.length + unexpected.length + unexpectedPending.length +
            invalidSubmissions.length + duplicates.length + pendingDuplicates.length + unresolved.length + (repair.failures || []).length;
        const technicalOk = Boolean(repair.ok);
        const report = {
            ok: technicalOk,
            technicalOk,
            businessComplete: technicalOk && needsReview === 0,
            shift: normalizedShift,
            source,
            triggerMessageId,
            checkedAt: now.toISOString(),
            checkedAtLabel: now.format('YYYY-MM-DD HH:mm:ss'),
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            workEndAt: settlementWindow?.workEndAt || bounds.end.toISOString(),
            settlementDeadlineAt: settlementWindow?.deadlineAt || bounds.end.clone().add(60, 'minutes').toISOString(),
            overtimeExtensionMinutes: Number(settlementWindow?.extensionMinutes || 0),
            shiftStartLabel: bounds.start.format('MM/DD HH:mm'),
            shiftEndLabel: bounds.end.format('MM/DD HH:mm'),
            expectedWorkers: expected.workers,
            submitted,
            approved: classification.approved,
            approvedPostCount,
            postCount,
            pending,
            awaitingApproval,
            invalidSubmissions,
            missing,
            unexpected,
            unexpectedPending,
            duplicates,
            pendingDuplicates,
            unresolved,
            operations: operations.length,
            totalsByServer,
            repair,
            sheetMismatches,
            sheetRecordedCount,
            needsReview
        };
        report.integrityFingerprint = integrityFingerprint(report);
        report.quality7d = summarizeEndAdenaQuality(recentOperations, {
            now,
            days: 7,
            currentReport: report
        });

        await payrollOperationLogService.record({
            kind: 'end-adena-reconciliation',
            action: 'reconcile',
            shift: normalizedShift,
            status: report.ok ? 'success' : 'failed',
            payload: {
                shift: normalizedShift,
                from: from.toISOString(),
                to: now.toISOString(),
                shiftStartAt: bounds.start.toISOString(),
                shiftEndAt: bounds.end.toISOString(),
                workEndAt: report.workEndAt,
                settlementDeadlineAt: report.settlementDeadlineAt,
                overtimeExtensionMinutes: report.overtimeExtensionMinutes,
                triggerMessageId
            },
            result: {
                ok: report.ok,
                technicalOk: report.technicalOk,
                businessComplete: report.businessComplete,
                needsReview: report.needsReview,
                expectedWorkers: report.expectedWorkers.length,
                submitted: report.submitted.length,
                approved: report.approved.length,
                approvedPostCount: report.approvedPostCount,
                postCount: report.postCount,
                pending: report.pending,
                awaitingApproval: report.awaitingApproval,
                invalidSubmissions: report.invalidSubmissions,
                missing: report.missing,
                unexpected: report.unexpected,
                unexpectedPending: report.unexpectedPending,
                duplicates: report.duplicates,
                pendingDuplicates: report.pendingDuplicates,
                unresolved: report.unresolved,
                totalsByServer,
                sheetMismatches: report.sheetMismatches,
                sheetRecordedCount: report.sheetRecordedCount,
                integrityFingerprint: report.integrityFingerprint,
                quality7d: report.quality7d,
                repair
            },
            source
        });

        const reportMessage = buildReportMessage(report);
        const channel = CONFIG.LOG_CHANNEL && client?.channels?.fetch
            ? await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null)
            : null;
        let logNotified = false;
        if (channel?.send) {
            logNotified = Boolean(await channel.send(reportMessage).then(() => true).catch(error => {
                logger.warn?.('[END ADENA RECONCILIATION REPORT WARN]', error?.message || error);
                return false;
            }));
        }
        const previouslyReported = recentOperations.some(operation => (
            operation?.kind === 'end-adena-close-integrity' &&
            operation?.status === 'success' &&
            String(operation?.result?.integrityFingerprint || '') === report.integrityFingerprint &&
            reminderMatchesWindow(operation, normalizedShift, bounds)
        ));
        const ownerIds = [...new Set((CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || []).filter(Boolean))];
        let ownerNotified = 0;
        if (!previouslyReported && (!report.businessComplete || !report.technicalOk) && ownerIds.length && client?.users?.fetch) {
            const results = await Promise.all(ownerIds.map(async ownerId => {
                const owner = await client.users.fetch(ownerId).catch(() => null);
                if (!owner?.send) return false;
                return owner.send(reportMessage).then(() => true).catch(error => {
                    logger.warn?.('[END ADENA INTEGRITY DM WARN]', ownerId, error?.message || error);
                    return false;
                });
            }));
            ownerNotified = results.filter(Boolean).length;
        }
        report.logNotified = logNotified;
        report.ownerNotified = ownerNotified;
        report.alertDeduplicated = previouslyReported;
        await payrollOperationLogService.record({
            kind: 'end-adena-close-integrity',
            action: 'audit',
            shift: normalizedShift,
            status: report.technicalOk ? 'success' : 'failed',
            payload: {
                shift: normalizedShift,
                shiftStartAt: bounds.start.toISOString(),
                shiftEndAt: bounds.end.toISOString(),
                checkedAt: report.checkedAt,
                source
            },
            result: {
                ok: report.technicalOk,
                businessComplete: report.businessComplete,
                needsReview: report.needsReview,
                expectedWorkers: report.expectedWorkers.length,
                submitted: report.submitted.length,
                approvedPostCount: report.approvedPostCount,
                postCount: report.postCount,
                pending: report.pending,
                awaitingApproval: report.awaitingApproval,
                invalidSubmissions: report.invalidSubmissions,
                missing: report.missing,
                unexpected: report.unexpected,
                unexpectedPending: report.unexpectedPending,
                duplicates: report.duplicates,
                pendingDuplicates: report.pendingDuplicates,
                unresolved: report.unresolved,
                totalsByServer: report.totalsByServer,
                sheetMismatches: report.sheetMismatches,
                sheetRecordedCount: report.sheetRecordedCount,
                repairFailures: report.repair.failures || [],
                integrityFingerprint: report.integrityFingerprint,
                quality7d: report.quality7d,
                logNotified,
                ownerNotified,
                alertDeduplicated: previouslyReported
            },
            source
        });
        return report;
    }

    async function scanPendingApprovals({ normalizedShift, bounds, now, targetGuild, operations }) {
        const handledMessageIds = new Set(
            operations
                .filter(operation => operation?.kind === 'end-adena' && operation?.status === 'success')
                .map(operation => String(operation.messageId || operation.payload?.messageId || ''))
                .filter(Boolean)
        );
        const pending = [];
        const invalidSubmissions = [];
        const latestValidations = new Map();
        for (const operation of operations || []) {
            if (operation?.kind !== 'end-adena-prevalidation' || !operation?.messageId) continue;
            const previous = latestValidations.get(String(operation.messageId));
            if (!previous || operationCreatedAt(operation) >= operationCreatedAt(previous)) {
                latestValidations.set(String(operation.messageId), operation);
            }
        }
        const seenMessages = new Set();
        const seenChannels = new Set();
        for (const [configuredServer, channelId] of Object.entries(CONFIG.END_ADENA_CHANNEL_IDS || {})) {
            if (!channelId || seenChannels.has(channelId)) continue;
            seenChannels.add(channelId);
            const channel = await client?.channels?.fetch?.(channelId).catch(() => null);
            const fetched = await channel?.messages?.fetch?.({ limit: 100 }).catch(error => {
                logger.warn?.('[END ADENA PENDING FETCH WARN]', { channelId, message: error?.message || error });
                return null;
            });
            for (const message of collectionValues(fetched)) {
                if (!message?.id || seenMessages.has(message.id) || message.author?.bot) continue;
                seenMessages.add(message.id);
                const createdAtMs = new Date(message.createdAt || message.createdTimestamp || 0).getTime();
                if (!Number.isFinite(createdAtMs) || createdAtMs < bounds.start.valueOf() || createdAtMs > now.valueOf()) continue;
                if (handledMessageIds.has(String(message.id))) continue;
                const parsed = parseEndAdenaMessage(message.content);
                const member = message.member || targetGuild?.members?.cache?.get?.(message.author?.id) ||
                    await targetGuild?.members?.fetch?.(message.author?.id).catch(() => null);
                const memberShift = getMemberShift(member, CONFIG.ROLES);
                if (memberShift && memberShift !== normalizedShift) continue;
                const server = normalizePayrollServer(configuredServer);
                const userName = memberShift
                    ? getMemberSheetName(member, { name: parsed?.requestedName })
                    : parsed?.requestedName || getMemberSheetName(member, null) || message.author?.username || 'Unknown';
                const url = buildMessageUrl(CONFIG.GUILD_ID, channelId, message.id);
                const validation = latestValidations.get(String(message.id));
                if (!parsed || validation?.status === 'failed') {
                    invalidSubmissions.push({
                        messageId: message.id,
                        channelId,
                        server,
                        userName,
                        rawAmount: parsed?.rawAmount ?? validation?.payload?.rawAmount ?? null,
                        issueCodes: validation?.result?.issueCodes || ['invalid-format'],
                        createdAt: new Date(createdAtMs).toISOString(),
                        url
                    });
                    continue;
                }
                pending.push({
                    messageId: message.id,
                    channelId,
                    server,
                    userName,
                    rawAmount: parsed.rawAmount,
                    createdAt: new Date(createdAtMs).toISOString(),
                    url
                });
            }
        }
        pending.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        invalidSubmissions.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        return { pending, invalidSubmissions };
    }

    async function reportCloseReadiness({ shift, bounds, at = moment().tz(CONFIG.TIMEZONE), guild = null } = {}) {
        const normalizedShift = String(shift || '').trim().toUpperCase();
        if (!['DAY', 'NIGHT'].includes(normalizedShift) || !bounds?.start || !bounds?.end) {
            return { ok: false, code: 'invalid-readiness-window', shift: normalizedShift || null };
        }
        const now = moment(at).tz(CONFIG.TIMEZONE);
        const targetGuild = guild || client?.guilds?.cache?.get?.(CONFIG.GUILD_ID) || null;
        await targetGuild?.members?.fetch?.().catch(error => {
            logger.warn?.('[END ADENA READINESS MEMBER FETCH WARN]', error?.message || error);
        });
        const operations = await payrollOperationLogService.listRecent({ limit: 10_000, date: bounds.end.toDate() });
        const alreadyReported = operations.some(operation => (
            operation?.kind === 'end-adena-close-readiness' &&
            operation?.status === 'success' &&
            String(operation?.shift || operation?.payload?.shift || '').toUpperCase() === normalizedShift &&
            sameInstant(operation?.payload?.shiftStartAt, bounds.start.toISOString()) &&
            sameInstant(operation?.payload?.shiftEndAt, bounds.end.toISOString())
        ));
        if (alreadyReported) {
            return { ok: true, skipped: true, reason: 'already-reported', shift: normalizedShift };
        }

        const sheet = await purchaseSheetService.readAdenaSummary({ shift: normalizedShift });
        if (!sheet.ok) {
            const failed = { ok: false, code: 'summary-read-failed', shift: normalizedShift, sheetResults: sheet.results || [] };
            await payrollOperationLogService.record({
                kind: 'end-adena-close-readiness',
                action: 'report',
                shift: normalizedShift,
                status: 'failed',
                payload: {
                    shift: normalizedShift,
                    shiftStartAt: bounds.start.toISOString(),
                    shiftEndAt: bounds.end.toISOString(),
                    checkedAt: now.toISOString()
                },
                result: failed,
                source: 'scheduler'
            });
            return failed;
        }

        const approvedOperations = selectEndAdenaOperations(operations, {
            shift: normalizedShift,
            from: bounds.start.toISOString(),
            to: now.toISOString(),
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString()
        });
        const operationsByCell = new Map();
        const unresolvedOperations = [];
        for (const operation of approvedOperations) {
            const server = normalizePayrollServer(operation.server || operation.payload?.server);
            const userName = operation.userName || operation.payload?.userName;
            const cell = findSummaryCell(sheet.cells, server, userName, aliases);
            if (!cell) {
                unresolvedOperations.push({ server, userName, code: 'operation-summary-user-not-found' });
                continue;
            }
            const key = summaryCellKey(server, cell.userName);
            const list = operationsByCell.get(key) || [];
            list.push(operation);
            operationsByCell.set(key, list);
        }

        const submitted = [];
        for (const cell of sheet.cells) {
            const server = normalizePayrollServer(cell.server);
            const reduced = reduceEndAdenaOperations(operationsByCell.get(summaryCellKey(server, cell.userName)) || []);
            if (reduced.submitted) submitted.push({ server, sheetUserName: cell.userName, ...reduced });
        }
        const expected = collectExpectedWorkers({
            attendanceData: getAttendanceData(),
            guild: targetGuild,
            bounds,
            shift: normalizedShift.toLowerCase(),
            roles: CONFIG.ROLES,
            cells: sheet.cells,
            aliases
        });
        const submissionScan = await scanPendingApprovals({ normalizedShift, bounds, now, targetGuild, operations });
        const rawPending = submissionScan.pending;
        const unresolvedPending = [];
        const pending = rawPending.map(item => {
            const cell = findSummaryCell(sheet.cells, item.server, item.userName, aliases);
            if (!cell) {
                unresolvedPending.push({ server: item.server, userName: item.userName, code: 'pending-summary-user-not-found' });
                return { ...item, cellKey: null, sheetUserName: item.userName };
            }
            return {
                ...item,
                cellKey: summaryCellKey(item.server, cell.userName),
                sheetUserName: cell.userName
            };
        });
        const invalidSubmissions = submissionScan.invalidSubmissions.map(item => {
            const cell = findSummaryCell(sheet.cells, item.server, item.userName, aliases);
            return cell
                ? { ...item, cellKey: summaryCellKey(item.server, cell.userName), sheetUserName: cell.userName }
                : { ...item, cellKey: null, sheetUserName: item.userName };
        });
        const classification = classifyCloseReadiness({
            expectedWorkers: expected.workers,
            submitted,
            pending,
            cells: sheet.cells
        });
        const invalidExpectedKeys = new Set(invalidSubmissions.map(item => item.cellKey).filter(Boolean));
        const missing = classification.missing.filter(item => !invalidExpectedKeys.has(item.cellKey));
        const unresolved = [...expected.unresolved, ...unresolvedOperations, ...unresolvedPending];
        const report = {
            ok: true,
            shift: normalizedShift,
            checkedAt: now.toISOString(),
            checkedAtLabel: now.format('YYYY-MM-DD HH:mm:ss'),
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            shiftStartLabel: bounds.start.format('MM/DD HH:mm'),
            shiftEndLabel: bounds.end.format('MM/DD HH:mm'),
            minutesBeforeEnd: Math.max(0, bounds.end.diff(now, 'minutes')),
            expectedWorkers: expected.workers,
            submitted,
            pending,
            invalidSubmissions,
            unresolved,
            ...classification,
            missing,
            needsReview: classification.awaitingApproval.length + missing.length +
                classification.notWorking.length + invalidSubmissions.length + unresolved.length
        };

        const logChannel = CONFIG.LOG_CHANNEL && client?.channels?.fetch
            ? await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null)
            : null;
        if (!logChannel?.send) {
            report.ok = false;
            report.code = 'log-channel-unavailable';
        } else {
            const sent = await logChannel.send(buildCloseReadinessMessage(report))
                .then(() => true)
                .catch(error => {
                    logger.warn?.('[END ADENA READINESS REPORT WARN]', error?.message || error);
                    return false;
                });
            if (!sent) {
                report.ok = false;
                report.code = 'report-send-failed';
            }
        }

        await payrollOperationLogService.record({
            kind: 'end-adena-close-readiness',
            action: 'report',
            shift: normalizedShift,
            status: report.ok ? 'success' : 'failed',
            payload: {
                shift: normalizedShift,
                shiftStartAt: bounds.start.toISOString(),
                shiftEndAt: bounds.end.toISOString(),
                checkedAt: now.toISOString()
            },
            result: {
                ok: report.ok,
                expectedWorkers: report.expectedWorkers.length,
                approved: report.approved.length,
                awaitingApproval: report.awaitingApproval.length,
                invalidSubmissions: report.invalidSubmissions,
                missing: report.missing,
                notWorking: report.notWorking,
                unresolved: report.unresolved,
                needsReview: report.needsReview
            },
            source: 'scheduler'
        });
        return report;
    }

    async function remindPendingApprovals({
        shift,
        bounds,
        at = moment().tz(CONFIG.TIMEZONE),
        guild = null,
        urgent = false,
        settlement = null
    } = {}) {
        const normalizedShift = String(shift || '').trim().toUpperCase();
        if (!['DAY', 'NIGHT'].includes(normalizedShift) || !bounds?.start || !bounds?.end) {
            return { ok: false, code: 'invalid-reminder-window', shift: normalizedShift || null, pending: [] };
        }
        const now = moment(at).tz(CONFIG.TIMEZONE);
        const settlementWindow = settlement || getSettlementWindow({ shift: normalizedShift, bounds, at: now });
        if (settlementWindow?.activeOvertime) {
            return {
                ok: true,
                deferred: true,
                reason: 'active-overtime',
                shift: normalizedShift,
                urgent: Boolean(urgent),
                activeOvertimeCount: settlementWindow.activeOvertimeCount,
                pending: []
            };
        }
        const targetGuild = guild || client?.guilds?.cache?.get?.(CONFIG.GUILD_ID) || null;
        const operations = await payrollOperationLogService.listRecent({ limit: 10_000, date: bounds.end.toDate() });
        const kind = urgent ? 'end-adena-approval-deadline-warning' : 'end-adena-approval-reminder';
        const previous = operations
            .filter(operation => operation?.kind === kind && operation?.status === 'success')
            .find(operation => reminderMatchesWindow(operation, normalizedShift, bounds));
        if (previous) {
            return {
                ok: true,
                skipped: true,
                reason: 'already-notified',
                shift: normalizedShift,
                urgent: Boolean(urgent),
                pending: Array.isArray(previous.result?.pending) ? previous.result.pending : [],
                invalidSubmissions: Array.isArray(previous.result?.invalidSubmissions) ? previous.result.invalidSubmissions : []
            };
        }
        const submissionScan = await scanPendingApprovals({ normalizedShift, bounds, now, targetGuild, operations });
        const pending = submissionScan.pending;
        const invalidSubmissions = submissionScan.invalidSubmissions;
        const deadlineMs = Date.parse(settlementWindow?.deadlineAt || '');
        const deadline = Number.isFinite(deadlineMs)
            ? moment(deadlineMs).tz(CONFIG.TIMEZONE)
            : bounds.end.clone().add(60, 'minutes');
        const report = {
            ok: true,
            shift: normalizedShift,
            checkedAt: now.toISOString(),
            checkedAtLabel: now.format('YYYY-MM-DD HH:mm:ss'),
            deadlineAt: deadline.toISOString(),
            deadlineAtLabel: deadline.format('YYYY-MM-DD HH:mm:ss'),
            minutesRemaining: Math.max(0, deadline.diff(now, 'minutes')),
            urgent: Boolean(urgent),
            pending,
            invalidSubmissions
        };
        const message = urgent ? buildUrgentApprovalMessage(report) : buildPendingApprovalMessage(report);
        const ownerIds = [...new Set((CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || []).filter(Boolean))];
        let logNotified = false;
        let ownerNotified = 0;
        if ((pending.length || invalidSubmissions.length) && CONFIG.LOG_CHANNEL && client?.channels?.fetch) {
            const logChannel = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
            const content = urgent && ownerIds.length
                ? `${ownerIds.map(id => `<@${id}>`).join(' ')}\n${message}`.slice(0, 2000)
                : message;
            logNotified = Boolean(await logChannel?.send?.(urgent
                ? { content, allowedMentions: { users: ownerIds } }
                : content).then(() => true).catch(error => {
                logger.warn?.('[END ADENA PENDING REPORT WARN]', error?.message || error);
                return false;
            }));
        }
        if (urgent && (pending.length || invalidSubmissions.length) && ownerIds.length && client?.users?.fetch) {
            const results = await Promise.all(ownerIds.map(async ownerId => {
                const owner = await client.users.fetch(ownerId).catch(() => null);
                if (!owner?.send) return false;
                return owner.send(message).then(() => true).catch(error => {
                    logger.warn?.('[END ADENA DEADLINE DM WARN]', ownerId, error?.message || error);
                    return false;
                });
            }));
            ownerNotified = results.filter(Boolean).length;
        }
        await payrollOperationLogService.record({
            kind,
            action: 'scan',
            shift: normalizedShift,
            status: 'success',
            payload: {
                shiftStartAt: bounds.start.toISOString(),
                shiftEndAt: bounds.end.toISOString(),
                workEndAt: settlementWindow?.workEndAt || bounds.end.toISOString(),
                settlementDeadlineAt: deadline.toISOString(),
                overtimeExtensionMinutes: Number(settlementWindow?.extensionMinutes || 0),
                checkedAt: now.toISOString()
            },
            result: { pending, invalidSubmissions, urgent: Boolean(urgent), logNotified, ownerNotified },
            source: urgent ? 'deadline-guard' : 'scheduler'
        });
        return { ...report, logNotified, ownerNotified };
    }

    async function reconcileLateApproval(event = {}, { guild = null, at = moment().tz(CONFIG.TIMEZONE) } = {}) {
        const audit = event.audit || {};
        const shift = String(event.shift || '').trim().toUpperCase();
        const start = moment(audit.shiftStartAt);
        const end = moment(audit.shiftEndAt);
        const now = moment(at).tz(CONFIG.TIMEZONE);
        if (!['DAY', 'NIGHT'].includes(shift) || !start.isValid() || !end.isValid()) {
            return { ok: true, skipped: true, reason: 'missing-shift-audit' };
        }
        const bounds = { start: start.tz(CONFIG.TIMEZONE), end: end.tz(CONFIG.TIMEZONE) };
        const settlement = getSettlementWindow({ shift, bounds, at: now });
        const deadlineMs = Date.parse(settlement?.deadlineAt || '');
        if (settlement?.activeOvertime || (Number.isFinite(deadlineMs) && now.valueOf() < deadlineMs)) {
            return { ok: true, skipped: true, reason: 'regular-reconciliation-pending' };
        }
        return run({
            shift,
            bounds,
            at: now,
            guild,
            source: 'late-approval',
            triggerMessageId: event.messageId || null,
            settlement
        });
    }

    async function recoverLateApprovals({ guild = null, at = moment().tz(CONFIG.TIMEZONE) } = {}) {
        const now = moment(at).tz(CONFIG.TIMEZONE);
        const operations = await payrollOperationLogService.listRecent({ limit: 10_000, date: now.toDate() });
        const windows = collectPendingLateApprovalWindows(operations, { now: now.toDate() }).slice(0, 4);
        const results = [];
        let deferred = 0;
        for (const window of windows) {
            const bounds = {
                start: moment(window.shiftStartAt).tz(CONFIG.TIMEZONE),
                end: moment(window.shiftEndAt).tz(CONFIG.TIMEZONE)
            };
            const settlement = getSettlementWindow({ shift: window.shift, bounds, at: now });
            const deadlineMs = Date.parse(settlement?.deadlineAt || '');
            if (settlement?.activeOvertime || (Number.isFinite(deadlineMs) && now.valueOf() < deadlineMs)) {
                deferred += 1;
                continue;
            }
            results.push(await run({
                shift: window.shift,
                bounds,
                at: now,
                guild,
                source: 'late-approval-recovery',
                triggerMessageId: window.triggerMessageId,
                settlement
            }));
        }
        return { ok: results.every(result => result?.ok), recovered: results.length, deferred, results };
    }

    return {
        run,
        reportCloseReadiness,
        remindPendingApprovals,
        reconcileLateApproval,
        recoverLateApprovals,
        getSettlementWindow
    };
}

module.exports = {
    createEndAdenaReconciliationService,
    normalizeName,
    findSummaryCell,
    selectEndAdenaOperations,
    reduceEndAdenaOperations,
    sessionOverlapsBounds,
    sessionBelongsToShiftWindow,
    resolveEndAdenaSettlementWindow,
    collectExpectedWorkers,
    classifyCloseReadiness,
    collectSheetMismatches,
    collectPendingDuplicates,
    integrityFingerprint,
    buildReportMessage,
    buildPendingApprovalMessage,
    buildCloseReadinessMessage,
    collectPendingLateApprovalWindows,
    operationMatchesShiftWindow
};
