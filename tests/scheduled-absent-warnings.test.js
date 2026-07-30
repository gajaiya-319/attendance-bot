const assert = require('assert');
const moment = require('moment-timezone');
const { createScheduledJobsWorkflow } = require('../src/workflows/scheduledJobsWorkflow');

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', 'Asia/Manila');
}

(async () => {
    const sent = [];
    const logs = [];
    const transitions = [];
    const audits = [];
    const rawRows = [];
    const attendanceData = {
        brave: {
            id: 'brave',
            name: 'Brave',
            shift: 'night',
            checkedIn: false,
            dayOff: false,
            disconnected: false,
            isFinished: false,
            points: 0,
            totalAbsent: 0
        }
    };
    const member = {
        id: 'brave',
        user: { bot: false },
        send: async message => sent.push(message),
        voice: {}
    };
    const guild = {
        members: {
            cache: new Map([['brave', member]])
        }
    };
    const workflow = createScheduledJobsWorkflow({
        client: {
            guilds: { cache: { get: () => guild } },
            channels: { fetch: async () => null }
        },
        CONFIG: {
            GUILD_ID: 'guild',
            TIMEZONE: 'Asia/Manila',
            EXCEPTIONS: {},
            POINTS: { ABSENT: -20 },
            LIVE_OFF_CLOCK_OUT_MINS: 30,
            GRACE_PERIOD_MINS: 10,
            AUTO_TIMEOUT_RESUME_WINDOW_MINS: 60,
            CLOCK_OUT_GRACE_MINS: 5
        },
        moment,
        EmbedBuilder: class {},
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => [],
        setOvertimeUsers: () => {},
        getLiveExceptions: () => ({}),
        getAnnounceData: () => ({}),
        saveSystemAsync: async () => {},
        recordLog: async (user, type, text) => logs.push(`${user.id}:${type}:${text}`),
        handleClockOut: async () => {},
        transitionRecordedStatus: (user, next, now, source, reason) => {
            Object.assign(user, next);
            transitions.push(`${source}:${reason}:${next.attendanceStatus}`);
            return true;
        },
        updateWorkingRole: async () => {},
        getScheduledEndMoment: () => null,
        getShiftBounds: () => ({
            start: at('2026-06-28 21:00'),
            end: at('2026-06-29 09:00')
        }),
        formatKoreanDateTime: value => String(value),
        renderDashboardCore: async () => {},
        handleClockIn: async () => false,
        getActiveLiveException: () => null,
        isMaintenanceWindow: () => false,
        isCurrentShiftRegularWorker: () => true,
        getOvertimeStartMoment: () => null,
        addOvertimeUser: () => false,
        determineShift: () => 'night',
        ensureUserData: () => attendanceData.brave,
        getOpenSession: () => null,
        startAttendanceSession: () => null,
        rawAttendanceSheetService: {
            sendAttendanceRow: async row => {
                rawRows.push(row);
                return { ok: true };
            }
        },
        RAW_ATTENDANCE_STATUS: { ABSENT: '결석' },
        getWorkerProfileForRawSync: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
        formatDuration: mins => `${mins}m`,
        appendAdminAudit: async (action, payload) => audits.push({ action, payload })
    });

    assert.strictEqual(await workflow.checkAbsentWarnings(at('2026-06-28 21:29')), false);
    assert.strictEqual(sent.length, 0);

    assert.strictEqual(await workflow.checkAbsentWarnings(at('2026-06-28 21:30')), true);
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0], /Reminder 1\/4/);
    assert.match(sent[0], /Unexplained absence may result in termination/);
    assert.deepStrictEqual(attendanceData.brave.absentWarningMarks, [30]);
    assert.strictEqual(audits[0].action, 'AUTO_DM_ABSENT_WARNING');
    assert.strictEqual(audits[0].payload.targetId, 'brave');
    assert.strictEqual(audits[0].payload.mark, 30);
    assert.strictEqual(audits[0].payload.dmStatus, 'sent');

    assert.strictEqual(await workflow.checkAbsentWarnings(at('2026-06-28 21:59')), false);
    assert.strictEqual(sent.length, 1, '30-minute warning is not duplicated');

    assert.strictEqual(await workflow.checkAbsentWarnings(at('2026-06-28 22:00')), true);
    assert.strictEqual(sent.length, 2);
    assert.match(sent[1], /Reminder 2\/4/);
    assert.deepStrictEqual(attendanceData.brave.absentWarningMarks, [30, 60]);

    assert.strictEqual(await workflow.checkAbsentWarnings(at('2026-06-28 23:00')), true);
    assert.strictEqual(sent.length, 3);
    assert.match(sent[2], /Reminder 4\/4/);
    assert.match(sent[2], /marked ABSENT/);
    assert.strictEqual(attendanceData.brave.status, undefined);
    assert.strictEqual(attendanceData.brave.attendanceStatus, 'PRE_SHIFT');
    assert.strictEqual(attendanceData.brave.absentCandidateThisShift, true);
    assert.strictEqual(attendanceData.brave.totalAbsent, 0);
    assert.strictEqual(attendanceData.brave.points, 0);
    assert.deepStrictEqual(rawRows, []);
    assert.deepStrictEqual(attendanceData.brave.absentWarningMarks, [30, 60, 120]);
    assert.deepStrictEqual(transitions, ['absent-warning:no-clock-in-after-120-minutes-candidate:PRE_SHIFT']);
    assert.strictEqual(logs.length, 0);
    assert.deepStrictEqual(audits.map(item => item.payload.mark), [30, 60, 120]);

    assert.strictEqual(await workflow.checkAbsentWarnings(at('2026-06-29 09:01')), true);
    assert.strictEqual(attendanceData.brave.status, 'absent');
    assert.strictEqual(attendanceData.brave.attendanceStatus, 'ABSENT');
    assert.strictEqual(attendanceData.brave.totalAbsent, 1);
    assert.strictEqual(attendanceData.brave.points, -20);
    assert.deepStrictEqual(rawRows, [{
        date: '2026-06-28',
        server: 'PAAGRIO',
        shift: 'NIGHT',
        name: 'Brave',
        status: '결석',
        inTime: '-',
        outTime: '-',
        note: '최종 결석 - 정규 근무 종료까지 출근 기록 없음',
        forceStatus: true
    }]);
    assert.deepStrictEqual(attendanceData.brave.absentWarningMarks, [30, 60, 120]);
    assert.deepStrictEqual(transitions, [
        'absent-warning:no-clock-in-after-120-minutes-candidate:PRE_SHIFT',
        'final-absent:shift-ended-without-clock-in:ABSENT'
    ]);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(audits.at(-1).action, 'FINAL_ABSENT_CONFIRMED');

    const timeoutCalls = [];
    const timeoutData = {
        daba: {
            id: 'daba',
            name: 'Daba',
            shift: 'night',
            checkedIn: true,
            dayOff: false,
            disconnected: false,
            isFinished: false,
            status: 'late',
            checkInRaw: at('2026-06-29 00:27').toISOString(),
            liveOffStartedAt: at('2026-06-29 06:30').toISOString(),
            pendingClockOut: {
                source: 'live_off',
                at: at('2026-06-29 07:00').toISOString(),
                expiresAt: at('2026-06-29 07:00').toISOString()
            }
        },
        gab: {
            id: 'gab',
            name: 'Gab',
            shift: 'night',
            checkedIn: true,
            dayOff: false,
            disconnected: true,
            isFinished: false,
            status: 'late',
            checkInRaw: at('2026-06-29 00:10').toISOString(),
            disconnectedAt: at('2026-06-29 06:50').toISOString(),
            pendingClockOut: {
                source: 'voice_leave',
                at: at('2026-06-29 07:00').toISOString(),
                expiresAt: at('2026-06-29 07:00').toISOString()
            }
        }
    };
    let timeoutScheduledEnd = moment().tz('Asia/Manila').add(1, 'hour');
    const timeoutWorkflow = createScheduledJobsWorkflow({
        client: {
            guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } },
            channels: { fetch: async () => null }
        },
        CONFIG: {
            GUILD_ID: 'guild',
            TIMEZONE: 'Asia/Manila',
            EXCEPTIONS: {},
            POINTS: { ABSENT: -20 },
            LIVE_OFF_CLOCK_OUT_MINS: 30,
            GRACE_PERIOD_MINS: 10,
            AUTO_TIMEOUT_RESUME_WINDOW_MINS: 60,
            CLOCK_OUT_GRACE_MINS: 5
        },
        moment,
        EmbedBuilder: class {},
        getAttendanceData: () => timeoutData,
        getOvertimeUsers: () => [],
        setOvertimeUsers: () => {},
        getLiveExceptions: () => ({}),
        getAnnounceData: () => ({}),
        saveSystemAsync: async () => {},
        recordLog: async () => {},
        handleClockOut: async () => {
            throw new Error('handleClockOut should not be called without cached member');
        },
        handleClockOutWithoutMember: async (id, user, now, text, effectiveOut, options) => {
            timeoutCalls.push({
                id,
                text,
                effectiveOut: effectiveOut.format('HH:mm'),
                source: options.clockOutSource
            });
            user.checkedIn = false;
            user.isFinished = true;
            user.disconnected = false;
        },
        transitionRecordedStatus: () => true,
        updateWorkingRole: async () => {},
        getScheduledEndMoment: () => timeoutScheduledEnd.clone(),
        getShiftBounds: () => ({
            start: at('2026-06-28 21:00'),
            end: at('2026-06-29 09:00')
        }),
        formatKoreanDateTime: value => String(value),
        renderDashboardCore: async () => {},
        handleClockIn: async () => false,
        getActiveLiveException: () => null,
        isMaintenanceWindow: () => false,
        isCurrentShiftRegularWorker: () => false,
        getOvertimeStartMoment: () => null,
        addOvertimeUser: () => false,
        determineShift: () => 'night',
        ensureUserData: () => null,
        getOpenSession: () => null,
        startAttendanceSession: () => null,
        rawAttendanceSheetService: null,
        RAW_ATTENDANCE_STATUS: { ABSENT: '결석' },
        getWorkerProfileForRawSync: () => null,
        formatDuration: mins => `${mins}m`,
        appendAdminAudit: async () => {},
        logger: { warn() {}, log() {}, error() {} }
    });

    await timeoutWorkflow.checkGracePeriods();
    assert.deepStrictEqual(timeoutCalls.map(call => `${call.id}:${call.source}:${call.effectiveOut}`), []);
    assert.strictEqual(timeoutData.daba.checkedIn, true, 'live-off timeout before shift end keeps worker checked in');
    assert.strictEqual(Boolean(timeoutData.daba.pendingClockOut?.timeoutNotifiedAt), true, 'live-off hold marks timeout notification once');
    assert.strictEqual(timeoutData.gab.checkedIn, true, 'dc timeout before shift end keeps worker checked in');
    assert.strictEqual(timeoutData.gab.disconnected, true, 'dc timeout before shift end remains disconnected');
    assert.strictEqual(Boolean(timeoutData.gab.pendingClockOut?.timeoutNotifiedAt), true, 'dc hold marks timeout notification once');

    timeoutScheduledEnd = moment().tz('Asia/Manila').subtract(1, 'minute');
    await timeoutWorkflow.checkGracePeriods();
    assert(timeoutCalls.map(call => `${call.id}:${call.source}:${call.effectiveOut}`).includes('daba:live-off-timeout:07:00'));
    assert(timeoutCalls.map(call => `${call.id}:${call.source}:${call.effectiveOut}`).includes('gab:dc-timeout:07:00'));

    console.log('scheduled-absent-warnings tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
