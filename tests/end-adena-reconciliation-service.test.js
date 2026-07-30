const assert = require('assert');
const moment = require('moment-timezone');
const {
    createEndAdenaReconciliationService,
    selectEndAdenaOperations,
    reduceEndAdenaOperations,
    sessionOverlapsBounds,
    resolveEndAdenaSettlementWindow,
    collectPendingLateApprovalWindows,
    classifyCloseReadiness
} = require('../src/services/endAdenaReconciliationService');
const {
    summarizeEndAdenaQuality,
    formatEndAdenaQualityLine,
    formatEndAdenaQualityIssues
} = require('../src/services/endAdenaQualityService');

const TIMEZONE = 'Asia/Manila';

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', TIMEZONE);
}

function operation({
    createdAt,
    server = 'PAAGRIO',
    shift = 'DAY',
    userName,
    messageId,
    action = 'approve',
    summaryNextValue,
    rawAmount = summaryNextValue
}) {
    return {
        kind: 'end-adena',
        status: 'success',
        action,
        createdAt: at(createdAt).toISOString(),
        server,
        shift,
        userName,
        messageId,
        result: { summaryRange: 'L59', summaryNextValue },
        payload: { server, shift, userName, messageId, rawAmount }
    };
}

function member(id, displayName, roleIds) {
    const roles = new Set(roleIds);
    return {
        id,
        displayName,
        user: { id, username: displayName, bot: false },
        roles: { cache: { has: roleId => roles.has(roleId) } }
    };
}

