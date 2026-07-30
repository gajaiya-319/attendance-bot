'use strict';

const {
    normalizeAliasMap,
    normalizePayrollServer,
    resolveSheetNameCandidates
} = require('./purchaseSheetService');
const { parseEndAdenaMessage } = require('../utils/endAdenaMessage');
const { isExcludedUserId } = require('../utils/excludedUsers');

const VALIDATION_MARKER = '**\uc5d4\ub4dc\uc544\ub370\ub098 \uc0ac\uc804\uac80\uc99d**';

function memberHasRole(member, roleId) {
    return Boolean(roleId && member?.roles?.cache?.has?.(roleId));
}

function getMemberServer(member, roles = {}) {
    if (memberHasRole(member, roles.PAAGRIO)) return 'PAAGRIO';
    if (memberHasRole(member, roles.VALAKAS) || memberHasRole(member, roles.HEINE)) return 'VALAKAS';
    const name = String(member?.displayName || member?.user?.username || '').toLowerCase();
    if (/\s-\s*p(?:\s|$)/.test(name)) return 'PAAGRIO';
    if (/\s-\s*(?:v|h)(?:\s|$)/.test(name)) return 'VALAKAS';
    return null;
}

function namesOverlap(left, right, aliases = {}) {
    const leftNames = new Set(resolveSheetNameCandidates(left, aliases));
    return resolveSheetNameCandidates(right, aliases).some(name => leftNames.has(name));
}

function findSummaryCell(cells, server, userName, aliases = {}) {
    const normalizedServer = normalizePayrollServer(server);
    return (cells || []).find(cell => (
        normalizePayrollServer(cell.server) === normalizedServer &&
        namesOverlap(cell.userName, userName, aliases)
    )) || null;
}

function sessionOverlapsWindow(session, bounds, shift, at) {
    if (!session?.clockInAt || !bounds?.start || !bounds?.end) return false;
    const sessionShift = String(session.shift || session.sessionKey || '').toLowerCase();
    if (shift && !sessionShift.includes(String(shift).toLowerCase())) return false;
    const startMs = Date.parse(session.clockInAt);
    const endMs = Date.parse(session.clockOutAt || at?.toISOString?.() || at || '');
    return Number.isFinite(startMs) && Number.isFinite(endMs) &&
        startMs <= bounds.end.valueOf() && endMs >= bounds.start.valueOf();
}

function sessionWindowScore(session, bounds, shift, at) {
    if (!session || !bounds?.start || !bounds?.end) return 0;
    const normalizedShift = String(shift || '').toLowerCase();
    const sessionShift = String(session.shift || session.sessionKey || '').toLowerCase();
    if (normalizedShift && !sessionShift.includes(normalizedShift)) return 0;

    const expectedKey = `${normalizedShift}:${bounds.start.format('YYYY-MM-DD HH:mm')}`;
    const sessionKey = String(session.sessionKey || session.id || '').toLowerCase();
    const scheduledStartMs = Date.parse(session.scheduledStartAt || '');
    const scheduledEndMs = Date.parse(session.scheduledEndAt || '');
    const clockInMs = Date.parse(session.clockInAt || '');
    let score = 0;

    if (sessionKey.includes(expectedKey)) score += 100;
    if (scheduledStartMs === bounds.start.valueOf()) score += 80;
    if (scheduledEndMs === bounds.end.valueOf()) score += 70;
    if (Number.isFinite(clockInMs) && clockInMs >= bounds.start.valueOf() && clockInMs <= bounds.end.valueOf()) score += 60;
    if (sessionOverlapsWindow(session, bounds, normalizedShift, at)) score += 50;
    return score;
}

