'use strict';

const assert = require('assert');
const moment = require('moment-timezone');
const {
    getMemberServer,
    buildEndAdenaValidationMessage,
    createEndAdenaSubmissionValidationService
} = require('../src/services/endAdenaSubmissionValidationService');

const TIMEZONE = 'Asia/Manila';
const START = moment.tz('2026-07-30 09:00', 'YYYY-MM-DD HH:mm', TIMEZONE);
const END = moment.tz('2026-07-30 21:00', 'YYYY-MM-DD HH:mm', TIMEZONE);
const CREATED = END.clone().subtract(10, 'minutes');
const CONFIG = {
    TIMEZONE,
    ROLES: { DAY: 'day', NIGHT: 'night', PAAGRIO: 'paagrio', HEINE: 'valakas' },
    SHEET_NAME_ALIASES: { bitshelby: 'bit shelby' }
};

function roles(ids) {
    return { cache: { has: id => ids.includes(id) } };
}

function createMessage(overrides = {}) {
    return {
        id: overrides.id || 'message-1',
        channelId: 'paagrio-end',
        content: 'NAME: BitShelby\n-GAINED ADENA: 140,884',
        createdAt: CREATED.toDate(),
        author: { id: 'worker-1', username: 'BitShelby', bot: false },
        member: {
            displayName: 'BitShelby - P Day Time',
            roles: roles(['day', 'paagrio'])
        },
        channel: { messages: { fetch: async () => new Map() } },
        ...overrides
    };
}

function attendanceData() {
    return {
        'worker-1': {
            name: 'BitShelby',
            sessions: [{
                shift: 'day',
                clockInAt: START.clone().add(5, 'minutes').toISOString(),
                clockOutAt: CREATED.clone().subtract(5, 'minutes').toISOString()
            }]
        }
    };
}

function parsed() {
    return { requestedName: 'BitShelby', rawAmount: 140884, amount: 140000 };
}

function createService({
    data = attendanceData(),
    operations = [],
    boundsResolver = () => ({ start: START.clone(), end: END.clone() }),
    summary = {
        ok: true,
        cells: [{ server: 'PAAGRIO', shift: 'DAY', userName: 'Bit Shelby', value: 0, range: 'L59' }],
        results: []
    }
} = {}) {
    let summaryReads = 0;
    const records = [];
    const service = createEndAdenaSubmissionValidationService({
        CONFIG,
        moment,
        getShiftBounds: boundsResolver,
        getAttendanceData: () => data,
        purchaseSheetService: {
            readAdenaSummary: async () => {
                summaryReads += 1;
                return summary;
            }
        },
        payrollOperationLogService: {
            listRecent: async () => operations,
            record: async entry => records.push(entry)
        },
        logger: { warn() {} }
    });
    return { service, records, getSummaryReads: () => summaryReads };
}