(async () => {
    const qualityWindow = (day, result, kind = 'end-adena-close-integrity') => ({
        kind,
        status: result.ok === false ? 'failed' : 'success',
        shift: 'DAY',
        createdAt: at(`2026-07-${day} 22:00`).toISOString(),
        payload: {
            shiftStartAt: at(`2026-07-${day} 09:00`).toISOString(),
            shiftEndAt: at(`2026-07-${day} 21:00`).toISOString()
        },
        result
    });
    const qualityLogs = [
        qualityWindow('28', { ok: true, businessComplete: false, needsReview: 1 }, 'end-adena-reconciliation'),
        qualityWindow('28', {
            ok: true,
            businessComplete: true,
            needsReview: 0,
            expectedWorkers: 2,
            submitted: 2,
            approvedPostCount: 2,
            sheetMismatches: [{ recovered: true }]
        }),
        qualityWindow('29', {
            ok: false,
            businessComplete: false,
            needsReview: 2,
            expectedWorkers: 2,
            submitted: 1,
            approvedPostCount: 1,
            invalidSubmissions: [{}],
            missing: [{}],
            sheetMismatches: [{ recovered: false }],
            repairFailures: [{}]
        }),
        {
            kind: 'end-adena-prevalidation', status: 'success', messageId: 'quality-1',
            createdAt: at('2026-07-29 18:00').toISOString(), result: { issueCodes: [] }
        },
        {
            kind: 'end-adena-prevalidation', status: 'failed', messageId: 'quality-2',
            createdAt: at('2026-07-29 18:10').toISOString(), result: { issueCodes: ['invalid-format'] }
        },
        {
            kind: 'end-adena-prevalidation', status: 'success', messageId: 'quality-2',
            createdAt: at('2026-07-29 18:15').toISOString(), result: { issueCodes: [] }
        },
        {
            kind: 'end-adena-prevalidation', status: 'failed', messageId: 'quality-3',
            createdAt: at('2026-07-29 18:20').toISOString(), result: { issueCodes: ['duplicate-submission'] }
        },
        {
            kind: 'end-adena-prevalidation', status: 'success', messageId: 'quality-4',
            createdAt: at('2026-07-29 18:25').toISOString(), result: { issueCodes: [] }
        },
        {
            kind: 'end-adena-prevalidation', status: 'failed', messageId: 'quality-4',
            createdAt: at('2026-07-29 18:30').toISOString(), result: { issueCodes: ['attendance-not-found'] }
        },
        {
            kind: 'end-adena-prevalidation', status: 'failed', messageId: 'active-shift-validation',
            createdAt: at('2026-07-30 10:00').toISOString(),
            payload: { shiftEndAt: at('2026-07-30 21:00').toISOString() },
            result: { issueCodes: ['attendance-not-found'] }
        }
    ];
    const quality = summarizeEndAdenaQuality(qualityLogs, { now: at('2026-07-30 12:00') });
    assert.strictEqual(quality.close.cycles, 2, 'a later integrity audit replaces reconciliation for the same shift');
    assert.strictEqual(quality.close.completedCycles, 1);
    assert.strictEqual(quality.close.completeRate, 50);
    assert.strictEqual(quality.close.sheetRecoveryRate, 50);
    assert.deepStrictEqual(
        [quality.validation.total, quality.validation.firstPass, quality.validation.corrected, quality.validation.unresolved],
        [4, 2, 1, 2]
    );
    assert.strictEqual(quality.validation.averageCorrectionMinutes, 5);
    assert.strictEqual(quality.score, 50);
    assert.strictEqual(quality.status, 'needs-attention');
    assert.match(formatEndAdenaQualityLine(quality), /7일 품질: 50점/);
    assert.match(formatEndAdenaQualityIssues(quality), /중복 제출 1건/);

    const bounds = { start: at('2026-07-28 09:00'), end: at('2026-07-28 19:00') };
    const operations = [
        operation({ createdAt: '2026-07-28 18:52', server: 'VALAKAS', userName: 'Zurin', messageId: 'z1', summaryNextValue: 100000 }),
        operation({ createdAt: '2026-07-28 19:20', server: 'VALAKAS', userName: 'Zurin', messageId: 'z2', summaryNextValue: 120000 }),
        operation({ createdAt: '2026-07-28 19:30', server: 'PAAGRIO', userName: 'ACE', messageId: 'a1', summaryNextValue: 200000 }),
        operation({ createdAt: '2026-07-28 17:00', server: 'PAAGRIO', userName: 'Giru Kun', messageId: 'g1', summaryNextValue: 170000 }),
        { ...operation({ createdAt: '2026-07-28 19:10', server: 'PAAGRIO', userName: 'Failed', messageId: 'f1', summaryNextValue: 1 }), status: 'failed' },
        {
            kind: 'end-adena-prevalidation',
            action: 'validate',
            status: 'failed',
            createdAt: at('2026-07-28 18:41').toISOString(),
            messageId: 'invalid1',
            shift: 'DAY',
            payload: { shiftStartAt: bounds.start.toISOString(), shiftEndAt: bounds.end.toISOString() },
            result: { issueCodes: ['invalid-format'] }
        }
    ];
    const selected = selectEndAdenaOperations(operations, {
        shift: 'DAY',
        from: bounds.start.toISOString(),
        to: bounds.end.clone().add(60, 'minutes').toISOString(),
        shiftStartAt: bounds.start.toISOString(),
        shiftEndAt: bounds.end.toISOString()
    });
    assert.strictEqual(selected.length, 4);
    const wrongWindowOperation = {
        ...operation({ createdAt: '2026-07-28 18:58', userName: 'Wrong Window', messageId: 'wrong-window', summaryNextValue: 1 }),
        payload: {
            server: 'PAAGRIO',
            shift: 'DAY',
            userName: 'Wrong Window',
            messageId: 'wrong-window',
            rawAmount: 1,
            audit: {
                shiftStartAt: at('2026-07-29 09:00').toISOString(),
                shiftEndAt: at('2026-07-29 21:00').toISOString()
            }
        }
    };
    assert.strictEqual(selectEndAdenaOperations([...operations, wrongWindowOperation], {
        shift: 'DAY',
        from: bounds.start.toISOString(),
        to: bounds.end.clone().add(60, 'minutes').toISOString(),
        shiftStartAt: bounds.start.toISOString(),
        shiftEndAt: bounds.end.toISOString()
    }).some(item => item.messageId === 'wrong-window'), false);
    const zurin = reduceEndAdenaOperations(selected.filter(item => item.userName === 'Zurin'));
    assert.strictEqual(zurin.expectedValue, 120000);
    assert.strictEqual(zurin.duplicate, true);

    const supplementalOvertime = reduceEndAdenaOperations([
        operation({ createdAt: '2026-07-28 18:55', userName: 'Deia', messageId: 'deia-regular', summaryNextValue: 210000 }),
        {
            ...operation({ createdAt: '2026-07-28 23:30', userName: 'Deia', messageId: 'deia-overtime', summaryNextValue: 60000 }),
            payload: {
                server: 'PAAGRIO',
                shift: 'DAY',
                userName: 'Deia',
                messageId: 'deia-overtime',
                rawAmount: 60000,
                audit: {
                    attendanceSessionId: 'day:2026-07-28-09-00:overtime',
                    attendanceSessionType: 'FORCED'
                }
            }
        }
    ]);
    assert.strictEqual(supplementalOvertime.expectedValue, 270000);
    assert.strictEqual(supplementalOvertime.duplicate, false);
    assert.strictEqual(supplementalOvertime.approvedMessageIds.length, 2);

    const preResetApproval = reduceEndAdenaOperations([
        operation({
            createdAt: '2026-07-28 18:50',
            userName: 'Deia',
            messageId: 'deia-before-reset',
            summaryNextValue: 440000,
            rawAmount: 170000
        })
    ], { fromZero: true });
    assert.strictEqual(preResetApproval.expectedValue, 170000, 'scheduled reset removes the stale summary baseline');

    const repeatedOvertime = reduceEndAdenaOperations([
        ...selected.filter(item => item.userName === 'ACE'),
        ...['ot-1', 'ot-2'].map((messageId, index) => ({
            ...operation({ createdAt: `2026-07-28 19:${40 + index}`, userName: 'ACE', messageId, summaryNextValue: 250000 + index * 10000 }),
            payload: {
                server: 'PAAGRIO',
                shift: 'DAY',
                userName: 'ACE',
                messageId,
                rawAmount: 50000,
                audit: {
                    attendanceSessionId: 'day:2026-07-28-09-00:overtime',
                    attendanceSessionType: 'FORCED'
                }
            }
        }))
    ]);
    assert.strictEqual(repeatedOvertime.duplicate, true);

    const cancelled = reduceEndAdenaOperations([
        operation({ createdAt: '2026-07-28 18:55', userName: 'Kel', messageId: 'k1', summaryNextValue: 50000 }),
        operation({ createdAt: '2026-07-28 19:05', userName: 'Kel', messageId: 'k1', action: 'cancel', summaryNextValue: 0, rawAmount: -50000 })
    ]);
    assert.strictEqual(cancelled.expectedValue, 0);
    assert.strictEqual(cancelled.submitted, false);
    assert.strictEqual(sessionOverlapsBounds({
        shift: 'day',
        clockInAt: bounds.start.toISOString(),
        clockOutAt: bounds.end.toISOString()
    }, bounds, 'day'), true);

    const overtimeSession = {
        id: 'day-overtime',
        shift: 'day',
        scheduledStartAt: bounds.start.toISOString(),
        scheduledEndAt: bounds.end.toISOString(),
        clockInAt: bounds.start.toISOString(),
        clockOutAt: null
    };
    const activeSettlement = resolveEndAdenaSettlementWindow({
        attendanceData: { overtimeWorker: { name: 'Overtime Worker', sessions: [overtimeSession] } },
        bounds,
        shift: 'DAY',
        at: bounds.end.clone().add(55, 'minutes')
    });
    assert.strictEqual(activeSettlement.activeOvertime, true);
    assert.strictEqual(activeSettlement.activeOvertimeCount, 1);
    assert.strictEqual(activeSettlement.deadlineAt, null);

    const closedSettlement = resolveEndAdenaSettlementWindow({
        attendanceData: {
            overtimeWorker: {
                name: 'Overtime Worker',
                sessions: [{ ...overtimeSession, clockOutAt: bounds.end.clone().add(63, 'minutes').toISOString() }]
            }
        },
        bounds,
        shift: 'DAY',
        at: bounds.end.clone().add(70, 'minutes')
    });
    assert.strictEqual(closedSettlement.activeOvertime, false);
    assert.strictEqual(closedSettlement.extensionMinutes, 63);
    assert.strictEqual(closedSettlement.workEndAt, bounds.end.clone().add(63, 'minutes').toISOString());
    assert.strictEqual(closedSettlement.deadlineAt, bounds.end.clone().add(123, 'minutes').toISOString());

    const cells = [
        { server: 'VALAKAS', shift: 'DAY', userName: 'Zurin', value: 999000, range: "'Valakas Great'!L59" },
        { server: 'PAAGRIO', shift: 'DAY', userName: 'Giru Kun', value: 0, range: "'Paagrio Great'!L59" },
        { server: 'PAAGRIO', shift: 'DAY', userName: 'ACE', value: 150000, range: "'Paagrio Great'!L60" },
        { server: 'PAAGRIO', shift: 'DAY', userName: 'Absent', value: 50000, range: "'Paagrio Great'!L61" }
    ];
    const repairCalls = [];
    const logCalls = [];
    const sent = [];
    const dmSent = [];
    let memberRefreshCalls = 0;
    let forceActiveOvertime = false;
    const members = new Map([
        ['u1', member('u1', 'Zurin - V Day Time', ['day-role', 'heine-role'])],
        ['u2', member('u2', 'Giru Kun - P Day Time', ['day-role', 'paagrio-role'])],
        ['proxy', member('proxy', 'Manager', [])]
    ]);
    const pendingMessage = {
        id: 'pending1',
        channelId: 'end-paagrio',
        content: 'NAME: Giru Kun\n-GAINED ADENA: 180,500',
        createdAt: at('2026-07-28 18:35').toDate(),
        author: { id: 'proxy', username: 'Manager', bot: false },
        member: members.get('proxy')
    };
    const approvedMessage = {
        id: 'z1',
        channelId: 'end-paagrio',
        content: 'NAME: Zurin\n-GAINED ADENA: 100,000',
        createdAt: at('2026-07-28 18:52').toDate(),
        author: { id: 'u1', username: 'Zurin', bot: false },
        member: members.get('u1')
    };
    const invalidMessage = {
        id: 'invalid1',
        channelId: 'end-paagrio',
        content: '잘못된 엔드아데나 형식',
        createdAt: at('2026-07-28 18:40').toDate(),
        author: { id: 'proxy', username: 'Manager', bot: false },
        member: members.get('proxy')
    };
    const service = createEndAdenaReconciliationService({
        CONFIG: {
            TIMEZONE,
            GUILD_ID: 'guild1',
            LOG_CHANNEL: 'log1',
            PURCHASE_OWNER_DM_IDS: ['owner1'],
            END_ADENA_CHANNEL_IDS: { PAAGRIO: 'end-paagrio' },
            ROLES: {
                DAY: 'day-role',
                NIGHT: 'night-role',
                HEINE: 'heine-role',
                PAAGRIO: 'paagrio-role'
            },
            SHEET_NAME_ALIASES: {}
        },
        moment,
        client: {
            guilds: { cache: { get: () => ({ members: { cache: members, fetch: async id => id ? members.get(id) : members } }) } },
            users: {
                fetch: async ownerId => ({ send: async text => dmSent.push({ ownerId, text }) })
            },
            channels: {
                fetch: async channelId => channelId === 'end-paagrio'
                    ? { messages: { fetch: async () => new Map([['pending1', pendingMessage], ['z1', approvedMessage], ['invalid1', invalidMessage]]) } }
                    : { send: async text => sent.push(text) }
            }
        },
        getAttendanceData: () => ({
            u1: {
                name: 'Zurin',
                sessions: [{
                    shift: 'day',
                    scheduledStartAt: bounds.start.toISOString(),
                    scheduledEndAt: bounds.end.toISOString(),
                    clockInAt: bounds.start.toISOString(),
                    clockOutAt: forceActiveOvertime ? null : bounds.end.toISOString()
                }]
            },
            u2: {
                name: 'Giru Kun',
                sessions: [{ shift: 'day', clockInAt: bounds.start.toISOString(), clockOutAt: bounds.end.toISOString() }]
            }
        }),
        payrollOperationLogService: {
            listRecent: async () => [...operations, ...logCalls],
            record: async entry => logCalls.push(entry)
        },
        purchaseSheetService: {
            readAdenaSummary: async () => ({ ok: true, shift: 'DAY', cells, results: [] }),
            repairAdenaSummary: async input => {
                repairCalls.push(input);
                const expectedByCell = new Map(input.expectedValues.map(item => [`${item.server}:${item.userName}`, item.value]));
                const corrections = cells
                    .map(cell => ({ ...cell, previousValue: cell.value, expectedValue: expectedByCell.get(`${cell.server}:${cell.userName}`) }))
                    .filter(item => item.previousValue !== item.expectedValue);
                return {
                    ok: true,
                    shift: 'DAY',
                    corrected: corrections.length,
                    corrections,
                    unresolved: [],
                    failures: []
                };
            }
        },
        refreshGuildMembers: async (guild, options) => {
            memberRefreshCalls += 1;
            assert.strictEqual(guild.members.cache, members);
            assert.deepStrictEqual(options, { force: false, minIntervalMs: 10 * 60 * 1000 });
            return true;
        },
        logger: { warn() {}, error() {}, log() {} }
    });

    const readiness = await service.reportCloseReadiness({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().subtract(20, 'minutes')
    });
    assert.strictEqual(readiness.ok, true);
    assert.strictEqual(readiness.minutesBeforeEnd, 20);
    assert.deepStrictEqual(readiness.approved, []);
    assert.deepStrictEqual(readiness.awaitingApproval.map(item => item.sheetUserName), ['Giru Kun']);
    assert.deepStrictEqual(readiness.missing.map(item => item.sheetUserName), ['Zurin']);
    assert.deepStrictEqual(readiness.notWorking.map(item => item.sheetUserName).sort(), ['ACE', 'Absent']);
    assert.strictEqual(readiness.invalidSubmissions.length, 1);
    assert.strictEqual(readiness.needsReview, 5);
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0], /근무 종료 20분 전/);
    assert.match(sent[0], /승인 대기 1명 \/ 수정 필요 1명 \/ 미제출 1명/);
    assert.match(sent[0], /비근무 데이터 2명/);
    const duplicateReadiness = await service.reportCloseReadiness({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().subtract(15, 'minutes')
    });
    assert.strictEqual(duplicateReadiness.skipped, true);
    assert.strictEqual(sent.length, 1, 'readiness report must not be duplicated after restart');

    const report = await service.run({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().add(60, 'minutes')
    });
    assert.strictEqual(memberRefreshCalls, 1, 'reconciliation must use the shared member refresh controller');
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.expectedWorkers.length, 2);
    assert.strictEqual(report.submitted.length, 3);
    assert.deepStrictEqual(report.approved.map(item => item.sheetUserName), ['Zurin']);
    assert.deepStrictEqual(report.awaitingApproval.map(item => item.sheetUserName), ['Giru Kun']);
    assert.deepStrictEqual(report.pending.map(item => item.messageId), ['pending1']);
    assert.deepStrictEqual(report.invalidSubmissions.map(item => item.messageId), ['invalid1']);
    assert.deepStrictEqual(report.missing, []);
    assert.deepStrictEqual(report.unexpected.map(item => item.sheetUserName), ['ACE']);
    assert.deepStrictEqual(report.unexpectedPending, []);
    assert.deepStrictEqual(report.duplicates.map(item => item.sheetUserName), ['Zurin']);
    assert.deepStrictEqual(report.totalsByServer, { VALAKAS: 120000, PAAGRIO: 370000 });
    assert.strictEqual(report.approvedPostCount, 4);
    assert.strictEqual(report.sheetRecordedCount, 3);
    assert.strictEqual(report.sheetMismatches.length, 4);
    assert.strictEqual(report.sheetMismatches.every(item => item.recovered), true);
    assert.strictEqual(report.postCount, 6);
    assert.strictEqual(report.needsReview, 4);
    assert.strictEqual(report.quality7d.close.cycles, 1);
    assert.strictEqual(report.quality7d.validation.unresolved, 1);
    assert.strictEqual(report.quality7d.score, 20);
    assert.strictEqual(report.technicalOk, true);
    assert.strictEqual(report.businessComplete, false);
    assert.strictEqual(report.ownerNotified, 1);
    assert.strictEqual(repairCalls.length, 1);
    assert.deepStrictEqual(
        Object.fromEntries(repairCalls[0].expectedValues.map(item => [`${item.server}:${item.userName}`, item.value])),
        {
            'VALAKAS:Zurin': 120000,
            'PAAGRIO:Giru Kun': 170000,
            'PAAGRIO:ACE': 200000,
            'PAAGRIO:Absent': 0
        }
    );
    assert.strictEqual(logCalls.some(entry => entry.kind === 'end-adena-reconciliation' && entry.status === 'success'), true);
    const reconciliationLog = logCalls.find(entry => entry.kind === 'end-adena-reconciliation');
    assert.strictEqual(reconciliationLog.result.businessComplete, false);
    assert.strictEqual(reconciliationLog.result.needsReview, 4);
    assert.strictEqual(logCalls.some(entry => entry.kind === 'end-adena-close-integrity' && entry.status === 'success'), true);
    assert.strictEqual(sent.length, 2);
    assert.match(sent[1], /실출근 2명 \/ 제출 3명 \/ 미제출 0명/);
    assert.match(sent[1], /승인 대기 1건/);
    assert.match(sent[1], /7일 품질: 20점/);
    assert.match(sent[1], /자동 수정 4건/);

    const reminder = await service.remindPendingApprovals({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().add(45, 'minutes')
    });
    assert.strictEqual(reminder.ok, true);
    assert.deepStrictEqual(reminder.pending.map(item => item.messageId), ['pending1']);
    assert.deepStrictEqual(reminder.invalidSubmissions.map(item => item.messageId), ['invalid1']);
    assert.strictEqual(sent.length, 3);
    assert.match(sent[2], /미승인 게시물 1건/);
    assert.strictEqual(logCalls.some(entry => entry.kind === 'end-adena-approval-reminder'), true);

    const deadlineWarning = await service.remindPendingApprovals({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().add(55, 'minutes'),
        urgent: true
    });
    assert.strictEqual(deadlineWarning.ok, true);
    assert.strictEqual(deadlineWarning.urgent, true);
    assert.strictEqual(deadlineWarning.minutesRemaining, 5);
    assert.strictEqual(deadlineWarning.ownerNotified, 1);
    assert.strictEqual(sent.length, 4);
    assert.match(sent[3].content, /\ucd5c\uc885 \uc2b9\uc778 \ub9c8\uac10 \uacbd\ubcf4/);
    assert.deepStrictEqual(sent[3].allowedMentions.users, ['owner1']);
    assert.strictEqual(dmSent.length, 2);
    assert.match(dmSent[1].text, /pending1/);
    assert.strictEqual(logCalls.some(entry => entry.kind === 'end-adena-approval-deadline-warning'), true);

    const duplicateDeadlineWarning = await service.remindPendingApprovals({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().add(56, 'minutes'),
        urgent: true
    });
    assert.strictEqual(duplicateDeadlineWarning.skipped, true);
    assert.strictEqual(sent.length, 4, 'deadline warning must not duplicate after a restart or repeated tick');
    assert.strictEqual(dmSent.length, 2);

    forceActiveOvertime = true;
    const blockedAdminReconciliation = await service.run({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().add(55, 'minutes'),
        source: 'admin-review'
    });
    assert.strictEqual(blockedAdminReconciliation.ok, true);
    assert.strictEqual(blockedAdminReconciliation.deferred, true);
    assert.strictEqual(blockedAdminReconciliation.reason, 'active-overtime');
    assert.strictEqual(repairCalls.length, 1, 'active overtime must block even an admin reconciliation request');
    forceActiveOvertime = false;

    const repeatedReport = await service.run({
        shift: 'DAY',
        bounds,
        at: bounds.end.clone().add(60, 'minutes')
    });
    assert.strictEqual(repeatedReport.alertDeduplicated, true);
    assert.strictEqual(repeatedReport.ownerNotified, 0, 'the same integrity findings must not send another owner DM');
    assert.strictEqual(dmSent.length, 2);

    const lateAudit = {
        shiftStartAt: bounds.start.toISOString(),
        shiftEndAt: bounds.end.toISOString()
    };
    const lateApproval = {
        ...operation({ createdAt: '2026-07-28 20:10', userName: 'Giru Kun', messageId: 'late1', summaryNextValue: 190000 }),
        payload: {
            server: 'PAAGRIO',
            shift: 'DAY',
            userName: 'Giru Kun',
            messageId: 'late1',
            rawAmount: 190000,
            audit: lateAudit
        }
    };
    const pendingLate = collectPendingLateApprovalWindows([lateApproval], {
        now: at('2026-07-28 20:20').toDate()
    });
    assert.strictEqual(pendingLate.length, 1);
    const coveredLate = collectPendingLateApprovalWindows([
        lateApproval,
        {
            kind: 'end-adena-reconciliation',
            status: 'success',
            shift: 'DAY',
            createdAt: at('2026-07-28 20:15').toISOString(),
            payload: lateAudit
        }
    ], { now: at('2026-07-28 20:20').toDate() });
    assert.deepStrictEqual(coveredLate, []);

    let lateLogs = [...operations, lateApproval];
    const lateRepairCalls = [];
    const lateService = createEndAdenaReconciliationService({
        CONFIG: {
            TIMEZONE,
            GUILD_ID: 'guild1',
            LOG_CHANNEL: 'log1',
            END_ADENA_CHANNEL_IDS: {},
            ROLES: {
                DAY: 'day-role',
                NIGHT: 'night-role',
                HEINE: 'heine-role',
                PAAGRIO: 'paagrio-role'
            },
            SHEET_NAME_ALIASES: {}
        },
        moment,
        client: {
            guilds: { cache: { get: () => ({ members: { cache: members, fetch: async id => id ? members.get(id) : members } }) } },
            channels: { fetch: async () => ({ send: async () => {} }) }
        },
        getAttendanceData: () => ({
            u1: { name: 'Zurin', sessions: [{ shift: 'day', clockInAt: bounds.start.toISOString(), clockOutAt: bounds.end.toISOString() }] },
            u2: { name: 'Giru Kun', sessions: [{ shift: 'day', clockInAt: bounds.start.toISOString(), clockOutAt: bounds.end.toISOString() }] }
        }),
        payrollOperationLogService: {
            listRecent: async () => lateLogs,
            record: async entry => {
                lateLogs.push({ ...entry, createdAt: at('2026-07-28 20:20').toISOString() });
            }
        },
        purchaseSheetService: {
            readAdenaSummary: async () => ({ ok: true, shift: 'DAY', cells, results: [] }),
            repairAdenaSummary: async input => {
                lateRepairCalls.push(input);
                return { ok: true, shift: 'DAY', corrected: 1, corrections: [], unresolved: [], failures: [] };
            }
        },
        logger: { warn() {}, error() {}, log() {} }
    });
    const lateReport = await lateService.reconcileLateApproval({
        shift: 'DAY',
        messageId: 'late1',
        audit: lateAudit
    }, { at: at('2026-07-28 20:20') });
    assert.strictEqual(lateReport.ok, true);
    assert.strictEqual(lateReport.source, 'late-approval');
    assert.strictEqual(
        lateRepairCalls[0].expectedValues.find(item => item.userName === 'Giru Kun').value,
        190000
    );
    assert.strictEqual((await lateService.recoverLateApprovals({ at: at('2026-07-28 20:25') })).recovered, 0);

    const classified = classifyCloseReadiness({
        expectedWorkers: [{ cellKey: 'PAAGRIO:worker', sheetUserName: 'Worker' }],
        submitted: [{ server: 'PAAGRIO', sheetUserName: 'Worker' }],
        pending: [{ server: 'PAAGRIO', sheetUserName: 'Worker', cellKey: 'PAAGRIO:worker' }]
    });
    assert.strictEqual(classified.approved.length, 0);
    assert.strictEqual(classified.awaitingApproval.length, 1, 'new pending post takes priority over an older approval');

    lateLogs = lateLogs.filter(item => item.kind !== 'end-adena-reconciliation');
    const recovered = await lateService.recoverLateApprovals({ at: at('2026-07-28 20:25') });
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.recovered, 1);

    console.log('end-adena-reconciliation-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
