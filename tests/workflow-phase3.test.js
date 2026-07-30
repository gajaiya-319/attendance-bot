'use strict';

const assert = require('assert');
const { createClockWorkflow } = require('../src/workflows/clockWorkflow');
const { createWorkflowRuntime } = require('../src/runtime/workflowRuntime');

(async () => {
    const attendanceData = {};
    const overtimeUsers = [];

    const clock = createClockWorkflow({
        client: { guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }, channels: { cache: { get: () => null }, fetch: async () => null } },
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila', ROLES: { DAY: 'd', NIGHT: 'n' }, CLOCK_OUT_GRACE_MINS: 15 },
        moment: require('moment-timezone'),
        attendanceService: {
            getScheduledEndMoment: () => null,
            transitionRecordedStatus: () => false,
            applyFinishedStateCore: () => ({ ok: true }),
            applyDayOffCore: () => ({ ok: true })
        },
        roleService: {},
        rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
        dashboardStateUtils: require('../src/utils/dashboardState'),
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        setOvertimeUsers: list => { overtimeUsers.length = 0; overtimeUsers.push(...list); },
        saveSystemAsync: async () => {},
        updateWorkingRole: async () => {},
        getActiveLiveException: () => null,
        getOperationalShift: () => 'day',
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        isWithinPreShiftWindow: () => false,
        getTimeLogicRecentMaintenanceEnd: () => null,
        formatDuration: mins => `${mins}m`,
        RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
        mapRawClockInStatus: () => 'IN',
        mapRawClockOutStatus: () => 'OUT'
    });

    assert.strictEqual(typeof clock.handleClockIn, 'function');
    assert.strictEqual(typeof clock.getMemberShiftRole, 'function');
    assert.strictEqual(typeof clock.expireDayOffSessions, 'function');
    assert.strictEqual(
        clock.buildClockInRawAttendanceNote({}, {
            preShift: true,
            preShiftVoiceGrace: true,
            preShiftVoiceMode: 'regular',
            preShiftVoiceAt: require('moment-timezone').tz('2026-07-01 08:50', 'Asia/Manila'),
            recognizedAt: require('moment-timezone').tz('2026-07-01 09:00', 'Asia/Manila')
        }, true, require('moment-timezone').tz('2026-07-01 09:08', 'Asia/Manila')),
        '사전 음성 대기 08:50 / 인정 출근 09:00 / 실제 LIVE ON 09:08',
        'pre-shift voice grace note is explicit in Raw_Attendance'
    );

    {
        const moment = require('moment-timezone');
        class TestButton {
            setCustomId(value) { this.customId = value; return this; }
            setLabel(value) { this.label = value; return this; }
            setStyle(value) { this.style = value; return this; }
        }
        class TestRow {
            addComponents(...components) { this.components = components; return this; }
        }
        const config = {
            GUILD_ID: 'g1',
            TIMEZONE: 'Asia/Manila',
            LOG_CHANNEL: 'log',
            ROLES: { DAY: 'd', NIGHT: 'n' },
            EXCEPTIONS: {},
            POINTS: { OT: 5 },
            CLOCK_OUT_GRACE_MINS: 5,
            AUTO_OT_CONFIRM_EXPIRE_MINS: 0,
            AUTO_OT_CONFIRM_REMINDER_MINS: 5,
            OT_ACTIVITY_DENYLIST: []
        };
        const otState = {
            attendanceData: {
                otUser: { id: 'otUser', name: 'OT User', shift: 'night', attendanceEvents: [] }
            },
            overtimeUsers: []
        };
        const sends = [];
        const otClock = createClockWorkflow({
            client: {
                channels: {
                    cache: { get: () => null },
                    fetch: async () => null
                },
                guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }
            },
            CONFIG: config,
            moment,
            attendanceService: {
                appendAttendanceEvent: (user, type, at, source, meta) => {
                    user.attendanceEvents.push({ type, at: at.toISOString(), source, meta });
                    return true;
                },
                getOvertimeStartMoment: () => moment.tz('2026-07-01 09:00', config.TIMEZONE),
                getOpenSession: () => null,
                calculateSessionWorkedMinutes: () => null
            },
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => otState.attendanceData,
            getOvertimeUsers: () => otState.overtimeUsers,
            setOvertimeUsers: list => { otState.overtimeUsers.length = 0; otState.overtimeUsers.push(...list); },
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: member => otState.attendanceData[member.id],
            getActiveLiveException: () => null,
            getOperationalShift: () => 'night',
            getDashboardShift: () => 'night',
            getShiftBounds: () => ({
                start: moment.tz('2026-06-30 21:00', config.TIMEZONE),
                end: moment.tz('2026-07-01 09:00', config.TIMEZONE)
            }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
            mapRawClockInStatus: () => 'IN',
            mapRawClockOutStatus: () => 'OUT',
            ActionRowBuilder: TestRow,
            ButtonBuilder: TestButton,
            ButtonStyle: { Danger: 4, Secondary: 2 },
            logger: { warn: () => {}, error: () => {} }
        });
        const member = {
            id: 'otUser',
            displayName: 'OT User',
            voice: { streaming: true },
            guild: {
                presences: { cache: new Map() },
                voiceStates: { cache: new Map() }
            },
            send: async payload => {
                sends.push(payload);
                return { id: `dm${sends.length}`, channelId: 'dm' };
            }
        };
        const user = otState.attendanceData.otUser;
        const scheduledEnd = moment.tz('2026-07-01 09:00', config.TIMEZONE);

        await otClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:06', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 1, 'first OT suspicion sends a DM');
        assert(sends[0].content.includes('Activity evidence: not visible'), 'OT DM shows missing activity evidence');
        assert.strictEqual(user.pendingAutoOTConfirm.expiresAt, null, 'default OT confirmation does not expire');
        assert.strictEqual(user.pendingAutoOTConfirm.dmSentCount, 1, 'first DM count is recorded');

        await otClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:08', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 1, 'pending OT confirmation is not spammed before reminder interval');

        await otClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:11', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 2, 'pending OT confirmation is resent after reminder interval');
        assert(sends[1].content.includes('OT confirmation reminder'), 'resent DM is clearly marked as a reminder');
        assert.strictEqual(user.pendingAutoOTConfirm.dmSentCount, 2, 'reminder increments DM count');

        user.pendingAutoOTConfirm.status = 'canceled';
        await otClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:20', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 2, 'canceled OT confirmation is not resent for the same scheduled end');
    }

    {
        const moment = require('moment-timezone');
        class TestButton {
            setCustomId(value) { this.customId = value; return this; }
            setLabel(value) { this.label = value; return this; }
            setStyle(value) { this.style = value; return this; }
        }
        class TestRow {
            addComponents(...components) { this.components = components; return this; }
        }
        const config = {
            GUILD_ID: 'g1',
            TIMEZONE: 'Asia/Manila',
            LOG_CHANNEL: 'log',
            ROLES: { DAY: 'd', NIGHT: 'n' },
            EXCEPTIONS: {},
            POINTS: { OT: 5 },
            CLOCK_OUT_GRACE_MINS: 5,
            AUTO_OT_CONFIRM_EXPIRE_MINS: 0,
            AUTO_OT_CONFIRM_REMINDER_MINS: 5,
            OT_ACTIVITY_DENYLIST: ['Dota'],
            AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold',
            AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK: false
        };
        const holdState = {
            attendanceData: {
                holdUser: { id: 'holdUser', name: 'Hold User', shift: 'night', attendanceEvents: [] }
            },
            overtimeUsers: []
        };
        const sends = [];
        const holdClock = createClockWorkflow({
            client: {
                channels: { cache: { get: () => null }, fetch: async () => null },
                guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }
            },
            CONFIG: config,
            moment,
            attendanceService: {
                appendAttendanceEvent: (user, type, at, source, meta) => {
                    user.attendanceEvents.push({ type, at: at.toISOString(), source, meta });
                    return true;
                },
                getOvertimeStartMoment: () => moment.tz('2026-07-01 09:00', config.TIMEZONE),
                getOpenSession: () => null,
                calculateSessionWorkedMinutes: () => null
            },
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => holdState.attendanceData,
            getOvertimeUsers: () => holdState.overtimeUsers,
            setOvertimeUsers: list => { holdState.overtimeUsers.length = 0; holdState.overtimeUsers.push(...list); },
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: member => holdState.attendanceData[member.id],
            getActiveLiveException: () => null,
            getOperationalShift: () => 'night',
            getDashboardShift: () => 'night',
            getShiftBounds: () => ({
                start: moment.tz('2026-06-30 21:00', config.TIMEZONE),
                end: moment.tz('2026-07-01 09:00', config.TIMEZONE)
            }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
            mapRawClockInStatus: () => 'IN',
            mapRawClockOutStatus: () => 'OUT',
            ActionRowBuilder: TestRow,
            ButtonBuilder: TestButton,
            ButtonStyle: { Danger: 4, Secondary: 2 },
            logger: { warn: () => {}, error: () => {} }
        });
        const member = {
            id: 'holdUser',
            displayName: 'Hold User',
            voice: { streaming: true },
            presence: { activities: [] },
            guild: {
                presences: { cache: new Map() },
                voiceStates: { cache: new Map() }
            },
            send: async payload => {
                sends.push(payload);
                return { id: `hold-dm${sends.length}`, channelId: 'dm' };
            }
        };
        const user = holdState.attendanceData.holdUser;
        const scheduledEnd = moment.tz('2026-07-01 09:00', config.TIMEZONE);
        await holdClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:06', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 1, 'hold policy still sends an OT suspicion DM');
        assert.strictEqual(user.pendingAutoOTConfirm.activityStatus, 'unknown', 'pending OT records missing activity evidence');
        assert(sends[0].content.includes('Activity evidence: not visible'), 'hold-policy DM tells the user activity is hidden');
        assert(sends[0].content.includes('Start OT will not start automatically'), 'hold-policy DM warns that hidden activity cannot auto-start OT');

        const startButton = sends[0].components[0].components[0];
        const result = await holdClock.handleAutoOvertimeConfirmation({
            customId: startButton.customId,
            user: { id: 'holdUser' },
            member,
            guild: member.guild
        }, moment.tz('2026-07-01 09:07', config.TIMEZONE));
        assert.strictEqual(result.changed, true, 'unknown activity confirmation changes pending state');
        assert(result.message.includes('activity was not visible'), 'unknown activity confirmation explains why OT is not started');
        assert.strictEqual(user.pendingAutoOTConfirm.status, 'blocked', 'unknown activity blocks automatic OT at approval time');
        assert.strictEqual(holdState.overtimeUsers.length, 0, 'unknown activity does not add an OT user');
    }

    {
        const moment = require('moment-timezone');
        class TestButton {
            setCustomId(value) { this.customId = value; return this; }
            setLabel(value) { this.label = value; return this; }
            setStyle(value) { this.style = value; return this; }
        }
        class TestRow {
            addComponents(...components) { this.components = components; return this; }
        }
        const config = {
            GUILD_ID: 'g1',
            TIMEZONE: 'Asia/Manila',
            LOG_CHANNEL: 'log',
            ROLES: { DAY: 'd', NIGHT: 'n' },
            EXCEPTIONS: {},
            POINTS: { OT: 5 },
            CLOCK_OUT_GRACE_MINS: 5,
            AUTO_OT_CONFIRM_EXPIRE_MINS: 0,
            AUTO_OT_CONFIRM_REMINDER_MINS: 5,
            OT_ACTIVITY_DENYLIST: ['Dota'],
            AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold',
            AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK: true
        };
        const fallbackState = {
            attendanceData: {
                fallbackUser: { id: 'fallbackUser', name: 'Fallback User', shift: 'night', attendanceEvents: [] }
            },
            overtimeUsers: []
        };
        const sends = [];
        const scheduledEnd = moment.tz('2026-07-01 09:00', config.TIMEZONE);
        const fallbackClock = createClockWorkflow({
            client: {
                channels: { cache: { get: () => null }, fetch: async () => null },
                guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }
            },
            CONFIG: config,
            moment,
            attendanceService: {
                appendAttendanceEvent: (user, type, at, source, meta) => {
                    user.attendanceEvents.push({ type, at: at.toISOString(), source, meta });
                    return true;
                },
                getOvertimeStartMoment: () => scheduledEnd,
                getPostShiftOvertimeStartMoment: () => scheduledEnd,
                canStartPostShiftOvertime: () => true,
                getOpenSession: () => null,
                calculateSessionWorkedMinutes: () => null,
                applyOvertimeCore: (user, now, type) => {
                    user.checkedIn = true;
                    user.attendanceStatus = 'OVERTIME';
                    user.pendingAutoOTConfirm = null;
                    fallbackState.overtimeUsers.push({ id: user.id, type });
                    return { ok: true, added: true };
                }
            },
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => fallbackState.attendanceData,
            getOvertimeUsers: () => fallbackState.overtimeUsers,
            setOvertimeUsers: list => { fallbackState.overtimeUsers.length = 0; fallbackState.overtimeUsers.push(...list); },
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: member => fallbackState.attendanceData[member.id],
            getActiveLiveException: () => null,
            getOperationalShift: () => 'night',
            getDashboardShift: () => 'night',
            getShiftBounds: () => ({
                start: moment.tz('2026-06-30 21:00', config.TIMEZONE),
                end: scheduledEnd
            }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
            mapRawClockInStatus: () => 'IN',
            mapRawClockOutStatus: () => 'OUT',
            ActionRowBuilder: TestRow,
            ButtonBuilder: TestButton,
            ButtonStyle: { Danger: 4, Secondary: 2 },
            logger: { warn: () => {}, error: () => {} }
        });
        const member = {
            id: 'fallbackUser',
            displayName: 'Fallback User',
            voice: { streaming: true },
            presence: { activities: [] },
            guild: {
                presences: { cache: new Map() },
                voiceStates: { cache: new Map() }
            },
            send: async payload => {
                sends.push(payload);
                return { id: `fallback-dm${sends.length}`, channelId: 'dm' };
            }
        };
        const user = fallbackState.attendanceData.fallbackUser;

        await fallbackClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:06', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 1, 'continuous-live fallback still sends an OT confirmation DM');
        assert.strictEqual(user.pendingAutoOTConfirm.activityFallback, 'continuous-live', 'pending OT records continuous-live fallback evidence');
        assert(sends[0].content.includes('Fallback evidence: continuous LIVE from shift end'), 'DM explains the fallback evidence');

        const startButton = sends[0].components[0].components[0];
        const result = await fallbackClock.handleAutoOvertimeConfirmation({
            customId: startButton.customId,
            user: { id: 'fallbackUser' },
            member,
            guild: member.guild
        }, moment.tz('2026-07-01 09:07', config.TIMEZONE));

        assert.strictEqual(result.message, 'OT started. Thank you.', 'continuous-live fallback can start OT after DM approval');
        assert.strictEqual(fallbackState.overtimeUsers.length, 1, 'continuous-live fallback adds an OT user');
    }

    {
        const moment = require('moment-timezone');
        class TestButton {
            setCustomId(value) { this.customId = value; return this; }
            setLabel(value) { this.label = value; return this; }
            setStyle(value) { this.style = value; return this; }
        }
        class TestRow {
            addComponents(...components) { this.components = components; return this; }
        }
        const config = {
            GUILD_ID: 'g1',
            TIMEZONE: 'Asia/Manila',
            LOG_CHANNEL: 'log',
            ROLES: { DAY: 'd', NIGHT: 'n' },
            EXCEPTIONS: {},
            POINTS: { OT: 5 },
            CLOCK_OUT_GRACE_MINS: 5,
            AUTO_OT_CONFIRM_EXPIRE_MINS: 0,
            AUTO_OT_CONFIRM_REMINDER_MINS: 5,
            OT_ACTIVITY_DENYLIST: ['Dota'],
            AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold',
            AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK: true
        };
        const noLiveState = {
            attendanceData: {
                noLiveUser: { id: 'noLiveUser', name: 'No Live User', shift: 'night', attendanceEvents: [] }
            },
            overtimeUsers: []
        };
        const scheduledEnd = moment.tz('2026-07-01 09:00', config.TIMEZONE);
        const sends = [];
        const noLiveClock = createClockWorkflow({
            client: {
                channels: { cache: { get: () => null }, fetch: async () => null },
                guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }
            },
            CONFIG: config,
            moment,
            attendanceService: {
                appendAttendanceEvent: (user, type, at, source, meta) => {
                    user.attendanceEvents.push({ type, at: at.toISOString(), source, meta });
                    return true;
                },
                getOvertimeStartMoment: () => scheduledEnd,
                getPostShiftOvertimeStartMoment: () => scheduledEnd,
                canStartPostShiftOvertime: () => true,
                getOpenSession: () => null,
                calculateSessionWorkedMinutes: () => null,
                applyOvertimeCore: () => {
                    throw new Error('OT must not start when LIVE is off at confirmation time');
                }
            },
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => noLiveState.attendanceData,
            getOvertimeUsers: () => noLiveState.overtimeUsers,
            setOvertimeUsers: list => { noLiveState.overtimeUsers.length = 0; noLiveState.overtimeUsers.push(...list); },
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: member => noLiveState.attendanceData[member.id],
            getActiveLiveException: () => null,
            getOperationalShift: () => 'night',
            getDashboardShift: () => 'night',
            getShiftBounds: () => ({
                start: moment.tz('2026-06-30 21:00', config.TIMEZONE),
                end: scheduledEnd
            }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
            mapRawClockInStatus: () => 'IN',
            mapRawClockOutStatus: () => 'OUT',
            ActionRowBuilder: TestRow,
            ButtonBuilder: TestButton,
            ButtonStyle: { Danger: 4, Secondary: 2 },
            logger: { warn: () => {}, error: () => {} }
        });
        const member = {
            id: 'noLiveUser',
            displayName: 'No Live User',
            voice: { streaming: true },
            presence: { activities: [{ type: 0, name: 'Lineage Classic' }] },
            guild: {
                presences: { cache: new Map() },
                voiceStates: { cache: new Map() }
            },
            send: async payload => {
                sends.push(payload);
                return { id: `no-live-dm${sends.length}`, channelId: 'dm' };
            }
        };
        const user = noLiveState.attendanceData.noLiveUser;

        await noLiveClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:06', config.TIMEZONE), 'unit-test', { scheduledEnd });
        assert.strictEqual(sends.length, 1, 'OT suspicion sends a confirmation DM before starting');

        member.voice.streaming = false;
        const startButton = sends[0].components[0].components[0];
        const result = await noLiveClock.handleAutoOvertimeConfirmation({
            customId: startButton.customId,
            user: { id: 'noLiveUser' },
            member,
            guild: member.guild
        }, moment.tz('2026-07-01 09:07', config.TIMEZONE));

        assert.strictEqual(result.message, 'LIVE is not on now, so OT was not started.', 'Start OT rechecks LIVE state');
        assert.strictEqual(user.pendingAutoOTConfirm.status, 'no-live', 'pending OT closes as no-live');
        assert.strictEqual(noLiveState.overtimeUsers.length, 0, 'no-live confirmation does not add an OT user');
        assert(user.attendanceEvents.some(event => event.type === 'auto_ot_confirmation_no_live'), 'no-live decision is recorded');
    }

    {
        const moment = require('moment-timezone');
        class TestButton {
            setCustomId(value) { this.customId = value; return this; }
            setLabel(value) { this.label = value; return this; }
            setStyle(value) { this.style = value; return this; }
        }
        class TestRow {
            addComponents(...components) { this.components = components; return this; }
        }
        const config = {
            GUILD_ID: 'g1',
            TIMEZONE: 'Asia/Manila',
            LOG_CHANNEL: 'log',
            ROLES: { DAY: 'd', NIGHT: 'n' },
            EXCEPTIONS: {},
            POINTS: { OT: 5 },
            CLOCK_OUT_GRACE_MINS: 5,
            AUTO_OT_CONFIRM_EXPIRE_MINS: 0,
            AUTO_OT_CONFIRM_REMINDER_MINS: 5,
            OT_ACTIVITY_DENYLIST: ['Dota'],
            AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold',
            AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK: true
        };
        const lateState = {
            attendanceData: {
                lateOtUser: { id: 'lateOtUser', name: 'Late OT User', shift: 'night', attendanceEvents: [] }
            },
            overtimeUsers: []
        };
        const sends = [];
        const scheduledEnd = moment.tz('2026-07-01 09:00', config.TIMEZONE);
        let canStartOptions = null;
        let applyOptions = null;
        const lateClock = createClockWorkflow({
            client: {
                channels: { cache: { get: () => null }, fetch: async () => null },
                guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }
            },
            CONFIG: config,
            moment,
            attendanceService: {
                appendAttendanceEvent: (user, type, at, source, meta) => {
                    user.attendanceEvents.push({ type, at: at.toISOString(), source, meta });
                    return true;
                },
                getOvertimeStartMoment: () => scheduledEnd,
                getPostShiftOvertimeStartMoment: (_user, now, options) => options?.allowLateReturn ? moment(now).tz(config.TIMEZONE) : scheduledEnd,
                canStartPostShiftOvertime: (_user, _now, options) => {
                    canStartOptions = options;
                    return Boolean(options?.allowLateReturn && options?.requireContinuousLive === false);
                },
                getOpenSession: () => null,
                calculateSessionWorkedMinutes: () => null,
                applyOvertimeCore: (user, now, type, source, reason, options) => {
                    applyOptions = options;
                    user.checkedIn = true;
                    user.attendanceStatus = 'OVERTIME';
                    user.pendingAutoOTConfirm = null;
                    lateState.overtimeUsers.push({ id: user.id, type, startedAt: options.startedAt.toISOString() });
                    return { ok: true, added: true };
                }
            },
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }) },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => lateState.attendanceData,
            getOvertimeUsers: () => lateState.overtimeUsers,
            setOvertimeUsers: list => { lateState.overtimeUsers.length = 0; lateState.overtimeUsers.push(...list); },
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: member => lateState.attendanceData[member.id],
            getActiveLiveException: () => null,
            getOperationalShift: () => 'night',
            getDashboardShift: () => 'night',
            getShiftBounds: () => ({
                start: moment.tz('2026-06-30 21:00', config.TIMEZONE),
                end: scheduledEnd
            }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
            mapRawClockInStatus: () => 'IN',
            mapRawClockOutStatus: () => 'OUT',
            ActionRowBuilder: TestRow,
            ButtonBuilder: TestButton,
            ButtonStyle: { Danger: 4, Secondary: 2 },
            logger: { warn: () => {}, error: () => {} }
        });
        const member = {
            id: 'lateOtUser',
            displayName: 'Late OT User',
            voice: { streaming: true },
            presence: { activities: [] },
            guild: {
                presences: { cache: new Map() },
                voiceStates: { cache: new Map() }
            },
            send: async payload => {
                sends.push(payload);
                return { id: `late-dm${sends.length}`, channelId: 'dm' };
            }
        };
        const user = lateState.attendanceData.lateOtUser;

        await lateClock.requestPostShiftOvertimeConfirmation(member, user, moment.tz('2026-07-01 09:45', config.TIMEZONE), 'unit-test', {
            scheduledEnd,
            allowLateReturn: true,
            requireContinuousLive: false
        });
        assert.strictEqual(sends.length, 1, 'late-return live sends an OT confirmation DM');
        assert.strictEqual(user.pendingAutoOTConfirm.activityFallback, 'late-return-live', 'late-return pending OT records live-now fallback evidence');
        assert(sends[0].content.includes('new OT session from now'), 'late-return DM says OT starts from now');

        const startButton = sends[0].components[0].components[0];
        const result = await lateClock.handleAutoOvertimeConfirmation({
            customId: startButton.customId,
            user: { id: 'lateOtUser' },
            member,
            guild: member.guild
        }, moment.tz('2026-07-01 09:46', config.TIMEZONE));

        assert.strictEqual(result.message, 'OT started. Thank you.', 'late-return DM approval can start detached OT');
        assert.strictEqual(canStartOptions?.allowLateReturn, true, 'late-return confirmation uses allowLateReturn');
        assert.strictEqual(applyOptions?.resetClockInForOvertime, true, 'late-return OT resets clock-in to the new OT start');
        assert.strictEqual(applyOptions?.otEvidence?.liveOnAtConfirmation, true, 'OT evidence records the live-on recheck');
        assert.strictEqual(applyOptions?.otEvidence?.activityStatus, 'unknown', 'OT evidence records hidden activity status');
        assert.strictEqual(applyOptions?.otEvidence?.activityFallback, 'late-return-live', 'OT evidence records late-return fallback');
        assert.strictEqual(applyOptions?.otEvidence?.allowLateReturn, true, 'OT evidence records detached late-return mode');
        assert.strictEqual(lateState.overtimeUsers[0].startedAt, moment.tz('2026-07-01 09:46', config.TIMEZONE).toISOString(), 'late-return OT starts at button approval time');
    }

    {
        const rawRows = [];
        const moment = require('moment-timezone');
        const absentClock = createClockWorkflow({
            client: { guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }, channels: { cache: { get: () => null }, fetch: async () => null } },
            CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila', ROLES: { DAY: 'd', NIGHT: 'n' }, EXCEPTIONS: {}, CLOCK_OUT_GRACE_MINS: 15 },
            moment,
            attendanceService: {
                applyClockInCore: (user, member, shift, now) => {
                    user.id = member.id;
                    user.name = member.displayName;
                    user.shift = shift;
                    user.status = 'late';
                    user.attendanceStatus = 'WORKING';
                    user.checkInRaw = now.toISOString();
                    return {
                        ok: true,
                        recognizedAt: now,
                        preShift: false,
                        session: { scheduledStartAt: moment.tz('2026-06-28 21:00', 'Asia/Manila').toISOString() },
                        convertedAbsentToLate: true
                    };
                },
                getOpenSession: () => null,
                appendAttendanceEvent: () => true
            },
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'NIGHT' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: { sendAttendanceRow: async row => { rawRows.push(row); return { ok: true }; } },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => ({}),
            getOvertimeUsers: () => [],
            setOvertimeUsers: () => {},
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: member => ({ id: member.id, name: member.displayName }),
            getActiveLiveException: () => null,
            getOperationalShift: () => 'night',
            getDashboardShift: () => 'night',
            getShiftBounds: () => ({ start: moment.tz('2026-06-28 21:00', 'Asia/Manila'), end: moment.tz('2026-06-29 09:00', 'Asia/Manila') }),
            getShiftSessionKey: () => 'key',
            getRecognizedClockInMoment: (shift, now) => ({ ok: true, recognizedAt: now, preShift: false, bounds: {} }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: { ABSENT: '결석' },
            mapRawClockInStatus: status => status === 'late' ? '지각' : '정출',
            mapRawClockOutStatus: () => '지각'
        });

        await absentClock.handleClockIn({ id: 'late-return', displayName: 'Late Return', user: { username: 'Late Return' } }, {}, 'night', moment.tz('2026-06-28 23:30', 'Asia/Manila'), true);
        assert.deepStrictEqual(rawRows, [{
            date: '2026-06-28',
            server: 'PAAGRIO',
            shift: 'NIGHT',
            name: 'Late Return',
            status: '지각',
            inTime: '23:30',
            outTime: '-',
            note: '2시간 이상 지각 - 결석 취소, 지각 처리',
            forceStatus: true
        }]);
    }

    {
        const moment = require('moment-timezone');
        const { createAttendanceService } = require('../src/services/attendanceService');
        const dayState = { attendanceData: {}, overtimeUsers: [] };
        const rawRows = [];
        const logs = [];
        const config = {
            GUILD_ID: 'g1',
            TIMEZONE: 'Asia/Manila',
            LOG_CHANNEL: 'log',
            ROLES: { DAY: 'd', NIGHT: 'n' },
            EXCEPTIONS: {},
            POINTS: { NORMAL_IN: 10, LATE: -5, EXCESSIVE_LATE: -10, EARLY_OUT: -10, OT: 5, ABSENT: -25 },
            CLOCK_IN_GRACE_MINS: 0,
            CLOCK_OUT_GRACE_MINS: 5,
            GRACE_PERIOD_MINS: 10,
            LIVE_OFF_IGNORE_MINS: 2
        };
        const dayAt = value => moment.tz(value, 'YYYY-MM-DD HH:mm', config.TIMEZONE);
        const getDayBounds = (shift, now) => {
            const start = moment(now).tz(config.TIMEZONE).hour(9).minute(0).second(0).millisecond(0);
            return { start, end: start.clone().hour(21) };
        };
        const attendance = createAttendanceService({
            CONFIG: config,
            moment,
            getAttendanceData: () => dayState.attendanceData,
            getOvertimeUsers: () => dayState.overtimeUsers,
            determineShift: () => 'day',
            getShiftSessionKey: (shift, now) => `${shift}:${moment(now).tz(config.TIMEZONE).format('YYYY-MM-DD')}`,
            getShiftBounds: getDayBounds
        });
        const dayClock = createClockWorkflow({
            client: {
                channels: {
                    cache: { get: () => ({ send: async text => logs.push(text) }) },
                    fetch: async () => null
                },
                guilds: { cache: { get: () => ({ members: { cache: new Map() } }) } }
            },
            CONFIG: config,
            moment,
            attendanceService: attendance,
            roleService: {
                getWorkerRoleProfileFromMember: () => ({ server: 'PAAGRIO', shift: 'DAY' }),
                getWorkerRoleProfileFromNickname: () => null
            },
            rawAttendanceSheetService: {
                sendAttendanceRow: async row => {
                    rawRows.push(row);
                    return { ok: true };
                }
            },
            dashboardStateUtils: require('../src/utils/dashboardState'),
            getAttendanceData: () => dayState.attendanceData,
            getOvertimeUsers: () => dayState.overtimeUsers,
            setOvertimeUsers: list => { dayState.overtimeUsers.length = 0; dayState.overtimeUsers.push(...list); },
            saveSystemAsync: async () => {},
            updateWorkingRole: async () => {},
            ensureUserData: (member, shift) => attendance.ensureUserData(member, shift),
            getActiveLiveException: () => null,
            getOperationalShift: () => 'day',
            getDashboardShift: () => 'day',
            getShiftBounds: getDayBounds,
            getShiftSessionKey: (shift, now) => `${shift}:${moment(now).tz(config.TIMEZONE).format('YYYY-MM-DD')}`,
            getRecognizedClockInMoment: (shift, now) => ({
                ok: true,
                recognizedAt: moment(now).tz(config.TIMEZONE),
                preShift: false,
                bounds: getDayBounds(shift, now)
            }),
            isWithinPreShiftWindow: () => false,
            getTimeLogicRecentMaintenanceEnd: () => null,
            formatDuration: mins => `${mins}m`,
            RAW_ATTENDANCE_STATUS: {
                DAY_OFF: '\uD734\uBB34',
                OVERTIME: '\uC5F0\uC7A5\uADFC\uBB34',
                ABSENT: '\uACB0\uC11D'
            },
            mapRawClockInStatus: status => status === 'late' ? '\uC9C0\uAC01' : '\uC815\uCD9C',
            mapRawClockOutStatus: () => '\uC870\uD1F4'
        });
        const member = {
            id: 'day-late-early',
            displayName: 'Day Late Early',
            user: { username: 'Day Late Early' },
            voice: { channelId: null, streaming: false },
            send: async () => {}
        };
        const user = attendance.ensureUserData(member, 'day');

        await dayClock.handleClockIn(member, user, 'day', dayAt('2026-07-01 09:20'), true);
        await dayClock.handleClockOut(member, user, dayAt('2026-07-01 15:30'), '\uC218\uB3D9 \uC870\uAE30\uD1F4\uADFC');

        assert.strictEqual(user.totalLate, 1, 'day late count remains after early-out');
        assert.strictEqual(user.totalEarly, 1, 'day early-out count is added');
        assert.strictEqual(user.points, -15, 'day late plus early-out scores -15');
        assert.strictEqual(user.monthlyStats.totalLate, 1, 'monthly day late remains after early-out');
        assert.strictEqual(user.monthlyStats.totalEarly, 1, 'monthly day early-out is added');
        assert.strictEqual(user.monthlyStats.points, -15, 'monthly day late plus early-out scores -15');
        assert.strictEqual(rawRows[0].status, '\uC9C0\uAC01', 'raw sheet receives the initial day late status');
        assert.strictEqual(rawRows[1].status, '\uC870\uD1F4', 'raw sheet receives the final day early-out status');
    }

    const { createAttendanceService } = require('../src/services/attendanceService');
    const attendanceService = createAttendanceService({
        CONFIG: { TIMEZONE: 'Asia/Manila' },
        moment: require('moment-timezone'),
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        determineShift: () => 'day',
        getShiftSessionKey: () => 'key',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() })
    });

    const runtime = createWorkflowRuntime({
        client: clockDepsClient(),
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Manila', STATUS_CHANNEL: 's', ROLES: { DAY: 'd', NIGHT: 'n', WORKING: 'w' }, LOG_CHANNEL: 'l', CLOCK_OUT_GRACE_MINS: 15 },
        moment: require('moment-timezone'),
        fs: require('fs'),
        EmbedBuilder: class {},
        ActionRowBuilder: class {},
        ButtonBuilder: class {},
        ButtonStyle: {},
        PermissionFlagsBits: {},
        padWidth: (v, w) => String(v).padEnd(w),
        truncateWidth: v => String(v),
        formatExactWidth: v => String(v),
        renderEmbedCodeBlock: v => v,
        safeAddFields: () => {},
        refreshGuildMembers: async () => true,
        dashboardMessageService: {
            consolidateStatusMessages: async () => ({ keptId: null, deleted: 0 }),
            upsertStatusMessage: async () => ({ statusMessageId: null, created: false, updated: false, skipped: true })
        },
        attendanceService,
        roleService: {},
        rawAttendanceSheetService: { sendAttendanceRow: async () => ({ ok: true }), sendWorkerProfile: async () => ({ ok: true }), removeWorkerProfile: async () => ({ ok: true }) },
        dashboardStateUtils: require('../src/utils/dashboardState'),
        getDashboardShift: () => 'day',
        getShiftBounds: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getOperationalShift: () => 'day',
        getAttendanceData: () => attendanceData,
        getOvertimeUsers: () => overtimeUsers,
        setOvertimeUsers: list => { overtimeUsers.length = 0; overtimeUsers.push(...list); },
        getAnnounceData: () => ({}),
        getLiveExceptions: () => ({}),
        getDayOffReservations: () => ({}),
        getStatusMessageId: () => null,
        setStatusMessageId: () => {},
        getLastSavedAt: () => null,
        getLastBackupAt: () => null,
        getPanelInfo: () => ({ day: { cId: 'd', mId: null }, night: { cId: 'n', mId: null } }),
        setPanelMessageId: () => {},
        removeOvertimeUser: () => {},
        saveSystemAsync: async () => {},
        updateWorkingRole: async () => {},
        dayOffService: {},
        ensureUserData: () => null,
        determineShift: () => 'day',
        getDayOffLogicalDateForShift: () => '2026-01-01',
        buildShiftBoundsForBusinessDate: () => ({ start: require('moment-timezone')(), end: require('moment-timezone')() }),
        getDashboardName: () => 'x',
        collectStatusTransitionWarnings: () => [],
        isAssignedWorker: () => false,
        hasManagedAttendanceRole: () => false,
        createBackupSnapshot: async () => {},
        getRuntimeHealthSnapshot: () => ({}),
        getStartupBuildInfo: () => ({}),
        readRuntimeHealthFile: async () => ({}),
        buildCommandDefinitions: () => [],
        hiddenCommandAliases: {},
        validateCommandPayloads: () => [],
        getActiveMaintenanceWindow: () => null,
        isMaintenanceWindow: () => false,
        isWithinPreShiftWindow: () => false,
        getTimeLogicRecentMaintenanceEnd: () => null,
        maintenanceOverrideService: {},
        opsQueueService: { list: async () => [], retryAll: async () => ({ total: 0, succeeded: 0, failed: 0 }) },
        purchaseSheetService: {},
        retryQueuedItem: async () => ({ ok: true }),
        isOwnerId: () => false,
        renderPercentBar: () => '',
        renderReportTopRow: () => '',
        renderReportStatsLegend: () => '',
        renderReportMetricRow: () => '',
        renderReportMetricHeader: () => '',
        renderSessionMetricRow: () => '',
        formatDuration: mins => `${mins}m`,
        formatKoreanDateTime: () => '',
        RAW_ATTENDANCE_STATUS: { DAY_OFF: 'DAY_OFF', OVERTIME: 'OT' },
        mapRawClockInStatus: () => 'IN',
        mapRawClockOutStatus: () => 'OUT',
        getWorkerProfileForRawSync: () => ({ shift: 'day' }),
        DAY_OFF_REQUEST_CUSTOM_IDS: {},
        reactionCleanupLocks: new Set(),
        getDayOffPanelPayload: () => ({}),
        alertState: {
            lastOperationalIssueSignature: null,
            lastOperationalIssueAlertAt: 0,
            lastOpsQueueAutoRetryAt: 0,
            lastOpsQueueStuckAlertAt: 0,
            lastOpsQueueAutoResultSignature: null,
            lastOpsQueueAutoResultAlertAt: 0
        }
    });

    assert.ok(runtime.clock);
    assert.ok(runtime.voice);
    assert.strictEqual(typeof runtime.clock.handleClockIn, 'function');
    assert.strictEqual(typeof runtime.voice.syncVoiceStates, 'function');

    console.log('workflow-phase3 tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});

function clockDepsClient() {
    return {
        guilds: { cache: { get: () => ({ members: { cache: new Map() }, voiceStates: { cache: new Map() } }) } },
        channels: { cache: { get: () => null }, fetch: async () => null }
    };
}