(async () => {
    assert.strictEqual(getMemberServer(createMessage().member, CONFIG.ROLES), 'PAAGRIO');
    assert.strictEqual(getMemberServer({ displayName: 'Other - V Day Time', roles: roles([]) }, CONFIG.ROLES), 'VALAKAS');

    const readyHarness = createService();
    const ready = await readyHarness.service.validate({
        message: createMessage(),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(ready.valid, true);
    assert.strictEqual(ready.status, 'ready');
    assert.strictEqual(ready.sheetUserName, 'Bit Shelby');
    assert.strictEqual(ready.attendanceUserId, 'worker-1');
    assert.strictEqual(ready.shiftResolutionSource, 'attendance-session');
    assert.deepStrictEqual(ready.issues, []);
    assert.match(buildEndAdenaValidationMessage(ready), /\uc2b9\uc778 \uac00\ub2a5/);
    await readyHarness.service.validate({
        message: createMessage({ id: 'message-2' }),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(readyHarness.getSummaryReads(), 1, 'summary reads should be cached');
    assert.strictEqual(readyHarness.records.length, 2);

    const wrongServer = await createService().service.validate({
        message: createMessage(),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: { displayName: 'BitShelby - V Day Time', roles: roles(['day', 'valakas']) },
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(wrongServer.valid, false);
    assert(wrongServer.issues.some(issue => issue.code === 'server-mismatch'));
    assert.match(buildEndAdenaValidationMessage(wrongServer), /\uc218\uc815 \ud544\uc694/);

    const absent = await createService({ data: {} }).service.validate({
        message: createMessage(),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(absent.valid, false);
    assert(absent.issues.some(issue => issue.code === 'attendance-not-found'));

    const proxyData = {
        'worker-1': { name: 'Proxy Manager', sessions: [] },
        'worker-2': { ...attendanceData()['worker-1'], name: 'BitShelby' }
    };
    const proxySubmission = await createService({ data: proxyData }).service.validate({
        message: createMessage(),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(proxySubmission.valid, true);
    assert.strictEqual(proxySubmission.attendanceUserId, 'worker-2');

    const duplicateOperations = [{
        kind: 'end-adena',
        action: 'approve',
        status: 'success',
        messageId: 'previous-message',
        server: 'PAAGRIO',
        shift: 'DAY',
        userName: 'BitShelby',
        payload: { audit: { shiftStartAt: START.toISOString(), shiftEndAt: END.toISOString() } }
    }];
    const duplicate = await createService({ operations: duplicateOperations }).service.validate({
        message: createMessage(),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(duplicate.valid, false);
    assert.strictEqual(duplicate.status, 'duplicate');
    assert.deepStrictEqual(duplicate.duplicateMessageIds, ['previous-message']);
    assert.match(buildEndAdenaValidationMessage(duplicate), /\uc911\ubcf5 \uc758\uc2ec/);

    const sheetWarning = await createService({
        summary: { ok: false, code: 'sheet-api-error', cells: [], results: [] }
    }).service.validate({
        message: createMessage(),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(sheetWarning.valid, true);
    assert.strictEqual(sheetWarning.status, 'review');
    assert(sheetWarning.issues.some(issue => issue.code === 'sheet-unavailable'));

    const overtimeCreated = moment.tz('2026-07-30 04:31', 'YYYY-MM-DD HH:mm', TIMEZONE);
    const previousStart = moment.tz('2026-07-29 09:00', 'YYYY-MM-DD HH:mm', TIMEZONE);
    const previousEnd = moment.tz('2026-07-29 21:00', 'YYYY-MM-DD HH:mm', TIMEZONE);
    const crossMidnight = await createService({
        boundsResolver: (_shift, input) => {
            const start = moment(input).tz(TIMEZONE).startOf('day').hour(9);
            return { start, end: start.clone().hour(21) };
        },
        data: {
            'worker-1': {
                name: 'BitShelby',
                sessions: [{
                    id: 'day:2026-07-29-09-00:regular',
                    shift: 'day',
                    sessionKey: 'day:2026-07-29 09:00',
                    scheduledStartAt: previousStart.toISOString(),
                    scheduledEndAt: previousEnd.toISOString(),
                    clockInAt: previousStart.clone().add(20, 'minutes').toISOString(),
                    clockOutAt: previousEnd.clone().subtract(4, 'minutes').toISOString()
                }, {
                    id: 'day:2026-07-29-09-00:overtime',
                    shift: 'day',
                    sessionKey: 'day:2026-07-29 09:00',
                    scheduledStartAt: previousEnd.clone().add(2, 'hours').toISOString(),
                    scheduledEndAt: previousEnd.clone().add(2, 'hours').toISOString(),
                    clockInAt: previousEnd.clone().add(40, 'minutes').toISOString(),
                    clockOutAt: overtimeCreated.clone().subtract(12, 'minutes').toISOString(),
                    otType: 'FORCED'
                }]
            }
        }
    }).service.validate({
        message: createMessage({ createdAt: overtimeCreated.toDate() }),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(crossMidnight.valid, true);
    assert.strictEqual(crossMidnight.shiftStartAt, previousStart.toISOString());
    assert.strictEqual(crossMidnight.shiftEndAt, previousEnd.toISOString());
    assert.strictEqual(crossMidnight.shiftResolutionSource, 'attendance-session');
    assert.deepStrictEqual(crossMidnight.attendanceSessionIds, [
        'day:2026-07-29-09-00:regular',
        'day:2026-07-29-09-00:overtime'
    ]);
    assert.strictEqual(crossMidnight.attendanceSessionId, 'day:2026-07-29-09-00:overtime');
    assert.strictEqual(crossMidnight.attendanceSessionType, 'FORCED');

    const regularApproval = {
        kind: 'end-adena',
        action: 'approve',
        status: 'success',
        messageId: 'regular-submission',
        server: 'PAAGRIO',
        shift: 'DAY',
        userName: 'BitShelby',
        messageCreatedAt: previousEnd.clone().subtract(4, 'minutes').toISOString(),
        payload: {
            audit: {
                messageCreatedAt: previousEnd.clone().subtract(4, 'minutes').toISOString(),
                shiftStartAt: previousStart.toISOString(),
                shiftEndAt: previousEnd.toISOString()
            }
        }
    };
    const supplementalOvertime = await createService({
        boundsResolver: (_shift, input) => {
            const start = moment(input).tz(TIMEZONE).startOf('day').hour(9);
            return { start, end: start.clone().hour(21) };
        },
        data: {
            'worker-1': {
                name: 'BitShelby',
                sessions: [{
                    id: 'day:2026-07-29-09-00:regular',
                    shift: 'day',
                    sessionKey: 'day:2026-07-29 09:00',
                    scheduledStartAt: previousStart.toISOString(),
                    scheduledEndAt: previousEnd.toISOString(),
                    clockInAt: previousStart.clone().add(20, 'minutes').toISOString(),
                    clockOutAt: previousEnd.clone().subtract(4, 'minutes').toISOString()
                }, {
                    id: 'day:2026-07-29-09-00:overtime',
                    shift: 'day',
                    sessionKey: 'day:2026-07-29 09:00',
                    clockInAt: previousEnd.clone().add(40, 'minutes').toISOString(),
                    clockOutAt: overtimeCreated.clone().subtract(12, 'minutes').toISOString(),
                    otType: 'FORCED'
                }]
            }
        },
        operations: [regularApproval]
    }).service.validate({
        message: createMessage({ id: 'overtime-submission', createdAt: overtimeCreated.toDate() }),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(supplementalOvertime.valid, true);
    assert.deepStrictEqual(supplementalOvertime.duplicateMessageIds, []);
    assert.strictEqual(supplementalOvertime.attendanceSessionId, 'day:2026-07-29-09-00:overtime');

    const repeatedOvertime = await createService({
        boundsResolver: (_shift, input) => {
            const start = moment(input).tz(TIMEZONE).startOf('day').hour(9);
            return { start, end: start.clone().hour(21) };
        },
        data: {
            'worker-1': {
                name: 'BitShelby',
                sessions: supplementalOvertime.attendanceSessionIds.map((id, index) => ({
                    id,
                    shift: 'day',
                    sessionKey: 'day:2026-07-29 09:00',
                    clockInAt: index === 0
                        ? previousStart.clone().add(20, 'minutes').toISOString()
                        : previousEnd.clone().add(40, 'minutes').toISOString(),
                    clockOutAt: index === 0
                        ? previousEnd.clone().subtract(4, 'minutes').toISOString()
                        : overtimeCreated.clone().subtract(12, 'minutes').toISOString(),
                    otType: index === 0 ? null : 'FORCED'
                }))
            }
        },
        operations: [regularApproval, {
            ...regularApproval,
            messageId: 'first-overtime-submission',
            messageCreatedAt: overtimeCreated.clone().subtract(1, 'minute').toISOString(),
            payload: {
                audit: {
                    messageCreatedAt: overtimeCreated.clone().subtract(1, 'minute').toISOString(),
                    shiftStartAt: previousStart.toISOString(),
                    shiftEndAt: previousEnd.toISOString(),
                    attendanceSessionId: 'day:2026-07-29-09-00:overtime'
                }
            }
        }]
    }).service.validate({
        message: createMessage({ id: 'second-overtime-submission', createdAt: overtimeCreated.toDate() }),
        server: 'PAAGRIO',
        parsed: parsed(),
        member: createMessage().member,
        shift: 'DAY',
        userName: 'BitShelby'
    });
    assert.strictEqual(repeatedOvertime.valid, false);
    assert.deepStrictEqual(repeatedOvertime.duplicateMessageIds, ['first-overtime-submission']);

    const nightBoundsResolver = (_shift, input) => {
        const start = moment(input).tz(TIMEZONE).startOf('day').hour(21);
        return { start, end: start.clone().add(12, 'hours') };
    };
    const abCurrentStart = moment.tz('2026-08-01 21:00', TIMEZONE);
    const abDeclaredSubmission = await createService({
        boundsResolver: nightBoundsResolver,
        data: {
            ab: {
                name: 'AB',
                sessions: [{
                    id: 'night:2026-07-31-21-00:regular',
                    shift: 'night',
                    sessionKey: 'night:2026-07-31 21:00',
                    clockInAt: moment.tz('2026-07-31 21:05', TIMEZONE).toISOString(),
                    clockOutAt: moment.tz('2026-08-01 09:00', TIMEZONE).toISOString()
                }]
            }
        },
        operations: [{
            kind: 'end-adena',
            action: 'approve',
            status: 'success',
            messageId: 'ab-previous-night',
            userName: 'AB',
            payload: { audit: {
                shiftStartAt: moment.tz('2026-07-31 21:00', TIMEZONE).toISOString(),
                shiftEndAt: moment.tz('2026-08-01 09:00', TIMEZONE).toISOString(),
                attendanceSessionId: 'night:2026-07-31-21-00:regular',
                attendanceSessionType: 'REGULAR'
            } }
        }],
        summary: {
            ok: true,
            cells: [{ server: 'PAAGRIO', shift: 'NIGHT', userName: 'AB', value: 0, range: 'U35' }],
            results: []
        }
    }).service.validate({
        message: createMessage({
            id: 'ab-current-night',
            createdAt: abCurrentStart.clone().add(12, 'hours').add(7, 'minutes').toDate(),
            content: '-NAME: AB\n-START: 8/1/2026\n-START TIME: 10:00 PM KR TIME\n-GAINED ADENA: 191,000',
            author: { id: 'ab', username: 'AB', bot: false },
            member: { displayName: 'AB - P Night Time', roles: roles(['night', 'paagrio']) }
        }),
        server: 'PAAGRIO',
        parsed: {
            requestedName: 'AB', rawAmount: 191000, amount: 191000,
            startDate: '8/1/2026', startTime: '10:00 PM', startTimezone: 'Asia/Seoul'
        },
        member: { displayName: 'AB - P Night Time', roles: roles(['night', 'paagrio']) },
        shift: 'NIGHT',
        userName: 'AB'
    });
    assert.strictEqual(abDeclaredSubmission.valid, true, 'declared current night is not matched to an older attendance session');
    assert.strictEqual(abDeclaredSubmission.shiftStartAt, abCurrentStart.toISOString());
    assert.strictEqual(abDeclaredSubmission.shiftResolutionSource, 'declared-start');
    assert.deepStrictEqual(abDeclaredSubmission.duplicateMessageIds, []);
    assert.deepStrictEqual(abDeclaredSubmission.issues.map(issue => [issue.code, issue.severity]), [
        ['attendance-not-found', 'warning']
    ]);

    const kauchinreiBoundsResolver = (_shift, input) => {
        const start = moment(input).tz(TIMEZONE).startOf('day').hour(9);
        return { start, end: start.clone().add(12, 'hours') };
    };
    const kauchinreiStart = moment.tz('2026-08-01 09:00', TIMEZONE);
    const oldOvertimeMessage = {
        id: 'kauchinrei-old-overtime',
        content: 'Name: Kauchinrei (OT)\n-START: 08/01/2026\n-START TIME: 3:00 AM KR TIME\n-GAINED ADENA: 40,000',
        createdAt: moment.tz('2026-08-01 05:05', TIMEZONE).toDate(),
        author: { id: 'kauchinrei', username: 'Kauchinrei', bot: false },
        reactions: { cache: new Map() }
    };
    const currentOvertimeMessage = createMessage({
        id: 'kauchinrei-current-overtime',
        createdAt: moment.tz('2026-08-02 05:17', TIMEZONE).toDate(),
        content: 'Name: Kauchinrei (OT)\n-START: 08/2/2026\n-START TIME: 12:00 AM KR TIME\n-GAINED ADENA: 130,000',
        author: { id: 'kauchinrei', username: 'Kauchinrei', bot: false },
        member: { displayName: 'Kauchinrei - P Day Time', roles: roles(['day', 'paagrio']) },
        channel: { messages: { fetch: async input => (
            typeof input === 'string' ? oldOvertimeMessage : new Map([[oldOvertimeMessage.id, oldOvertimeMessage]])
        ) } }
    });
    const kauchinreiOvertime = await createService({
        boundsResolver: kauchinreiBoundsResolver,
        data: {
            kauchinrei: {
                name: 'Kauchinrei',
                sessions: [{
                    id: 'day:2026-08-01-09-00:regular',
                    shift: 'day',
                    sessionKey: 'day:2026-08-01 09:00',
                    clockInAt: kauchinreiStart.toISOString(),
                    clockOutAt: kauchinreiStart.clone().add(12, 'hours').toISOString()
                }, {
                    id: 'day:2026-08-01-09-00:late-live',
                    shift: 'day',
                    sessionKey: 'day:2026-08-01 09:00',
                    clockInAt: kauchinreiStart.clone().add(13, 'hours').add(41, 'minutes').toISOString(),
                    clockOutAt: kauchinreiStart.clone().add(15, 'hours').toISOString()
                }]
            }
        },
        operations: [{
            kind: 'end-adena', action: 'approve', status: 'success',
            messageId: oldOvertimeMessage.id, userName: 'Kauchinrei',
            payload: { audit: {
                shiftStartAt: kauchinreiStart.toISOString(),
                shiftEndAt: kauchinreiStart.clone().add(12, 'hours').toISOString()
            } }
        }],
        summary: {
            ok: true,
            cells: [{ server: 'PAAGRIO', shift: 'DAY', userName: 'Kauchinrei', value: 0, range: 'I10' }],
            results: []
        }
    }).service.validate({
        message: currentOvertimeMessage,
        server: 'PAAGRIO',
        parsed: {
            requestedName: 'Kauchinrei', rawAmount: 130000, amount: 130000,
            startDate: '08/2/2026', startTime: '12:00 AM', startTimezone: 'Asia/Seoul',
            submissionType: 'OVERTIME'
        },
        member: currentOvertimeMessage.member,
        shift: 'DAY',
        userName: 'Kauchinrei'
    });
    assert.strictEqual(kauchinreiOvertime.valid, true, `a new declared OT window is not blocked by the previous OT: ${JSON.stringify(kauchinreiOvertime)}`);
    assert.deepStrictEqual(kauchinreiOvertime.duplicateMessageIds, []);
    assert.strictEqual(kauchinreiOvertime.attendanceSessionId, 'day:2026-08-01-09-00:late-live');
    assert.strictEqual(kauchinreiOvertime.attendanceSessionType, 'OVERTIME');

    console.log('end-adena-submission-validation-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