function resolveAttendanceShiftBounds({ moment, timezone, getShiftBounds, shift, messageAt, sessions = [] }) {
    const normalizedShift = String(shift || '').toLowerCase();
    const at = moment(messageAt).tz(timezone);
    const candidates = [];
    const seen = new Set();

    for (let lookbackDays = 0; lookbackDays <= 2; lookbackDays += 1) {
        const bounds = getShiftBounds(normalizedShift, at.clone().subtract(lookbackDays, 'day'));
        if (!bounds?.start || !bounds?.end) continue;
        const key = `${bounds.start.valueOf()}:${bounds.end.valueOf()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const matchedSessions = (sessions || [])
            .map(session => ({ session, score: sessionWindowScore(session, bounds, normalizedShift, at) }))
            .filter(item => item.score > 0)
            .sort((left, right) => right.score - left.score);
        candidates.push({ bounds, matchedSessions, score: matchedSessions[0]?.score || 0 });
    }

    const matched = candidates
        .filter(candidate => candidate.score > 0)
        .sort((left, right) => right.score - left.score || right.bounds.start.valueOf() - left.bounds.start.valueOf())[0];
    const selected = matched || candidates[0] || null;
    return {
        bounds: selected?.bounds || null,
        matchedSessions: selected?.matchedSessions?.map(item => item.session) || [],
        source: matched ? 'attendance-session' : 'message-time'
    };
}

function getAttendanceSessionId(session) {
    if (!session) return null;
    return String(session.id || `${session.sessionKey || 'session'}:${session.clockInAt || ''}`);
}

function selectSubmissionSession(sessions, bounds, shift, messageAt) {
    const atMs = Date.parse(messageAt?.toISOString?.() || messageAt || '');
    return (sessions || [])
        .filter(session => sessionWindowScore(session, bounds, shift, messageAt) > 0)
        .filter(session => {
            const clockInMs = Date.parse(session.clockInAt || '');
            return Number.isFinite(clockInMs) && (!Number.isFinite(atMs) || clockInMs <= atMs);
        })
        .sort((left, right) => (
            Date.parse(right.clockInAt || '') - Date.parse(left.clockInAt || '') ||
            Date.parse(right.clockOutAt || '') - Date.parse(left.clockOutAt || '')
        ))[0] || null;
}

function findAttendanceUser(attendanceData, authorId, userName, aliases = {}) {
    const direct = attendanceData?.[authorId];
    if (direct && namesOverlap(direct?.name, userName, aliases)) return { userId: authorId, user: direct };
    for (const [userId, user] of Object.entries(attendanceData || {})) {
        if (namesOverlap(user?.name, userName, aliases)) return { userId, user };
    }
    return null;
}

function validationStatus(validation) {
    if ((validation?.issues || []).some(issue => issue.code.includes('duplicate'))) return 'duplicate';
    if (!validation?.valid) return 'needs-fix';
    if ((validation?.issues || []).some(issue => issue.severity === 'warning')) return 'review';
    return 'ready';
}

function buildEndAdenaValidationMessage(validation = {}) {
    const status = validationStatus(validation);
    const labels = {
        ready: '\uc2b9\uc778 \uac00\ub2a5',
        review: '\ud655\uc778 \ud544\uc694',
        'needs-fix': '\uc218\uc815 \ud544\uc694',
        duplicate: '\uc911\ubcf5 \uc758\uc2ec'
    };
    const lines = [
        VALIDATION_MARKER,
        `\ud310\uc815: **${labels[status]}**`,
        validation.userName ? `\uc774\ub984: ${validation.sheetUserName || validation.userName}` : null,
        validation.server ? `\uc11c\ubc84 / \uadfc\ubb34\uc870: ${validation.server} / ${validation.shift || '\ud655\uc778 \ubd88\uac00'}` : null,
        Number.isFinite(validation.rawAmount)
            ? `\uae08\uc561: ${validation.rawAmount.toLocaleString('en-US')} (\ubc18\uc601 ${validation.amount.toLocaleString('en-US')})`
            : null
    ].filter(Boolean);
    for (const issue of validation.issues || []) {
        lines.push(`- ${issue.severity === 'warning' ? '\ud655\uc778' : '\uc624\ub958'}: ${issue.message}`);
    }
    lines.push('', validation.valid
        ? '\uc790\ub3d9 \uc2b9\uc778\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. \uad00\ub9ac\uc790 \uccb4\ud06c \uc2b9\uc778\uc744 \uae30\ub2e4\ub9bd\ub2c8\ub2e4.'
        : '\uac8c\uc2dc\ubb3c\uc744 \uc218\uc815\ud558\uba74 \uc790\ub3d9\uc73c\ub85c \ub2e4\uc2dc \uac80\uc0ac\ud569\ub2c8\ub2e4.');
    return lines.join('\n').slice(0, 1900);
}

function createEndAdenaSubmissionValidationService({
    CONFIG,
    moment,
    getShiftBounds,
    getAttendanceData,
    purchaseSheetService,
    payrollOperationLogService = null,
    cacheMs = 60_000,
    logger = console
}) {
    if (!CONFIG?.TIMEZONE || !CONFIG?.ROLES) throw new TypeError('CONFIG with TIMEZONE and ROLES must be provided');
    if (!moment || typeof getShiftBounds !== 'function') throw new TypeError('moment and getShiftBounds must be provided');
    if (typeof getAttendanceData !== 'function') throw new TypeError('getAttendanceData must be a function');
    if (typeof purchaseSheetService?.readAdenaSummary !== 'function') throw new TypeError('purchaseSheetService.readAdenaSummary must be a function');

    const aliases = normalizeAliasMap(CONFIG.SHEET_NAME_ALIASES || {});
    const summaryCache = new Map();
    let operationCache = null;

    async function readSummary(shift) {
        const cached = summaryCache.get(shift);
        if (cached && cached.expiresAt > Date.now()) return cached.promise;
        const promise = purchaseSheetService.readAdenaSummary({ shift }).catch(error => ({
            ok: false,
            code: 'sheet-api-error',
            cells: [],
            results: [],
            errorMessage: error?.message || String(error)
        }));
        summaryCache.set(shift, { expiresAt: Date.now() + cacheMs, promise });
        return promise;
    }

    async function collectDuplicateMessageIds(message, { bounds, userName, shift, sessions, submissionSession }) {
        const duplicates = new Set();
        const submissionSessionId = getAttendanceSessionId(submissionSession);
        const isSameSubmissionSession = (candidateAt, explicitSessionId = null) => {
            if (!submissionSessionId) return true;
            const candidateSession = explicitSessionId
                ? null
                : selectSubmissionSession(sessions, bounds, shift, candidateAt);
            const candidateSessionId = explicitSessionId || getAttendanceSessionId(candidateSession);
            return !candidateSessionId || candidateSessionId === submissionSessionId;
        };
        const channelCache = message.channel?.messages?.cache;
        const fetched = channelCache?.values
            ? channelCache
            : await message.channel?.messages?.fetch?.({ limit: 100 }).catch(() => null);
        if (fetched?.values) {
            for (const candidate of fetched.values()) {
                if (!candidate?.id || candidate.id === message.id || candidate.author?.bot || isExcludedUserId(CONFIG, candidate.author)) continue;
                const reactions = candidate.reactions?.cache;
                const hasSuccess = Boolean(reactions?.find?.(item => item.emoji?.name === CONFIG.PURCHASE_SUCCESS_EMOJI));
                const hasCancel = Boolean(reactions?.find?.(item => item.emoji?.name === CONFIG.PURCHASE_CANCEL_EMOJI));
                if (hasCancel && !hasSuccess) continue;
                const createdAtMs = new Date(candidate.createdAt || candidate.createdTimestamp || 0).getTime();
                if (!Number.isFinite(createdAtMs) || createdAtMs < bounds.start.valueOf() || createdAtMs > new Date(message.createdAt || Date.now()).getTime()) continue;
                const parsed = parseEndAdenaMessage(candidate.content);
                if (!parsed) continue;
                const candidateName = parsed.requestedName || String(candidate.member?.displayName || candidate.author?.username || '').split('-')[0].trim();
                if (candidate.author?.id === message.author?.id || namesOverlap(candidateName, userName, aliases)) {
                    if (!isSameSubmissionSession(candidate.createdAt || candidate.createdTimestamp || null)) continue;
                    duplicates.add(String(candidate.id));
                }
            }
        }

        if (!operationCache || operationCache.expiresAt <= Date.now()) {
            operationCache = {
                expiresAt: Date.now() + 5_000,
                promise: payrollOperationLogService?.listRecent?.({ limit: 10_000, date: bounds.end.toDate() }).catch(() => []) || Promise.resolve([])
            };
        }
        const operations = await operationCache.promise;
        const cancelled = new Set((operations || [])
            .filter(item => item?.kind === 'end-adena' && item?.status === 'success' && String(item.action).toLowerCase() === 'cancel')
            .map(item => String(item.messageId || item.payload?.messageId || '')));
        for (const operation of operations || []) {
            if (operation?.kind !== 'end-adena' || operation?.status !== 'success' || String(operation.action).toLowerCase() === 'cancel') continue;
            const messageId = String(operation.messageId || operation.payload?.messageId || '');
            if (!messageId || messageId === String(message.id) || cancelled.has(messageId)) continue;
            const audit = operation.payload?.audit || operation.audit || operation.payload || {};
            const sameWindow = Date.parse(audit.shiftStartAt || '') === bounds.start.valueOf() &&
                Date.parse(audit.shiftEndAt || '') === bounds.end.valueOf();
            if (!sameWindow) continue;
            if (!isSameSubmissionSession(
                operation.messageCreatedAt || audit.messageCreatedAt || operation.createdAt || null,
                audit.attendanceSessionId || operation.payload?.attendanceSessionId || null
            )) continue;
            if (namesOverlap(operation.userName || operation.payload?.userName, userName, aliases)) duplicates.add(messageId);
        }
        return [...duplicates];
    }

    function resolveShiftContext({ message, shift, userName } = {}) {
        const normalizedShift = String(shift || '').toUpperCase();
        const messageAt = moment(message?.createdAt || Date.now()).tz(CONFIG.TIMEZONE);
        const attendance = userName
            ? findAttendanceUser(getAttendanceData(), message?.author?.id, userName, aliases)
            : null;
        const resolution = ['DAY', 'NIGHT'].includes(normalizedShift)
            ? resolveAttendanceShiftBounds({
                moment,
                timezone: CONFIG.TIMEZONE,
                getShiftBounds,
                shift: normalizedShift,
                messageAt,
                sessions: attendance?.user?.sessions || []
            })
            : { bounds: null, matchedSessions: [], source: 'message-time' };
        return {
            messageAt,
            attendance,
            attendanceUserId: attendance?.userId || null,
            matchedSessions: resolution.matchedSessions,
            submissionSession: selectSubmissionSession(
                resolution.matchedSessions,
                resolution.bounds,
                normalizedShift,
                messageAt
            ),
            source: resolution.source,
            bounds: resolution.bounds,
            shiftStartAt: resolution.bounds?.start?.toISOString?.() || null,
            shiftEndAt: resolution.bounds?.end?.toISOString?.() || null
        };
    }

    async function validate({ message, server, parsed, member, shift, userName } = {}) {
        const normalizedServer = normalizePayrollServer(server);
        const normalizedShift = String(shift || '').toUpperCase();
        const issues = [];
        const addIssue = (code, severity, messageText) => issues.push({ code, severity, message: messageText });
        const shiftContext = resolveShiftContext({ message, shift: normalizedShift, userName });
        const messageAt = shiftContext.messageAt;
        const bounds = shiftContext.bounds;

        if (!parsed) addIssue('invalid-format', 'error', 'GAINED ADENA \uae08\uc561 \ud615\uc2dd\uc744 \ud655\uc778\ud558\uc138\uc694.');
        if (!['DAY', 'NIGHT'].includes(normalizedShift)) addIssue('shift-not-found', 'error', '\ub0ae/\ubc24 \uadfc\ubb34\uc870\ub97c \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
        if (!userName) addIssue('name-not-found', 'error', '\uc120\uc218 \uc774\ub984\uc744 \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');

        const memberServer = getMemberServer(member, CONFIG.ROLES);
        if (memberServer && normalizedServer && memberServer !== normalizedServer) {
            addIssue('server-mismatch', 'error', `\uc120\uc218 \uc11c\ubc84 ${memberServer}\uc640 \uac8c\uc2dc\ud310 ${normalizedServer}\uac00 \ub2e4\ub985\ub2c8\ub2e4.`);
        } else if (!memberServer) {
            addIssue('server-unverified', 'warning', '\uc11c\ubc84 \uc5ed\ud560\uc744 \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
        }

        let sheetUserName = null;
        if (parsed && userName && ['DAY', 'NIGHT'].includes(normalizedShift)) {
            const summary = await readSummary(normalizedShift);
            if (!summary?.ok) {
                addIssue('sheet-unavailable', 'warning', '\uc2dc\ud2b8 \uc870\ud68c\uac00 \uc9c0\uc5f0\ub418\uc5b4 \uc2b9\uc778 \uc2dc \ub2e4\uc2dc \uac80\uc0ac\ud569\ub2c8\ub2e4.');
            } else {
                const cell = findSummaryCell(summary.cells, normalizedServer, userName, aliases);
                if (cell) {
                    sheetUserName = cell.userName;
                } else {
                    const otherServers = [...new Set((summary.cells || [])
                        .filter(item => namesOverlap(item.userName, userName, aliases))
                        .map(item => normalizePayrollServer(item.server))
                        .filter(Boolean))];
                    addIssue('summary-user-not-found', 'error', otherServers.length
                        ? `\uc774\ub984\uc740 ${otherServers.join(', ')} \uc2dc\ud2b8\uc5d0 \uc788\uc2b5\ub2c8\ub2e4. \uc11c\ubc84\ub97c \ud655\uc778\ud558\uc138\uc694.`
                        : '\uc5d4\ub4dc\uc544\ub370\ub098 \uc2dc\ud2b8\uc5d0\uc11c \uc120\uc218 \uc774\ub984\uc744 \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.');
                }
            }
        }

        let attendanceUserId = shiftContext.attendanceUserId;
        if (bounds && userName) {
            const worked = shiftContext.matchedSessions.length > 0;
            if (!worked) addIssue('attendance-not-found', 'error', '\ud574\ub2f9 \uadfc\ubb34\uc870\uc758 \uc2e4\uc81c \ucd9c\uadfc \uae30\ub85d\uc744 \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.');
        }

        let duplicateMessageIds = [];
        if (bounds && userName) {
            duplicateMessageIds = await collectDuplicateMessageIds(message, {
                bounds,
                userName,
                shift: normalizedShift,
                sessions: shiftContext.matchedSessions,
                submissionSession: shiftContext.submissionSession
            });
            if (duplicateMessageIds.length) {
                addIssue('duplicate-submission', 'error', `\uac19\uc740 \uadfc\ubb34\uc870 \uc81c\ucd9c ${duplicateMessageIds.length}\uac74\uc774 \uc774\ubbf8 \uc788\uc2b5\ub2c8\ub2e4.`);
            }
        }

        if (parsed?.requestedName && userName && !namesOverlap(parsed.requestedName, userName, aliases)) {
            addIssue('requested-name-mismatch', 'warning', `\ubcf8\ubb38 \uc774\ub984 ${parsed.requestedName}\uacfc Discord \uc774\ub984 ${userName}\uc774 \ub2e4\ub985\ub2c8\ub2e4.`);
        }

        const validation = {
            enabled: true,
            valid: !issues.some(issue => issue.severity === 'error'),
            server: normalizedServer,
            shift: normalizedShift || null,
            userName: userName || parsed?.requestedName || null,
            sheetUserName,
            rawAmount: parsed?.rawAmount,
            amount: parsed?.amount,
            attendanceUserId,
            duplicateMessageIds,
            shiftStartAt: bounds?.start?.toISOString?.() || null,
            shiftEndAt: bounds?.end?.toISOString?.() || null,
            shiftResolutionSource: shiftContext.source,
            attendanceSessionIds: shiftContext.matchedSessions.map(session => session.id || session.sessionKey).filter(Boolean),
            attendanceSessionId: getAttendanceSessionId(shiftContext.submissionSession),
            attendanceSessionType: shiftContext.submissionSession
                ? shiftContext.submissionSession.otType || 'REGULAR'
                : null,
            issues
        };
        validation.status = validationStatus(validation);

        await payrollOperationLogService?.record?.({
            kind: 'end-adena-prevalidation',
            action: 'validate',
            messageId: message?.id || null,
            channelId: message?.channelId || null,
            server: normalizedServer,
            shift: normalizedShift || null,
            userName: validation.userName,
            status: validation.valid ? 'success' : 'failed',
            payload: {
                shiftStartAt: validation.shiftStartAt,
                shiftEndAt: validation.shiftEndAt,
                authorId: message?.author?.id || null,
                rawAmount: validation.rawAmount,
                amount: validation.amount
            },
            result: {
                valid: validation.valid,
                validationStatus: validation.status,
                issueCodes: issues.map(issue => issue.code),
                duplicateMessageIds,
                shiftResolutionSource: validation.shiftResolutionSource,
                attendanceSessionIds: validation.attendanceSessionIds,
                attendanceSessionId: validation.attendanceSessionId,
                attendanceSessionType: validation.attendanceSessionType
            },
            source: 'message-create'
        }).catch(error => logger.warn?.('[END ADENA PREVALIDATION LOG WARN]', error?.message || error));

        return validation;
    }

    return {
        validate,
        resolveShiftContext,
        format: buildEndAdenaValidationMessage,
        clearCache: () => {
            summaryCache.clear();
            operationCache = null;
        }
    };
}

module.exports = {
    VALIDATION_MARKER,
    getMemberServer,
    namesOverlap,
    findSummaryCell,
    sessionOverlapsWindow,
    sessionWindowScore,
    resolveAttendanceShiftBounds,
    getAttendanceSessionId,
    selectSubmissionSession,
    findAttendanceUser,
    validationStatus,
    buildEndAdenaValidationMessage,
    createEndAdenaSubmissionValidationService
};
